use crate::{api, config::ServerConfig, database, storage::BlobStorage};
use axum::{
    extract::{Request, State},
    http::{HeaderName, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use collab_protocol::{DataResponse, HealthState, HealthStatus, PROTOCOL_VERSION};
use sqlx::PgPool;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
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
    pub started_at: Instant,
}

impl AppState {
    pub fn new(config: ServerConfig, database: PgPool, blobs: Arc<dyn BlobStorage>) -> Self {
        Self {
            config,
            database,
            blobs,
            login_limiter: LoginRateLimiter::default(),
            started_at: Instant::now(),
        }
    }
}

pub fn build_router(state: AppState) -> Router {
    let admin_index = state.config.admin_web_dir.join("index.html");
    let admin_assets =
        ServeDir::new(&state.config.admin_web_dir).fallback(ServeFile::new(admin_index));
    Router::new()
        .route("/health/live", get(liveness))
        .route("/health/ready", get(readiness))
        .route("/api/v1/auth/bootstrap-status", get(api::bootstrap_status))
        .route("/api/v1/auth/bootstrap", post(api::bootstrap))
        .route("/api/v1/auth/login", post(api::login))
        .route("/api/v1/auth/logout", post(api::logout))
        .route("/api/v1/users/me", get(api::me))
        .route("/api/v1/admin/overview", get(api::overview))
        .route("/api/v1/admin/users", get(api::list_users).post(api::create_user))
        .route("/api/v1/admin/users/{user_id}", patch(api::update_user))
        .route(
            "/api/v1/admin/users/{user_id}/revoke-sessions",
            post(api::revoke_user_sessions),
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
        .layer(middleware::from_fn(request_id))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
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
