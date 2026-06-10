use crate::{
    app::AppState,
    auth::{
        administrator_exists, authenticate_native_access_token, authenticate_session,
        generate_secret, hash_password, hash_secret, normalize_username, user_from_row,
        validate_password, verify_password, AuthenticatedUser, CSRF_COOKIE, SESSION_COOKIE,
    },
};
use axum::{
    extract::{Extension, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_protocol::{
    AdminOverview, ApiError, AuditEvent, BootstrapStatus, BrowserSession, CreatedInvitation,
    DataResponse, ErrorCode, ErrorResponse, HealthState, HostedVaultSummary, Invitation,
    NativeSession, OperationalWarning, ServerUser, ServerUserRole, StorageSummary,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    pub password: String,
    #[serde(default)]
    pub admin: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
    pub display_name: Option<String>,
    pub disabled: Option<bool>,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvitationRequest {
    pub username: String,
    pub display_name: String,
    #[serde(default)]
    pub admin: bool,
    #[serde(default = "default_invitation_hours")]
    pub expires_in_hours: i64,
}

fn default_invitation_hours() -> i64 {
    72
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptInvitationRequest {
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLoginRequest {
    pub username: String,
    pub password: String,
    #[serde(default = "default_client_name")]
    pub client_name: String,
}

fn default_client_name() -> String {
    "Collab desktop".into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordRequest {
    pub new_password: String,
}

pub async fn bootstrap_status(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
) -> ApiResult<BootstrapStatus> {
    let required = !administrator_exists(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id))?;
    Ok(Json(DataResponse::new(BootstrapStatus { required })))
}

pub async fn bootstrap(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Response, ApiFailure> {
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query("SELECT pg_advisory_xact_lock(7302026)")
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if administrator_exists_transaction(&mut transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?
    {
        return Err(ApiFailure::new(
            StatusCode::CONFLICT,
            ErrorCode::BootstrapAlreadyCompleted,
            "The first administrator has already been created.",
            request_id,
        ));
    }
    let mut user = insert_user(&mut transaction, &payload, true, &request_id).await?;
    sqlx::query("UPDATE users SET is_primary_admin = TRUE WHERE id = $1")
        .bind(Uuid::parse_str(&user.id).expect("database UUID is valid"))
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    user.is_primary_admin = true;
    audit(
        &mut transaction,
        Some(&user.id),
        "admin.bootstrap",
        Some("user"),
        Some(&user.id),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    create_browser_session(&state, &headers, user, &request_id).await
}

pub async fn login(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<Response, ApiFailure> {
    let normalized = normalize_username(&payload.username).map_err(|error| {
        ApiFailure::new(
            StatusCode::UNAUTHORIZED,
            ErrorCode::AuthenticationInvalid,
            error.to_string(),
            request_id.clone(),
        )
    })?;
    if !state.login_limiter.allow(&normalized).await {
        return Err(ApiFailure::new(
            StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::RateLimited,
            "Too many login attempts. Try again shortly.",
            request_id,
        ));
    }

    let row = sqlx::query(
        r#"
        SELECT u.id, u.username, u.display_name, u.role::text AS role, u.status::text AS status,
               u.created_at, u.last_login_at, u.is_primary_admin, c.password_hash,
               (SELECT COUNT(*) FROM sessions active
                WHERE active.user_id = u.id AND active.revoked_at IS NULL AND active.expires_at > NOW())
                AS active_sessions
        FROM users u JOIN credentials c ON c.user_id = u.id
        WHERE u.normalized_username = $1
        "#,
    )
    .bind(&normalized)
    .fetch_optional(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;

    let valid = row
        .as_ref()
        .map(|row| {
            row.get::<String, _>("status") == "active"
                && verify_password(
                    &payload.password,
                    row.get::<String, _>("password_hash").as_str(),
                )
        })
        .unwrap_or(false);
    if !valid {
        record_audit(
            &state.database,
            None,
            "auth.login",
            None,
            None,
            "failure",
            &request_id,
            json!({"username": normalized}),
        )
        .await?;
        return Err(ApiFailure::new(
            StatusCode::UNAUTHORIZED,
            ErrorCode::AuthenticationInvalid,
            "The username or password is incorrect.",
            request_id,
        ));
    }

    state.login_limiter.clear(&normalized).await;
    let user = user_from_row(row.as_ref().expect("validated row exists"));
    sqlx::query("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1")
        .bind(Uuid::parse_str(&user.id).expect("database UUID is valid"))
        .execute(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    record_audit(
        &state.database,
        Some(&user.id),
        "auth.login",
        Some("user"),
        Some(&user.id),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    create_browser_session(&state, &headers, user, &request_id).await
}

pub async fn me(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<Json<DataResponse<ServerUser>>, ApiFailure> {
    let authenticated = require_user(&state, &headers, &request_id).await?;
    Ok(Json(DataResponse::new(authenticated.user)))
}

pub async fn logout(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<Response, ApiFailure> {
    let authenticated = require_csrf(&state, &headers, &request_id).await?;
    sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE id = $1")
        .bind(authenticated.session_id)
        .execute(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    record_audit(
        &state.database,
        Some(&authenticated.user.id),
        "auth.logout",
        Some("session"),
        Some(&authenticated.session_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    append_expired_cookie(
        &mut response,
        SESSION_COOKIE,
        state.config.browser_secure_cookies,
    );
    append_expired_cookie(
        &mut response,
        CSRF_COOKIE,
        state.config.browser_secure_cookies,
    );
    Ok(response)
}

pub async fn native_login(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    Json(payload): Json<NativeLoginRequest>,
) -> Result<Json<DataResponse<NativeSession>>, ApiFailure> {
    let user =
        authenticate_password(&state, &payload.username, &payload.password, &request_id).await?;
    let session = create_native_session(&state, user, &payload.client_name, &request_id).await?;
    Ok(Json(DataResponse::new(session)))
}

pub async fn refresh(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    Json(payload): Json<RefreshRequest>,
) -> Result<Json<DataResponse<NativeSession>>, ApiFailure> {
    let token_hash = hash_secret(&payload.refresh_token);
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let row = sqlx::query(
        r#"
        SELECT s.id AS session_id, s.user_id, s.refresh_token_hash, s.previous_refresh_token_hash,
               s.client_name, s.refresh_expires_at, s.revoked_at,
               u.id, u.username, u.display_name, u.role::text AS role, u.status::text AS status,
               u.created_at, u.last_login_at, u.is_primary_admin,
               ((SELECT COUNT(*) FROM sessions active WHERE active.user_id = u.id AND active.revoked_at IS NULL AND active.expires_at > NOW())
                + (SELECT COUNT(*) FROM native_sessions active WHERE active.user_id = u.id AND active.revoked_at IS NULL AND active.refresh_expires_at > NOW()))
                AS active_sessions
        FROM native_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.refresh_token_hash = $1 OR s.previous_refresh_token_hash = $1
        FOR UPDATE OF s
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?
    .ok_or_else(|| ApiFailure::authentication_required(request_id.clone()))?;

    let session_id: Uuid = row.get("session_id");
    let current_hash: String = row.get("refresh_token_hash");
    let active = row
        .get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at")
        .is_none()
        && row.get::<chrono::DateTime<chrono::Utc>, _>("refresh_expires_at") > chrono::Utc::now()
        && row.get::<String, _>("status") == "active";
    if token_hash != current_hash {
        sqlx::query("UPDATE native_sessions SET revoked_at = NOW() WHERE id = $1")
            .bind(session_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
        transaction
            .commit()
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
        return Err(ApiFailure::new(
            StatusCode::UNAUTHORIZED,
            ErrorCode::SessionRevoked,
            "The refresh token has already been used.",
            request_id,
        ));
    }
    if !active {
        return Err(ApiFailure::new(
            StatusCode::UNAUTHORIZED,
            ErrorCode::SessionExpired,
            "The session has expired or was revoked.",
            request_id,
        ));
    }

    let user = user_from_row(&row);
    let access_token = generate_secret();
    let refresh_token = generate_secret();
    let access_expires_at =
        chrono::Utc::now() + chrono::Duration::minutes(state.config.native_access_ttl_minutes);
    let refresh_expires_at =
        chrono::Utc::now() + chrono::Duration::days(state.config.native_refresh_ttl_days);
    let rotated = sqlx::query(
        r#"
        UPDATE native_sessions SET access_token_hash = $1, previous_refresh_token_hash = refresh_token_hash,
          refresh_token_hash = $2, access_expires_at = $3, refresh_expires_at = $4, last_seen_at = NOW()
        WHERE id = $5
        "#,
    )
    .bind(hash_secret(&access_token))
    .bind(hash_secret(&refresh_token))
    .bind(access_expires_at)
    .bind(refresh_expires_at)
    .bind(session_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if rotated.rows_affected() != 1 {
        return Err(ApiFailure::server(request_id));
    }
    audit(
        &mut transaction,
        Some(&user.id),
        "auth.native.refresh",
        Some("session"),
        Some(&session_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(NativeSession {
        user,
        access_token,
        refresh_token,
        access_expires_at: access_expires_at.to_rfc3339(),
        refresh_expires_at: refresh_expires_at.to_rfc3339(),
    })))
}

pub async fn native_logout(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiFailure> {
    let authenticated = require_native_user(&state, &headers, &request_id).await?;
    sqlx::query("UPDATE native_sessions SET revoked_at = NOW() WHERE id = $1")
        .bind(authenticated.session_id)
        .execute(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    record_audit(
        &state.database,
        Some(&authenticated.user.id),
        "auth.native.logout",
        Some("session"),
        Some(&authenticated.session_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn change_password(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<StatusCode, ApiFailure> {
    let authenticated = require_any_user(&state, &headers, &request_id).await?;
    let hash =
        sqlx::query_scalar::<_, String>("SELECT password_hash FROM credentials WHERE user_id = $1")
            .bind(Uuid::parse_str(&authenticated.user.id).expect("database UUID is valid"))
            .fetch_one(&state.database)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if !verify_password(&payload.current_password, &hash) {
        return Err(ApiFailure::new(
            StatusCode::UNAUTHORIZED,
            ErrorCode::AuthenticationInvalid,
            "The current password is incorrect.",
            request_id,
        ));
    }
    replace_password_and_revoke(
        &state.database,
        Uuid::parse_str(&authenticated.user.id).unwrap(),
        &payload.new_password,
        Some(authenticated.session_id),
        &request_id,
    )
    .await?;
    record_audit(
        &state.database,
        Some(&authenticated.user.id),
        "auth.password.change",
        Some("user"),
        Some(&authenticated.user.id),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn overview(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<Json<DataResponse<AdminOverview>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    let counts = sqlx::query(
        r#"
        SELECT
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
          ((SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > NOW())
           + (SELECT COUNT(*) FROM native_sessions WHERE revoked_at IS NULL AND refresh_expires_at > NOW())) AS active_sessions,
          (SELECT COUNT(*) FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()) AS pending_invitations
        "#,
    )
    .fetch_one(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let events = list_audit_events(&state.database, 8, &request_id).await?;
    let database_bytes =
        sqlx::query_scalar::<_, i64>("SELECT pg_database_size(current_database())")
            .fetch_one(&state.database)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let blob_bytes = state
        .blobs
        .total_bytes()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let mut warnings = Vec::new();
    if !state.config.browser_secure_cookies {
        warnings.push(OperationalWarning {
            code: "insecure_browser_cookies".into(),
            message: "Secure browser cookies are disabled. Enable them behind TLS for production."
                .into(),
            severity: "warning".into(),
        });
    }
    let expired_invitations = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= NOW()",
    ).fetch_one(&state.database).await.map_err(|_| ApiFailure::server(request_id.clone()))?;
    if expired_invitations > 0 {
        warnings.push(OperationalWarning {
            code: "expired_invitations".into(),
            message: format!("{expired_invitations} expired invitation(s) can be cleaned up."),
            severity: "info".into(),
        });
    }
    Ok(Json(DataResponse::new(AdminOverview {
        health: if state.blobs.health_check().await.is_ok() {
            HealthState::Ok
        } else {
            HealthState::Degraded
        },
        server_version: env!("CARGO_PKG_VERSION").into(),
        protocol_version: collab_protocol::PROTOCOL_VERSION,
        uptime_seconds: state.started_at.elapsed().as_secs(),
        users: counts.get("users"),
        active_users: counts.get("active_users"),
        active_sessions: counts.get("active_sessions"),
        pending_invitations: counts.get("pending_invitations"),
        hosted_vaults: 0,
        storage: StorageSummary {
            database_bytes,
            blob_bytes,
        },
        operational_warnings: warnings,
        recent_audit_events: events,
    })))
}

pub async fn list_users(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<Json<DataResponse<Vec<ServerUser>>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    let rows = sqlx::query(
        r#"
        SELECT u.id, u.username, u.display_name, u.role::text AS role, u.status::text AS status,
               u.created_at, u.last_login_at, u.is_primary_admin,
               ((SELECT COUNT(*) FROM sessions active
                 WHERE active.user_id = u.id AND active.revoked_at IS NULL AND active.expires_at > NOW())
                + (SELECT COUNT(*) FROM native_sessions active
                   WHERE active.user_id = u.id AND active.revoked_at IS NULL AND active.refresh_expires_at > NOW()))
                AS active_sessions
        FROM users u ORDER BY u.created_at ASC
        "#,
    )
    .fetch_all(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        rows.iter().map(user_from_row).collect(),
    )))
}

pub async fn create_user(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<DataResponse<ServerUser>>), ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let user = insert_user(&mut transaction, &payload, payload.admin, &request_id).await?;
    audit(
        &mut transaction,
        Some(&actor.user.id),
        "admin.user.create",
        Some("user"),
        Some(&user.id),
        "success",
        &request_id,
        json!({"role": if payload.admin { "admin" } else { "member" }}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id))?;
    Ok((StatusCode::CREATED, Json(DataResponse::new(user))))
}

pub async fn update_user(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<Json<DataResponse<ServerUser>>, ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    if payload.disabled == Some(true)
        && is_primary_admin(&state.database, user_id, &request_id).await?
    {
        return Err(ApiFailure::validation(
            "The primary administrator account cannot be disabled.",
            request_id,
        ));
    }
    if payload.disabled == Some(true) && actor.user.id == user_id.to_string() {
        return Err(ApiFailure::validation(
            "Administrators cannot disable their own account.",
            request_id,
        ));
    }
    if let Some(password) = payload.password.as_deref() {
        validate_password(password)
            .map_err(|error| ApiFailure::validation(error.to_string(), request_id.clone()))?;
        let password_hash = hash_password(password)
            .map_err(|error| ApiFailure::validation(error.to_string(), request_id.clone()))?;
        sqlx::query(
            "UPDATE credentials SET password_hash = $1, password_changed_at = NOW() WHERE user_id = $2",
        )
        .bind(password_hash)
        .bind(user_id)
        .execute(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
        sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1")
            .bind(user_id)
            .execute(&state.database)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
        sqlx::query("UPDATE native_sessions SET revoked_at = NOW() WHERE user_id = $1")
            .bind(user_id)
            .execute(&state.database)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
    }
    let disabled = payload.disabled;
    let row = sqlx::query(
        r#"
        UPDATE users SET
          display_name = COALESCE($1, display_name),
          status = CASE
            WHEN $2::boolean IS NULL THEN status
            WHEN $2 THEN 'disabled'::server_user_status
            ELSE 'active'::server_user_status
          END,
          updated_at = NOW()
        WHERE id = $3
        RETURNING id, username, display_name, role::text AS role, status::text AS status,
                  created_at, last_login_at, is_primary_admin, 0::bigint AS active_sessions
        "#,
    )
    .bind(payload.display_name)
    .bind(disabled)
    .bind(user_id)
    .fetch_optional(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    if disabled == Some(true) {
        sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1")
            .bind(user_id)
            .execute(&state.database)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
        sqlx::query("UPDATE native_sessions SET revoked_at = NOW() WHERE user_id = $1")
            .bind(user_id)
            .execute(&state.database)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
    }
    let user = user_from_row(&row);
    record_audit(
        &state.database,
        Some(&actor.user.id),
        "admin.user.update",
        Some("user"),
        Some(&user.id),
        "success",
        &request_id,
        json!({"disabled": disabled, "passwordReset": payload.password.is_some()}),
    )
    .await?;
    Ok(Json(DataResponse::new(user)))
}

pub async fn delete_user(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    if actor.user.id == user_id.to_string() {
        return Err(ApiFailure::validation(
            "Administrators cannot delete their own account.",
            request_id,
        ));
    }
    if is_primary_admin(&state.database, user_id, &request_id).await? {
        return Err(ApiFailure::validation(
            "The primary administrator account cannot be deleted.",
            request_id,
        ));
    }

    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if !exists {
        return Err(ApiFailure::not_found(request_id));
    }
    audit(
        &mut transaction,
        Some(&actor.user.id),
        "admin.user.delete",
        Some("user"),
        Some(&user_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn revoke_user_sessions(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query(
        "UPDATE native_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    record_audit(
        &state.database,
        Some(&actor.user.id),
        "admin.user.sessions.revoke",
        Some("user"),
        Some(&user_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn reset_user_password(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<ResetPasswordRequest>,
) -> Result<StatusCode, ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    replace_password_and_revoke(
        &state.database,
        user_id,
        &payload.new_password,
        None,
        &request_id,
    )
    .await?;
    record_audit(
        &state.database,
        Some(&actor.user.id),
        "admin.user.password.reset",
        Some("user"),
        Some(&user_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn create_invitation(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Json(payload): Json<CreateInvitationRequest>,
) -> Result<(StatusCode, Json<DataResponse<CreatedInvitation>>), ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    let normalized = normalize_username(&payload.username)
        .map_err(|error| ApiFailure::validation(error.to_string(), request_id.clone()))?;
    if payload.display_name.trim().is_empty()
        || payload.display_name.len() > 128
        || !(1..=24 * 30).contains(&payload.expires_in_hours)
    {
        return Err(ApiFailure::validation(
            "Invitation display name or expiry is invalid.",
            request_id,
        ));
    }
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE normalized_username = $1)",
    )
    .bind(&normalized)
    .fetch_one(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if exists {
        return Err(ApiFailure::validation(
            "That username already exists.",
            request_id,
        ));
    }
    sqlx::query(
        "UPDATE invitations SET revoked_at = NOW() WHERE normalized_username = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= NOW()",
    )
    .bind(&normalized)
    .execute(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let raw_token = generate_secret();
    let row = sqlx::query(
        r#"
        INSERT INTO invitations (id, token_hash, username, normalized_username, display_name, role, created_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN 'admin'::server_user_role ELSE 'member'::server_user_role END,
                $7, NOW() + ($8 || ' hours')::interval)
        RETURNING id, username, display_name, role::text AS role, created_at, expires_at, accepted_at, revoked_at
        "#,
    )
    .bind(Uuid::now_v7()).bind(hash_secret(&raw_token)).bind(payload.username.trim()).bind(normalized)
    .bind(payload.display_name.trim()).bind(payload.admin).bind(Uuid::parse_str(&actor.user.id).unwrap())
    .bind(payload.expires_in_hours.to_string())
    .fetch_one(&state.database).await.map_err(|error| {
        if error.as_database_error().and_then(|value| value.code()).as_deref() == Some("23505") {
            ApiFailure::validation("A pending invitation already exists for that username.", request_id.clone())
        } else { ApiFailure::server(request_id.clone()) }
    })?;
    let invitation = invitation_from_row(&row);
    record_audit(
        &state.database,
        Some(&actor.user.id),
        "admin.invitation.create",
        Some("invitation"),
        Some(&invitation.id),
        "success",
        &request_id,
        json!({"role": if payload.admin { "admin" } else { "member" }}),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(CreatedInvitation {
            invitation,
            token: raw_token,
        })),
    ))
}

pub async fn list_invitations(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<Json<DataResponse<Vec<Invitation>>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    let rows = sqlx::query("SELECT id, username, display_name, role::text AS role, created_at, expires_at, accepted_at, revoked_at FROM invitations ORDER BY created_at DESC")
        .fetch_all(&state.database).await.map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        rows.iter().map(invitation_from_row).collect(),
    )))
}

pub async fn accept_invitation(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(payload): Json<AcceptInvitationRequest>,
) -> Result<Response, ApiFailure> {
    validate_password(&payload.password)
        .map_err(|error| ApiFailure::validation(error.to_string(), request_id.clone()))?;
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let row = sqlx::query(
        "SELECT id, username, display_name, role::text AS role FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() FOR UPDATE",
    ).bind(hash_secret(&token)).fetch_optional(&mut *transaction).await
        .map_err(|_| ApiFailure::server(request_id.clone()))?
        .ok_or_else(|| ApiFailure::new(StatusCode::GONE, ErrorCode::ResourceNotFound, "The invitation is invalid or expired.", request_id.clone()))?;
    let create = CreateUserRequest {
        username: row.get("username"),
        display_name: row.get("display_name"),
        password: payload.password,
        admin: row.get::<String, _>("role") == "admin",
    };
    let user = insert_user(&mut transaction, &create, create.admin, &request_id).await?;
    let invitation_id: Uuid = row.get("id");
    sqlx::query("UPDATE invitations SET accepted_at = NOW() WHERE id = $1")
        .bind(invitation_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    audit(
        &mut transaction,
        Some(&user.id),
        "auth.invitation.accept",
        Some("invitation"),
        Some(&invitation_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    create_browser_session(&state, &headers, user, &request_id).await
}

pub async fn user_activity(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<DataResponse<Vec<AuditEvent>>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    Ok(Json(DataResponse::new(
        list_user_audit_events(&state.database, user_id, 100, &request_id).await?,
    )))
}

pub async fn hosted_vaults(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<Json<DataResponse<Vec<HostedVaultSummary>>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    Ok(Json(DataResponse::new(Vec::new())))
}

pub async fn audit_events(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<Json<DataResponse<Vec<AuditEvent>>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    Ok(Json(DataResponse::new(
        list_audit_events(&state.database, 100, &request_id).await?,
    )))
}

async fn authenticate_password(
    state: &AppState,
    username: &str,
    password: &str,
    request_id: &str,
) -> Result<ServerUser, ApiFailure> {
    let normalized = normalize_username(username).map_err(|_| {
        ApiFailure::new(
            StatusCode::UNAUTHORIZED,
            ErrorCode::AuthenticationInvalid,
            "The username or password is incorrect.",
            request_id.to_owned(),
        )
    })?;
    if !state.login_limiter.allow(&normalized).await {
        return Err(ApiFailure::new(
            StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::RateLimited,
            "Too many login attempts. Try again shortly.",
            request_id.to_owned(),
        ));
    }
    let row = sqlx::query(
        r#"
        SELECT u.id, u.username, u.display_name, u.role::text AS role, u.status::text AS status,
          u.created_at, u.last_login_at, u.is_primary_admin, c.password_hash,
          ((SELECT COUNT(*) FROM sessions active WHERE active.user_id = u.id AND active.revoked_at IS NULL AND active.expires_at > NOW())
           + (SELECT COUNT(*) FROM native_sessions active WHERE active.user_id = u.id AND active.revoked_at IS NULL AND active.refresh_expires_at > NOW()))
           AS active_sessions
        FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.normalized_username = $1
        "#,
    ).bind(&normalized).fetch_optional(&state.database).await.map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    let valid = row
        .as_ref()
        .map(|row| {
            row.get::<String, _>("status") == "active"
                && verify_password(password, row.get::<String, _>("password_hash").as_str())
        })
        .unwrap_or(false);
    if !valid {
        record_audit(
            &state.database,
            None,
            "auth.native.login",
            None,
            None,
            "failure",
            request_id,
            json!({"username": normalized}),
        )
        .await?;
        return Err(ApiFailure::new(
            StatusCode::UNAUTHORIZED,
            ErrorCode::AuthenticationInvalid,
            "The username or password is incorrect.",
            request_id.to_owned(),
        ));
    }
    state.login_limiter.clear(&normalized).await;
    let user = user_from_row(row.as_ref().expect("validated row exists"));
    sqlx::query("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1")
        .bind(Uuid::parse_str(&user.id).unwrap())
        .execute(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    record_audit(
        &state.database,
        Some(&user.id),
        "auth.native.login",
        Some("user"),
        Some(&user.id),
        "success",
        request_id,
        json!({}),
    )
    .await?;
    Ok(user)
}

async fn create_native_session(
    state: &AppState,
    user: ServerUser,
    client_name: &str,
    request_id: &str,
) -> Result<NativeSession, ApiFailure> {
    if client_name.trim().is_empty() || client_name.len() > 128 {
        return Err(ApiFailure::validation(
            "Client name must be between 1 and 128 characters.",
            request_id.to_owned(),
        ));
    }
    let access_token = generate_secret();
    let refresh_token = generate_secret();
    let access_expires_at =
        chrono::Utc::now() + chrono::Duration::minutes(state.config.native_access_ttl_minutes);
    let refresh_expires_at =
        chrono::Utc::now() + chrono::Duration::days(state.config.native_refresh_ttl_days);
    sqlx::query(
        "INSERT INTO native_sessions (id, user_id, access_token_hash, refresh_token_hash, client_name, access_expires_at, refresh_expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    ).bind(Uuid::now_v7()).bind(Uuid::parse_str(&user.id).unwrap()).bind(hash_secret(&access_token))
        .bind(hash_secret(&refresh_token)).bind(client_name.trim()).bind(access_expires_at).bind(refresh_expires_at)
        .execute(&state.database).await.map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(NativeSession {
        user,
        access_token,
        refresh_token,
        access_expires_at: access_expires_at.to_rfc3339(),
        refresh_expires_at: refresh_expires_at.to_rfc3339(),
    })
}

async fn replace_password_and_revoke(
    pool: &PgPool,
    user_id: Uuid,
    password: &str,
    keep_session: Option<Uuid>,
    request_id: &str,
) -> Result<(), ApiFailure> {
    let password_hash = hash_password(password)
        .map_err(|error| ApiFailure::validation(error.to_string(), request_id.to_owned()))?;
    let result = sqlx::query(
        "UPDATE credentials SET password_hash = $1, password_changed_at = NOW() WHERE user_id = $2",
    )
    .bind(password_hash)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    if result.rows_affected() == 0 {
        return Err(ApiFailure::not_found(request_id.to_owned()));
    }
    sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)")
        .bind(user_id).bind(keep_session).execute(pool).await.map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    sqlx::query("UPDATE native_sessions SET revoked_at = NOW() WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)")
        .bind(user_id).bind(keep_session).execute(pool).await.map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(())
}

async fn is_primary_admin(
    pool: &PgPool,
    user_id: Uuid,
    request_id: &str,
) -> Result<bool, ApiFailure> {
    sqlx::query_scalar::<_, bool>("SELECT is_primary_admin FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?
        .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))
}

fn invitation_from_row(row: &sqlx::postgres::PgRow) -> Invitation {
    Invitation {
        id: row.get::<Uuid, _>("id").to_string(),
        username: row.get("username"),
        display_name: row.get("display_name"),
        role: if row.get::<String, _>("role") == "admin" {
            ServerUserRole::Admin
        } else {
            ServerUserRole::Member
        },
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .to_rfc3339(),
        expires_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("expires_at")
            .to_rfc3339(),
        accepted_at: row
            .get::<Option<chrono::DateTime<chrono::Utc>>, _>("accepted_at")
            .map(|value| value.to_rfc3339()),
        revoked_at: row
            .get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at")
            .map(|value| value.to_rfc3339()),
    }
}

async fn create_browser_session(
    state: &AppState,
    headers: &HeaderMap,
    user: ServerUser,
    request_id: &str,
) -> Result<Response, ApiFailure> {
    let token = generate_secret();
    let csrf = generate_secret();
    let session_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO sessions (id, user_id, token_hash, csrf_hash, user_agent, expires_at)
        VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval)
        "#,
    )
    .bind(session_id)
    .bind(Uuid::parse_str(&user.id).expect("database UUID is valid"))
    .bind(hash_secret(&token))
    .bind(hash_secret(&csrf))
    .bind(
        headers
            .get(header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.chars().take(512).collect::<String>()),
    )
    .bind(state.config.session_ttl_hours.to_string())
    .execute(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;

    let mut response = Json(DataResponse::new(BrowserSession {
        user,
        csrf_token: csrf.clone(),
    }))
    .into_response();
    append_cookie(
        &mut response,
        SESSION_COOKIE,
        &token,
        true,
        state.config.browser_secure_cookies,
        state.config.session_ttl_hours,
    );
    append_cookie(
        &mut response,
        CSRF_COOKIE,
        &csrf,
        false,
        state.config.browser_secure_cookies,
        state.config.session_ttl_hours,
    );
    Ok(response)
}

async fn require_native_user(
    state: &AppState,
    headers: &HeaderMap,
    request_id: &str,
) -> Result<AuthenticatedUser, ApiFailure> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| ApiFailure::authentication_required(request_id.to_owned()))?;
    authenticate_native_access_token(&state.database, token)
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?
        .ok_or_else(|| ApiFailure::authentication_required(request_id.to_owned()))
}

async fn require_any_user(
    state: &AppState,
    headers: &HeaderMap,
    request_id: &str,
) -> Result<AuthenticatedUser, ApiFailure> {
    if headers.contains_key(header::AUTHORIZATION) {
        require_native_user(state, headers, request_id).await
    } else {
        require_csrf(state, headers, request_id).await
    }
}

async fn require_user(
    state: &AppState,
    headers: &HeaderMap,
    request_id: &str,
) -> Result<AuthenticatedUser, ApiFailure> {
    let token = cookie(headers, SESSION_COOKIE)
        .ok_or_else(|| ApiFailure::authentication_required(request_id.to_owned()))?;
    authenticate_session(&state.database, token)
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?
        .ok_or_else(|| ApiFailure::authentication_required(request_id.to_owned()))
}

async fn require_admin(
    state: &AppState,
    headers: &HeaderMap,
    request_id: &str,
) -> Result<AuthenticatedUser, ApiFailure> {
    let authenticated = require_user(state, headers, request_id).await?;
    if authenticated.user.role != ServerUserRole::Admin {
        return Err(ApiFailure::new(
            StatusCode::FORBIDDEN,
            ErrorCode::AdminRequired,
            "Administrator access is required.",
            request_id.to_owned(),
        ));
    }
    Ok(authenticated)
}

async fn require_csrf(
    state: &AppState,
    headers: &HeaderMap,
    request_id: &str,
) -> Result<AuthenticatedUser, ApiFailure> {
    let authenticated = require_user(state, headers, request_id).await?;
    let cookie_value = cookie(headers, CSRF_COOKIE);
    let header_value = headers
        .get("x-collab-csrf")
        .and_then(|value| value.to_str().ok());
    if cookie_value.is_none()
        || cookie_value != header_value
        || hash_secret(cookie_value.unwrap_or_default()) != authenticated.csrf_hash
    {
        return Err(ApiFailure::new(
            StatusCode::FORBIDDEN,
            ErrorCode::CsrfInvalid,
            "The request could not be verified.",
            request_id.to_owned(),
        ));
    }
    Ok(authenticated)
}

async fn require_admin_csrf(
    state: &AppState,
    headers: &HeaderMap,
    request_id: &str,
) -> Result<AuthenticatedUser, ApiFailure> {
    let authenticated = require_csrf(state, headers, request_id).await?;
    if authenticated.user.role != ServerUserRole::Admin {
        return Err(ApiFailure::new(
            StatusCode::FORBIDDEN,
            ErrorCode::AdminRequired,
            "Administrator access is required.",
            request_id.to_owned(),
        ));
    }
    Ok(authenticated)
}

async fn insert_user(
    transaction: &mut Transaction<'_, Postgres>,
    payload: &CreateUserRequest,
    admin: bool,
    request_id: &str,
) -> Result<ServerUser, ApiFailure> {
    let normalized = normalize_username(&payload.username)
        .map_err(|error| ApiFailure::validation(error.to_string(), request_id.to_owned()))?;
    if payload.display_name.trim().is_empty() || payload.display_name.len() > 128 {
        return Err(ApiFailure::validation(
            "Display name must be between 1 and 128 characters.",
            request_id.to_owned(),
        ));
    }
    let password_hash = hash_password(&payload.password)
        .map_err(|error| ApiFailure::validation(error.to_string(), request_id.to_owned()))?;
    let id = Uuid::now_v7();
    let row = sqlx::query(
        r#"
        INSERT INTO users (id, username, normalized_username, display_name, role)
        VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN 'admin'::server_user_role ELSE 'member'::server_user_role END)
        RETURNING id, username, display_name, role::text AS role, status::text AS status,
                  created_at, last_login_at, is_primary_admin, 0::bigint AS active_sessions
        "#,
    )
    .bind(id)
    .bind(payload.username.trim())
    .bind(normalized)
    .bind(payload.display_name.trim())
    .bind(admin)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| {
        if error.as_database_error().and_then(|value| value.code()).as_deref() == Some("23505") {
            ApiFailure::validation("That username already exists.", request_id.to_owned())
        } else {
            ApiFailure::server(request_id.to_owned())
        }
    })?;
    sqlx::query("INSERT INTO credentials (user_id, password_hash) VALUES ($1, $2)")
        .bind(id)
        .bind(password_hash)
        .execute(&mut **transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(user_from_row(&row))
}

async fn administrator_exists_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE role = 'admin' AND status = 'active')",
    )
    .fetch_one(&mut **transaction)
    .await
}

async fn audit(
    transaction: &mut Transaction<'_, Postgres>,
    actor: Option<&str>,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    result: &str,
    request_id: &str,
    metadata: Value,
) -> Result<(), ApiFailure> {
    sqlx::query(
        "INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, result, request_id, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::now_v7())
    .bind(actor.map(|value| Uuid::parse_str(value).expect("database UUID is valid")))
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(result)
    .bind(request_id)
    .bind(metadata)
    .execute(&mut **transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(())
}

async fn record_audit(
    pool: &PgPool,
    actor: Option<&str>,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    result: &str,
    request_id: &str,
    metadata: Value,
) -> Result<(), ApiFailure> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    audit(
        &mut transaction,
        actor,
        action,
        target_type,
        target_id,
        result,
        request_id,
        metadata,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))
}

async fn list_audit_events(
    pool: &PgPool,
    limit: i64,
    request_id: &str,
) -> Result<Vec<AuditEvent>, ApiFailure> {
    let rows = sqlx::query(
        r#"
        SELECT a.id, u.display_name AS actor_display_name, a.action, a.target_type,
               a.target_id, a.result, a.created_at
        FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC LIMIT $1
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(rows
        .iter()
        .map(|row| AuditEvent {
            id: row.get::<Uuid, _>("id").to_string(),
            actor_display_name: row.get("actor_display_name"),
            action: row.get("action"),
            target_type: row.get("target_type"),
            target_id: row.get("target_id"),
            result: row.get("result"),
            created_at: row
                .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .to_rfc3339(),
        })
        .collect())
}

async fn list_user_audit_events(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    request_id: &str,
) -> Result<Vec<AuditEvent>, ApiFailure> {
    let rows = sqlx::query(
        r#"
        SELECT a.id, u.display_name AS actor_display_name, a.action, a.target_type,
               a.target_id, a.result, a.created_at
        FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.actor_user_id = $1 OR (a.target_type = 'user' AND a.target_id = $2)
        ORDER BY a.created_at DESC LIMIT $3
        "#,
    )
    .bind(user_id)
    .bind(user_id.to_string())
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(rows
        .iter()
        .map(|row| AuditEvent {
            id: row.get::<Uuid, _>("id").to_string(),
            actor_display_name: row.get("actor_display_name"),
            action: row.get("action"),
            target_type: row.get("target_type"),
            target_id: row.get("target_id"),
            result: row.get("result"),
            created_at: row
                .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .to_rfc3339(),
        })
        .collect())
}

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|value| value.trim().split_once('='))
        .find_map(|(key, value)| (key == name).then_some(value))
}

fn append_cookie(
    response: &mut Response,
    name: &str,
    value: &str,
    http_only: bool,
    secure: bool,
    ttl_hours: i64,
) {
    let mut cookie = format!(
        "{name}={value}; Path=/; SameSite=Strict; Max-Age={}",
        ttl_hours * 60 * 60
    );
    if http_only {
        cookie.push_str("; HttpOnly");
    }
    if secure {
        cookie.push_str("; Secure");
    }
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).expect("generated cookie is valid"),
    );
}

fn append_expired_cookie(response: &mut Response, name: &str, secure: bool) {
    let mut cookie = format!("{name}=; Path=/; SameSite=Strict; Max-Age=0; HttpOnly");
    if secure {
        cookie.push_str("; Secure");
    }
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).expect("generated cookie is valid"),
    );
}

type ApiResult<T> = Result<Json<DataResponse<T>>, ApiFailure>;

#[derive(Debug)]
pub struct ApiFailure {
    status: StatusCode,
    error: ApiError,
}

impl ApiFailure {
    fn new(
        status: StatusCode,
        code: ErrorCode,
        message: impl Into<String>,
        request_id: String,
    ) -> Self {
        Self {
            status,
            error: ApiError {
                code,
                message: message.into(),
                request_id,
                details: Value::Null,
            },
        }
    }

    fn server(request_id: String) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::ServerUnavailable,
            "The server could not complete the request.",
            request_id,
        )
    }

    fn validation(message: impl Into<String>, request_id: String) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::ValidationFailed,
            message,
            request_id,
        )
    }

    fn authentication_required(request_id: String) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            ErrorCode::AuthenticationRequired,
            "Authentication is required.",
            request_id,
        )
    }

    fn not_found(request_id: String) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            ErrorCode::ResourceNotFound,
            "The requested resource was not found.",
            request_id,
        )
    }
}

impl IntoResponse for ApiFailure {
    fn into_response(self) -> Response {
        (self.status, Json(ErrorResponse { error: self.error })).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::cookie;
    use crate::auth::hash_secret;
    use crate::{
        app::{build_router, AppState},
        config::ServerConfig,
        database,
        storage::FileSystemBlobStorage,
    };
    use axum::{
        body::Body,
        http::{header, HeaderMap, HeaderValue, Request, StatusCode},
        Router,
    };
    use http_body_util::BodyExt;
    use serde_json::{json, Value};
    use sqlx::{postgres::PgPoolOptions, Row};
    use std::sync::Arc;
    use tower::ServiceExt;
    use uuid::Uuid;

    #[test]
    fn cookie_parser_matches_exact_names() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("other=x; collab_session=secret; collab_csrf=token"),
        );
        assert_eq!(cookie(&headers, "collab_session"), Some("secret"));
        assert_eq!(cookie(&headers, "session"), None);
    }

    async fn request(
        app: &Router,
        method: &str,
        uri: &str,
        body: Value,
        cookie: Option<&str>,
        csrf: Option<&str>,
    ) -> axum::response::Response {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(cookie) = cookie {
            builder = builder.header(header::COOKIE, cookie);
        }
        if let Some(csrf) = csrf {
            builder = builder.header("x-collab-csrf", csrf);
        }
        app.clone()
            .oneshot(builder.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap()
    }

    async fn bearer_request(
        app: &Router,
        method: &str,
        uri: &str,
        body: Value,
        token: &str,
    ) -> axum::response::Response {
        app.clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn json_body(response: axum::response::Response) -> Value {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    fn session_cookies(response: &axum::response::Response) -> (String, String) {
        let values = response.headers().get_all(header::SET_COOKIE);
        let mut session = String::new();
        let mut csrf = String::new();
        for value in values {
            let pair = value.to_str().unwrap().split(';').next().unwrap();
            if pair.starts_with("collab_session=") {
                session = pair.to_owned();
            } else if pair.starts_with("collab_csrf=") {
                csrf = pair.to_owned();
            }
        }
        let csrf_value = csrf.split_once('=').unwrap().1.to_owned();
        (format!("{session}; {csrf}"), csrf_value)
    }

    #[tokio::test]
    async fn browser_admin_lifecycle_is_authorized_and_csrf_protected() {
        let Ok(url) = std::env::var("COLLAB_TEST_DATABASE_URL") else {
            return;
        };
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await
            .unwrap();
        database::migrate(&pool).await.unwrap();
        sqlx::query(
            "TRUNCATE audit_events, invitations, native_sessions, sessions, credentials, users RESTART IDENTITY CASCADE",
        )
        .execute(&pool)
        .await
        .unwrap();
        let blobs = Arc::new(
            FileSystemBlobStorage::new(tempfile::tempdir().unwrap().keep())
                .await
                .unwrap(),
        );
        let app = build_router(AppState::new(ServerConfig::default(), pool.clone(), blobs));

        let status = request(
            &app,
            "GET",
            "/api/v1/auth/bootstrap-status",
            json!({}),
            None,
            None,
        )
        .await;
        assert_eq!(status.status(), StatusCode::OK);
        assert_eq!(json_body(status).await["data"]["required"], true);

        let bootstrap = request(
            &app,
            "POST",
            "/api/v1/auth/bootstrap",
            json!({
                "username": "admin",
                "displayName": "First Admin",
                "password": "correct horse battery staple"
            }),
            None,
            None,
        )
        .await;
        assert_eq!(bootstrap.status(), StatusCode::OK);
        let (admin_cookie, admin_csrf) = session_cookies(&bootstrap);
        let admin_id =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE is_primary_admin = TRUE")
                .fetch_one(&pool)
                .await
                .unwrap();

        let duplicate_bootstrap = request(
            &app,
            "POST",
            "/api/v1/auth/bootstrap",
            json!({
                "username": "other-admin",
                "displayName": "Other",
                "password": "correct horse battery staple"
            }),
            None,
            None,
        )
        .await;
        assert_eq!(duplicate_bootstrap.status(), StatusCode::CONFLICT);

        let without_csrf = request(
            &app,
            "POST",
            "/api/v1/admin/users",
            json!({
                "username": "member",
                "displayName": "Member",
                "password": "member password is long enough"
            }),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(without_csrf.status(), StatusCode::FORBIDDEN);

        let member = request(
            &app,
            "POST",
            "/api/v1/admin/users",
            json!({
                "username": "member",
                "displayName": "Member",
                "password": "member password is long enough"
            }),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(member.status(), StatusCode::CREATED);
        let member_id = json_body(member).await["data"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let invitation = request(
            &app,
            "POST",
            "/api/v1/admin/invitations",
            json!({"username": "invited", "displayName": "Invited User", "expiresInHours": 24}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(invitation.status(), StatusCode::CREATED);
        let invitation_body = json_body(invitation).await;
        let invitation_token = invitation_body["data"]["token"].as_str().unwrap();
        assert!(!invitation_body
            .to_string()
            .contains("invited password is long enough"));
        let accepted = request(
            &app,
            "POST",
            &format!("/api/v1/auth/invitations/{invitation_token}/accept"),
            json!({"password": "invited password is long enough"}),
            None,
            None,
        )
        .await;
        assert_eq!(accepted.status(), StatusCode::OK);
        let invited_id = json_body(accepted).await["data"]["user"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let reset = request(
            &app,
            "POST",
            &format!("/api/v1/admin/users/{invited_id}/reset-password"),
            json!({"newPassword": "replacement password is long enough"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(reset.status(), StatusCode::NO_CONTENT);
        let old_password = request(
            &app,
            "POST",
            "/api/v1/auth/login",
            json!({"username": "invited", "password": "invited password is long enough"}),
            None,
            None,
        )
        .await;
        assert_eq!(old_password.status(), StatusCode::UNAUTHORIZED);
        let new_password = request(
            &app,
            "POST",
            "/api/v1/auth/login",
            json!({"username": "invited", "password": "replacement password is long enough"}),
            None,
            None,
        )
        .await;
        assert_eq!(new_password.status(), StatusCode::OK);

        let native_login = request(
            &app,
            "POST",
            "/api/v1/auth/native/login",
            json!({"username": "member", "password": "member password is long enough", "clientName": "Integration test"}),
            None,
            None,
        ).await;
        assert_eq!(native_login.status(), StatusCode::OK);
        let native_body = json_body(native_login).await;
        let access = native_body["data"]["accessToken"]
            .as_str()
            .unwrap()
            .to_owned();
        let refresh_token = native_body["data"]["refreshToken"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_ne!(access, refresh_token);

        let refreshed = request(
            &app,
            "POST",
            "/api/v1/auth/refresh",
            json!({"refreshToken": refresh_token.clone()}),
            None,
            None,
        )
        .await;
        assert_eq!(refreshed.status(), StatusCode::OK);
        let refreshed_body = json_body(refreshed).await;
        let next_access = refreshed_body["data"]["accessToken"]
            .as_str()
            .unwrap()
            .to_owned();
        let next_refresh = refreshed_body["data"]["refreshToken"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_ne!(refresh_token, next_refresh);
        let hashes = sqlx::query("SELECT refresh_token_hash, previous_refresh_token_hash FROM native_sessions WHERE access_token_hash = $1")
            .bind(hash_secret(&next_access)).fetch_one(&pool).await.unwrap();
        assert_eq!(
            hashes.get::<String, _>("refresh_token_hash"),
            hash_secret(&next_refresh)
        );
        assert_eq!(
            hashes.get::<Option<String>, _>("previous_refresh_token_hash"),
            Some(hash_secret(&refresh_token))
        );
        let reused = request(
            &app,
            "POST",
            "/api/v1/auth/refresh",
            json!({"refreshToken": refresh_token}),
            None,
            None,
        )
        .await;
        assert_eq!(reused.status(), StatusCode::UNAUTHORIZED);
        let revoked_native = bearer_request(
            &app,
            "POST",
            "/api/v1/auth/native/logout",
            json!({}),
            &next_access,
        )
        .await;
        assert_eq!(revoked_native.status(), StatusCode::UNAUTHORIZED);
        let forged_native = bearer_request(
            &app,
            "POST",
            "/api/v1/auth/native/logout",
            json!({}),
            "forged-token",
        )
        .await;
        assert_eq!(forged_native.status(), StatusCode::UNAUTHORIZED);
        let expired_login = request(
            &app,
            "POST",
            "/api/v1/auth/native/login",
            json!({"username": "member", "password": "member password is long enough"}),
            None,
            None,
        )
        .await;
        let expired_body = json_body(expired_login).await;
        sqlx::query("UPDATE native_sessions SET refresh_expires_at = NOW() - INTERVAL '1 minute' WHERE refresh_token_hash = $1")
            .bind(hash_secret(expired_body["data"]["refreshToken"].as_str().unwrap()))
            .execute(&pool).await.unwrap();
        let expired_refresh = request(
            &app,
            "POST",
            "/api/v1/auth/refresh",
            json!({"refreshToken": expired_body["data"]["refreshToken"]}),
            None,
            None,
        )
        .await;
        assert_eq!(expired_refresh.status(), StatusCode::UNAUTHORIZED);

        let member_login = request(
            &app,
            "POST",
            "/api/v1/auth/login",
            json!({"username": "member", "password": "member password is long enough"}),
            None,
            None,
        )
        .await;
        assert_eq!(member_login.status(), StatusCode::OK);
        let (member_cookie, _) = session_cookies(&member_login);
        let forbidden_overview = request(
            &app,
            "GET",
            "/api/v1/admin/overview",
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(forbidden_overview.status(), StatusCode::FORBIDDEN);

        let disabled = request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/users/{member_id}"),
            json!({"disabled": true}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(disabled.status(), StatusCode::OK);
        let revoked_me = request(
            &app,
            "GET",
            "/api/v1/users/me",
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(revoked_me.status(), StatusCode::UNAUTHORIZED);

        let primary_disable = request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/users/{admin_id}"),
            json!({"disabled": true}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(primary_disable.status(), StatusCode::BAD_REQUEST);
        let primary_delete = request(
            &app,
            "DELETE",
            &format!("/api/v1/admin/users/{admin_id}"),
            json!({}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(primary_delete.status(), StatusCode::BAD_REQUEST);

        let reenabled = request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/users/{member_id}"),
            json!({"disabled": false}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(reenabled.status(), StatusCode::OK);
        assert_eq!(json_body(reenabled).await["data"]["status"], "active");
        let reenabled_login = request(
            &app,
            "POST",
            "/api/v1/auth/login",
            json!({"username": "member", "password": "member password is long enough"}),
            None,
            None,
        )
        .await;
        assert_eq!(reenabled_login.status(), StatusCode::OK);

        let deleted = request(
            &app,
            "DELETE",
            &format!("/api/v1/admin/users/{member_id}"),
            json!({}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
        let deleted_login = request(
            &app,
            "POST",
            "/api/v1/auth/login",
            json!({"username": "member", "password": "member password is long enough"}),
            None,
            None,
        )
        .await;
        assert_eq!(deleted_login.status(), StatusCode::UNAUTHORIZED);

        let overview = request(
            &app,
            "GET",
            "/api/v1/admin/overview",
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(overview.status(), StatusCode::OK);
        let overview_body = json_body(overview).await;
        assert_eq!(overview_body["data"]["users"], 2);
        assert!(
            overview_body["data"]["recentAuditEvents"]
                .as_array()
                .unwrap()
                .len()
                >= 3
        );
    }
}
