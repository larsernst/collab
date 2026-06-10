use crate::{
    app::AppState,
    auth::{
        administrator_exists, authenticate_native_access_token, authenticate_session,
        generate_secret, hash_password, hash_secret, normalize_username, user_from_row,
        validate_password, verify_password, AuthenticatedUser, CSRF_COOKIE, SESSION_COOKIE,
    },
};
use axum::{
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use collab_protocol::{
    AdminOverview, ApiError, AuditEvent, BootstrapStatus, BrowserSession, CreatedInvitation,
    DataResponse, ErrorCode, ErrorResponse, HealthState, HostedDocumentType, HostedFileEntry,
    HostedFileKind, HostedFileReference, HostedFileRevision, HostedFileState,
    HostedReferenceImpact, HostedRevisionContent, HostedSearchResult, HostedSnapshot,
    HostedStructuralOperationPreview, HostedStructuralOperationResult,
    HostedStructuralOperationType, HostedTextDocument, HostedVault, HostedVaultActivityEvent,
    HostedVaultAdminDetail, HostedVaultImportResult, HostedVaultManifest, HostedVaultMember,
    HostedVaultRole, HostedVaultStatus, HostedVaultStorage, HostedVaultSummary, Invitation,
    NativeSession, OperationalWarning, ServerUser, ServerUserRole, StorageSummary,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Read, Write},
};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVaultRequest {
    pub name: Option<String>,
    pub status: Option<HostedVaultStatus>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddVaultMemberRequest {
    pub user_id: Uuid,
    pub role: HostedVaultRole,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVaultMemberRequest {
    pub role: HostedVaultRole,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultFileRequest {
    pub parent_id: Option<Uuid>,
    pub name: String,
    pub kind: HostedFileKind,
    pub document_type: Option<HostedDocumentType>,
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextRevisionRequest {
    pub expected_revision_sequence: i64,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSnapshotRequest {
    pub revision_id: Option<Uuid>,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSnapshotRequest {
    pub expected_revision_sequence: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadBinaryAssetRequest {
    pub parent_id: Option<Uuid>,
    pub name: String,
    pub media_type: String,
    pub content_base64: String,
    pub expected_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralOperationRequest {
    pub client_operation_id: Uuid,
    pub base_manifest_sequence: i64,
    pub operation_type: HostedStructuralOperationType,
    pub target_file_id: Uuid,
    pub name: Option<String>,
    pub parent_id: Option<Uuid>,
    #[serde(default)]
    pub remove_references: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralOperationPreviewRequest {
    pub operation_type: HostedStructuralOperationType,
    pub target_file_id: Uuid,
    pub name: Option<String>,
    pub parent_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct VaultSearchQuery {
    pub q: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportVaultZipRequest {
    pub archive_base64: String,
}

pub async fn bootstrap_status(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
) -> Result<Response, ApiFailure> {
    let required = !administrator_exists(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id))?;
    let mut response = Json(DataResponse::new(BootstrapStatus { required })).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
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

pub async fn list_vaults(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
) -> Result<Json<DataResponse<Vec<HostedVault>>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    let rows = sqlx::query(
        r#"
        SELECT v.id, v.name, v.owner_user_id, owner.display_name AS owner_display_name,
               m.role::text AS role, v.status::text AS status, v.manifest_sequence,
               v.created_at, v.updated_at,
               (SELECT COUNT(*) FROM hosted_vault_memberships members WHERE members.vault_id = v.id) AS members,
               COALESCE((SELECT SUM(r.size_bytes) FROM hosted_file_revisions r WHERE r.vault_id = v.id), 0)::bigint AS storage_bytes
        FROM hosted_vaults v
        JOIN hosted_vault_memberships m ON m.vault_id = v.id
        JOIN users owner ON owner.id = v.owner_user_id
        WHERE m.user_id = $1
        ORDER BY v.updated_at DESC
        "#,
    )
    .bind(user_uuid(&actor.user))
    .fetch_all(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        rows.iter().map(vault_from_row).collect(),
    )))
}

pub async fn create_vault(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Json(payload): Json<CreateVaultRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedVault>>), ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    let name = validate_vault_name(&payload.name, &request_id)?;
    let vault_id = Uuid::now_v7();
    let actor_id = user_uuid(&actor.user);
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query("INSERT INTO hosted_vaults (id, name, owner_user_id) VALUES ($1, $2, $3)")
        .bind(vault_id)
        .bind(&name)
        .bind(actor_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query(
        "INSERT INTO hosted_vault_memberships (vault_id, user_id, role) VALUES ($1, $2, 'admin')",
    )
    .bind(vault_id)
    .bind(actor_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(actor_id),
        "vault.created",
        Some("vault"),
        Some(&vault_id.to_string()),
        json!({}),
        &request_id,
    )
    .await?;
    audit(
        &mut transaction,
        Some(&actor.user.id),
        "vault.create",
        Some("vault"),
        Some(&vault_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(
            load_vault(&state.database, vault_id, actor_id, &request_id).await?,
        )),
    ))
}

pub async fn get_vault(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<HostedVault>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    Ok(Json(DataResponse::new(
        load_vault(
            &state.database,
            vault_id,
            user_uuid(&actor.user),
            &request_id,
        )
        .await?,
    )))
}

pub async fn update_vault(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<UpdateVaultRequest>,
) -> Result<Json<DataResponse<HostedVault>>, ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    let access = require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Admin,
        &request_id,
    )
    .await?;
    let name = payload
        .name
        .as_deref()
        .map(|value| validate_vault_name(value, &request_id))
        .transpose()?;
    if payload.status == Some(HostedVaultStatus::PendingDelete) {
        return Err(ApiFailure::validation(
            "Use DELETE to mark a vault for deletion.",
            request_id,
        ));
    }
    if payload.status.is_some() && !access.owner {
        return Err(ApiFailure::vault_permission_denied(request_id));
    }
    let reactivating = access.status == HostedVaultStatus::Archived
        && payload.status == Some(HostedVaultStatus::Active)
        && name.is_none();
    if access.status != HostedVaultStatus::Active && !reactivating {
        return Err(ApiFailure::vault_archived(request_id));
    }
    let status = payload.status.map(vault_status_name);
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query(
        r#"
        UPDATE hosted_vaults SET
          name = COALESCE($1, name),
          status = COALESCE($2::hosted_vault_status, status),
          archived_at = CASE
            WHEN $2 = 'archived' THEN NOW()
            WHEN $2 = 'active' THEN NULL
            ELSE archived_at
          END,
          updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(name.as_deref())
    .bind(status)
    .bind(vault_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        if payload.status.is_some() {
            "vault.status_changed"
        } else {
            "vault.renamed"
        },
        Some("vault"),
        Some(&vault_id.to_string()),
        json!({"status": status, "name": name}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        load_vault(
            &state.database,
            vault_id,
            user_uuid(&actor.user),
            &request_id,
        )
        .await?,
    )))
}

pub async fn delete_vault(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    let access = require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Admin,
        &request_id,
    )
    .await?;
    if !access.owner {
        return Err(ApiFailure::vault_permission_denied(request_id));
    }
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query(
        "UPDATE hosted_vaults SET status = 'pending_delete', pending_delete_at = NOW(), updated_at = NOW() WHERE id = $1",
    )
    .bind(vault_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        "vault.pending_delete",
        Some("vault"),
        Some(&vault_id.to_string()),
        json!({}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_vault_members(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<Vec<HostedVaultMember>>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    Ok(Json(DataResponse::new(
        load_vault_members(&state.database, vault_id, &request_id).await?,
    )))
}

pub async fn add_vault_member(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<AddVaultMemberRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedVaultMember>>), ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    let access =
        require_active_vault_admin(&state.database, vault_id, &actor.user, &request_id).await?;
    if payload.role == HostedVaultRole::Admin && !access.owner {
        return Err(ApiFailure::vault_permission_denied(request_id));
    }
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let inserted = sqlx::query(
        "INSERT INTO hosted_vault_memberships (vault_id, user_id, role) SELECT $1, id, $3::hosted_vault_role FROM users WHERE id = $2 AND status = 'active' ON CONFLICT DO NOTHING",
    )
    .bind(vault_id).bind(payload.user_id).bind(vault_role_name(payload.role))
    .execute(&mut *transaction).await.map_err(|_| ApiFailure::server(request_id.clone()))?;
    if inserted.rows_affected() == 0 {
        return Err(ApiFailure::validation(
            "The user does not exist, is disabled, or is already a member.",
            request_id,
        ));
    }
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        "member.added",
        Some("user"),
        Some(&payload.user_id.to_string()),
        json!({"role": vault_role_name(payload.role)}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(
            load_vault_member(&state.database, vault_id, payload.user_id, &request_id).await?,
        )),
    ))
}

pub async fn update_vault_member(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, user_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateVaultMemberRequest>,
) -> Result<Json<DataResponse<HostedVaultMember>>, ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    let access =
        require_active_vault_admin(&state.database, vault_id, &actor.user, &request_id).await?;
    let target = load_vault_member(&state.database, vault_id, user_id, &request_id).await?;
    if target.owner
        || (payload.role == HostedVaultRole::Admin && !access.owner)
        || (target.role == HostedVaultRole::Admin && !access.owner)
    {
        return Err(ApiFailure::vault_permission_denied(request_id));
    }
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query("UPDATE hosted_vault_memberships SET role = $1::hosted_vault_role, updated_at = NOW() WHERE vault_id = $2 AND user_id = $3")
        .bind(vault_role_name(payload.role)).bind(vault_id).bind(user_id).execute(&mut *transaction).await.map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        "member.role_changed",
        Some("user"),
        Some(&user_id.to_string()),
        json!({"role": vault_role_name(payload.role)}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        load_vault_member(&state.database, vault_id, user_id, &request_id).await?,
    )))
}

pub async fn remove_vault_member(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    let access =
        require_active_vault_admin(&state.database, vault_id, &actor.user, &request_id).await?;
    let target = load_vault_member(&state.database, vault_id, user_id, &request_id).await?;
    if target.owner || (target.role == HostedVaultRole::Admin && !access.owner) {
        return Err(ApiFailure::vault_permission_denied(request_id));
    }
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query("DELETE FROM hosted_vault_memberships WHERE vault_id = $1 AND user_id = $2")
        .bind(vault_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        "member.removed",
        Some("user"),
        Some(&user_id.to_string()),
        json!({}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn vault_activity(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<Vec<HostedVaultActivityEvent>>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    let rows = sqlx::query(
        "SELECT a.id, u.display_name AS actor_display_name, a.event_type, a.target_type, a.target_id, a.created_at FROM hosted_vault_activity_events a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.vault_id = $1 ORDER BY a.created_at DESC LIMIT 100",
    ).bind(vault_id).fetch_all(&state.database).await.map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        rows.iter().map(vault_activity_from_row).collect(),
    )))
}

pub async fn vault_manifest(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<HostedVaultManifest>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    Ok(Json(DataResponse::new(
        load_vault_manifest(&state.database, vault_id, &request_id).await?,
    )))
}

pub async fn vault_storage(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<HostedVaultStorage>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    let row = sqlx::query(
        r#"
        SELECT
          COALESCE((
            SELECT SUM(r.size_bytes)
            FROM hosted_file_entries f
            JOIN hosted_file_revisions r ON r.id = f.current_revision_id
            WHERE f.vault_id = $1 AND f.state = 'active'
          ), 0)::bigint AS active_bytes,
          COALESCE((
            SELECT SUM(r.size_bytes)
            FROM hosted_file_entries f
            JOIN hosted_file_revisions r ON r.id = f.current_revision_id
            WHERE f.vault_id = $1 AND f.state = 'trashed'
          ), 0)::bigint AS trash_bytes,
          COALESCE((
            SELECT SUM(r.size_bytes) FROM hosted_file_revisions r WHERE r.vault_id = $1
          ), 0)::bigint AS retained_revision_bytes,
          COALESCE((
            SELECT SUM(blobs.size_bytes)
            FROM (
              SELECT blob_digest, MAX(size_bytes) AS size_bytes
              FROM hosted_file_revisions
              WHERE vault_id = $1
              GROUP BY blob_digest
            ) blobs
          ), 0)::bigint AS unique_blob_bytes,
          (SELECT COUNT(*) FROM hosted_file_entries f WHERE f.vault_id = $1 AND f.state = 'active') AS active_files,
          (SELECT COUNT(*) FROM hosted_file_entries f WHERE f.vault_id = $1 AND f.state = 'trashed') AS trashed_files,
          (SELECT COUNT(*) FROM hosted_file_revisions r WHERE r.vault_id = $1) AS revision_count,
          (SELECT COUNT(*) FROM hosted_snapshots s WHERE s.vault_id = $1) AS snapshot_count
        "#,
    )
    .bind(vault_id)
    .fetch_one(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id))?;
    Ok(Json(DataResponse::new(HostedVaultStorage {
        active_bytes: row.get::<i64, _>("active_bytes").max(0) as u64,
        trash_bytes: row.get::<i64, _>("trash_bytes").max(0) as u64,
        retained_revision_bytes: row.get::<i64, _>("retained_revision_bytes").max(0) as u64,
        unique_blob_bytes: row.get::<i64, _>("unique_blob_bytes").max(0) as u64,
        active_files: row.get("active_files"),
        trashed_files: row.get("trashed_files"),
        revision_count: row.get("revision_count"),
        snapshot_count: row.get("snapshot_count"),
    })))
}

pub async fn list_vault_files(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<Vec<HostedFileEntry>>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    Ok(Json(DataResponse::new(
        load_vault_manifest(&state.database, vault_id, &request_id)
            .await?
            .files,
    )))
}

pub async fn create_vault_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<CreateVaultFileRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedFileEntry>>), ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    require_active_vault_role(
        &state.database,
        vault_id,
        &actor.user,
        HostedVaultRole::Editor,
        &request_id,
    )
    .await?;
    let (name, normalized_name) = collab_core::normalize_hosted_name(&payload.name)
        .map_err(|error| ApiFailure::path_invalid(error.to_string(), request_id.clone()))?;
    validate_file_kind(
        payload.kind,
        payload.document_type,
        &payload.content,
        &request_id,
    )?;
    let parent_path =
        validate_parent_folder(&state.database, vault_id, payload.parent_id, &request_id).await?;
    let relative_path = if parent_path.is_empty() {
        name.clone()
    } else {
        format!("{parent_path}/{name}")
    };
    collab_core::normalize_hosted_path(&relative_path)
        .map_err(|error| ApiFailure::path_invalid(error.to_string(), request_id.clone()))?;

    let content = (payload.kind == HostedFileKind::Document).then(|| payload.content.into_bytes());
    let digest = if let Some(content) = content.as_deref() {
        Some(
            state
                .blobs
                .put(content)
                .await
                .map_err(|_| ApiFailure::server(request_id.clone()))?,
        )
    } else {
        None
    };
    let file_id = Uuid::now_v7();
    let revision_id = digest.as_ref().map(|_| Uuid::now_v7());
    let actor_id = user_uuid(&actor.user);
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    lock_active_vault(&mut transaction, vault_id, &request_id).await?;
    let inserted = sqlx::query(
        r#"
        INSERT INTO hosted_file_entries
          (id, vault_id, parent_id, name, normalized_name, kind, document_type, created_by)
        VALUES ($1, $2, $3, $4, $5, $6::hosted_file_kind, $7::hosted_document_type, $8)
        "#,
    )
    .bind(file_id)
    .bind(vault_id)
    .bind(payload.parent_id)
    .bind(&name)
    .bind(&normalized_name)
    .bind(file_kind_name(payload.kind))
    .bind(payload.document_type.map(document_type_name))
    .bind(actor_id)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = inserted {
        return Err(map_path_database_error(error, request_id));
    }
    if let (Some(content), Some(digest), Some(revision_id)) =
        (content.as_deref(), digest.as_deref(), revision_id)
    {
        insert_blob_record(
            &mut transaction,
            digest,
            content.len(),
            "text/plain",
            &request_id,
        )
        .await?;
        sqlx::query(
            "INSERT INTO hosted_file_revisions (id, vault_id, file_id, sequence, blob_digest, content_hash, size_bytes, created_by) VALUES ($1, $2, $3, 1, $4, $4, $5, $6)",
        )
        .bind(revision_id)
        .bind(vault_id)
        .bind(file_id)
        .bind(digest)
        .bind(content.len() as i64)
        .bind(actor_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
        sqlx::query("UPDATE hosted_file_entries SET current_revision_id = $1 WHERE id = $2")
            .bind(revision_id)
            .bind(file_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
    }
    increment_manifest(&mut transaction, vault_id, &request_id).await?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(actor_id),
        "file.created",
        Some("file"),
        Some(&file_id.to_string()),
        json!({"path": relative_path, "kind": file_kind_name(payload.kind)}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(
            load_vault_file_entry(&state.database, vault_id, file_id, &request_id).await?,
        )),
    ))
}

pub async fn get_vault_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<DataResponse<HostedTextDocument>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    let file = load_vault_file_entry(&state.database, vault_id, file_id, &request_id).await?;
    if file.kind != HostedFileKind::Document || file.state != HostedFileState::Active {
        return Err(ApiFailure::validation(
            "Only active text documents can be read through this endpoint.",
            request_id,
        ));
    }
    let digest = file
        .current_revision
        .as_ref()
        .map(|revision| revision.content_hash.as_str())
        .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    let bytes = state
        .blobs
        .get(digest)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?
        .ok_or_else(|| ApiFailure::server(request_id.clone()))?;
    let content = String::from_utf8(bytes).map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(HostedTextDocument {
        file,
        content,
    })))
}

pub async fn list_file_revisions(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<DataResponse<Vec<HostedFileRevision>>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    Ok(Json(DataResponse::new(
        load_file_revisions(&state.database, vault_id, file_id, &request_id).await?,
    )))
}

pub async fn get_text_revision(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id, revision_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<DataResponse<HostedRevisionContent>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    Ok(Json(DataResponse::new(
        load_text_revision_content(&state, vault_id, file_id, revision_id, &request_id).await?,
    )))
}

pub async fn list_file_snapshots(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<DataResponse<Vec<HostedSnapshot>>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    Ok(Json(DataResponse::new(
        load_file_snapshots(&state.database, vault_id, file_id, &request_id).await?,
    )))
}

pub async fn create_file_snapshot(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<CreateSnapshotRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedSnapshot>>), ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    require_active_vault_role(
        &state.database,
        vault_id,
        &actor.user,
        HostedVaultRole::Editor,
        &request_id,
    )
    .await?;
    let label = normalize_snapshot_label(payload.label, &request_id)?;
    let actor_id = user_uuid(&actor.user);
    let snapshot_id = Uuid::now_v7();
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    lock_active_vault(&mut transaction, vault_id, &request_id).await?;
    let file = sqlx::query(
        "SELECT kind::text AS kind, state::text AS state, current_revision_id FROM hosted_file_entries WHERE vault_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(vault_id)
    .bind(file_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    if file.get::<String, _>("kind") != "document" || file.get::<String, _>("state") != "active" {
        return Err(ApiFailure::validation(
            "Only active text documents can be snapshotted.",
            request_id,
        ));
    }
    let revision_id = payload
        .revision_id
        .or_else(|| file.get::<Option<Uuid>, _>("current_revision_id"))
        .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    let revision_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM hosted_file_revisions WHERE vault_id = $1 AND file_id = $2 AND id = $3)",
    )
    .bind(vault_id)
    .bind(file_id)
    .bind(revision_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if !revision_exists {
        return Err(ApiFailure::not_found(request_id));
    }
    sqlx::query(
        "INSERT INTO hosted_snapshots (id, vault_id, file_id, revision_id, label, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(snapshot_id)
    .bind(vault_id)
    .bind(file_id)
    .bind(revision_id)
    .bind(&label)
    .bind(actor_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(actor_id),
        "snapshot.created",
        Some("file"),
        Some(&file_id.to_string()),
        json!({"snapshotId": snapshot_id, "revisionId": revision_id}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let snapshot =
        load_file_snapshot(&state.database, vault_id, file_id, snapshot_id, &request_id).await?;
    Ok((StatusCode::CREATED, Json(DataResponse::new(snapshot))))
}

pub async fn restore_file_snapshot(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id, snapshot_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(payload): Json<RestoreSnapshotRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedTextDocument>>), ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    require_active_vault_role(
        &state.database,
        vault_id,
        &actor.user,
        HostedVaultRole::Editor,
        &request_id,
    )
    .await?;
    let actor_id = user_uuid(&actor.user);
    let revision_id = Uuid::now_v7();
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    lock_active_vault(&mut transaction, vault_id, &request_id).await?;
    let current = sqlx::query(
        r#"
        SELECT f.kind::text AS kind, f.state::text AS state, current.sequence,
               snapshot_revision.blob_digest, snapshot_revision.content_hash,
               snapshot_revision.size_bytes
        FROM hosted_file_entries f
        LEFT JOIN hosted_file_revisions current ON current.id = f.current_revision_id
        JOIN hosted_snapshots snapshot ON snapshot.vault_id = f.vault_id AND snapshot.file_id = f.id
        JOIN hosted_file_revisions snapshot_revision ON snapshot_revision.id = snapshot.revision_id
        WHERE f.vault_id = $1 AND f.id = $2 AND snapshot.id = $3
        FOR UPDATE OF f
        "#,
    )
    .bind(vault_id)
    .bind(file_id)
    .bind(snapshot_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    if current.get::<String, _>("kind") != "document"
        || current.get::<String, _>("state") != "active"
    {
        return Err(ApiFailure::validation(
            "Only active text documents can be restored.",
            request_id,
        ));
    }
    let current_sequence = current.get::<Option<i64>, _>("sequence").unwrap_or(0);
    if current_sequence != payload.expected_revision_sequence {
        return Err(ApiFailure::revision_conflict(request_id));
    }
    let next_sequence = current_sequence + 1;
    sqlx::query(
        "INSERT INTO hosted_file_revisions (id, vault_id, file_id, sequence, blob_digest, content_hash, size_bytes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(revision_id)
    .bind(vault_id)
    .bind(file_id)
    .bind(next_sequence)
    .bind(current.get::<String, _>("blob_digest"))
    .bind(current.get::<String, _>("content_hash"))
    .bind(current.get::<i64, _>("size_bytes"))
    .bind(actor_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query(
        "UPDATE hosted_file_entries SET current_revision_id = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(revision_id)
    .bind(file_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    increment_manifest(&mut transaction, vault_id, &request_id).await?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(actor_id),
        "snapshot.restored",
        Some("file"),
        Some(&file_id.to_string()),
        json!({"snapshotId": snapshot_id, "revisionSequence": next_sequence}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let file = load_vault_file_entry(&state.database, vault_id, file_id, &request_id).await?;
    let content = load_blob_text(
        &state,
        file.current_revision
            .as_ref()
            .map(|revision| revision.content_hash.as_str())
            .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?,
        &request_id,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(HostedTextDocument { file, content })),
    ))
}

pub async fn write_text_revision(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<WriteTextRevisionRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedTextDocument>>), ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    require_active_vault_role(
        &state.database,
        vault_id,
        &actor.user,
        HostedVaultRole::Editor,
        &request_id,
    )
    .await?;
    let content = payload.content.into_bytes();
    let digest = state
        .blobs
        .put(&content)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let actor_id = user_uuid(&actor.user);
    let revision_id = Uuid::now_v7();
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    lock_active_vault(&mut transaction, vault_id, &request_id).await?;
    let current = sqlx::query(
        r#"
        SELECT f.kind::text AS kind, f.state::text AS state, r.sequence
        FROM hosted_file_entries f
        LEFT JOIN hosted_file_revisions r ON r.id = f.current_revision_id
        WHERE f.vault_id = $1 AND f.id = $2
        FOR UPDATE OF f
        "#,
    )
    .bind(vault_id)
    .bind(file_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    if current.get::<String, _>("kind") != "document"
        || current.get::<String, _>("state") != "active"
    {
        return Err(ApiFailure::validation(
            "Only active text documents can be written.",
            request_id,
        ));
    }
    let current_sequence = current.get::<Option<i64>, _>("sequence").unwrap_or(0);
    if current_sequence != payload.expected_revision_sequence {
        return Err(ApiFailure::revision_conflict(request_id));
    }
    let next_sequence = current_sequence + 1;
    insert_blob_record(
        &mut transaction,
        &digest,
        content.len(),
        "text/plain",
        &request_id,
    )
    .await?;
    sqlx::query(
        "INSERT INTO hosted_file_revisions (id, vault_id, file_id, sequence, blob_digest, content_hash, size_bytes, created_by) VALUES ($1, $2, $3, $4, $5, $5, $6, $7)",
    )
    .bind(revision_id)
    .bind(vault_id)
    .bind(file_id)
    .bind(next_sequence)
    .bind(&digest)
    .bind(content.len() as i64)
    .bind(actor_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query(
        "UPDATE hosted_file_entries SET current_revision_id = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(revision_id)
    .bind(file_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    increment_manifest(&mut transaction, vault_id, &request_id).await?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(actor_id),
        "file.revision_created",
        Some("file"),
        Some(&file_id.to_string()),
        json!({"revisionSequence": next_sequence}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let file = load_vault_file_entry(&state.database, vault_id, file_id, &request_id).await?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(HostedTextDocument {
            file,
            content: String::from_utf8(content).expect("request JSON strings are UTF-8"),
        })),
    ))
}

pub async fn upload_binary_asset(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<UploadBinaryAssetRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedFileEntry>>), ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    require_active_vault_role(
        &state.database,
        vault_id,
        &actor.user,
        HostedVaultRole::Editor,
        &request_id,
    )
    .await?;
    let (name, normalized_name) = collab_core::normalize_hosted_name(&payload.name)
        .map_err(|error| ApiFailure::path_invalid(error.to_string(), request_id.clone()))?;
    let parent_path =
        validate_parent_folder(&state.database, vault_id, payload.parent_id, &request_id).await?;
    let relative_path = if parent_path.is_empty() {
        name.clone()
    } else {
        format!("{parent_path}/{name}")
    };
    collab_core::normalize_hosted_path(&relative_path)
        .map_err(|error| ApiFailure::path_invalid(error.to_string(), request_id.clone()))?;
    if payload.media_type.trim().is_empty() || payload.media_type.len() > 255 {
        return Err(ApiFailure::validation(
            "Media type must be between 1 and 255 characters.",
            request_id,
        ));
    }
    let content = STANDARD.decode(&payload.content_base64).map_err(|_| {
        ApiFailure::validation("Asset content is not valid base64.", request_id.clone())
    })?;
    if content.len() > state.config.max_file_bytes {
        return Err(ApiFailure::quota_exceeded(request_id));
    }
    let digest = collab_core::sha256_bytes(&content);
    if digest != payload.expected_hash.to_ascii_lowercase() {
        return Err(ApiFailure::upload_hash_mismatch(request_id));
    }
    let stored_digest = state
        .blobs
        .put(&content)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if stored_digest != digest {
        return Err(ApiFailure::upload_hash_mismatch(request_id));
    }

    let actor_id = user_uuid(&actor.user);
    let file_id = Uuid::now_v7();
    let revision_id = Uuid::now_v7();
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    lock_active_vault(&mut transaction, vault_id, &request_id).await?;
    let inserted = sqlx::query(
        "INSERT INTO hosted_file_entries (id, vault_id, parent_id, name, normalized_name, kind, created_by) VALUES ($1, $2, $3, $4, $5, 'asset', $6)",
    )
    .bind(file_id)
    .bind(vault_id)
    .bind(payload.parent_id)
    .bind(&name)
    .bind(&normalized_name)
    .bind(actor_id)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = inserted {
        return Err(map_path_database_error(error, request_id));
    }
    insert_blob_record(
        &mut transaction,
        &digest,
        content.len(),
        payload.media_type.trim(),
        &request_id,
    )
    .await?;
    sqlx::query(
        "INSERT INTO hosted_file_revisions (id, vault_id, file_id, sequence, blob_digest, content_hash, size_bytes, created_by) VALUES ($1, $2, $3, 1, $4, $4, $5, $6)",
    )
    .bind(revision_id)
    .bind(vault_id)
    .bind(file_id)
    .bind(&digest)
    .bind(content.len() as i64)
    .bind(actor_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query("UPDATE hosted_file_entries SET current_revision_id = $1 WHERE id = $2")
        .bind(revision_id)
        .bind(file_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    increment_manifest(&mut transaction, vault_id, &request_id).await?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(actor_id),
        "asset.uploaded",
        Some("file"),
        Some(&file_id.to_string()),
        json!({"path": relative_path, "sizeBytes": content.len(), "contentHash": digest}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(
            load_vault_file_entry(&state.database, vault_id, file_id, &request_id).await?,
        )),
    ))
}

pub async fn download_vault_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    let row = sqlx::query(
        r#"
        SELECT f.name, f.state::text AS state, r.blob_digest, b.media_type
        FROM hosted_file_entries f
        JOIN hosted_file_revisions r ON r.id = f.current_revision_id
        JOIN hosted_blobs b ON b.digest = r.blob_digest
        WHERE f.vault_id = $1 AND f.id = $2
        "#,
    )
    .bind(vault_id)
    .bind(file_id)
    .fetch_optional(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    if row.get::<String, _>("state") != "active" {
        return Err(ApiFailure::not_found(request_id));
    }
    let digest: String = row.get("blob_digest");
    let bytes = state
        .blobs
        .get(&digest)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?
        .ok_or_else(|| ApiFailure::server(request_id.clone()))?;
    if collab_core::sha256_bytes(&bytes) != digest {
        return Err(ApiFailure::upload_hash_mismatch(request_id));
    }
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(row.get::<String, _>("media_type").as_str())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&format!("\"{digest}\"")).expect("digest ETag is valid"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment"),
    );
    Ok(response)
}

pub async fn apply_structural_operation(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<StructuralOperationRequest>,
) -> Result<Json<DataResponse<HostedStructuralOperationResult>>, ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    let minimum_role = if payload.operation_type == HostedStructuralOperationType::Purge {
        HostedVaultRole::Admin
    } else {
        HostedVaultRole::Editor
    };
    require_active_vault_role(
        &state.database,
        vault_id,
        &actor.user,
        minimum_role,
        &request_id,
    )
    .await?;
    if let Some(existing) = load_structural_operation(
        &state.database,
        vault_id,
        payload.client_operation_id,
        true,
        &request_id,
    )
    .await?
    {
        return Ok(Json(DataResponse::new(existing)));
    }

    let manifest = load_vault_manifest(&state.database, vault_id, &request_id).await?;
    if manifest.sequence != payload.base_manifest_sequence {
        return Err(ApiFailure::manifest_conflict(request_id));
    }
    let target = manifest
        .files
        .iter()
        .find(|file| file.id == payload.target_file_id.to_string())
        .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    let new_prefix = validate_structural_operation(&manifest, target, &payload, &request_id)?;

    let rewrite_destination = match payload.operation_type {
        HostedStructuralOperationType::Rename | HostedStructuralOperationType::Move => {
            Some(new_prefix.as_deref())
        }
        HostedStructuralOperationType::Trash if payload.remove_references => Some(None),
        _ => None,
    };
    let rewrites = if let Some(new_path) = rewrite_destination {
        compute_reference_rewrites(
            &state,
            &manifest,
            &target.relative_path,
            new_path,
            &request_id,
        )
        .await?
    } else {
        Vec::new()
    };
    let mut planned_revisions = Vec::with_capacity(rewrites.len());
    for rewrite in rewrites {
        let bytes = rewrite.content.into_bytes();
        let digest = state
            .blobs
            .put(&bytes)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
        planned_revisions.push((
            rewrite.file_id,
            rewrite.revision_sequence,
            digest,
            bytes.len(),
        ));
    }

    let actor_id = user_uuid(&actor.user);
    let operation_id = Uuid::now_v7();
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let current_manifest = lock_active_vault(&mut transaction, vault_id, &request_id).await?;
    if current_manifest != payload.base_manifest_sequence {
        return Err(ApiFailure::manifest_conflict(request_id));
    }
    match payload.operation_type {
        HostedStructuralOperationType::Rename => {
            let (name, normalized_name) = collab_core::normalize_hosted_name(
                payload.name.as_deref().unwrap(),
            )
            .map_err(|error| ApiFailure::path_invalid(error.to_string(), request_id.clone()))?;
            sqlx::query(
                "UPDATE hosted_file_entries SET name = $1, normalized_name = $2, updated_at = NOW() WHERE vault_id = $3 AND id = $4 AND state = 'active'",
            )
            .bind(name)
            .bind(normalized_name)
            .bind(vault_id)
            .bind(payload.target_file_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| map_path_database_error(error, request_id.clone()))?;
        }
        HostedStructuralOperationType::Move => {
            sqlx::query(
                "UPDATE hosted_file_entries SET parent_id = $1, updated_at = NOW() WHERE vault_id = $2 AND id = $3 AND state = 'active'",
            )
            .bind(payload.parent_id)
            .bind(vault_id)
            .bind(payload.target_file_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| map_path_database_error(error, request_id.clone()))?;
        }
        HostedStructuralOperationType::Trash => {
            sqlx::query(
                r#"
                WITH RECURSIVE affected AS (
                  SELECT id, parent_id, name FROM hosted_file_entries
                  WHERE vault_id = $1 AND id = $2 AND state = 'active'
                  UNION ALL
                  SELECT child.id, child.parent_id, child.name
                  FROM hosted_file_entries child JOIN affected parent ON child.parent_id = parent.id
                  WHERE child.vault_id = $1 AND child.state = 'active'
                )
                INSERT INTO hosted_trash_records (file_id, vault_id, original_parent_id, original_name, trashed_by)
                SELECT id, $1, parent_id, name, $3 FROM affected
                ON CONFLICT (file_id) DO NOTHING
                "#,
            )
            .bind(vault_id)
            .bind(payload.target_file_id)
            .bind(actor_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
            update_subtree_state(
                &mut transaction,
                vault_id,
                payload.target_file_id,
                "trashed",
                &request_id,
            )
            .await?;
        }
        HostedStructuralOperationType::Restore => {
            let root = sqlx::query(
                "SELECT original_parent_id, original_name FROM hosted_trash_records WHERE vault_id = $1 AND file_id = $2",
            )
            .bind(vault_id)
            .bind(payload.target_file_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?
            .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
            let original_name: String = root.get("original_name");
            let (_, normalized_name) = collab_core::normalize_hosted_name(&original_name)
                .map_err(|error| ApiFailure::path_invalid(error.to_string(), request_id.clone()))?;
            sqlx::query(
                "UPDATE hosted_file_entries SET parent_id = $1, name = $2, normalized_name = $3 WHERE vault_id = $4 AND id = $5",
            )
            .bind(root.get::<Option<Uuid>, _>("original_parent_id"))
            .bind(original_name)
            .bind(normalized_name)
            .bind(vault_id)
            .bind(payload.target_file_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| map_path_database_error(error, request_id.clone()))?;
            update_subtree_state(
                &mut transaction,
                vault_id,
                payload.target_file_id,
                "active",
                &request_id,
            )
            .await?;
            delete_subtree_trash_records(
                &mut transaction,
                vault_id,
                payload.target_file_id,
                &request_id,
            )
            .await?;
        }
        HostedStructuralOperationType::Purge => {
            update_subtree_state(
                &mut transaction,
                vault_id,
                payload.target_file_id,
                "tombstoned",
                &request_id,
            )
            .await?;
            delete_subtree_trash_records(
                &mut transaction,
                vault_id,
                payload.target_file_id,
                &request_id,
            )
            .await?;
        }
    }
    let mut rewritten_document_ids = Vec::with_capacity(planned_revisions.len());
    for (file_id, revision_sequence, digest, size) in &planned_revisions {
        insert_blob_record(&mut transaction, digest, *size, "text/plain", &request_id).await?;
        let revision_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO hosted_file_revisions (id, vault_id, file_id, sequence, blob_digest, content_hash, size_bytes, created_by) VALUES ($1, $2, $3, $4, $5, $5, $6, $7)",
        )
        .bind(revision_id)
        .bind(vault_id)
        .bind(file_id)
        .bind(revision_sequence + 1)
        .bind(digest)
        .bind(*size as i64)
        .bind(actor_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
        sqlx::query(
            "UPDATE hosted_file_entries SET current_revision_id = $1, updated_at = NOW() WHERE vault_id = $2 AND id = $3",
        )
        .bind(revision_id)
        .bind(vault_id)
        .bind(file_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
        rewritten_document_ids.push(file_id.to_string());
    }
    let result_manifest = increment_manifest(&mut transaction, vault_id, &request_id).await?;
    sqlx::query(
        "INSERT INTO hosted_structural_operations (id, client_operation_id, vault_id, actor_user_id, base_manifest_sequence, result_manifest_sequence, operation_type, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(operation_id)
    .bind(payload.client_operation_id)
    .bind(vault_id)
    .bind(actor_id)
    .bind(payload.base_manifest_sequence)
    .bind(result_manifest)
    .bind(structural_operation_name(payload.operation_type))
    .bind(json!({
        "targetFileId": payload.target_file_id,
        "name": payload.name,
        "parentId": payload.parent_id,
        "rewrittenDocumentIds": rewritten_document_ids,
    }))
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(actor_id),
        structural_activity_name(payload.operation_type),
        Some("file"),
        Some(&payload.target_file_id.to_string()),
        json!({"manifestSequence": result_manifest}),
        &request_id,
    )
    .await?;
    if !rewritten_document_ids.is_empty() {
        vault_activity_event(
            &mut transaction,
            vault_id,
            Some(actor_id),
            "file.references_rewritten",
            Some("file"),
            Some(&payload.target_file_id.to_string()),
            json!({"documents": rewritten_document_ids}),
            &request_id,
        )
        .await?;
    }
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(HostedStructuralOperationResult {
        operation_id: operation_id.to_string(),
        client_operation_id: payload.client_operation_id.to_string(),
        operation_type: payload.operation_type,
        target_file_id: payload.target_file_id.to_string(),
        result_manifest_sequence: result_manifest,
        already_applied: false,
        rewritten_document_ids,
    })))
}

pub async fn preview_structural_operation(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<StructuralOperationPreviewRequest>,
) -> Result<Json<DataResponse<HostedStructuralOperationPreview>>, ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    let minimum_role = if payload.operation_type == HostedStructuralOperationType::Purge {
        HostedVaultRole::Admin
    } else {
        HostedVaultRole::Editor
    };
    require_active_vault_role(
        &state.database,
        vault_id,
        &actor.user,
        minimum_role,
        &request_id,
    )
    .await?;
    let manifest = load_vault_manifest(&state.database, vault_id, &request_id).await?;
    let target = manifest
        .files
        .iter()
        .find(|file| file.id == payload.target_file_id.to_string())
        .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    let validation = StructuralOperationRequest {
        client_operation_id: Uuid::nil(),
        base_manifest_sequence: manifest.sequence,
        operation_type: payload.operation_type,
        target_file_id: payload.target_file_id,
        name: payload.name.clone(),
        parent_id: payload.parent_id,
        remove_references: false,
    };
    let mut new_relative_path = None;
    let mut blocked_reason = None;
    match validate_structural_operation(&manifest, target, &validation, &request_id) {
        Ok(prefix) => new_relative_path = prefix,
        Err(failure) => blocked_reason = Some(failure.message().to_owned()),
    }
    if blocked_reason.is_none() {
        if let Some(next_path) = new_relative_path.as_deref() {
            if next_path == target.relative_path {
                blocked_reason = Some("The destination matches the current path.".into());
            } else if manifest.files.iter().any(|file| {
                file.id != target.id
                    && file.state == HostedFileState::Active
                    && file.relative_path.to_lowercase() == next_path.to_lowercase()
            }) {
                blocked_reason = Some("The destination path already exists.".into());
            }
        }
    }
    let rewrite_destination = if blocked_reason.is_some() {
        None
    } else {
        match payload.operation_type {
            HostedStructuralOperationType::Rename | HostedStructuralOperationType::Move => {
                Some(new_relative_path.as_deref())
            }
            HostedStructuralOperationType::Trash => Some(None),
            _ => None,
        }
    };
    let affected_documents = if let Some(new_path) = rewrite_destination {
        compute_reference_rewrites(
            &state,
            &manifest,
            &target.relative_path,
            new_path,
            &request_id,
        )
        .await?
        .into_iter()
        .map(|rewrite| HostedReferenceImpact {
            file_id: rewrite.file_id.to_string(),
            relative_path: rewrite.relative_path,
        })
        .collect()
    } else {
        Vec::new()
    };
    let nested_item_count = manifest
        .files
        .iter()
        .filter(|file| {
            file.state == HostedFileState::Active
                && file
                    .relative_path
                    .starts_with(&format!("{}/", target.relative_path))
        })
        .count() as i64;
    Ok(Json(DataResponse::new(HostedStructuralOperationPreview {
        operation_type: payload.operation_type,
        target_file_id: target.id.clone(),
        item_kind: target.kind,
        old_relative_path: target.relative_path.clone(),
        new_relative_path,
        nested_item_count,
        affected_documents,
        blocked_reason,
    })))
}

pub async fn list_file_references(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<DataResponse<Vec<HostedFileReference>>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    let manifest = load_vault_manifest(&state.database, vault_id, &request_id).await?;
    let target = manifest
        .files
        .iter()
        .find(|file| file.id == file_id.to_string())
        .ok_or_else(|| ApiFailure::not_found(request_id.clone()))?;
    if target.state != HostedFileState::Active {
        return Err(ApiFailure::validation(
            "Only active files can be inspected for references.",
            request_id,
        ));
    }
    let target_path = target.relative_path.clone();
    let lookup = collab_core::references::build_reference_lookup(
        manifest
            .files
            .iter()
            .filter(|file| {
                file.kind != HostedFileKind::Folder && file.state == HostedFileState::Active
            })
            .map(|file| file.relative_path.as_str()),
    );
    let path_ids = manifest
        .files
        .iter()
        .filter(|file| file.state == HostedFileState::Active)
        .map(|file| (file.relative_path.as_str(), file.id.as_str()))
        .collect::<HashMap<_, _>>();
    let mut references = Vec::new();
    for file in &manifest.files {
        if file.kind != HostedFileKind::Document
            || file.state != HostedFileState::Active
            || file.id == target.id
            || collab_core::references::path_matches_or_descends(&file.relative_path, &target_path)
        {
            continue;
        }
        let Some(revision) = file.current_revision.as_ref() else {
            continue;
        };
        let content = load_blob_text(&state, &revision.content_hash, &request_id).await?;
        let collected = match file.document_type.unwrap_or(HostedDocumentType::Note) {
            HostedDocumentType::Note => collab_core::references::collect_note_references(
                &content,
                &file.relative_path,
                &lookup,
                &target_path,
            ),
            HostedDocumentType::Kanban => collab_core::references::collect_kanban_references(
                &content,
                &file.relative_path,
                &target_path,
            )
            .unwrap_or_default(),
            HostedDocumentType::Canvas => collab_core::references::collect_canvas_references(
                &content,
                &file.relative_path,
                &target_path,
            )
            .unwrap_or_default(),
        };
        for reference in collected {
            let referenced_file_id = path_ids
                .get(reference.referenced_relative_path.as_str())
                .map(|id| (*id).to_owned());
            references.push(HostedFileReference {
                source_file_id: file.id.clone(),
                source_relative_path: reference.source_relative_path,
                source_document_type: reference.source_document_type,
                reference_kind: reference.reference_kind,
                referenced_file_id,
                referenced_relative_path: reference.referenced_relative_path,
                display_label: reference.display_label,
                context: reference.context,
            });
        }
    }
    references.sort_by(|a, b| {
        a.source_relative_path
            .cmp(&b.source_relative_path)
            .then(a.reference_kind.cmp(&b.reference_kind))
            .then(a.display_label.cmp(&b.display_label))
    });
    Ok(Json(DataResponse::new(references)))
}

pub async fn search_vault(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Query(query): Query<VaultSearchQuery>,
) -> Result<Json<DataResponse<Vec<HostedSearchResult>>>, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Viewer,
        &request_id,
    )
    .await?;
    let query = query.q.trim();
    if query.is_empty() {
        return Ok(Json(DataResponse::new(Vec::new())));
    }
    if query.chars().count() > 200 {
        return Err(ApiFailure::validation(
            "Search queries must be at most 200 characters.",
            request_id,
        ));
    }
    let manifest = load_vault_manifest(&state.database, vault_id, &request_id).await?;
    ensure_hosted_note_index(&state, &manifest, &request_id).await?;
    let rows = sqlx::query(
        r#"
        SELECT file_id, title, content, tags,
               (
                 ts_rank(search_vector, plainto_tsquery('simple', $2))
                 + CASE WHEN title ILIKE $3 THEN 0.5 ELSE 0 END
               )::REAL AS rank
        FROM hosted_note_index
        WHERE vault_id = $1
          AND (
            search_vector @@ plainto_tsquery('simple', $2)
            OR title ILIKE $3
            OR content ILIKE $3
            OR EXISTS (SELECT 1 FROM unnest(tags) tag WHERE tag ILIKE $3)
          )
        ORDER BY rank DESC, indexed_at DESC
        LIMIT 50
        "#,
    )
    .bind(vault_id)
    .bind(query)
    .bind(format!("%{query}%"))
    .fetch_all(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let paths = manifest
        .files
        .iter()
        .map(|file| (file.id.as_str(), file.relative_path.as_str()))
        .collect::<HashMap<_, _>>();
    Ok(Json(DataResponse::new(
        rows.iter()
            .filter_map(|row| {
                let file_id = row.get::<Uuid, _>("file_id").to_string();
                Some(HostedSearchResult {
                    relative_path: paths.get(file_id.as_str())?.to_string(),
                    file_id,
                    title: row.get("title"),
                    excerpt: search_excerpt(row.get::<String, _>("content").as_str(), query, 180),
                    tags: row.get("tags"),
                    rank: row.get("rank"),
                })
            })
            .collect(),
    )))
}

struct VaultImportEntry {
    relative_path: String,
    name: String,
    parent_path: Option<String>,
    kind: HostedFileKind,
    document_type: Option<HostedDocumentType>,
    content: Option<Vec<u8>>,
    digest: Option<String>,
}

pub async fn import_vault_zip(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<ImportVaultZipRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedVaultImportResult>>), ApiFailure> {
    let actor = require_any_user(&state, &headers, &request_id).await?;
    require_active_vault_role(
        &state.database,
        vault_id,
        &actor.user,
        HostedVaultRole::Admin,
        &request_id,
    )
    .await?;
    let archive_bytes = STANDARD.decode(payload.archive_base64).map_err(|_| {
        ApiFailure::validation("Vault import is not valid base64.", request_id.clone())
    })?;
    if archive_bytes.len() > state.config.max_import_bytes {
        return Err(ApiFailure::quota_exceeded(request_id));
    }
    let manifest = load_vault_manifest(&state.database, vault_id, &request_id).await?;
    if manifest
        .files
        .iter()
        .any(|file| file.state == HostedFileState::Active)
    {
        return Err(ApiFailure::validation(
            "ZIP import currently requires an empty hosted vault.",
            request_id,
        ));
    }
    let mut entries = parse_vault_zip(
        &archive_bytes,
        state.config.max_file_bytes,
        state.config.max_import_expanded_bytes,
        &request_id,
    )?;
    let mut imported_bytes = 0usize;
    for entry in &mut entries {
        if let Some(content) = entry.content.as_deref() {
            imported_bytes += content.len();
            entry.digest = Some(
                state
                    .blobs
                    .put(content)
                    .await
                    .map_err(|_| ApiFailure::server(request_id.clone()))?,
            );
        }
    }
    let actor_id = user_uuid(&actor.user);
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    lock_active_vault(&mut transaction, vault_id, &request_id).await?;
    let mut path_ids = HashMap::<String, Uuid>::new();
    for entry in &entries {
        let file_id = Uuid::now_v7();
        let parent_id = entry
            .parent_path
            .as_ref()
            .and_then(|path| path_ids.get(path))
            .copied();
        let (_, normalized_name) = collab_core::normalize_hosted_name(&entry.name)
            .map_err(|error| ApiFailure::path_invalid(error.to_string(), request_id.clone()))?;
        sqlx::query(
            "INSERT INTO hosted_file_entries (id, vault_id, parent_id, name, normalized_name, kind, document_type, created_by) VALUES ($1, $2, $3, $4, $5, $6::hosted_file_kind, $7::hosted_document_type, $8)",
        )
        .bind(file_id)
        .bind(vault_id)
        .bind(parent_id)
        .bind(&entry.name)
        .bind(normalized_name)
        .bind(file_kind_name(entry.kind))
        .bind(entry.document_type.map(document_type_name))
        .bind(actor_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| map_path_database_error(error, request_id.clone()))?;
        if let (Some(content), Some(digest)) = (entry.content.as_deref(), entry.digest.as_deref()) {
            let revision_id = Uuid::now_v7();
            let media_type = if entry.kind == HostedFileKind::Document {
                "text/plain"
            } else {
                "application/octet-stream"
            };
            insert_blob_record(
                &mut transaction,
                digest,
                content.len(),
                media_type,
                &request_id,
            )
            .await?;
            sqlx::query(
                "INSERT INTO hosted_file_revisions (id, vault_id, file_id, sequence, blob_digest, content_hash, size_bytes, created_by) VALUES ($1, $2, $3, 1, $4, $4, $5, $6)",
            )
            .bind(revision_id)
            .bind(vault_id)
            .bind(file_id)
            .bind(digest)
            .bind(content.len() as i64)
            .bind(actor_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
            sqlx::query("UPDATE hosted_file_entries SET current_revision_id = $1 WHERE id = $2")
                .bind(revision_id)
                .bind(file_id)
                .execute(&mut *transaction)
                .await
                .map_err(|_| ApiFailure::server(request_id.clone()))?;
        }
        path_ids.insert(entry.relative_path.clone(), file_id);
    }
    let result_manifest_sequence =
        increment_manifest(&mut transaction, vault_id, &request_id).await?;
    let imported_folders = entries
        .iter()
        .filter(|entry| entry.kind == HostedFileKind::Folder)
        .count() as u64;
    let imported_files = entries.len() as u64 - imported_folders;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(actor_id),
        "vault.imported",
        Some("vault"),
        Some(&vault_id.to_string()),
        json!({"files": imported_files, "folders": imported_folders, "bytes": imported_bytes}),
        &request_id,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(HostedVaultImportResult {
            imported_files,
            imported_folders,
            imported_bytes: imported_bytes as u64,
            result_manifest_sequence,
        })),
    ))
}

pub async fn export_vault_zip(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Response, ApiFailure> {
    let actor = require_authenticated_user(&state, &headers, &request_id).await?;
    require_vault_access(
        &state.database,
        vault_id,
        user_uuid(&actor.user),
        HostedVaultRole::Admin,
        &request_id,
    )
    .await?;
    let manifest = load_vault_manifest(&state.database, vault_id, &request_id).await?;
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for file in manifest
        .files
        .iter()
        .filter(|file| file.state == HostedFileState::Active)
    {
        if file.kind == HostedFileKind::Folder {
            archive
                .add_directory(format!("{}/", file.relative_path), options)
                .map_err(|_| ApiFailure::server(request_id.clone()))?;
            continue;
        }
        let digest = file
            .current_revision
            .as_ref()
            .map(|revision| revision.content_hash.as_str())
            .ok_or_else(|| ApiFailure::server(request_id.clone()))?;
        let bytes = state
            .blobs
            .get(digest)
            .await
            .map_err(|_| ApiFailure::server(request_id.clone()))?
            .ok_or_else(|| ApiFailure::server(request_id.clone()))?;
        archive
            .start_file(&file.relative_path, options)
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
        archive
            .write_all(&bytes)
            .map_err(|_| ApiFailure::server(request_id.clone()))?;
    }
    let bytes = archive
        .finish()
        .map_err(|_| ApiFailure::server(request_id.clone()))?
        .into_inner();
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"collab-vault.zip\""),
    );
    Ok(response)
}

struct ReferenceRewrite {
    file_id: Uuid,
    relative_path: String,
    revision_sequence: i64,
    content: String,
}

async fn compute_reference_rewrites(
    state: &AppState,
    manifest: &HostedVaultManifest,
    old_path: &str,
    new_path: Option<&str>,
    request_id: &str,
) -> Result<Vec<ReferenceRewrite>, ApiFailure> {
    let mut rewrites = Vec::new();
    for file in &manifest.files {
        if file.kind != HostedFileKind::Document
            || file.state != HostedFileState::Active
            || collab_core::references::path_matches_or_descends(&file.relative_path, old_path)
        {
            continue;
        }
        let Some(revision) = file.current_revision.as_ref() else {
            continue;
        };
        let content = load_blob_text(state, &revision.content_hash, request_id).await?;
        // Unparseable board/canvas documents are skipped rather than blocking
        // the structural operation; they cannot hold resolvable references.
        let rewritten = match file.document_type.unwrap_or(HostedDocumentType::Note) {
            HostedDocumentType::Note => Some(collab_core::references::rewrite_note_references(
                &content,
                &file.relative_path,
                old_path,
                new_path,
            )),
            HostedDocumentType::Kanban => {
                collab_core::references::rewrite_kanban_references(&content, old_path, new_path)
                    .ok()
            }
            HostedDocumentType::Canvas => {
                collab_core::references::rewrite_canvas_references(&content, old_path, new_path)
                    .ok()
            }
        };
        let Some(rewritten) = rewritten else {
            continue;
        };
        if rewritten == content {
            continue;
        }
        rewrites.push(ReferenceRewrite {
            file_id: Uuid::parse_str(&file.id).expect("stored file IDs are valid UUIDs"),
            relative_path: file.relative_path.clone(),
            revision_sequence: revision.sequence,
            content: rewritten,
        });
    }
    Ok(rewrites)
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
          (SELECT COUNT(*) FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()) AS pending_invitations,
          (SELECT COUNT(*) FROM hosted_vaults WHERE status <> 'pending_delete') AS hosted_vaults
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
        hosted_vaults: counts.get("hosted_vaults"),
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
    let owns_vault = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM hosted_vaults WHERE owner_user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if owns_vault {
        return Err(ApiFailure::validation(
            "Transfer or delete this user's hosted vaults before deleting the account.",
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
    let rows = sqlx::query(
        r#"
        SELECT v.id, v.name, owner.display_name AS owner_display_name, v.status::text AS status,
               v.updated_at,
               (SELECT COUNT(*) FROM hosted_vault_memberships members WHERE members.vault_id = v.id) AS members,
               COALESCE((SELECT SUM(r.size_bytes) FROM hosted_file_revisions r WHERE r.vault_id = v.id), 0)::bigint AS storage_bytes
        FROM hosted_vaults v
        JOIN users owner ON owner.id = v.owner_user_id
        ORDER BY v.updated_at DESC
        "#,
    )
    .fetch_all(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        rows.iter().map(vault_summary_from_row).collect(),
    )))
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

pub async fn admin_vault_detail(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<HostedVaultAdminDetail>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    Ok(Json(DataResponse::new(
        load_admin_vault_detail(&state.database, vault_id, &request_id).await?,
    )))
}

pub async fn admin_update_vault(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<UpdateVaultRequest>,
) -> Result<Json<DataResponse<HostedVaultAdminDetail>>, ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    let name = payload
        .name
        .as_deref()
        .map(|value| validate_vault_name(value, &request_id))
        .transpose()?;
    if payload.status == Some(HostedVaultStatus::PendingDelete) {
        return Err(ApiFailure::validation(
            "Use DELETE to mark a vault for deletion.",
            request_id,
        ));
    }
    let status = payload.status.map(vault_status_name);
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let updated = sqlx::query(
        r#"
        UPDATE hosted_vaults SET
          name = COALESCE($1, name),
          status = COALESCE($2::hosted_vault_status, status),
          archived_at = CASE
            WHEN $2 = 'archived' THEN NOW()
            WHEN $2 = 'active' THEN NULL
            ELSE archived_at
          END,
          pending_delete_at = CASE WHEN $2 IS NOT NULL THEN NULL ELSE pending_delete_at END,
          updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(name.as_deref())
    .bind(status)
    .bind(vault_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if updated.rows_affected() == 0 {
        return Err(ApiFailure::not_found(request_id));
    }
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        if payload.status.is_some() {
            "vault.status_changed"
        } else {
            "vault.renamed"
        },
        Some("vault"),
        Some(&vault_id.to_string()),
        json!({"status": status, "name": name, "byServerAdmin": true}),
        &request_id,
    )
    .await?;
    audit(
        &mut transaction,
        Some(&actor.user.id),
        "admin.vault.update",
        Some("vault"),
        Some(&vault_id.to_string()),
        "success",
        &request_id,
        json!({"status": status, "renamed": name.is_some()}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        load_admin_vault_detail(&state.database, vault_id, &request_id).await?,
    )))
}

pub async fn admin_delete_vault(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let updated = sqlx::query(
        "UPDATE hosted_vaults SET status = 'pending_delete', pending_delete_at = NOW(), updated_at = NOW() WHERE id = $1",
    )
    .bind(vault_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if updated.rows_affected() == 0 {
        return Err(ApiFailure::not_found(request_id));
    }
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        "vault.pending_delete",
        Some("vault"),
        Some(&vault_id.to_string()),
        json!({"byServerAdmin": true}),
        &request_id,
    )
    .await?;
    audit(
        &mut transaction,
        Some(&actor.user.id),
        "admin.vault.delete",
        Some("vault"),
        Some(&vault_id.to_string()),
        "success",
        &request_id,
        json!({}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn admin_vault_members(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<Vec<HostedVaultMember>>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    require_vault_exists(&state.database, vault_id, &request_id).await?;
    Ok(Json(DataResponse::new(
        load_vault_members(&state.database, vault_id, &request_id).await?,
    )))
}

pub async fn admin_add_vault_member(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
    Json(payload): Json<AddVaultMemberRequest>,
) -> Result<(StatusCode, Json<DataResponse<HostedVaultMember>>), ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    require_vault_not_pending_delete(&state.database, vault_id, &request_id).await?;
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    let inserted = sqlx::query(
        "INSERT INTO hosted_vault_memberships (vault_id, user_id, role) SELECT $1, id, $3::hosted_vault_role FROM users WHERE id = $2 AND status = 'active' ON CONFLICT DO NOTHING",
    )
    .bind(vault_id)
    .bind(payload.user_id)
    .bind(vault_role_name(payload.role))
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    if inserted.rows_affected() == 0 {
        return Err(ApiFailure::validation(
            "The user does not exist, is disabled, or is already a member.",
            request_id,
        ));
    }
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        "member.added",
        Some("user"),
        Some(&payload.user_id.to_string()),
        json!({"role": vault_role_name(payload.role), "byServerAdmin": true}),
        &request_id,
    )
    .await?;
    audit(
        &mut transaction,
        Some(&actor.user.id),
        "admin.vault.member.add",
        Some("vault"),
        Some(&vault_id.to_string()),
        "success",
        &request_id,
        json!({"userId": payload.user_id, "role": vault_role_name(payload.role)}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok((
        StatusCode::CREATED,
        Json(DataResponse::new(
            load_vault_member(&state.database, vault_id, payload.user_id, &request_id).await?,
        )),
    ))
}

pub async fn admin_update_vault_member(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, user_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateVaultMemberRequest>,
) -> Result<Json<DataResponse<HostedVaultMember>>, ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    require_vault_not_pending_delete(&state.database, vault_id, &request_id).await?;
    let target = load_vault_member(&state.database, vault_id, user_id, &request_id).await?;
    if target.owner {
        return Err(ApiFailure::validation(
            "The owner membership cannot be changed.",
            request_id,
        ));
    }
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query("UPDATE hosted_vault_memberships SET role = $1::hosted_vault_role, updated_at = NOW() WHERE vault_id = $2 AND user_id = $3")
        .bind(vault_role_name(payload.role))
        .bind(vault_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        "member.role_changed",
        Some("user"),
        Some(&user_id.to_string()),
        json!({"role": vault_role_name(payload.role), "byServerAdmin": true}),
        &request_id,
    )
    .await?;
    audit(
        &mut transaction,
        Some(&actor.user.id),
        "admin.vault.member.update",
        Some("vault"),
        Some(&vault_id.to_string()),
        "success",
        &request_id,
        json!({"userId": user_id, "role": vault_role_name(payload.role)}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        load_vault_member(&state.database, vault_id, user_id, &request_id).await?,
    )))
}

pub async fn admin_remove_vault_member(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path((vault_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiFailure> {
    let actor = require_admin_csrf(&state, &headers, &request_id).await?;
    require_vault_not_pending_delete(&state.database, vault_id, &request_id).await?;
    let target = load_vault_member(&state.database, vault_id, user_id, &request_id).await?;
    if target.owner {
        return Err(ApiFailure::validation(
            "The owner membership cannot be removed.",
            request_id,
        ));
    }
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    sqlx::query("DELETE FROM hosted_vault_memberships WHERE vault_id = $1 AND user_id = $2")
        .bind(vault_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiFailure::server(request_id.clone()))?;
    vault_activity_event(
        &mut transaction,
        vault_id,
        Some(user_uuid(&actor.user)),
        "member.removed",
        Some("user"),
        Some(&user_id.to_string()),
        json!({"byServerAdmin": true}),
        &request_id,
    )
    .await?;
    audit(
        &mut transaction,
        Some(&actor.user.id),
        "admin.vault.member.remove",
        Some("vault"),
        Some(&vault_id.to_string()),
        "success",
        &request_id,
        json!({"userId": user_id}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| ApiFailure::server(request_id))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn admin_vault_activity(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
    headers: HeaderMap,
    Path(vault_id): Path<Uuid>,
) -> Result<Json<DataResponse<Vec<HostedVaultActivityEvent>>>, ApiFailure> {
    require_admin(&state, &headers, &request_id).await?;
    require_vault_exists(&state.database, vault_id, &request_id).await?;
    let rows = sqlx::query(
        "SELECT a.id, u.display_name AS actor_display_name, a.event_type, a.target_type, a.target_id, a.created_at FROM hosted_vault_activity_events a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.vault_id = $1 ORDER BY a.created_at DESC LIMIT 100",
    )
    .bind(vault_id)
    .fetch_all(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.clone()))?;
    Ok(Json(DataResponse::new(
        rows.iter().map(vault_activity_from_row).collect(),
    )))
}

async fn require_vault_exists(
    pool: &PgPool,
    vault_id: Uuid,
    request_id: &str,
) -> Result<HostedVaultStatus, ApiFailure> {
    let status =
        sqlx::query_scalar::<_, String>("SELECT status::text FROM hosted_vaults WHERE id = $1")
            .bind(vault_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| ApiFailure::server(request_id.to_owned()))?
            .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    Ok(parse_vault_status(&status))
}

async fn require_vault_not_pending_delete(
    pool: &PgPool,
    vault_id: Uuid,
    request_id: &str,
) -> Result<(), ApiFailure> {
    if require_vault_exists(pool, vault_id, request_id).await? == HostedVaultStatus::PendingDelete {
        return Err(ApiFailure::vault_archived(request_id.to_owned()));
    }
    Ok(())
}

async fn load_admin_vault_detail(
    pool: &PgPool,
    vault_id: Uuid,
    request_id: &str,
) -> Result<HostedVaultAdminDetail, ApiFailure> {
    let row = sqlx::query(
        r#"
        SELECT v.id, v.name, v.owner_user_id, owner.username AS owner_username,
               owner.display_name AS owner_display_name, v.status::text AS status,
               v.manifest_sequence, v.created_at, v.updated_at,
               (SELECT COUNT(*) FROM hosted_vault_memberships m WHERE m.vault_id = v.id) AS members,
               (SELECT COUNT(*) FROM hosted_file_entries f WHERE f.vault_id = v.id AND f.state = 'active') AS active_files,
               (SELECT COUNT(*) FROM hosted_file_entries f WHERE f.vault_id = v.id AND f.state = 'trashed') AS trashed_files,
               COALESCE((SELECT SUM(r.size_bytes) FROM hosted_file_revisions r WHERE r.vault_id = v.id), 0)::bigint AS storage_bytes
        FROM hosted_vaults v
        JOIN users owner ON owner.id = v.owner_user_id
        WHERE v.id = $1
        "#,
    )
    .bind(vault_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    Ok(HostedVaultAdminDetail {
        id: row.get::<Uuid, _>("id").to_string(),
        name: row.get("name"),
        owner_user_id: row.get::<Uuid, _>("owner_user_id").to_string(),
        owner_username: row.get("owner_username"),
        owner_display_name: row.get("owner_display_name"),
        status: parse_vault_status(row.get::<String, _>("status").as_str()),
        manifest_sequence: row.get("manifest_sequence"),
        members: row.get("members"),
        active_files: row.get("active_files"),
        trashed_files: row.get("trashed_files"),
        storage_bytes: row.get::<i64, _>("storage_bytes").max(0) as u64,
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .to_rfc3339(),
        updated_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
            .to_rfc3339(),
    })
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

#[derive(Debug)]
struct VaultAccess {
    role: HostedVaultRole,
    owner: bool,
    status: HostedVaultStatus,
}

fn user_uuid(user: &ServerUser) -> Uuid {
    Uuid::parse_str(&user.id).expect("database UUID is valid")
}

fn validate_vault_name(name: &str, request_id: &str) -> Result<String, ApiFailure> {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 || name.chars().any(char::is_control) {
        return Err(ApiFailure::validation(
            "Vault name must be between 1 and 128 printable characters.",
            request_id.to_owned(),
        ));
    }
    Ok(name.to_owned())
}

fn vault_role_name(role: HostedVaultRole) -> &'static str {
    match role {
        HostedVaultRole::Viewer => "viewer",
        HostedVaultRole::Editor => "editor",
        HostedVaultRole::Admin => "admin",
    }
}

fn parse_vault_role(role: &str) -> HostedVaultRole {
    match role {
        "admin" => HostedVaultRole::Admin,
        "editor" => HostedVaultRole::Editor,
        _ => HostedVaultRole::Viewer,
    }
}

fn vault_status_name(status: HostedVaultStatus) -> &'static str {
    match status {
        HostedVaultStatus::Active => "active",
        HostedVaultStatus::Archived => "archived",
        HostedVaultStatus::PendingDelete => "pending_delete",
    }
}

fn parse_vault_status(status: &str) -> HostedVaultStatus {
    match status {
        "archived" => HostedVaultStatus::Archived,
        "pending_delete" => HostedVaultStatus::PendingDelete,
        _ => HostedVaultStatus::Active,
    }
}

async fn require_vault_access(
    pool: &PgPool,
    vault_id: Uuid,
    user_id: Uuid,
    minimum_role: HostedVaultRole,
    request_id: &str,
) -> Result<VaultAccess, ApiFailure> {
    let row = sqlx::query(
        r#"
        SELECT m.role::text AS role, v.owner_user_id = $2 AS owner, v.status::text AS status
        FROM hosted_vaults v
        JOIN hosted_vault_memberships m ON m.vault_id = v.id
        WHERE v.id = $1 AND m.user_id = $2
        "#,
    )
    .bind(vault_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    let access = VaultAccess {
        role: parse_vault_role(row.get::<String, _>("role").as_str()),
        owner: row.get("owner"),
        status: parse_vault_status(row.get::<String, _>("status").as_str()),
    };
    if access.role < minimum_role {
        return Err(ApiFailure::vault_permission_denied(request_id.to_owned()));
    }
    Ok(access)
}

async fn require_active_vault_admin(
    pool: &PgPool,
    vault_id: Uuid,
    user: &ServerUser,
    request_id: &str,
) -> Result<VaultAccess, ApiFailure> {
    let access = require_vault_access(
        pool,
        vault_id,
        user_uuid(user),
        HostedVaultRole::Admin,
        request_id,
    )
    .await?;
    if access.status != HostedVaultStatus::Active {
        return Err(ApiFailure::vault_archived(request_id.to_owned()));
    }
    Ok(access)
}

async fn require_active_vault_role(
    pool: &PgPool,
    vault_id: Uuid,
    user: &ServerUser,
    minimum_role: HostedVaultRole,
    request_id: &str,
) -> Result<VaultAccess, ApiFailure> {
    let access =
        require_vault_access(pool, vault_id, user_uuid(user), minimum_role, request_id).await?;
    if access.status != HostedVaultStatus::Active {
        return Err(ApiFailure::vault_archived(request_id.to_owned()));
    }
    Ok(access)
}

async fn load_vault(
    pool: &PgPool,
    vault_id: Uuid,
    user_id: Uuid,
    request_id: &str,
) -> Result<HostedVault, ApiFailure> {
    let row = sqlx::query(
        r#"
        SELECT v.id, v.name, v.owner_user_id, owner.display_name AS owner_display_name,
               m.role::text AS role, v.status::text AS status, v.manifest_sequence,
               v.created_at, v.updated_at,
               (SELECT COUNT(*) FROM hosted_vault_memberships members WHERE members.vault_id = v.id) AS members,
               COALESCE((SELECT SUM(r.size_bytes) FROM hosted_file_revisions r WHERE r.vault_id = v.id), 0)::bigint AS storage_bytes
        FROM hosted_vaults v
        JOIN hosted_vault_memberships m ON m.vault_id = v.id
        JOIN users owner ON owner.id = v.owner_user_id
        WHERE v.id = $1 AND m.user_id = $2
        "#,
    )
    .bind(vault_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    Ok(vault_from_row(&row))
}

fn vault_from_row(row: &sqlx::postgres::PgRow) -> HostedVault {
    HostedVault {
        id: row.get::<Uuid, _>("id").to_string(),
        name: row.get("name"),
        owner_user_id: row.get::<Uuid, _>("owner_user_id").to_string(),
        owner_display_name: row.get("owner_display_name"),
        role: parse_vault_role(row.get::<String, _>("role").as_str()),
        status: parse_vault_status(row.get::<String, _>("status").as_str()),
        manifest_sequence: row.get("manifest_sequence"),
        members: row.get("members"),
        storage_bytes: row.get::<i64, _>("storage_bytes").max(0) as u64,
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .to_rfc3339(),
        updated_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
            .to_rfc3339(),
    }
}

fn vault_summary_from_row(row: &sqlx::postgres::PgRow) -> HostedVaultSummary {
    HostedVaultSummary {
        id: row.get::<Uuid, _>("id").to_string(),
        name: row.get("name"),
        owner_display_name: row.get("owner_display_name"),
        status: parse_vault_status(row.get::<String, _>("status").as_str()),
        members: row.get("members"),
        storage_bytes: row.get::<i64, _>("storage_bytes").max(0) as u64,
        updated_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
            .to_rfc3339(),
    }
}

async fn load_vault_members(
    pool: &PgPool,
    vault_id: Uuid,
    request_id: &str,
) -> Result<Vec<HostedVaultMember>, ApiFailure> {
    let rows = sqlx::query(
        r#"
        SELECT u.id AS user_id, u.username, u.display_name, m.role::text AS role,
               v.owner_user_id = u.id AS owner, m.created_at
        FROM hosted_vault_memberships m
        JOIN users u ON u.id = m.user_id
        JOIN hosted_vaults v ON v.id = m.vault_id
        WHERE m.vault_id = $1
        ORDER BY owner DESC, u.display_name ASC
        "#,
    )
    .bind(vault_id)
    .fetch_all(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(rows.iter().map(vault_member_from_row).collect())
}

async fn load_vault_member(
    pool: &PgPool,
    vault_id: Uuid,
    user_id: Uuid,
    request_id: &str,
) -> Result<HostedVaultMember, ApiFailure> {
    let row = sqlx::query(
        r#"
        SELECT u.id AS user_id, u.username, u.display_name, m.role::text AS role,
               v.owner_user_id = u.id AS owner, m.created_at
        FROM hosted_vault_memberships m
        JOIN users u ON u.id = m.user_id
        JOIN hosted_vaults v ON v.id = m.vault_id
        WHERE m.vault_id = $1 AND m.user_id = $2
        "#,
    )
    .bind(vault_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    Ok(vault_member_from_row(&row))
}

fn vault_member_from_row(row: &sqlx::postgres::PgRow) -> HostedVaultMember {
    HostedVaultMember {
        user_id: row.get::<Uuid, _>("user_id").to_string(),
        username: row.get("username"),
        display_name: row.get("display_name"),
        role: parse_vault_role(row.get::<String, _>("role").as_str()),
        owner: row.get("owner"),
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .to_rfc3339(),
    }
}

async fn vault_activity_event(
    transaction: &mut Transaction<'_, Postgres>,
    vault_id: Uuid,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    metadata: Value,
    request_id: &str,
) -> Result<(), ApiFailure> {
    sqlx::query(
        "INSERT INTO hosted_vault_activity_events (id, vault_id, actor_user_id, event_type, target_type, target_id, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(Uuid::now_v7())
    .bind(vault_id)
    .bind(actor_user_id)
    .bind(event_type)
    .bind(target_type)
    .bind(target_id)
    .bind(metadata)
    .execute(&mut **transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(())
}

fn vault_activity_from_row(row: &sqlx::postgres::PgRow) -> HostedVaultActivityEvent {
    HostedVaultActivityEvent {
        id: row.get::<Uuid, _>("id").to_string(),
        actor_display_name: row.get("actor_display_name"),
        event_type: row.get("event_type"),
        target_type: row.get("target_type"),
        target_id: row.get("target_id"),
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .to_rfc3339(),
    }
}

fn file_kind_name(kind: HostedFileKind) -> &'static str {
    match kind {
        HostedFileKind::Folder => "folder",
        HostedFileKind::Document => "document",
        HostedFileKind::Asset => "asset",
    }
}

fn parse_file_kind(kind: &str) -> HostedFileKind {
    match kind {
        "folder" => HostedFileKind::Folder,
        "asset" => HostedFileKind::Asset,
        _ => HostedFileKind::Document,
    }
}

fn document_type_name(document_type: HostedDocumentType) -> &'static str {
    match document_type {
        HostedDocumentType::Note => "note",
        HostedDocumentType::Kanban => "kanban",
        HostedDocumentType::Canvas => "canvas",
    }
}

fn parse_document_type(document_type: Option<String>) -> Option<HostedDocumentType> {
    document_type.map(|value| match value.as_str() {
        "kanban" => HostedDocumentType::Kanban,
        "canvas" => HostedDocumentType::Canvas,
        _ => HostedDocumentType::Note,
    })
}

fn parse_file_state(state: &str) -> HostedFileState {
    match state {
        "trashed" => HostedFileState::Trashed,
        "tombstoned" => HostedFileState::Tombstoned,
        _ => HostedFileState::Active,
    }
}

fn structural_operation_name(operation: HostedStructuralOperationType) -> &'static str {
    match operation {
        HostedStructuralOperationType::Rename => "rename",
        HostedStructuralOperationType::Move => "move",
        HostedStructuralOperationType::Trash => "trash",
        HostedStructuralOperationType::Restore => "restore",
        HostedStructuralOperationType::Purge => "purge",
    }
}

fn parse_structural_operation(value: &str) -> HostedStructuralOperationType {
    match value {
        "move" => HostedStructuralOperationType::Move,
        "trash" => HostedStructuralOperationType::Trash,
        "restore" => HostedStructuralOperationType::Restore,
        "purge" => HostedStructuralOperationType::Purge,
        _ => HostedStructuralOperationType::Rename,
    }
}

fn structural_activity_name(operation: HostedStructuralOperationType) -> &'static str {
    match operation {
        HostedStructuralOperationType::Rename => "file.renamed",
        HostedStructuralOperationType::Move => "file.moved",
        HostedStructuralOperationType::Trash => "file.trashed",
        HostedStructuralOperationType::Restore => "file.restored",
        HostedStructuralOperationType::Purge => "file.purged",
    }
}

fn validate_structural_operation(
    manifest: &HostedVaultManifest,
    target: &HostedFileEntry,
    payload: &StructuralOperationRequest,
    request_id: &str,
) -> Result<Option<String>, ApiFailure> {
    if payload.base_manifest_sequence < 0 {
        return Err(ApiFailure::validation(
            "Base manifest sequence cannot be negative.",
            request_id.to_owned(),
        ));
    }
    match payload.operation_type {
        HostedStructuralOperationType::Rename | HostedStructuralOperationType::Move => {
            if target.state != HostedFileState::Active {
                return Err(ApiFailure::validation(
                    "Only active files can be renamed or moved.",
                    request_id.to_owned(),
                ));
            }
            let new_name = if payload.operation_type == HostedStructuralOperationType::Rename {
                payload.name.as_deref().ok_or_else(|| {
                    ApiFailure::validation("Rename requires a name.", request_id.to_owned())
                })?
            } else {
                &target.name
            };
            let (new_name, _) = collab_core::normalize_hosted_name(new_name).map_err(|error| {
                ApiFailure::path_invalid(error.to_string(), request_id.to_owned())
            })?;
            let parent_id = if payload.operation_type == HostedStructuralOperationType::Move {
                payload.parent_id
            } else {
                target
                    .parent_id
                    .as_deref()
                    .map(Uuid::parse_str)
                    .transpose()
                    .expect("stored file IDs are valid UUIDs")
            };
            let parent_path = if let Some(parent_id) = parent_id {
                let parent = manifest
                    .files
                    .iter()
                    .find(|file| file.id == parent_id.to_string())
                    .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
                if parent.kind != HostedFileKind::Folder || parent.state != HostedFileState::Active
                {
                    return Err(ApiFailure::path_invalid(
                        "The destination must be an active folder.",
                        request_id.to_owned(),
                    ));
                }
                if parent.id == target.id
                    || parent
                        .relative_path
                        .starts_with(&format!("{}/", target.relative_path))
                {
                    return Err(ApiFailure::path_invalid(
                        "A folder cannot be moved inside itself.",
                        request_id.to_owned(),
                    ));
                }
                parent.relative_path.as_str()
            } else {
                ""
            };
            let new_prefix = if parent_path.is_empty() {
                new_name
            } else {
                format!("{parent_path}/{new_name}")
            };
            collab_core::normalize_hosted_path(&new_prefix).map_err(|error| {
                ApiFailure::path_invalid(error.to_string(), request_id.to_owned())
            })?;
            for child in manifest.files.iter().filter(|file| {
                file.relative_path
                    .starts_with(&format!("{}/", target.relative_path))
            }) {
                let suffix = child
                    .relative_path
                    .strip_prefix(&target.relative_path)
                    .expect("prefix was checked");
                collab_core::normalize_hosted_path(&format!("{new_prefix}{suffix}")).map_err(
                    |error| ApiFailure::path_invalid(error.to_string(), request_id.to_owned()),
                )?;
            }
            return Ok(Some(new_prefix));
        }
        HostedStructuralOperationType::Trash if target.state != HostedFileState::Active => {
            return Err(ApiFailure::validation(
                "Only active files can be trashed.",
                request_id.to_owned(),
            ));
        }
        HostedStructuralOperationType::Restore | HostedStructuralOperationType::Purge
            if target.state != HostedFileState::Trashed =>
        {
            return Err(ApiFailure::validation(
                "Only trashed files can be restored or purged.",
                request_id.to_owned(),
            ));
        }
        _ => {}
    }
    Ok(None)
}

async fn load_structural_operation(
    pool: &PgPool,
    vault_id: Uuid,
    client_operation_id: Uuid,
    already_applied: bool,
    request_id: &str,
) -> Result<Option<HostedStructuralOperationResult>, ApiFailure> {
    let row = sqlx::query(
        "SELECT id, client_operation_id, operation_type, result_manifest_sequence, payload->>'targetFileId' AS target_file_id, payload->'rewrittenDocumentIds' AS rewritten_document_ids FROM hosted_structural_operations WHERE vault_id = $1 AND client_operation_id = $2",
    )
    .bind(vault_id)
    .bind(client_operation_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(row.map(|row| HostedStructuralOperationResult {
        operation_id: row.get::<Uuid, _>("id").to_string(),
        client_operation_id: row.get::<Uuid, _>("client_operation_id").to_string(),
        operation_type: parse_structural_operation(row.get::<String, _>("operation_type").as_str()),
        target_file_id: row.get("target_file_id"),
        result_manifest_sequence: row.get("result_manifest_sequence"),
        already_applied,
        rewritten_document_ids: row
            .get::<Option<Value>, _>("rewritten_document_ids")
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default(),
    }))
}

async fn update_subtree_state(
    transaction: &mut Transaction<'_, Postgres>,
    vault_id: Uuid,
    target_file_id: Uuid,
    state: &str,
    request_id: &str,
) -> Result<(), ApiFailure> {
    sqlx::query(
        r#"
        WITH RECURSIVE affected AS (
          SELECT id FROM hosted_file_entries WHERE vault_id = $1 AND id = $2
          UNION ALL
          SELECT child.id FROM hosted_file_entries child
          JOIN affected parent ON child.parent_id = parent.id
          WHERE child.vault_id = $1
        )
        UPDATE hosted_file_entries SET state = $3::hosted_file_state, updated_at = NOW()
        WHERE id IN (SELECT id FROM affected)
        "#,
    )
    .bind(vault_id)
    .bind(target_file_id)
    .bind(state)
    .execute(&mut **transaction)
    .await
    .map_err(|error| map_path_database_error(error, request_id.to_owned()))?;
    Ok(())
}

async fn delete_subtree_trash_records(
    transaction: &mut Transaction<'_, Postgres>,
    vault_id: Uuid,
    target_file_id: Uuid,
    request_id: &str,
) -> Result<(), ApiFailure> {
    sqlx::query(
        r#"
        WITH RECURSIVE affected AS (
          SELECT id FROM hosted_file_entries WHERE vault_id = $1 AND id = $2
          UNION ALL
          SELECT child.id FROM hosted_file_entries child
          JOIN affected parent ON child.parent_id = parent.id
          WHERE child.vault_id = $1
        )
        DELETE FROM hosted_trash_records WHERE file_id IN (SELECT id FROM affected)
        "#,
    )
    .bind(vault_id)
    .bind(target_file_id)
    .execute(&mut **transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(())
}

fn validate_file_kind(
    kind: HostedFileKind,
    document_type: Option<HostedDocumentType>,
    content: &str,
    request_id: &str,
) -> Result<(), ApiFailure> {
    match kind {
        HostedFileKind::Folder if document_type.is_none() && content.is_empty() => Ok(()),
        HostedFileKind::Document if document_type.is_some() => Ok(()),
        HostedFileKind::Asset => Err(ApiFailure::validation(
            "Binary assets must use the upload API.",
            request_id.to_owned(),
        )),
        _ => Err(ApiFailure::validation(
            "Folders cannot have document content, and documents require a document type.",
            request_id.to_owned(),
        )),
    }
}

async fn validate_parent_folder(
    pool: &PgPool,
    vault_id: Uuid,
    parent_id: Option<Uuid>,
    request_id: &str,
) -> Result<String, ApiFailure> {
    let Some(parent_id) = parent_id else {
        return Ok(String::new());
    };
    let manifest = load_vault_manifest(pool, vault_id, request_id).await?;
    let parent = manifest
        .files
        .into_iter()
        .find(|file| file.id == parent_id.to_string())
        .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    if parent.kind != HostedFileKind::Folder || parent.state != HostedFileState::Active {
        return Err(ApiFailure::path_invalid(
            "The parent must be an active folder.",
            request_id.to_owned(),
        ));
    }
    Ok(parent.relative_path)
}

async fn lock_active_vault(
    transaction: &mut Transaction<'_, Postgres>,
    vault_id: Uuid,
    request_id: &str,
) -> Result<i64, ApiFailure> {
    let row = sqlx::query(
        "SELECT status::text AS status, manifest_sequence FROM hosted_vaults WHERE id = $1 FOR UPDATE",
    )
    .bind(vault_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    if row.get::<String, _>("status") != "active" {
        return Err(ApiFailure::vault_archived(request_id.to_owned()));
    }
    Ok(row.get("manifest_sequence"))
}

async fn increment_manifest(
    transaction: &mut Transaction<'_, Postgres>,
    vault_id: Uuid,
    request_id: &str,
) -> Result<i64, ApiFailure> {
    sqlx::query_scalar(
        "UPDATE hosted_vaults SET manifest_sequence = manifest_sequence + 1, updated_at = NOW() WHERE id = $1 RETURNING manifest_sequence",
    )
    .bind(vault_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))
}

async fn insert_blob_record(
    transaction: &mut Transaction<'_, Postgres>,
    digest: &str,
    size: usize,
    media_type: &str,
    request_id: &str,
) -> Result<(), ApiFailure> {
    sqlx::query(
        "INSERT INTO hosted_blobs (digest, size_bytes, media_type, storage_key) VALUES ($1, $2, $3, $1) ON CONFLICT (digest) DO NOTHING",
    )
    .bind(digest)
    .bind(size as i64)
    .bind(media_type)
    .execute(&mut **transaction)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(())
}

fn map_path_database_error(error: sqlx::Error, request_id: String) -> ApiFailure {
    if error
        .as_database_error()
        .and_then(|value| value.code())
        .as_deref()
        == Some("23505")
    {
        ApiFailure::new(
            StatusCode::CONFLICT,
            ErrorCode::PathConflict,
            "A file with that name already exists in the folder.",
            request_id,
        )
    } else {
        ApiFailure::server(request_id)
    }
}

async fn load_vault_manifest(
    pool: &PgPool,
    vault_id: Uuid,
    request_id: &str,
) -> Result<HostedVaultManifest, ApiFailure> {
    let sequence =
        sqlx::query_scalar::<_, i64>("SELECT manifest_sequence FROM hosted_vaults WHERE id = $1")
            .bind(vault_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| ApiFailure::server(request_id.to_owned()))?
            .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    let rows = sqlx::query(
        r#"
        SELECT f.id, f.parent_id, f.name, f.kind::text AS kind,
               f.document_type::text AS document_type, f.state::text AS state,
               f.created_at, f.updated_at,
               r.id AS revision_id, r.sequence AS revision_sequence,
               r.content_hash, r.size_bytes, r.created_at AS revision_created_at,
               creator.display_name AS revision_creator_display_name
        FROM hosted_file_entries f
        LEFT JOIN hosted_file_revisions r ON r.id = f.current_revision_id
        LEFT JOIN users creator ON creator.id = r.created_by
        WHERE f.vault_id = $1
        ORDER BY f.created_at ASC
        "#,
    )
    .bind(vault_id)
    .fetch_all(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    let paths = rows
        .iter()
        .map(|row| {
            (
                row.get::<Uuid, _>("id"),
                (
                    row.get::<Option<Uuid>, _>("parent_id"),
                    row.get::<String, _>("name"),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let files = rows
        .iter()
        .map(|row| file_entry_from_row(row, &paths))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(HostedVaultManifest {
        vault_id: vault_id.to_string(),
        sequence,
        files,
    })
}

fn file_entry_from_row(
    row: &sqlx::postgres::PgRow,
    paths: &HashMap<Uuid, (Option<Uuid>, String)>,
) -> Result<HostedFileEntry, ()> {
    let id: Uuid = row.get("id");
    let mut current = Some(id);
    let mut names = Vec::new();
    for _ in 0..=paths.len() {
        let Some(file_id) = current else {
            names.reverse();
            return Ok(HostedFileEntry {
                id: id.to_string(),
                parent_id: row
                    .get::<Option<Uuid>, _>("parent_id")
                    .map(|value| value.to_string()),
                name: row.get("name"),
                relative_path: names.join("/"),
                kind: parse_file_kind(row.get::<String, _>("kind").as_str()),
                document_type: parse_document_type(row.get("document_type")),
                state: parse_file_state(row.get::<String, _>("state").as_str()),
                current_revision: revision_from_current_row(row),
                created_at: row
                    .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                    .to_rfc3339(),
                updated_at: row
                    .get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
                    .to_rfc3339(),
            });
        };
        let (parent_id, name) = paths.get(&file_id).ok_or(())?;
        names.push(name.clone());
        current = *parent_id;
    }
    Err(())
}

fn revision_from_current_row(row: &sqlx::postgres::PgRow) -> Option<HostedFileRevision> {
    Some(HostedFileRevision {
        id: row.get::<Option<Uuid>, _>("revision_id")?.to_string(),
        sequence: row.get("revision_sequence"),
        content_hash: row.get("content_hash"),
        size_bytes: row.get::<i64, _>("size_bytes").max(0) as u64,
        created_by_display_name: row.get("revision_creator_display_name"),
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("revision_created_at")
            .to_rfc3339(),
    })
}

async fn load_vault_file_entry(
    pool: &PgPool,
    vault_id: Uuid,
    file_id: Uuid,
    request_id: &str,
) -> Result<HostedFileEntry, ApiFailure> {
    load_vault_manifest(pool, vault_id, request_id)
        .await?
        .files
        .into_iter()
        .find(|file| file.id == file_id.to_string())
        .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))
}

async fn load_file_revisions(
    pool: &PgPool,
    vault_id: Uuid,
    file_id: Uuid,
    request_id: &str,
) -> Result<Vec<HostedFileRevision>, ApiFailure> {
    let rows = sqlx::query(
        r#"
        SELECT r.id, r.sequence, r.content_hash, r.size_bytes, r.created_at,
               creator.display_name AS created_by_display_name
        FROM hosted_file_revisions r
        LEFT JOIN users creator ON creator.id = r.created_by
        WHERE r.vault_id = $1 AND r.file_id = $2
        ORDER BY r.sequence DESC
        "#,
    )
    .bind(vault_id)
    .bind(file_id)
    .fetch_all(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    if rows.is_empty() {
        return Err(ApiFailure::not_found(request_id.to_owned()));
    }
    Ok(rows
        .iter()
        .map(|row| HostedFileRevision {
            id: row.get::<Uuid, _>("id").to_string(),
            sequence: row.get("sequence"),
            content_hash: row.get("content_hash"),
            size_bytes: row.get::<i64, _>("size_bytes").max(0) as u64,
            created_by_display_name: row.get("created_by_display_name"),
            created_at: row
                .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .to_rfc3339(),
        })
        .collect())
}

fn normalize_snapshot_label(
    label: Option<String>,
    request_id: &str,
) -> Result<Option<String>, ApiFailure> {
    let label = label
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if label
        .as_ref()
        .is_some_and(|value| value.chars().count() > 200)
    {
        return Err(ApiFailure::validation(
            "Snapshot labels must be at most 200 characters.",
            request_id.to_owned(),
        ));
    }
    Ok(label)
}

fn revision_from_row(row: &sqlx::postgres::PgRow) -> HostedFileRevision {
    HostedFileRevision {
        id: row.get::<Uuid, _>("revision_id").to_string(),
        sequence: row.get("revision_sequence"),
        content_hash: row.get("content_hash"),
        size_bytes: row.get::<i64, _>("size_bytes").max(0) as u64,
        created_by_display_name: row.get("revision_creator_display_name"),
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("revision_created_at")
            .to_rfc3339(),
    }
}

fn snapshot_from_row(row: &sqlx::postgres::PgRow) -> HostedSnapshot {
    HostedSnapshot {
        id: row.get::<Uuid, _>("snapshot_id").to_string(),
        label: row.get("label"),
        revision: revision_from_row(row),
        created_by_display_name: row.get("snapshot_creator_display_name"),
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("snapshot_created_at")
            .to_rfc3339(),
    }
}

async fn load_file_snapshots(
    pool: &PgPool,
    vault_id: Uuid,
    file_id: Uuid,
    request_id: &str,
) -> Result<Vec<HostedSnapshot>, ApiFailure> {
    let rows = sqlx::query(
        r#"
        SELECT snapshot.id AS snapshot_id, snapshot.label,
               snapshot.created_at AS snapshot_created_at,
               snapshot_creator.display_name AS snapshot_creator_display_name,
               revision.id AS revision_id, revision.sequence AS revision_sequence,
               revision.content_hash, revision.size_bytes,
               revision.created_at AS revision_created_at,
               revision_creator.display_name AS revision_creator_display_name
        FROM hosted_snapshots snapshot
        JOIN hosted_file_revisions revision ON revision.id = snapshot.revision_id
        LEFT JOIN users snapshot_creator ON snapshot_creator.id = snapshot.created_by
        LEFT JOIN users revision_creator ON revision_creator.id = revision.created_by
        WHERE snapshot.vault_id = $1 AND snapshot.file_id = $2
        ORDER BY snapshot.created_at DESC
        "#,
    )
    .bind(vault_id)
    .bind(file_id)
    .fetch_all(pool)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    Ok(rows.iter().map(snapshot_from_row).collect())
}

async fn load_file_snapshot(
    pool: &PgPool,
    vault_id: Uuid,
    file_id: Uuid,
    snapshot_id: Uuid,
    request_id: &str,
) -> Result<HostedSnapshot, ApiFailure> {
    let rows = load_file_snapshots(pool, vault_id, file_id, request_id).await?;
    rows.into_iter()
        .find(|snapshot| snapshot.id == snapshot_id.to_string())
        .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))
}

async fn load_blob_text(
    state: &AppState,
    digest: &str,
    request_id: &str,
) -> Result<String, ApiFailure> {
    let bytes = state
        .blobs
        .get(digest)
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?
        .ok_or_else(|| ApiFailure::server(request_id.to_owned()))?;
    if collab_core::sha256_bytes(&bytes) != digest {
        return Err(ApiFailure::upload_hash_mismatch(request_id.to_owned()));
    }
    String::from_utf8(bytes).map_err(|_| ApiFailure::server(request_id.to_owned()))
}

async fn load_text_revision_content(
    state: &AppState,
    vault_id: Uuid,
    file_id: Uuid,
    revision_id: Uuid,
    request_id: &str,
) -> Result<HostedRevisionContent, ApiFailure> {
    let row = sqlx::query(
        r#"
        SELECT file.kind::text AS kind, revision.blob_digest,
               revision.id AS revision_id, revision.sequence AS revision_sequence,
               revision.content_hash, revision.size_bytes,
               revision.created_at AS revision_created_at,
               creator.display_name AS revision_creator_display_name
        FROM hosted_file_entries file
        JOIN hosted_file_revisions revision
          ON revision.vault_id = file.vault_id AND revision.file_id = file.id
        LEFT JOIN users creator ON creator.id = revision.created_by
        WHERE file.vault_id = $1 AND file.id = $2 AND revision.id = $3
        "#,
    )
    .bind(vault_id)
    .bind(file_id)
    .bind(revision_id)
    .fetch_optional(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?
    .ok_or_else(|| ApiFailure::not_found(request_id.to_owned()))?;
    if row.get::<String, _>("kind") != "document" {
        return Err(ApiFailure::validation(
            "Only text revision content can be read through this endpoint.",
            request_id.to_owned(),
        ));
    }
    Ok(HostedRevisionContent {
        revision: revision_from_row(&row),
        content: load_blob_text(
            state,
            row.get::<String, _>("blob_digest").as_str(),
            request_id,
        )
        .await?,
    })
}

fn indexed_note_title(content: &str, filename: &str) -> String {
    if content.starts_with("---") {
        if let Some(end) = content[3..].find("---") {
            for line in content[3..end + 3].lines() {
                if let Some(title) = line.strip_prefix("title:") {
                    let title = title.trim().trim_matches(['"', '\'']);
                    if !title.is_empty() {
                        return title.to_owned();
                    }
                }
            }
        }
    }
    content
        .lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| filename.trim_end_matches(".md"))
        .to_owned()
}

fn indexed_note_tags(content: &str) -> Vec<String> {
    if !content.starts_with("---") {
        return Vec::new();
    }
    let Some(end) = content[3..].find("---") else {
        return Vec::new();
    };
    let mut tags = Vec::new();
    let mut in_tags = false;
    for line in content[3..end + 3].lines() {
        if let Some(value) = line.trim_start().strip_prefix("tags:") {
            let value = value.trim();
            if value.starts_with('[') {
                tags.extend(
                    value
                        .trim_matches(['[', ']'])
                        .split(',')
                        .map(|tag| tag.trim().trim_matches(['"', '\'']).to_owned())
                        .filter(|tag| !tag.is_empty()),
                );
            } else {
                in_tags = true;
            }
        } else if in_tags {
            if let Some(tag) = line.trim().strip_prefix("- ") {
                let tag = tag.trim().trim_matches(['"', '\'']);
                if !tag.is_empty() {
                    tags.push(tag.to_owned());
                }
            } else {
                break;
            }
        }
    }
    tags
}

fn search_excerpt(content: &str, query: &str, max_chars: usize) -> String {
    let lower_content = content.to_lowercase();
    let lower_query = query.to_lowercase();
    let match_char = lower_content
        .find(&lower_query)
        .map(|position| lower_content[..position].chars().count())
        .unwrap_or(0);
    let start_char = match_char.saturating_sub(max_chars / 3);
    let excerpt = content
        .chars()
        .skip(start_char)
        .take(max_chars)
        .collect::<String>();
    let excerpt = excerpt.split_whitespace().collect::<Vec<_>>().join(" ");
    if content.chars().skip(start_char).count() > max_chars {
        format!("{excerpt}...")
    } else {
        excerpt
    }
}

async fn ensure_hosted_note_index(
    state: &AppState,
    manifest: &HostedVaultManifest,
    request_id: &str,
) -> Result<(), ApiFailure> {
    let vault_id = Uuid::parse_str(&manifest.vault_id).expect("stored vault IDs are valid UUIDs");
    sqlx::query(
        r#"
        DELETE FROM hosted_note_index index_row
        WHERE index_row.vault_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM hosted_file_entries file
            WHERE file.id = index_row.file_id
              AND file.vault_id = index_row.vault_id
              AND file.state = 'active'
              AND file.kind = 'document'
              AND file.document_type = 'note'
              AND file.current_revision_id = index_row.revision_id
          )
        "#,
    )
    .bind(vault_id)
    .execute(&state.database)
    .await
    .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    for file in manifest.files.iter().filter(|file| {
        file.state == HostedFileState::Active
            && file.kind == HostedFileKind::Document
            && file.document_type == Some(HostedDocumentType::Note)
    }) {
        let Some(revision) = file.current_revision.as_ref() else {
            continue;
        };
        let file_id = Uuid::parse_str(&file.id).expect("stored file IDs are valid UUIDs");
        let revision_id =
            Uuid::parse_str(&revision.id).expect("stored revision IDs are valid UUIDs");
        let indexed_revision = sqlx::query_scalar::<_, Uuid>(
            "SELECT revision_id FROM hosted_note_index WHERE file_id = $1",
        )
        .bind(file_id)
        .fetch_optional(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
        if indexed_revision == Some(revision_id) {
            continue;
        }
        let content = load_blob_text(state, &revision.content_hash, request_id).await?;
        let title = indexed_note_title(&content, &file.name);
        let tags = indexed_note_tags(&content);
        let search_text = format!("{title} {} {content}", tags.join(" "));
        sqlx::query(
            r#"
            INSERT INTO hosted_note_index
              (file_id, vault_id, revision_id, title, content, tags, search_vector)
            VALUES ($1, $2, $3, $4, $5, $6, to_tsvector('simple', $7))
            ON CONFLICT (file_id) DO UPDATE SET
              revision_id = EXCLUDED.revision_id,
              title = EXCLUDED.title,
              content = EXCLUDED.content,
              tags = EXCLUDED.tags,
              search_vector = EXCLUDED.search_vector,
              indexed_at = NOW()
            "#,
        )
        .bind(file_id)
        .bind(vault_id)
        .bind(revision_id)
        .bind(title)
        .bind(content)
        .bind(tags)
        .bind(search_text)
        .execute(&state.database)
        .await
        .map_err(|_| ApiFailure::server(request_id.to_owned()))?;
    }
    Ok(())
}

fn parse_vault_zip(
    bytes: &[u8],
    max_file_bytes: usize,
    max_expanded_bytes: usize,
    request_id: &str,
) -> Result<Vec<VaultImportEntry>, ApiFailure> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| {
        ApiFailure::validation(
            "Vault import is not a valid ZIP archive.",
            request_id.to_owned(),
        )
    })?;
    if archive.len() > 1000 {
        return Err(ApiFailure::quota_exceeded(request_id.to_owned()));
    }
    let mut files = Vec::<(String, Vec<u8>)>::new();
    let mut explicit_folders = HashSet::<String>::new();
    let mut comparison_paths = HashSet::<String>::new();
    let mut expanded_bytes = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| {
            ApiFailure::validation("Vault ZIP entry could not be read.", request_id.to_owned())
        })?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(ApiFailure::validation(
                "Vault ZIP symlinks are not supported.",
                request_id.to_owned(),
            ));
        }
        let raw_name = entry.name().trim_end_matches('/');
        if raw_name.is_empty() {
            continue;
        }
        if raw_name
            .split('/')
            .next()
            .is_some_and(|name| name.eq_ignore_ascii_case(".collab"))
        {
            continue;
        }
        let path = collab_core::normalize_hosted_path(raw_name)
            .map_err(|error| ApiFailure::path_invalid(error.to_string(), request_id.to_owned()))?;
        let comparison = path.to_lowercase();
        if !comparison_paths.insert(comparison) {
            return Err(ApiFailure::validation(
                "Vault ZIP contains duplicate normalized paths.",
                request_id.to_owned(),
            ));
        }
        if entry.is_dir() {
            explicit_folders.insert(path);
            continue;
        }
        if entry.size() > max_file_bytes as u64 {
            return Err(ApiFailure::quota_exceeded(request_id.to_owned()));
        }
        let mut content = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut content).map_err(|_| {
            ApiFailure::validation(
                "Vault ZIP entry could not be expanded.",
                request_id.to_owned(),
            )
        })?;
        expanded_bytes = expanded_bytes.saturating_add(content.len());
        if expanded_bytes > max_expanded_bytes {
            return Err(ApiFailure::quota_exceeded(request_id.to_owned()));
        }
        files.push((path, content));
    }
    let mut folders = explicit_folders;
    for (path, _) in &files {
        let mut parts = path.split('/').collect::<Vec<_>>();
        parts.pop();
        while !parts.is_empty() {
            folders.insert(parts.join("/"));
            parts.pop();
        }
    }
    let file_paths = files
        .iter()
        .map(|(path, _)| path.to_lowercase())
        .collect::<HashSet<_>>();
    if folders
        .iter()
        .any(|folder| file_paths.contains(&folder.to_lowercase()))
    {
        return Err(ApiFailure::validation(
            "Vault ZIP contains a path used as both a file and folder.",
            request_id.to_owned(),
        ));
    }
    let mut entries = folders
        .into_iter()
        .map(|path| import_entry(path, HostedFileKind::Folder, None, None))
        .collect::<Vec<_>>();
    for (path, content) in files {
        let (kind, document_type) = imported_file_kind(&path);
        if kind == HostedFileKind::Document && String::from_utf8(content.clone()).is_err() {
            return Err(ApiFailure::validation(
                "Imported text documents must be valid UTF-8.",
                request_id.to_owned(),
            ));
        }
        entries.push(import_entry(path, kind, document_type, Some(content)));
    }
    entries.sort_by_key(|entry| {
        (
            entry.relative_path.matches('/').count(),
            entry.kind != HostedFileKind::Folder,
            entry.relative_path.to_lowercase(),
        )
    });
    Ok(entries)
}

fn import_entry(
    relative_path: String,
    kind: HostedFileKind,
    document_type: Option<HostedDocumentType>,
    content: Option<Vec<u8>>,
) -> VaultImportEntry {
    let (parent_path, name) = relative_path
        .rsplit_once('/')
        .map(|(parent, name)| (Some(parent.to_owned()), name.to_owned()))
        .unwrap_or_else(|| (None, relative_path.clone()));
    VaultImportEntry {
        relative_path,
        name,
        parent_path,
        kind,
        document_type,
        content,
        digest: None,
    }
}

fn imported_file_kind(path: &str) -> (HostedFileKind, Option<HostedDocumentType>) {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".md") {
        (HostedFileKind::Document, Some(HostedDocumentType::Note))
    } else if lower.ends_with(".kanban") {
        (HostedFileKind::Document, Some(HostedDocumentType::Kanban))
    } else if lower.ends_with(".canvas") {
        (HostedFileKind::Document, Some(HostedDocumentType::Canvas))
    } else {
        (HostedFileKind::Asset, None)
    }
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

async fn require_authenticated_user(
    state: &AppState,
    headers: &HeaderMap,
    request_id: &str,
) -> Result<AuthenticatedUser, ApiFailure> {
    if headers.contains_key(header::AUTHORIZATION) {
        require_native_user(state, headers, request_id).await
    } else {
        require_user(state, headers, request_id).await
    }
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

    fn message(&self) -> &str {
        &self.error.message
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

    fn vault_permission_denied(request_id: String) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            ErrorCode::VaultPermissionDenied,
            "You do not have permission to perform this vault operation.",
            request_id,
        )
    }

    fn vault_archived(request_id: String) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            ErrorCode::VaultArchived,
            "The vault is archived or pending deletion.",
            request_id,
        )
    }

    fn path_invalid(message: impl Into<String>, request_id: String) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::PathInvalid,
            message,
            request_id,
        )
    }

    fn revision_conflict(request_id: String) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            ErrorCode::RevisionConflict,
            "The document has changed since the supplied revision.",
            request_id,
        )
    }

    fn manifest_conflict(request_id: String) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            ErrorCode::ManifestConflict,
            "The vault manifest has changed since the supplied sequence.",
            request_id,
        )
    }

    fn upload_hash_mismatch(request_id: String) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::UploadHashMismatch,
            "The uploaded content does not match the expected SHA-256 hash.",
            request_id,
        )
    }

    fn quota_exceeded(request_id: String) -> Self {
        Self::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::QuotaExceeded,
            "The file exceeds the configured upload limit.",
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
    use super::{
        cookie, indexed_note_tags, indexed_note_title, parse_vault_zip, search_excerpt, STANDARD,
    };
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
    use base64::Engine;
    use http_body_util::BodyExt;
    use serde_json::{json, Value};
    use sqlx::{postgres::PgPoolOptions, Row};
    use std::{
        io::{Cursor, Read, Write},
        sync::Arc,
    };
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

    #[test]
    fn hosted_note_index_extracts_metadata_and_unicode_safe_excerpts() {
        let content = "---\ntitle: \"Search title\"\ntags: [alpha, beta]\n---\n# Ignored\nA café search term appears here.";
        assert_eq!(indexed_note_title(content, "Fallback.md"), "Search title");
        assert_eq!(indexed_note_tags(content), vec!["alpha", "beta"]);
        assert!(search_excerpt(content, "café", 30).contains("café"));
    }

    #[test]
    fn vault_zip_parser_rejects_traversal_and_builds_implicit_folders() {
        let valid = STANDARD
            .decode(zip_base64(&[("Notes/Test.md", b"# Test")]))
            .unwrap();
        let entries = parse_vault_zip(&valid, 1024, 4096, "request").unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].relative_path, "Notes");
        assert_eq!(entries[1].relative_path, "Notes/Test.md");

        let invalid = STANDARD
            .decode(zip_base64(&[("../escape.md", b"no")]))
            .unwrap();
        assert!(parse_vault_zip(&invalid, 1024, 4096, "request").is_err());
    }

    #[test]
    fn vault_zip_parser_enforces_total_expanded_limit_separately() {
        let archive = STANDARD
            .decode(zip_base64(&[
                ("one.bin", &[1; 700]),
                ("two.bin", &[2; 700]),
            ]))
            .unwrap();

        assert!(parse_vault_zip(&archive, 1024, 1200, "request").is_err());
        assert!(parse_vault_zip(&archive, 1024, 1600, "request").is_ok());
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

    async fn response_bytes(response: axum::response::Response) -> Vec<u8> {
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec()
    }

    fn zip_base64(entries: &[(&str, &[u8])]) -> String {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content).unwrap();
        }
        STANDARD.encode(writer.finish().unwrap().into_inner())
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
            "TRUNCATE audit_events, invitations, native_sessions, sessions, credentials, users, hosted_blobs RESTART IDENTITY CASCADE",
        )
        .execute(&pool)
        .await
        .unwrap();
        let blobs = Arc::new(
            FileSystemBlobStorage::new(tempfile::tempdir().unwrap().keep())
                .await
                .unwrap(),
        );
        let app = build_router(AppState::new(
            ServerConfig::default(),
            pool.clone(),
            blobs.clone(),
        ));

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
        assert_eq!(status.headers()[header::CACHE_CONTROL], "no-store");
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

        let restarted_app =
            build_router(AppState::new(ServerConfig::default(), pool.clone(), blobs));
        let restarted_status = request(
            &restarted_app,
            "GET",
            "/api/v1/auth/bootstrap-status",
            json!({}),
            None,
            None,
        )
        .await;
        assert_eq!(restarted_status.status(), StatusCode::OK);
        assert_eq!(
            restarted_status.headers()[header::CACHE_CONTROL],
            "no-store"
        );
        assert_eq!(json_body(restarted_status).await["data"]["required"], false);

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
        let (member_cookie, member_csrf) = session_cookies(&member_login);
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

        let vault = request(
            &app,
            "POST",
            "/api/v1/vaults",
            json!({"name": "Team Vault"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(vault.status(), StatusCode::CREATED);
        let vault_body = json_body(vault).await;
        let vault_id = vault_body["data"]["id"].as_str().unwrap();
        assert_eq!(vault_body["data"]["role"], "admin");
        assert_eq!(vault_body["data"]["status"], "active");

        let member_vaults_before = request(
            &app,
            "GET",
            "/api/v1/vaults",
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(json_body(member_vaults_before).await["data"], json!([]));

        let added_member = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/members"),
            json!({"userId": member_id, "role": "viewer"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(added_member.status(), StatusCode::CREATED);
        assert_eq!(json_body(added_member).await["data"]["role"], "viewer");

        let member_vaults = request(
            &app,
            "GET",
            "/api/v1/vaults",
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(json_body(member_vaults).await["data"][0]["id"], vault_id);

        let viewer_rename = request(
            &app,
            "PATCH",
            &format!("/api/v1/vaults/{vault_id}"),
            json!({"name": "Denied Rename"}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(viewer_rename.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(viewer_rename).await["error"]["code"],
            "vault_permission_denied"
        );

        let viewer_create_file = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files"),
            json!({"name": "Denied", "kind": "folder", "content": ""}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(viewer_create_file.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(viewer_create_file).await["error"]["code"],
            "vault_permission_denied"
        );

        let owner_removal = request(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault_id}/members/{admin_id}"),
            json!({}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(owner_removal.status(), StatusCode::FORBIDDEN);

        let promoted_member = request(
            &app,
            "PATCH",
            &format!("/api/v1/vaults/{vault_id}/members/{member_id}"),
            json!({"role": "editor"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(promoted_member.status(), StatusCode::OK);
        assert_eq!(json_body(promoted_member).await["data"]["role"], "editor");

        let invalid_path = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files"),
            json!({"name": ".collab", "kind": "folder", "content": ""}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(invalid_path.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(invalid_path).await["error"]["code"],
            "path_invalid"
        );

        let folder = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files"),
            json!({"name": "Notes", "kind": "folder", "content": ""}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(folder.status(), StatusCode::CREATED);
        let folder_id = json_body(folder).await["data"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let document = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files"),
            json!({
                "parentId": folder_id,
                "name": "Welcome.md",
                "kind": "document",
                "documentType": "note",
                "content": "# Welcome"
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(document.status(), StatusCode::CREATED);
        let document_body = json_body(document).await;
        let document_id = document_body["data"]["id"].as_str().unwrap().to_owned();
        assert_eq!(document_body["data"]["relativePath"], "Notes/Welcome.md");
        assert_eq!(document_body["data"]["currentRevision"]["sequence"], 1);

        let duplicate_name = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files"),
            json!({
                "parentId": folder_id,
                "name": "welcome.md",
                "kind": "document",
                "documentType": "note",
                "content": "duplicate"
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(duplicate_name.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(duplicate_name).await["error"]["code"],
            "path_conflict"
        );

        let read_document = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/files/{document_id}"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(read_document.status(), StatusCode::OK);
        assert_eq!(
            json_body(read_document).await["data"]["content"],
            "# Welcome"
        );

        let stale_write = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files/{document_id}/revisions"),
            json!({"expectedRevisionSequence": 0, "content": "# Stale"}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(stale_write.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(stale_write).await["error"]["code"],
            "revision_conflict"
        );

        let written = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files/{document_id}/revisions"),
            json!({"expectedRevisionSequence": 1, "content": "# Updated"}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(written.status(), StatusCode::CREATED);
        assert_eq!(
            json_body(written).await["data"]["file"]["currentRevision"]["sequence"],
            2
        );

        let manifest = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/manifest"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(manifest.status(), StatusCode::OK);
        let manifest_body = json_body(manifest).await;
        assert_eq!(manifest_body["data"]["sequence"], 3);
        assert_eq!(manifest_body["data"]["files"].as_array().unwrap().len(), 2);

        let revisions = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/files/{document_id}/revisions"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(revisions.status(), StatusCode::OK);
        let revisions_body = json_body(revisions).await;
        assert_eq!(revisions_body["data"].as_array().unwrap().len(), 2);
        let original_revision_id = revisions_body["data"][1]["id"].as_str().unwrap().to_owned();

        let original_revision = request(
            &app,
            "GET",
            &format!(
                "/api/v1/vaults/{vault_id}/files/{document_id}/revisions/{original_revision_id}"
            ),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(original_revision.status(), StatusCode::OK);
        assert_eq!(
            json_body(original_revision).await["data"]["content"],
            "# Welcome"
        );

        let snapshot = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files/{document_id}/snapshots"),
            json!({"revisionId": original_revision_id, "label": "Before update"}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(snapshot.status(), StatusCode::CREATED);
        let snapshot_body = json_body(snapshot).await;
        let snapshot_id = snapshot_body["data"]["id"].as_str().unwrap().to_owned();
        assert_eq!(snapshot_body["data"]["label"], "Before update");
        assert_eq!(snapshot_body["data"]["revision"]["sequence"], 1);

        let snapshots = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/files/{document_id}/snapshots"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(snapshots.status(), StatusCode::OK);
        assert_eq!(
            json_body(snapshots).await["data"].as_array().unwrap().len(),
            1
        );

        let stale_restore = request(
            &app,
            "POST",
            &format!(
                "/api/v1/vaults/{vault_id}/files/{document_id}/snapshots/{snapshot_id}/restore"
            ),
            json!({"expectedRevisionSequence": 1}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(stale_restore.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(stale_restore).await["error"]["code"],
            "revision_conflict"
        );

        let restored = request(
            &app,
            "POST",
            &format!(
                "/api/v1/vaults/{vault_id}/files/{document_id}/snapshots/{snapshot_id}/restore"
            ),
            json!({"expectedRevisionSequence": 2}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(restored.status(), StatusCode::CREATED);
        let restored_body = json_body(restored).await;
        assert_eq!(restored_body["data"]["content"], "# Welcome");
        assert_eq!(
            restored_body["data"]["file"]["currentRevision"]["sequence"],
            3
        );

        let demoted_member = request(
            &app,
            "PATCH",
            &format!("/api/v1/vaults/{vault_id}/members/{member_id}"),
            json!({"role": "viewer"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(demoted_member.status(), StatusCode::OK);

        let viewer_storage = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/storage"),
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(viewer_storage.status(), StatusCode::OK);
        let viewer_storage_body = json_body(viewer_storage).await;
        assert!(viewer_storage_body["data"]["activeBytes"].as_u64().unwrap() > 0);
        assert!(
            viewer_storage_body["data"]["retainedRevisionBytes"]
                .as_u64()
                .unwrap()
                >= viewer_storage_body["data"]["uniqueBlobBytes"]
                    .as_u64()
                    .unwrap()
        );
        assert_eq!(viewer_storage_body["data"]["snapshotCount"], 1);

        let viewer_mutation_cases = [
            (
                "PATCH",
                format!("/api/v1/vaults/{vault_id}"),
                json!({"name": "Denied"}),
            ),
            ("DELETE", format!("/api/v1/vaults/{vault_id}"), json!({})),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/members"),
                json!({"userId": admin_id, "role": "viewer"}),
            ),
            (
                "PATCH",
                format!("/api/v1/vaults/{vault_id}/members/{member_id}"),
                json!({"role": "editor"}),
            ),
            (
                "DELETE",
                format!("/api/v1/vaults/{vault_id}/members/{member_id}"),
                json!({}),
            ),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/files"),
                json!({"name": "Denied", "kind": "folder", "content": ""}),
            ),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/files/{document_id}/revisions"),
                json!({"expectedRevisionSequence": 3, "content": "Denied"}),
            ),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/files/{document_id}/snapshots"),
                json!({"label": "Denied"}),
            ),
            (
                "POST",
                format!(
                    "/api/v1/vaults/{vault_id}/files/{document_id}/snapshots/{snapshot_id}/restore"
                ),
                json!({"expectedRevisionSequence": 3}),
            ),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/uploads"),
                json!({
                    "name": "denied.bin",
                    "mediaType": "application/octet-stream",
                    "contentBase64": "",
                    "expectedHash": "0".repeat(64)
                }),
            ),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/operations"),
                json!({
                    "clientOperationId": Uuid::now_v7(),
                    "baseManifestSequence": 0,
                    "operationType": "trash",
                    "targetFileId": document_id
                }),
            ),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/operations/preview"),
                json!({"operationType": "trash", "targetFileId": document_id}),
            ),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/import"),
                json!({"archiveBase64": ""}),
            ),
            (
                "GET",
                format!("/api/v1/vaults/{vault_id}/export"),
                json!({}),
            ),
        ];
        for (method, uri, body) in viewer_mutation_cases {
            let denied = request(
                &app,
                method,
                &uri,
                body,
                Some(&member_cookie),
                Some(&member_csrf),
            )
            .await;
            assert_eq!(
                denied.status(),
                StatusCode::FORBIDDEN,
                "viewer unexpectedly accessed {method} {uri}"
            );
            assert_eq!(
                json_body(denied).await["error"]["code"],
                "vault_permission_denied"
            );
        }

        let re_promoted_member = request(
            &app,
            "PATCH",
            &format!("/api/v1/vaults/{vault_id}/members/{member_id}"),
            json!({"role": "editor"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(re_promoted_member.status(), StatusCode::OK);

        for (method, uri, body) in [
            (
                "PATCH",
                format!("/api/v1/vaults/{vault_id}"),
                json!({"name": "Denied editor rename"}),
            ),
            ("DELETE", format!("/api/v1/vaults/{vault_id}"), json!({})),
            (
                "POST",
                format!("/api/v1/vaults/{vault_id}/members"),
                json!({"userId": admin_id, "role": "viewer"}),
            ),
        ] {
            let denied = request(
                &app,
                method,
                &uri,
                body,
                Some(&member_cookie),
                Some(&member_csrf),
            )
            .await;
            assert_eq!(
                denied.status(),
                StatusCode::FORBIDDEN,
                "editor unexpectedly accessed admin/owner operation {method} {uri}"
            );
        }

        let bad_asset = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/uploads"),
            json!({
                "name": "bad.bin",
                "mediaType": "application/octet-stream",
                "contentBase64": "YXNzZXQgYnl0ZXM=",
                "expectedHash": "0".repeat(64)
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(bad_asset.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(bad_asset).await["error"]["code"],
            "upload_hash_mismatch"
        );

        let asset_hash = hash_secret("asset bytes");
        let asset = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/uploads"),
            json!({
                "parentId": folder_id,
                "name": "diagram.bin",
                "mediaType": "application/octet-stream",
                "contentBase64": "YXNzZXQgYnl0ZXM=",
                "expectedHash": asset_hash
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(asset.status(), StatusCode::CREATED);
        let asset_body = json_body(asset).await;
        let asset_id = asset_body["data"]["id"].as_str().unwrap().to_owned();
        assert_eq!(asset_body["data"]["kind"], "asset");
        assert_eq!(
            asset_body["data"]["currentRevision"]["contentHash"],
            asset_hash
        );

        let duplicate_asset = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/uploads"),
            json!({
                "parentId": folder_id,
                "name": "diagram-copy.bin",
                "mediaType": "application/octet-stream",
                "contentBase64": "YXNzZXQgYnl0ZXM=",
                "expectedHash": asset_hash
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(duplicate_asset.status(), StatusCode::CREATED);
        let blob_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM hosted_blobs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(blob_count, 3);

        let downloaded = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/files/{asset_id}/content"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(downloaded.status(), StatusCode::OK);
        assert_eq!(
            downloaded.headers()[header::CONTENT_TYPE],
            "application/octet-stream"
        );
        assert_eq!(response_bytes(downloaded).await, b"asset bytes");

        let index_note = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files"),
            json!({
                "name": "Index.md",
                "kind": "document",
                "documentType": "note",
                "content": "Link: [welcome](Notes/Welcome.md) and ![[diagram.bin]]"
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(index_note.status(), StatusCode::CREATED);
        let index_id = json_body(index_note).await["data"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let hosted_search = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/search?q=Link"),
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(hosted_search.status(), StatusCode::OK);
        let hosted_search_body = json_body(hosted_search).await;
        assert_eq!(hosted_search_body["data"].as_array().unwrap().len(), 1);
        assert_eq!(hosted_search_body["data"][0]["fileId"], index_id);
        assert_eq!(hosted_search_body["data"][0]["relativePath"], "Index.md");
        assert_eq!(hosted_search_body["data"][0]["title"], "Index");
        assert!(hosted_search_body["data"][0]["excerpt"]
            .as_str()
            .unwrap()
            .contains("Link"));

        let asset_references = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/files/{asset_id}/references"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(asset_references.status(), StatusCode::OK);
        let asset_references_body = json_body(asset_references).await;
        let asset_reference_list = asset_references_body["data"].as_array().unwrap();
        assert_eq!(asset_reference_list.len(), 1);
        assert_eq!(asset_reference_list[0]["sourceRelativePath"], "Index.md");
        assert_eq!(asset_reference_list[0]["referencedFileId"], asset_id);
        assert_eq!(
            asset_reference_list[0]["referencedRelativePath"],
            "Notes/diagram.bin"
        );

        let demoted_for_preview = request(
            &app,
            "PATCH",
            &format!("/api/v1/vaults/{vault_id}/members/{member_id}"),
            json!({"role": "viewer"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(demoted_for_preview.status(), StatusCode::OK);
        let viewer_preview = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations/preview"),
            json!({
                "operationType": "rename",
                "targetFileId": document_id,
                "name": "Renamed.md"
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(viewer_preview.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(viewer_preview).await["error"]["code"],
            "vault_permission_denied"
        );
        let viewer_references = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/files/{asset_id}/references"),
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(viewer_references.status(), StatusCode::OK);
        let promoted_after_preview = request(
            &app,
            "PATCH",
            &format!("/api/v1/vaults/{vault_id}/members/{member_id}"),
            json!({"role": "editor"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(promoted_after_preview.status(), StatusCode::OK);

        let rename_preview = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations/preview"),
            json!({
                "operationType": "rename",
                "targetFileId": document_id,
                "name": "Renamed.md"
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(rename_preview.status(), StatusCode::OK);
        let rename_preview_body = json_body(rename_preview).await;
        assert_eq!(
            rename_preview_body["data"]["oldRelativePath"],
            "Notes/Welcome.md"
        );
        assert_eq!(
            rename_preview_body["data"]["newRelativePath"],
            "Notes/Renamed.md"
        );
        assert_eq!(rename_preview_body["data"]["blockedReason"], Value::Null);
        assert_eq!(rename_preview_body["data"]["nestedItemCount"], 0);
        let preview_affected = rename_preview_body["data"]["affectedDocuments"]
            .as_array()
            .unwrap();
        assert_eq!(preview_affected.len(), 1);
        assert_eq!(preview_affected[0]["fileId"], index_id);
        assert_eq!(preview_affected[0]["relativePath"], "Index.md");

        let blocked_preview = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations/preview"),
            json!({
                "operationType": "rename",
                "targetFileId": document_id,
                "name": "diagram.bin"
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(blocked_preview.status(), StatusCode::OK);
        let blocked_preview_body = json_body(blocked_preview).await;
        assert_eq!(
            blocked_preview_body["data"]["blockedReason"],
            "The destination path already exists."
        );
        assert_eq!(blocked_preview_body["data"]["affectedDocuments"], json!([]));

        let rename_operation_id = Uuid::now_v7();
        let rename_payload = json!({
            "clientOperationId": rename_operation_id,
            "baseManifestSequence": 7,
            "operationType": "rename",
            "targetFileId": document_id,
            "name": "Renamed.md"
        });
        let renamed = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations"),
            rename_payload.clone(),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(renamed.status(), StatusCode::OK);
        let renamed_body = json_body(renamed).await;
        assert_eq!(renamed_body["data"]["resultManifestSequence"], 8);
        assert_eq!(
            renamed_body["data"]["rewrittenDocumentIds"],
            json!([index_id])
        );

        let rewritten_index = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/files/{index_id}"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        let rewritten_index_body = json_body(rewritten_index).await;
        assert_eq!(
            rewritten_index_body["data"]["content"],
            "Link: [welcome](Notes/Renamed.md) and ![[diagram.bin]]"
        );
        assert_eq!(
            rewritten_index_body["data"]["file"]["currentRevision"]["sequence"],
            2
        );

        let rewritten_search = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/search?q=Renamed.md"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(rewritten_search.status(), StatusCode::OK);
        let rewritten_search_body = json_body(rewritten_search).await;
        assert_eq!(rewritten_search_body["data"].as_array().unwrap().len(), 1);
        assert_eq!(rewritten_search_body["data"][0]["fileId"], index_id);

        let repeated_rename = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations"),
            rename_payload,
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(repeated_rename.status(), StatusCode::OK);
        let repeated_rename_body = json_body(repeated_rename).await;
        assert_eq!(repeated_rename_body["data"]["alreadyApplied"], true);
        assert_eq!(
            repeated_rename_body["data"]["rewrittenDocumentIds"],
            json!([index_id])
        );

        let stale_move = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations"),
            json!({
                "clientOperationId": Uuid::now_v7(),
                "baseManifestSequence": 6,
                "operationType": "move",
                "targetFileId": document_id,
                "parentId": null
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(stale_move.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(stale_move).await["error"]["code"],
            "manifest_conflict"
        );

        let moved = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations"),
            json!({
                "clientOperationId": Uuid::now_v7(),
                "baseManifestSequence": 8,
                "operationType": "move",
                "targetFileId": document_id,
                "parentId": null
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(moved.status(), StatusCode::OK);
        assert_eq!(
            json_body(moved).await["data"]["rewrittenDocumentIds"],
            json!([index_id])
        );

        let moved_manifest = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/manifest"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        let moved_manifest_body = json_body(moved_manifest).await;
        let moved_document = moved_manifest_body["data"]["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["id"] == document_id)
            .unwrap();
        assert_eq!(moved_document["relativePath"], "Renamed.md");

        for (operation_type, sequence) in [("trash", 9), ("restore", 10)] {
            let response = request(
                &app,
                "POST",
                &format!("/api/v1/vaults/{vault_id}/operations"),
                json!({
                    "clientOperationId": Uuid::now_v7(),
                    "baseManifestSequence": sequence,
                    "operationType": operation_type,
                    "targetFileId": document_id
                }),
                Some(&member_cookie),
                Some(&member_csrf),
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
        }

        let trash_with_reference_removal = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations"),
            json!({
                "clientOperationId": Uuid::now_v7(),
                "baseManifestSequence": 11,
                "operationType": "trash",
                "targetFileId": document_id,
                "removeReferences": true
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(trash_with_reference_removal.status(), StatusCode::OK);
        assert_eq!(
            json_body(trash_with_reference_removal).await["data"]["rewrittenDocumentIds"],
            json!([index_id])
        );
        let scrubbed_index = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/files/{index_id}"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        let scrubbed_index_body = json_body(scrubbed_index).await;
        assert_eq!(
            scrubbed_index_body["data"]["content"],
            "Link: welcome and ![[diagram.bin]]"
        );
        assert_eq!(
            scrubbed_index_body["data"]["file"]["currentRevision"]["sequence"],
            4
        );

        let editor_purge = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations"),
            json!({
                "clientOperationId": Uuid::now_v7(),
                "baseManifestSequence": 12,
                "operationType": "purge",
                "targetFileId": document_id
            }),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(editor_purge.status(), StatusCode::FORBIDDEN);

        let admin_purge = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/operations"),
            json!({
                "clientOperationId": Uuid::now_v7(),
                "baseManifestSequence": 12,
                "operationType": "purge",
                "targetFileId": document_id
            }),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(admin_purge.status(), StatusCode::OK);
        assert_eq!(
            json_body(admin_purge).await["data"]["resultManifestSequence"],
            13
        );

        let import_vault = request(
            &app,
            "POST",
            "/api/v1/vaults",
            json!({"name": "Imported Vault"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(import_vault.status(), StatusCode::CREATED);
        let import_vault_id = json_body(import_vault).await["data"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let import_member = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{import_vault_id}/members"),
            json!({"userId": member_id, "role": "editor"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(import_member.status(), StatusCode::CREATED);
        let denied_import = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{import_vault_id}/import"),
            json!({"archiveBase64": zip_base64(&[("Denied.md", b"denied")])}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(denied_import.status(), StatusCode::FORBIDDEN);
        let imported = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{import_vault_id}/import"),
            json!({"archiveBase64": zip_base64(&[
                ("Notes/Imported.md", b"# Imported\nsearchable archive"),
                ("Pictures/image.bin", b"asset")
            ])}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(imported.status(), StatusCode::CREATED);
        let imported_body = json_body(imported).await;
        assert_eq!(imported_body["data"]["importedFiles"], 2);
        assert_eq!(imported_body["data"]["importedFolders"], 2);

        let imported_search = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{import_vault_id}/search?q=searchable"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(imported_search.status(), StatusCode::OK);
        assert_eq!(
            json_body(imported_search).await["data"][0]["relativePath"],
            "Notes/Imported.md"
        );

        let exported = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{import_vault_id}/export"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(exported.status(), StatusCode::OK);
        assert_eq!(exported.headers()[header::CONTENT_TYPE], "application/zip");
        let exported_bytes = response_bytes(exported).await;
        let mut exported_zip = zip::ZipArchive::new(Cursor::new(exported_bytes)).unwrap();
        let mut imported_note = String::new();
        exported_zip
            .by_name("Notes/Imported.md")
            .unwrap()
            .read_to_string(&mut imported_note)
            .unwrap();
        assert_eq!(imported_note, "# Imported\nsearchable archive");
        let denied_export = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{import_vault_id}/export"),
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(denied_export.status(), StatusCode::FORBIDDEN);

        let archived = request(
            &app,
            "PATCH",
            &format!("/api/v1/vaults/{vault_id}"),
            json!({"status": "archived"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(archived.status(), StatusCode::OK);
        assert_eq!(json_body(archived).await["data"]["status"], "archived");

        let archived_member_mutation = request(
            &app,
            "PATCH",
            &format!("/api/v1/vaults/{vault_id}/members/{member_id}"),
            json!({"role": "viewer"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(archived_member_mutation.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(archived_member_mutation).await["error"]["code"],
            "vault_archived"
        );

        let archived_write = request(
            &app,
            "POST",
            &format!("/api/v1/vaults/{vault_id}/files/{document_id}/revisions"),
            json!({"expectedRevisionSequence": 2, "content": "# Archived"}),
            Some(&member_cookie),
            Some(&member_csrf),
        )
        .await;
        assert_eq!(archived_write.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(archived_write).await["error"]["code"],
            "vault_archived"
        );

        let activity = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}/activity"),
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(activity.status(), StatusCode::OK);
        assert!(json_body(activity).await["data"].as_array().unwrap().len() >= 4);

        let pending_delete = request(
            &app,
            "DELETE",
            &format!("/api/v1/vaults/{vault_id}"),
            json!({}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(pending_delete.status(), StatusCode::NO_CONTENT);
        let pending_detail = request(
            &app,
            "GET",
            &format!("/api/v1/vaults/{vault_id}"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(
            json_body(pending_detail).await["data"]["status"],
            "pending_delete"
        );

        let member_admin_vault = request(
            &app,
            "GET",
            &format!("/api/v1/admin/vaults/{vault_id}"),
            json!({}),
            Some(&member_cookie),
            None,
        )
        .await;
        assert_eq!(member_admin_vault.status(), StatusCode::FORBIDDEN);

        let admin_detail = request(
            &app,
            "GET",
            &format!("/api/v1/admin/vaults/{vault_id}"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(admin_detail.status(), StatusCode::OK);
        let admin_detail_body = json_body(admin_detail).await;
        assert_eq!(admin_detail_body["data"]["name"], "Team Vault");
        assert_eq!(admin_detail_body["data"]["status"], "pending_delete");
        assert_eq!(admin_detail_body["data"]["members"], 2);
        assert_eq!(admin_detail_body["data"]["activeFiles"], 4);
        assert_eq!(admin_detail_body["data"]["ownerUsername"], "admin");
        assert!(admin_detail_body["data"]["storageBytes"].as_u64().unwrap() > 0);

        let pending_member_change = request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/vaults/{vault_id}/members/{member_id}"),
            json!({"role": "viewer"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(pending_member_change.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(pending_member_change).await["error"]["code"],
            "vault_archived"
        );

        let admin_restore = request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/vaults/{vault_id}"),
            json!({"status": "active"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(admin_restore.status(), StatusCode::OK);
        assert_eq!(json_body(admin_restore).await["data"]["status"], "active");

        let owner_role_change = request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/vaults/{vault_id}/members/{admin_id}"),
            json!({"role": "viewer"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(owner_role_change.status(), StatusCode::BAD_REQUEST);

        let admin_role_change = request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/vaults/{vault_id}/members/{member_id}"),
            json!({"role": "viewer"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(admin_role_change.status(), StatusCode::OK);
        assert_eq!(json_body(admin_role_change).await["data"]["role"], "viewer");

        let admin_member_removal = request(
            &app,
            "DELETE",
            &format!("/api/v1/admin/vaults/{vault_id}/members/{member_id}"),
            json!({}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(admin_member_removal.status(), StatusCode::NO_CONTENT);

        let admin_member_add = request(
            &app,
            "POST",
            &format!("/api/v1/admin/vaults/{vault_id}/members"),
            json!({"userId": member_id, "role": "editor"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(admin_member_add.status(), StatusCode::CREATED);
        let admin_members = request(
            &app,
            "GET",
            &format!("/api/v1/admin/vaults/{vault_id}/members"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(admin_members.status(), StatusCode::OK);
        assert_eq!(
            json_body(admin_members).await["data"]
                .as_array()
                .unwrap()
                .len(),
            2
        );

        let admin_archive = request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/vaults/{vault_id}"),
            json!({"status": "archived"}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(admin_archive.status(), StatusCode::OK);
        assert_eq!(json_body(admin_archive).await["data"]["status"], "archived");

        let admin_vault_activity = request(
            &app,
            "GET",
            &format!("/api/v1/admin/vaults/{vault_id}/activity"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(admin_vault_activity.status(), StatusCode::OK);
        assert!(
            json_body(admin_vault_activity).await["data"]
                .as_array()
                .unwrap()
                .len()
                >= 6
        );

        let admin_redelete = request(
            &app,
            "DELETE",
            &format!("/api/v1/admin/vaults/{vault_id}"),
            json!({}),
            Some(&admin_cookie),
            Some(&admin_csrf),
        )
        .await;
        assert_eq!(admin_redelete.status(), StatusCode::NO_CONTENT);
        let redeleted_detail = request(
            &app,
            "GET",
            &format!("/api/v1/admin/vaults/{vault_id}"),
            json!({}),
            Some(&admin_cookie),
            None,
        )
        .await;
        assert_eq!(
            json_body(redeleted_detail).await["data"]["status"],
            "pending_delete"
        );

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
