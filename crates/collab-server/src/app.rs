use crate::{api, config::ServerConfig, database, storage::BlobStorage};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderName, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{get, patch, post, put},
    Json, Router,
};
use collab_protocol::{DataResponse, HealthState, HealthStatus, PROTOCOL_VERSION};
use sqlx::PgPool;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{sync::Mutex, time::sleep};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use uuid::Uuid;

const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(Clone)]
pub struct AppState {
    pub config: ServerConfig,
    pub database: PgPool,
    pub blobs: Arc<dyn BlobStorage>,
    pub login_limiter: LoginRateLimiter,
    pub hub: Arc<crate::ws::Hub>,
    pub started_at: Instant,
}

impl AppState {
    pub fn new(config: ServerConfig, database: PgPool, blobs: Arc<dyn BlobStorage>) -> Self {
        let hub = Arc::new(crate::ws::Hub::new(database.clone(), blobs.clone()));
        Self {
            config,
            database,
            blobs,
            login_limiter: LoginRateLimiter::default(),
            hub,
            started_at: Instant::now(),
        }
    }
}

pub fn build_router(state: AppState) -> Router {
    let admin_index = state.config.admin_web_dir.join("index.html");
    let max_json_body_bytes = state.config.max_json_body_bytes();
    let admin_assets =
        ServeDir::new(&state.config.admin_web_dir).fallback(ServeFile::new(admin_index));
    Router::new()
        .route("/", get(|| async { Redirect::permanent("/admin/") }))
        .route("/health/live", get(liveness))
        .route("/health/ready", get(readiness))
        .route("/api/v1/auth/bootstrap-status", get(api::bootstrap_status))
        .route("/api/v1/auth/bootstrap", post(api::bootstrap))
        .route("/api/v1/auth/login", post(api::login))
        .route("/api/v1/auth/native/login", post(api::native_login))
        .route("/api/v1/auth/refresh", post(api::refresh))
        .route("/api/v1/auth/native/logout", post(api::native_logout))
        .route("/api/v1/auth/invitations/{token}/accept", post(api::accept_invitation))
        .route("/api/v1/auth/ws-ticket", post(api::issue_ws_ticket))
        .route("/api/v1/auth/logout", post(api::logout))
        .route("/ws/v1/vaults/{vault_id}", get(crate::ws::vault_ws))
        .route("/api/v1/users/me", get(api::me).patch(api::update_self))
        .route("/api/v1/users/me/password", post(api::change_password))
        .route(
            "/api/v1/users/me/avatar",
            put(api::upload_self_avatar).delete(api::delete_self_avatar),
        )
        .route("/api/v1/users/{user_id}/avatar", get(api::get_user_avatar))
        .route("/api/v1/users/directory", get(api::user_directory))
        .route(
            "/api/v1/vaults",
            get(api::list_vaults).post(api::create_vault),
        )
        .route(
            "/api/v1/vaults/{vault_id}",
            get(api::get_vault)
                .patch(api::update_vault)
                .delete(api::delete_vault),
        )
        .route(
            "/api/v1/vaults/{vault_id}/members",
            get(api::list_vault_members).post(api::add_vault_member),
        )
        .route(
            "/api/v1/vaults/{vault_id}/members/{user_id}",
            patch(api::update_vault_member).delete(api::remove_vault_member),
        )
        .route(
            "/api/v1/vaults/{vault_id}/templates",
            get(api::list_vault_templates),
        )
        .route(
            "/api/v1/vaults/{vault_id}/activity",
            get(api::vault_activity),
        )
        .route(
            "/api/v1/vaults/{vault_id}/manifest",
            get(api::vault_manifest),
        )
        .route(
            "/api/v1/vaults/{vault_id}/manifest/delta",
            get(api::vault_manifest_delta),
        )
        .route(
            "/api/v1/vaults/{vault_id}/storage",
            get(api::vault_storage),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files",
            get(api::list_vault_files).post(api::create_vault_file),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}",
            get(api::get_vault_file),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}/content",
            get(api::download_vault_file),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}/archive",
            get(api::download_vault_folder_archive),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}/references",
            get(api::list_file_references),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}/pdf-annotations",
            get(api::get_pdf_annotations).put(api::write_pdf_annotations),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}/revisions",
            get(api::list_file_revisions).post(api::write_text_revision),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}/revisions/{revision_id}",
            get(api::get_text_revision).post(api::restore_file_revision),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}/snapshots",
            get(api::list_file_snapshots).post(api::create_file_snapshot),
        )
        .route(
            "/api/v1/vaults/{vault_id}/files/{file_id}/snapshots/{snapshot_id}/restore",
            post(api::restore_file_snapshot),
        )
        .route(
            "/api/v1/vaults/{vault_id}/uploads",
            post(api::upload_binary_asset),
        )
        .route(
            "/api/v1/vaults/{vault_id}/operations",
            post(api::apply_structural_operation),
        )
        .route(
            "/api/v1/vaults/{vault_id}/operations/preview",
            post(api::preview_structural_operation),
        )
        .route("/api/v1/vaults/{vault_id}/search", get(api::search_vault))
        .route(
            "/api/v1/vaults/{vault_id}/import",
            post(api::import_vault_zip),
        )
        .route(
            "/api/v1/vaults/{vault_id}/export",
            get(api::export_vault_zip),
        )
        .route(
            "/api/v1/vaults/{vault_id}/chat",
            get(api::list_chat_messages).post(api::send_chat_message),
        )
        .route(
            "/api/v1/vaults/{vault_id}/presence",
            get(api::list_presence)
                .put(api::write_presence)
                .delete(api::clear_presence),
        )
        .route("/api/v1/admin/overview", get(api::overview))
        .route(
            "/api/v1/admin/backups",
            get(api::admin_backups).post(api::admin_run_backup),
        )
        .route(
            "/api/v1/admin/backups/settings",
            patch(api::admin_update_backup_settings),
        )
        .route(
            "/api/v1/admin/backups/{backup_name}/verify",
            post(api::admin_verify_backup),
        )
        .route(
            "/api/v1/admin/backups/{backup_name}/restore",
            post(api::admin_restore_backup),
        )
        .route(
            "/api/v1/admin/backups/{backup_name}",
            axum::routing::delete(api::admin_delete_backup),
        )
        .route("/api/v1/admin/users", get(api::list_users).post(api::create_user))
        .route(
            "/api/v1/admin/users/{user_id}",
            patch(api::update_user).delete(api::delete_user),
        )
        .route(
            "/api/v1/admin/users/{user_id}/revoke-sessions",
            post(api::revoke_user_sessions),
        )
        .route(
            "/api/v1/admin/users/{user_id}/reset-password",
            post(api::reset_user_password),
        )
        .route(
            "/api/v1/admin/users/{user_id}/activity",
            get(api::user_activity),
        )
        .route(
            "/api/v1/admin/invitations",
            get(api::list_invitations).post(api::create_invitation),
        )
        .route("/api/v1/admin/vaults", get(api::hosted_vaults))
        .route(
            "/api/v1/admin/vaults/{vault_id}",
            get(api::admin_vault_detail)
                .patch(api::admin_update_vault)
                .delete(api::admin_delete_vault),
        )
        .route(
            "/api/v1/admin/vaults/{vault_id}/force-delete",
            post(api::admin_force_delete_vault),
        )
        .route(
            "/api/v1/admin/vaults/{vault_id}/members",
            get(api::admin_vault_members).post(api::admin_add_vault_member),
        )
        .route(
            "/api/v1/admin/vaults/{vault_id}/members/{user_id}",
            patch(api::admin_update_vault_member).delete(api::admin_remove_vault_member),
        )
        .route(
            "/api/v1/admin/vaults/{vault_id}/activity",
            get(api::admin_vault_activity),
        )
        .route(
            "/api/v1/admin/vaults/{vault_id}/grants",
            get(api::list_vault_grants),
        )
        .route(
            "/api/v1/admin/vaults/{vault_id}/grants/{subject_type}/{subject_id}",
            put(api::put_vault_grant).delete(api::delete_vault_grant),
        )
        .route(
            "/api/v1/admin/groups",
            get(api::list_groups).post(api::create_group),
        )
        .route(
            "/api/v1/admin/groups/{group_id}",
            patch(api::update_group).delete(api::delete_group),
        )
        .route(
            "/api/v1/admin/groups/{group_id}/members",
            get(api::list_group_members),
        )
        .route(
            "/api/v1/admin/groups/{group_id}/members/{user_id}",
            post(api::add_group_member).delete(api::remove_group_member),
        )
        .route(
            "/api/v1/admin/templates",
            get(api::list_templates).post(api::create_template),
        )
        .route(
            "/api/v1/admin/templates/{template_id}",
            patch(api::update_template).delete(api::delete_template),
        )
        .route("/api/v1/admin/audit-events", get(api::audit_events))
        .nest_service("/admin", admin_assets)
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static(
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            ),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(DefaultBodyLimit::max(max_json_body_bytes))
        .layer(middleware::from_fn(request_id))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub fn spawn_backup_scheduler(state: AppState) {
    let Some(command) = state.config.backup_command.clone() else {
        tracing::warn!("backup schedule is enabled but no backup command is configured");
        return;
    };
    let backup_dir = state.config.backup_dir.clone();
    tokio::spawn(async move {
        loop {
            let settings = crate::api::load_backup_runtime_settings(&state.config);
            if !settings.schedule_enabled {
                sleep(Duration::from_secs(60)).await;
                continue;
            }
            let interval = Duration::from_secs(settings.interval_seconds.max(60));
            tracing::debug!(
                interval_seconds = settings.interval_seconds,
                retention_days = settings.retention_days,
                export_dir = ?settings.export_dir,
                "backup scheduler sleeping"
            );
            sleep(interval).await;
            let settings = crate::api::load_backup_runtime_settings(&state.config);
            if !settings.schedule_enabled {
                continue;
            }
            let request_id = format!("scheduled-backup-{}", chrono::Utc::now().timestamp());
            match crate::api::run_operator_command(
                &command,
                &backup_dir,
                None,
                &settings,
                Duration::from_secs(30 * 60),
                &request_id,
            )
            .await
            {
                Ok(result) => tracing::info!(output = ?result.output, "scheduled backup completed"),
                Err(error) => tracing::warn!(?error, "scheduled backup failed"),
            }
        }
    });
}

#[derive(Debug, Clone, Default)]
pub struct LoginRateLimiter {
    attempts: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
}

impl LoginRateLimiter {
    pub async fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut attempts = self.attempts.lock().await;
        let entries = attempts.entry(key.to_owned()).or_default();
        entries.retain(|attempt| now.duration_since(*attempt) < Duration::from_secs(60));
        if entries.len() >= 5 {
            return false;
        }
        entries.push(now);
        true
    }

    pub async fn clear(&self, key: &str) {
        self.attempts.lock().await.remove(key);
    }
}

async fn liveness() -> Json<DataResponse<HealthStatus>> {
    Json(DataResponse::new(health_status(HealthState::Ok)))
}

async fn readiness(State(state): State<AppState>) -> Response {
    let database_ready = database::is_ready(&state.database).await;
    let storage_ready = state.blobs.health_check().await.is_ok();
    let status = if database_ready && storage_ready {
        HealthState::Ok
    } else {
        HealthState::Degraded
    };
    let code = if status == HealthState::Ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (code, Json(DataResponse::new(health_status(status)))).into_response()
}

fn health_status(status: HealthState) -> HealthStatus {
    HealthStatus {
        status,
        service: "collab-server".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        protocol_version: PROTOCOL_VERSION,
    }
}

async fn request_id(mut request: Request, next: Next) -> Response {
    let header_name = HeaderName::from_static(REQUEST_ID_HEADER);
    let request_id = request
        .headers()
        .get(&header_name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::now_v7().to_string());

    request.extensions_mut().insert(request_id.clone());
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(header_name, value);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::{build_router, AppState, LoginRateLimiter};
    use crate::{config::ServerConfig, storage::FileSystemBlobStorage};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use sqlx::postgres::PgPoolOptions;
    use std::{sync::Arc, time::Duration};
    use tower::ServiceExt;

    async fn test_state() -> AppState {
        let database = PgPoolOptions::new()
            .acquire_timeout(Duration::from_millis(50))
            .connect_lazy("postgres://collab:collab@127.0.0.1:1/unavailable")
            .unwrap();
        let dir = tempfile::tempdir().unwrap().keep();
        let blobs = Arc::new(FileSystemBlobStorage::new(dir).await.unwrap());
        AppState::new(ServerConfig::default(), database, blobs)
    }

    #[tokio::test]
    async fn liveness_does_not_depend_on_external_services() {
        let response = build_router(test_state().await)
            .oneshot(
                Request::builder()
                    .uri("/health/live")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key("x-request-id"));
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(std::str::from_utf8(&body)
            .unwrap()
            .contains("\"status\":\"ok\""));
    }

    #[tokio::test]
    async fn root_redirects_to_admin_dashboard() {
        let state = test_state().await;
        let response = build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
        assert_eq!(response.headers()["location"], "/admin/");
    }

    #[tokio::test]
    async fn configured_json_body_limit_accepts_base64_import_over_default_limit() {
        let payload = serde_json::json!({
            "archiveBase64": "a".repeat(3 * 1024 * 1024)
        });
        let response = build_router(test_state().await)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/vaults/019eb16e-2a85-7070-bbe7-8cf09911c2c1/import")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        // Reaching authentication proves the JSON extractor accepted the body.
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn readiness_fails_when_database_is_unavailable() {
        let response = build_router(test_state().await)
            .oneshot(
                Request::builder()
                    .uri("/health/ready")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn request_id_is_preserved_when_valid() {
        let response = build_router(test_state().await)
            .oneshot(
                Request::builder()
                    .uri("/health/live")
                    .header("x-request-id", "caller-request")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()["x-request-id"], "caller-request");
    }

    #[tokio::test]
    async fn login_rate_limiter_blocks_the_sixth_attempt_and_can_reset() {
        let limiter = LoginRateLimiter::default();
        for _ in 0..5 {
            assert!(limiter.allow("alice").await);
        }
        assert!(!limiter.allow("alice").await);
        limiter.clear("alice").await;
        assert!(limiter.allow("alice").await);
    }
}
