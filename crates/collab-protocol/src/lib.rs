use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REST_API_VERSION: &str = "v1";
pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataResponse<T> {
    pub data: T,
}

impl<T> DataResponse<T> {
    pub fn new(data: T) -> Self {
        Self { data }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub error: ApiError,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub details: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    BootstrapAlreadyCompleted,
    CsrfInvalid,
    AdminRequired,
    AuthenticationRequired,
    AuthenticationInvalid,
    SessionExpired,
    SessionRevoked,
    UserDisabled,
    RateLimited,
    ResourceNotFound,
    ValidationFailed,
    PathInvalid,
    PathConflict,
    VaultPermissionDenied,
    VaultArchived,
    RevisionConflict,
    ManifestConflict,
    OperationConflict,
    OperationAlreadyApplied,
    UploadIncomplete,
    UploadHashMismatch,
    QuotaExceeded,
    ProtocolVersionUnsupported,
    ServerUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    pub status: HealthState,
    pub service: String,
    pub version: String,
    pub protocol_version: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HealthState {
    Ok,
    Degraded,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServerUserRole {
    Member,
    Admin,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServerUserStatus {
    Active,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerUser {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub role: ServerUserRole,
    pub status: ServerUserStatus,
    pub created_at: String,
    pub last_login_at: Option<String>,
    pub active_sessions: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSession {
    pub user: ServerUser,
    pub csrf_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdminOverview {
    pub server_version: String,
    pub protocol_version: u32,
    pub uptime_seconds: u64,
    pub users: i64,
    pub active_users: i64,
    pub active_sessions: i64,
    pub pending_invitations: i64,
    pub hosted_vaults: i64,
    pub recent_audit_events: Vec<AuditEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub id: String,
    pub actor_display_name: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub result: String,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::{ApiError, DataResponse, ErrorCode, ErrorResponse};
    use serde_json::{json, Value};

    #[test]
    fn responses_use_camel_case_and_stable_snake_case_error_codes() {
        let response = ErrorResponse {
            error: ApiError {
                code: ErrorCode::VaultPermissionDenied,
                message: "denied".into(),
                request_id: "request-1".into(),
                details: Value::Null,
            },
        };

        assert_eq!(
            serde_json::to_value(response).unwrap(),
            json!({
                "error": {
                    "code": "vault_permission_denied",
                    "message": "denied",
                    "requestId": "request-1"
                }
            })
        );
    }

    #[test]
    fn data_response_wraps_payload() {
        assert_eq!(
            serde_json::to_value(DataResponse::new(json!({"ready": true}))).unwrap(),
            json!({"data": {"ready": true}})
        );
    }
}
