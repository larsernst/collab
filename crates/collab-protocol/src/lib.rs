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
