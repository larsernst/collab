use crate::{
    app::AppState,
    auth::{
        administrator_exists, authenticate_session, generate_secret, hash_password, hash_secret,
        normalize_username, user_from_row, validate_password, verify_password, AuthenticatedUser,
        CSRF_COOKIE, SESSION_COOKIE,
    },
};
use axum::{
    extract::{Extension, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_protocol::{
    AdminOverview, ApiError, AuditEvent, BootstrapStatus, BrowserSession, DataResponse, ErrorCode,
    ErrorResponse, ServerUser, ServerUserRole,
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
    let user = insert_user(&mut transaction, &payload, true, &request_id).await?;
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
               u.created_at, u.last_login_at, c.password_hash,
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
          (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > NOW()) AS active_sessions,
          (SELECT COUNT(*) FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()) AS pending_invitations
        "#,
    )
    .fetch_one(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let events = list_audit_events(&state.database, 8, &request_id).await?;
    Ok(Json(DataResponse::new(AdminOverview {
        server_version: env!("CARGO_PKG_VERSION").into(),
        protocol_version: collab_protocol::PROTOCOL_VERSION,
        uptime_seconds: state.started_at.elapsed().as_secs(),
        users: counts.get("users"),
        active_users: counts.get("active_users"),
        active_sessions: counts.get("active_sessions"),
        pending_invitations: counts.get("pending_invitations"),
        hosted_vaults: 0,
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
               u.created_at, u.last_login_at,
               (SELECT COUNT(*) FROM sessions active
                WHERE active.user_id = u.id AND active.revoked_at IS NULL AND active.expires_at > NOW())
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
                  created_at, last_login_at, 0::bigint AS active_sessions
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
                  created_at, last_login_at, 0::bigint AS active_sessions
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
    use sqlx::postgres::PgPoolOptions;
    use std::sync::Arc;
    use tower::ServiceExt;

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
            "TRUNCATE audit_events, invitations, sessions, credentials, users RESTART IDENTITY CASCADE",
        )
        .execute(&pool)
        .await
        .unwrap();
        let blobs = Arc::new(
            FileSystemBlobStorage::new(tempfile::tempdir().unwrap().keep())
                .await
                .unwrap(),
        );
        let app = build_router(AppState::new(ServerConfig::default(), pool, blobs));

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
