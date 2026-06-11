use crate::state::{AppState, ServerSessionState};
use base64::Engine as _;
use collab_protocol::{DataResponse, ErrorResponse, NativeSession, ServerUser};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::error::Error as _;
use tauri::State;
use url::Url;

const KEYRING_SERVICE: &str = "collab-server";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConnectionStatus {
    pub connected: bool,
    pub server_url: Option<String>,
    pub allow_invalid_certificates: bool,
    pub user: Option<ServerUser>,
    pub access_expires_at: Option<String>,
}

#[tauri::command]
pub async fn connect_server(
    state: State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
    allow_invalid_certificates: bool,
) -> Result<ServerConnectionStatus, String> {
    let base = validate_server_url(&server_url)?;
    let response = server_client(allow_invalid_certificates)?
        .post(format!("{base}/api/v1/auth/native/login"))
        .json(&serde_json::json!({
            "username": username,
            "password": password,
            "clientName": "Collab desktop"
        }))
        .send()
        .await
        .map_err(server_request_error)?;
    let session = decode_session(response).await?;
    store_refresh_token(&base, &session.refresh_token)?;
    let status = status_from_session(&base, allow_invalid_certificates, &session);
    *state.server_session.write() = Some(ServerSessionState {
        server_url: base,
        allow_invalid_certificates,
        access_token: session.access_token,
        access_expires_at: session.access_expires_at,
        user: session.user,
    });
    Ok(status)
}

#[tauri::command]
pub async fn reconnect_server(
    state: State<'_, AppState>,
    server_url: String,
    allow_invalid_certificates: bool,
) -> Result<ServerConnectionStatus, String> {
    let base = validate_server_url(&server_url)?;
    let refresh_token = keyring_entry(&base)?
        .get_password()
        .map_err(|_| "No saved server session was found.".to_string())?;
    let response = server_client(allow_invalid_certificates)?
        .post(format!("{base}/api/v1/auth/refresh"))
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(server_request_error)?;
    let session = decode_session(response).await?;
    store_refresh_token(&base, &session.refresh_token)?;
    let status = status_from_session(&base, allow_invalid_certificates, &session);
    *state.server_session.write() = Some(ServerSessionState {
        server_url: base,
        allow_invalid_certificates,
        access_token: session.access_token,
        access_expires_at: session.access_expires_at,
        user: session.user,
    });
    Ok(status)
}

#[tauri::command]
pub async fn disconnect_server(state: State<'_, AppState>) -> Result<(), String> {
    let session = state.server_session.read().clone();
    if let Some(session) = session {
        if let Ok(client) = server_client(session.allow_invalid_certificates) {
            let _ = client
                .post(format!("{}/api/v1/auth/native/logout", session.server_url))
                .bearer_auth(&session.access_token)
                .send()
                .await;
        }
        let _ = keyring_entry(&session.server_url)?.delete_credential();
    }
    *state.server_session.write() = None;
    Ok(())
}

#[tauri::command]
pub fn server_connection_status(state: State<'_, AppState>) -> ServerConnectionStatus {
    match state.server_session.read().as_ref() {
        Some(session) => ServerConnectionStatus {
            connected: true,
            server_url: Some(session.server_url.clone()),
            allow_invalid_certificates: session.allow_invalid_certificates,
            user: Some(session.user.clone()),
            access_expires_at: Some(session.access_expires_at.clone()),
        },
        None => ServerConnectionStatus {
            connected: false,
            server_url: None,
            allow_invalid_certificates: false,
            user: None,
            access_expires_at: None,
        },
    }
}

#[tauri::command]
pub async fn hosted_vault_request(
    state: State<'_, AppState>,
    server_url: String,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let session =
        state.server_session.read().clone().ok_or_else(|| {
            "Connect to the Collab server before opening hosted vaults.".to_string()
        })?;
    require_connected_server(&session, &server_url)?;
    let method = hosted_request_method(&method)?;
    let path = validate_hosted_vault_path(&path)?;
    let mut request = server_client(session.allow_invalid_certificates)?
        .request(method, format!("{}{}", session.server_url, path))
        .bearer_auth(&session.access_token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    decode_hosted_json_response(request.send().await.map_err(server_request_error)?).await
}

#[tauri::command]
pub async fn hosted_vault_asset_data_url(
    state: State<'_, AppState>,
    server_url: String,
    vault_id: String,
    file_id: String,
) -> Result<String, String> {
    validate_identifier(&vault_id)?;
    validate_identifier(&file_id)?;
    let session = state.server_session.read().clone().ok_or_else(|| {
        "Connect to the Collab server before downloading hosted assets.".to_string()
    })?;
    require_connected_server(&session, &server_url)?;
    let response = server_client(session.allow_invalid_certificates)?
        .get(format!(
            "{}/api/v1/vaults/{vault_id}/files/{file_id}/content",
            session.server_url,
        ))
        .bearer_auth(&session.access_token)
        .send()
        .await
        .map_err(server_request_error)?;
    if !response.status().is_success() {
        return Err(decode_hosted_error(response).await);
    }
    let media_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The server returned an invalid asset response.".to_string())?;
    Ok(format!(
        "data:{media_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes),
    ))
}

/// Read-only authenticated user directory used when adding hosted vault members.
/// This is the one non-`/vaults` route the native client may reach; the bearer
/// token stays in Rust and only the resolved directory entries reach the webview.
#[tauri::command]
pub async fn hosted_user_directory(
    state: State<'_, AppState>,
    server_url: String,
    query: String,
) -> Result<Value, String> {
    let session = state
        .server_session
        .read()
        .clone()
        .ok_or_else(|| "Connect to the Collab server before browsing users.".to_string())?;
    require_connected_server(&session, &server_url)?;
    let request = server_client(session.allow_invalid_certificates)?
        .get(format!("{}/api/v1/users/directory", session.server_url))
        .query(&[("q", query.as_str())])
        .bearer_auth(&session.access_token);
    decode_hosted_json_response(request.send().await.map_err(server_request_error)?).await
}

/// Download an admin-only hosted-vault ZIP export and write it to a local path.
/// The bearer token stays in Rust; only the success/failure result reaches the
/// webview. Server authorization (vault admin) is enforced server-side.
#[tauri::command]
pub async fn hosted_vault_export_zip(
    state: State<'_, AppState>,
    server_url: String,
    vault_id: String,
    destination_path: String,
) -> Result<(), String> {
    validate_identifier(&vault_id)?;
    let session = state.server_session.read().clone().ok_or_else(|| {
        "Connect to the Collab server before exporting hosted vaults.".to_string()
    })?;
    require_connected_server(&session, &server_url)?;
    let response = server_client(session.allow_invalid_certificates)?
        .get(format!(
            "{}/api/v1/vaults/{vault_id}/export",
            session.server_url,
        ))
        .bearer_auth(&session.access_token)
        .send()
        .await
        .map_err(server_request_error)?;
    if !response.status().is_success() {
        return Err(decode_hosted_error(response).await);
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The server returned an invalid export response.".to_string())?;
    std::fs::write(&destination_path, &bytes)
        .map_err(|_| "Could not write the exported vault archive to disk.".to_string())?;
    Ok(())
}

fn validate_server_url(value: &str) -> Result<String, String> {
    let mut url = Url::parse(value.trim()).map_err(|_| "Enter a valid server URL.".to_string())?;
    if url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Server URLs cannot contain credentials, queries, or fragments.".into());
    }
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Remote Collab servers must use HTTPS.".into());
    }
    url.set_path("");
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

fn server_client(allow_invalid_certificates: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(allow_invalid_certificates)
        .build()
        .map_err(|_| "Could not initialize the Collab server connection.".to_string())
}

fn server_request_error(error: reqwest::Error) -> String {
    let mut details = error.to_string().to_ascii_lowercase();
    let mut source = error.source();
    while let Some(cause) = source {
        details.push(' ');
        details.push_str(&cause.to_string().to_ascii_lowercase());
        source = cause.source();
    }
    if details.contains("certificate")
        || details.contains("unknown issuer")
        || details.contains("tls")
    {
        return "The server TLS certificate could not be verified. Trust the server certificate on this device or explicitly allow untrusted certificates in Server Settings.".to_string();
    }
    "Could not reach the Collab server. Check the server URL, DNS, proxy, and network connection."
        .to_string()
}

async fn decode_session(response: reqwest::Response) -> Result<NativeSession, String> {
    if !response.status().is_success() {
        return Err("The server rejected the connection or credentials.".into());
    }
    response
        .json::<DataResponse<NativeSession>>()
        .await
        .map(|body| body.data)
        .map_err(|_| "The server returned an invalid authentication response.".into())
}

fn hosted_request_method(value: &str) -> Result<reqwest::Method, String> {
    match value.to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PATCH" => Ok(reqwest::Method::PATCH),
        "DELETE" => Ok(reqwest::Method::DELETE),
        _ => Err("Unsupported hosted-vault request method.".into()),
    }
}

fn validate_hosted_vault_path(value: &str) -> Result<&str, String> {
    let request_path = value.split('?').next().unwrap_or(value);
    let lower_path = request_path.to_ascii_lowercase();
    if !(value == "/api/v1/vaults"
        || value.starts_with("/api/v1/vaults/")
        || value.starts_with("/api/v1/vaults?"))
        || value.starts_with("//")
        || value.contains("://")
        || value.contains('#')
        || request_path.contains("..")
        || request_path.contains('\\')
        || lower_path.contains("%2e")
        || lower_path.contains("%2f")
        || lower_path.contains("%5c")
    {
        return Err("Hosted-vault requests must target the connected server vault API.".into());
    }
    Ok(value)
}

fn validate_identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Hosted-vault identifiers are invalid.".into());
    }
    Ok(())
}

fn require_connected_server(session: &ServerSessionState, server_url: &str) -> Result<(), String> {
    let expected = validate_server_url(server_url)?;
    if session.server_url != expected {
        return Err("This hosted vault belongs to a different Collab server.".into());
    }
    Ok(())
}

async fn decode_hosted_json_response(response: reqwest::Response) -> Result<Value, String> {
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(Value::Null);
    }
    if !response.status().is_success() {
        return Err(decode_hosted_error(response).await);
    }
    response
        .json::<DataResponse<Value>>()
        .await
        .map(|body| body.data)
        .map_err(|_| "The server returned an invalid hosted-vault response.".into())
}

async fn decode_hosted_error(response: reqwest::Response) -> String {
    response
        .json::<ErrorResponse>()
        .await
        .map(|body| body.error.message)
        .unwrap_or_else(|_| "The hosted-vault request failed.".into())
}

fn keyring_entry(server_url: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, server_url)
        .map_err(|_| "The operating system credential store is unavailable.".into())
}

fn store_refresh_token(server_url: &str, refresh_token: &str) -> Result<(), String> {
    keyring_entry(server_url)?
        .set_password(refresh_token)
        .map_err(|_| {
            "Could not save the server session in the operating system credential store.".into()
        })
}

fn status_from_session(
    server_url: &str,
    allow_invalid_certificates: bool,
    session: &NativeSession,
) -> ServerConnectionStatus {
    ServerConnectionStatus {
        connected: true,
        server_url: Some(server_url.to_owned()),
        allow_invalid_certificates,
        user: Some(session.user.clone()),
        access_expires_at: Some(session.access_expires_at.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        hosted_request_method, server_request_error, validate_hosted_vault_path,
        validate_identifier, validate_server_url,
    };

    #[test]
    fn server_urls_require_https_except_for_local_development() {
        assert_eq!(
            validate_server_url("http://localhost:8788/").unwrap(),
            "http://localhost:8788"
        );
        assert!(validate_server_url("http://example.com").is_err());
        assert!(validate_server_url("https://user:pass@example.com").is_err());
        assert_eq!(
            validate_server_url("https://collab.example.com/admin").unwrap(),
            "https://collab.example.com"
        );
    }

    #[test]
    fn hosted_request_gateway_is_limited_to_vault_api_paths_and_methods() {
        assert!(validate_hosted_vault_path("/api/v1/vaults/vault-1/files?state=active").is_ok());
        assert!(validate_hosted_vault_path("/api/v1/admin/users").is_err());
        assert!(validate_hosted_vault_path("/api/v1/vaults-evil").is_err());
        assert!(validate_hosted_vault_path("//example.com/api/v1/vaults").is_err());
        assert!(validate_hosted_vault_path("/api/v1/vaults/../admin").is_err());
        assert!(validate_hosted_vault_path("/api/v1/vaults/%2e%2e/admin").is_err());
        assert!(
            validate_hosted_vault_path("/api/v1/vaults/vault-1/search?q=hello%20world").is_ok()
        );
        assert!(hosted_request_method("GET").is_ok());
        assert!(hosted_request_method("PUT").is_err());
        assert!(validate_identifier("019eb16e-2a85-7070-bbe7-8cf09911c2c1").is_ok());
        assert!(validate_identifier("../vault").is_err());
    }

    #[test]
    fn connection_errors_keep_actionable_network_context() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime should build");
        let error = runtime
            .block_on(reqwest::Client::new().get("http://127.0.0.1:1").send())
            .expect_err("closed local port should fail");
        assert!(server_request_error(error).contains("DNS, proxy, and network"));
    }
}
