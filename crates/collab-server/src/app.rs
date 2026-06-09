use crate::{config::ServerConfig, database, storage::BlobStorage};
use axum::{
    extract::{Request, State},
    http::{HeaderName, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use collab_protocol::{DataResponse, HealthState, HealthStatus, PROTOCOL_VERSION};
use sqlx::PgPool;
use std::sync::Arc;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(Clone)]
pub struct AppState {
    pub config: ServerConfig,
    pub database: PgPool,
    pub blobs: Arc<dyn BlobStorage>,
}

impl AppState {
    pub fn new(config: ServerConfig, database: PgPool, blobs: Arc<dyn BlobStorage>) -> Self {
        Self {
            config,
            database,
            blobs,
        }
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health/live", get(liveness))
        .route("/health/ready", get(readiness))
        .layer(middleware::from_fn(request_id))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
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
    use super::{build_router, AppState};
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
}
