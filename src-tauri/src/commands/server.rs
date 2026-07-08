use crate::state::{AppState, ServerSessionState};
use base64::Engine as _;
use collab_protocol::{DataResponse, ErrorResponse, NativeSession, ServerUser};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::error::Error as _;
use std::sync::LazyLock;
use tauri::State;
use tokio::io::AsyncWriteExt;
use url::Url;

const KEYRING_SERVICE: &str = "collab-server";

static SERVER_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .build()
        .map_err(|_| "Could not initialize the Collab server connection.".to_string())
});

static INSECURE_SERVER_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|_| "Could not initialize the Collab server connection.".to_string())
});

// Live-collaboration WebSocket clients are HTTP/1.1-only. `reqwest-websocket`
// only performs the RFC 6455 upgrade over HTTP/1.1 and errors on HTTP/2, but a
// normal reqwest client advertises `h2` via ALPN — so a modern server (valid
// cert, HTTP/2 enabled) would negotiate h2 and the live socket would fail while
// REST kept working. Forcing `http1_only` here makes the upgrade succeed against
// any server; REST keeps using the h2-capable clients above.
static WS_SERVER_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .http1_only()
        .build()
        .map_err(|_| "Could not initialize the Collab server connection.".to_string())
});

static WS_INSECURE_SERVER_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .http1_only()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|_| "Could not initialize the Collab server connection.".to_string())
});

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
    persist_across_reboots: bool,
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
    store_refresh_token(&base, &session.refresh_token, persist_across_reboots)?;
    // Cache the refresh token in memory so later reconnects never re-read the
    // keyring (which can prompt to unlock the Secret Service on Linux).
    state
        .refresh_token_cache
        .write()
        .insert(base.clone(), session.refresh_token.clone());
    let status = status_from_session(&base, allow_invalid_certificates, &session);
    state.server_sessions.write().insert(
        base.clone(),
        ServerSessionState {
            server_url: base,
            allow_invalid_certificates,
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            access_expires_at: session.access_expires_at,
            user: session.user,
        },
    );
    Ok(status)
}

#[tauri::command]
pub async fn reconnect_server(
    state: State<'_, AppState>,
    server_url: String,
    allow_invalid_certificates: bool,
    persist_across_reboots: bool,
) -> Result<ServerConnectionStatus, String> {
    let base = validate_server_url(&server_url)?;
    // Resolve the refresh token without touching the keyring on the hot path:
    // prefer the live session, then the per-launch cache, and only read the
    // keyring (once) when neither is primed. The keyring read primes the cache
    // immediately, so a refresh that then fails (e.g. the server is down at
    // startup) does not make the auto-reconnect retry loop re-read the keyring.
    let refresh_token = resolve_refresh_token(&state, &base)?;
    let response = server_client(allow_invalid_certificates)?
        .post(format!("{base}/api/v1/auth/refresh"))
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(server_request_error)?;
    let session = decode_session(response).await?;
    // Persist the rotated token only when it actually changed, to avoid redundant
    // Secret Service writes (each a potential unlock prompt on Linux).
    if should_persist_rotation(&refresh_token, &session.refresh_token) {
        store_refresh_token(&base, &session.refresh_token, persist_across_reboots)?;
    }
    state
        .refresh_token_cache
        .write()
        .insert(base.clone(), session.refresh_token.clone());
    let status = status_from_session(&base, allow_invalid_certificates, &session);
    state.server_sessions.write().insert(
        base.clone(),
        ServerSessionState {
            server_url: base,
            allow_invalid_certificates,
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            access_expires_at: session.access_expires_at,
            user: session.user,
        },
    );
    Ok(status)
}

#[tauri::command]
pub async fn disconnect_server(state: State<'_, AppState>, server_url: String) -> Result<(), String> {
    let base = validate_server_url(&server_url)?;
    // Remove only this server's session, leaving any other connected servers
    // intact (the app can be signed in to several servers at once).
    let session = state.server_sessions.write().remove(&base);
    if let Some(session) = session {
        if let Ok(client) = server_client(session.allow_invalid_certificates) {
            let _ = client
                .post(format!("{}/api/v1/auth/native/logout", session.server_url))
                .bearer_auth(&session.access_token)
                .send()
                .await;
        }
    }
    delete_refresh_token(&base);
    state.refresh_token_cache.write().remove(&base);
    Ok(())
}

/// Resolves the refresh token for `base` while touching the OS keyring at most
/// once per launch: prefers the in-memory session, then the per-launch cache,
/// and only then reads the keyring (priming the cache with what it read).
fn resolve_refresh_token(state: &AppState, base: &str) -> Result<String, String> {
    if let Some(session) = state.server_sessions.read().get(base) {
        if !session.refresh_token.is_empty() {
            return Ok(session.refresh_token.clone());
        }
    }
    if let Some(token) = state.refresh_token_cache.read().get(base) {
        return Ok(token.clone());
    }
    let token =
        read_refresh_token(base).ok_or_else(|| "No saved server session was found.".to_string())?;
    state
        .refresh_token_cache
        .write()
        .insert(base.to_string(), token.clone());
    Ok(token)
}

/// Whether a rotated refresh token must be re-written to the keyring. Skipping
/// an unchanged write avoids a redundant Secret Service access (a potential
/// unlock prompt on Linux).
fn should_persist_rotation(previous: &str, next: &str) -> bool {
    previous != next
}

/// Whether a refresh token for `server_url` exists in the OS credential store.
/// Used to decide if an automatic startup reconnect should even be attempted, so
/// a stale saved server URL (e.g. left over after a disconnect) does not surface
/// a spurious "could not restore session" error when no credential exists.
#[tauri::command]
pub fn server_has_saved_session(server_url: String) -> Result<bool, String> {
    let base = validate_server_url(&server_url)?;
    Ok(read_refresh_token(&base).is_some())
}

/// One status entry per currently connected server (the app may be signed in to
/// several at once). An empty list means no servers are connected.
#[tauri::command]
pub fn server_connection_statuses(state: State<'_, AppState>) -> Vec<ServerConnectionStatus> {
    state
        .server_sessions
        .read()
        .values()
        .map(|session| ServerConnectionStatus {
            connected: true,
            server_url: Some(session.server_url.clone()),
            allow_invalid_certificates: session.allow_invalid_certificates,
            user: Some(session.user.clone()),
            access_expires_at: Some(session.access_expires_at.clone()),
        })
        .collect()
}

/// Resolves the connected session for `server_url`, or the given "not connected"
/// message when the app is not signed in to that server. The message intentionally
/// contains "Connect to the Collab server" so the frontend's
/// `isLikelyConnectivityError` treats an unconnected server's vault as offline
/// (replica fallback + queued writes) rather than a hard failure.
pub(crate) fn session_for(
    state: &AppState,
    server_url: &str,
    not_connected_message: &str,
) -> Result<ServerSessionState, String> {
    let base = validate_server_url(server_url)?;
    state
        .server_sessions
        .read()
        .get(&base)
        .cloned()
        .ok_or_else(|| not_connected_message.to_string())
}

#[tauri::command]
pub async fn hosted_vault_request(
    state: State<'_, AppState>,
    server_url: String,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let session = session_for(
        &state,
        &server_url,
        "Connect to the Collab server before opening hosted vaults.",
    )?;
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

/// Exchanges the connected server session for a single-use live-collaboration
/// WebSocket ticket bound to one vault. The bearer token stays in Rust; the
/// webview receives only the opaque ticket plus the `ws(s)://` URL to open. The
/// WebSocket itself authenticates with the ticket, not a bearer token.
#[tauri::command]
pub async fn hosted_ws_ticket(
    state: State<'_, AppState>,
    server_url: String,
    vault_id: String,
) -> Result<Value, String> {
    validate_identifier(&vault_id)?;
    let session = session_for(
        &state,
        &server_url,
        "Connect to the Collab server before starting live collaboration.",
    )?;
    let response = server_client(session.allow_invalid_certificates)?
        .post(format!("{}/api/v1/auth/ws-ticket", session.server_url))
        .bearer_auth(&session.access_token)
        .json(&serde_json::json!({ "vaultId": vault_id }))
        .send()
        .await
        .map_err(server_request_error)?;
    let data = decode_hosted_json_response(response).await?;
    let ticket = data
        .get("ticket")
        .and_then(Value::as_str)
        .ok_or_else(|| "The server returned an invalid ticket response.".to_string())?;
    let websocket_path = data
        .get("websocketPath")
        .and_then(Value::as_str)
        .ok_or_else(|| "The server returned an invalid ticket response.".to_string())?;
    // Derive the WebSocket origin from the connected HTTP origin.
    let ws_origin = if let Some(rest) = session.server_url.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = session.server_url.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        return Err("The connected server URL is not valid.".to_string());
    };
    Ok(serde_json::json!({
        "ticket": ticket,
        "websocketUrl": format!("{}{}", ws_origin.trim_end_matches('/'), websocket_path),
        "protocolVersion": data.get("protocolVersion").cloned().unwrap_or(Value::Null),
    }))
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
    let session = session_for(
        &state,
        &server_url,
        "Connect to the Collab server before downloading hosted assets.",
    )?;
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

#[tauri::command]
pub async fn hosted_vault_upload_file(
    state: State<'_, AppState>,
    server_url: String,
    vault_id: String,
    parent_id: Option<String>,
    source_path: String,
) -> Result<Value, String> {
    validate_identifier(&vault_id)?;
    if let Some(parent_id) = parent_id.as_deref() {
        validate_identifier(parent_id)?;
    }
    let session = session_for(
        &state,
        &server_url,
        "Connect to the Collab server before uploading hosted assets.",
    )?;
    let payload = super::files::read_file_for_upload(source_path)?;
    let response = server_client(session.allow_invalid_certificates)?
        .post(format!("{}/api/v1/vaults/{vault_id}/uploads", session.server_url))
        .bearer_auth(&session.access_token)
        .json(&serde_json::json!({
            "parentId": parent_id,
            "name": payload.name,
            "mediaType": payload.media_type,
            "contentBase64": payload.content_base64,
            "expectedHash": payload.expected_hash,
        }))
        .send()
        .await
        .map_err(server_request_error)?;
    decode_hosted_json_response(response).await
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
    let session = session_for(
        &state,
        &server_url,
        "Connect to the Collab server before browsing users.",
    )?;
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
    let session = session_for(
        &state,
        &server_url,
        "Connect to the Collab server before exporting hosted vaults.",
    )?;
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
    let mut file = tokio::fs::File::create(&destination_path)
        .await
        .map_err(|_| "Could not write the exported vault archive to disk.".to_string())?;
    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The server returned an invalid export response.".to_string())?
    {
        file.write_all(&chunk)
            .await
            .map_err(|_| "Could not write the exported vault archive to disk.".to_string())?;
    }
    file.flush()
        .await
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

pub(crate) fn server_client(allow_invalid_certificates: bool) -> Result<reqwest::Client, String> {
    let client = if allow_invalid_certificates {
        &*INSECURE_SERVER_CLIENT
    } else {
        &*SERVER_CLIENT
    };
    client.clone()
}

/// HTTP/1.1-only client for the live-collaboration WebSocket upgrade (see the
/// `WS_SERVER_CLIENT` note). Shares the session's untrusted-certificate choice.
pub(crate) fn ws_server_client(allow_invalid_certificates: bool) -> Result<reqwest::Client, String> {
    let client = if allow_invalid_certificates {
        &*WS_INSECURE_SERVER_CLIENT
    } else {
        &*WS_SERVER_CLIENT
    };
    client.clone()
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
        "PUT" => Ok(reqwest::Method::PUT),
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

// Refresh-token storage is per-platform (see `Cargo.toml`).
//
// Linux defaults to the kernel keyutils keyring: silent (no D-Bus prompt), never
// written to disk, and cleared on reboot, which reconnects the "re-login after a
// reboot" tradeoff. When the user opts into cross-reboot persistence we use the
// D-Bus Secret Service instead, which is durable but may prompt to unlock the
// keyring. `persist_across_reboots` selects the Linux backend; on Windows/macOS
// the native OS keystore (Credential Manager / Keychain) is always used and the
// flag is ignored, because those stores are already silent and durable.

#[cfg(target_os = "linux")]
fn keyutils_entry(server_url: &str) -> Result<keyring::Entry, String> {
    let cred =
        keyring::keyutils::KeyutilsCredential::new_with_target(None, KEYRING_SERVICE, server_url)
            .map_err(|_| "The session keyring is unavailable.".to_string())?;
    Ok(keyring::Entry::new_with_credential(Box::new(cred)))
}

#[cfg(target_os = "linux")]
fn secret_service_entry(server_url: &str) -> Result<keyring::Entry, String> {
    // `new_with_target(None, ..)` uses the "default" target, matching the
    // attributes written by earlier versions (keyring's default builder), so
    // tokens saved before this change are still found on upgrade.
    let cred =
        keyring::secret_service::SsCredential::new_with_target(None, KEYRING_SERVICE, server_url)
            .map_err(|_| "The system keyring (Secret Service) is unavailable.".to_string())?;
    Ok(keyring::Entry::new_with_credential(Box::new(cred)))
}

#[cfg(target_os = "linux")]
fn store_refresh_token(
    server_url: &str,
    refresh_token: &str,
    persist_across_reboots: bool,
) -> Result<(), String> {
    if persist_across_reboots {
        secret_service_entry(server_url)?
            .set_password(refresh_token)
            .map_err(|_| "Could not save the server session.".to_string())?;
        // Deleting from keyutils is silent, so clear any stale silent-store copy.
        if let Ok(entry) = keyutils_entry(server_url) {
            let _ = entry.delete_credential();
        }
    } else {
        keyutils_entry(server_url)?
            .set_password(refresh_token)
            .map_err(|_| "Could not save the server session.".to_string())?;
        // Intentionally do NOT touch the Secret Service on this default path:
        // reading or deleting from a locked collection could trigger the unlock
        // prompt this silent path exists to avoid. A stale Secret Service token
        // from a previous opt-in is harmless — keyutils is read first, the server
        // rotates the refresh token on next use, and explicit disconnect clears
        // both backends.
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn read_refresh_token(server_url: &str) -> Option<String> {
    // Read from both backends so a saved token is found regardless of the
    // current preference (e.g. after the user flips the toggle, or after
    // upgrading from a version that only used the Secret Service).
    keyutils_entry(server_url)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .or_else(|| {
            secret_service_entry(server_url)
                .ok()
                .and_then(|entry| entry.get_password().ok())
        })
}

#[cfg(target_os = "linux")]
fn delete_refresh_token(server_url: &str) {
    if let Ok(entry) = keyutils_entry(server_url) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = secret_service_entry(server_url) {
        let _ = entry.delete_credential();
    }
}

#[cfg(not(target_os = "linux"))]
fn native_entry(server_url: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, server_url)
        .map_err(|_| "The operating system credential store is unavailable.".into())
}

#[cfg(not(target_os = "linux"))]
fn store_refresh_token(
    server_url: &str,
    refresh_token: &str,
    _persist_across_reboots: bool,
) -> Result<(), String> {
    native_entry(server_url)?.set_password(refresh_token).map_err(|_| {
        "Could not save the server session in the operating system credential store.".into()
    })
}

#[cfg(not(target_os = "linux"))]
fn read_refresh_token(server_url: &str) -> Option<String> {
    native_entry(server_url)
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

#[cfg(not(target_os = "linux"))]
fn delete_refresh_token(server_url: &str) {
    if let Ok(entry) = native_entry(server_url) {
        let _ = entry.delete_credential();
    }
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
        hosted_request_method, server_request_error, should_persist_rotation,
        validate_hosted_vault_path, validate_identifier, validate_server_url,
    };

    #[test]
    fn multiple_server_sessions_resolve_independently_by_url() {
        use crate::state::{AppState, ServerSessionState};
        use collab_protocol::{ServerUser, ServerUserRole, ServerUserStatus};

        fn session(url: &str, user: &str) -> ServerSessionState {
            ServerSessionState {
                server_url: url.to_string(),
                allow_invalid_certificates: false,
                access_token: format!("{user}-access"),
                refresh_token: format!("{user}-refresh"),
                access_expires_at: "2099-01-01T00:00:00Z".to_string(),
                user: ServerUser {
                    id: user.to_string(),
                    username: user.to_string(),
                    display_name: user.to_string(),
                    role: ServerUserRole::Member,
                    status: ServerUserStatus::Active,
                    created_at: String::new(),
                    last_login_at: None,
                    active_sessions: 1,
                    is_primary_admin: false,
                    has_avatar: false,
                    avatar_updated_at: None,
                    preferences: serde_json::Value::Null,
                },
            }
        }

        let state = AppState::new();
        state
            .server_sessions
            .write()
            .insert("https://a.example.com".to_string(), session("https://a.example.com", "alice"));
        state
            .server_sessions
            .write()
            .insert("https://b.example.com".to_string(), session("https://b.example.com", "bob"));

        // Each server resolves to its own session, concurrently.
        assert_eq!(
            super::session_for(&state, "https://a.example.com", "nope").unwrap().access_token,
            "alice-access"
        );
        assert_eq!(
            super::session_for(&state, "https://b.example.com/admin", "nope").unwrap().user.id,
            "bob"
        );
        // A server we are not connected to yields the connectivity message.
        assert_eq!(
            super::session_for(&state, "https://c.example.com", "not connected").unwrap_err(),
            "not connected"
        );

        // Dropping one server leaves the other intact.
        state.server_sessions.write().remove("https://a.example.com");
        assert!(super::session_for(&state, "https://a.example.com", "gone").is_err());
        assert!(super::session_for(&state, "https://b.example.com", "gone").is_ok());
    }

    #[test]
    fn rotated_refresh_token_is_persisted_only_when_it_changes() {
        // A server that returns the same refresh token on refresh must not
        // trigger a redundant keyring write (which can prompt on Linux).
        assert!(!should_persist_rotation("same-token", "same-token"));
        assert!(should_persist_rotation("old-token", "new-token"));
    }

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
        assert!(hosted_request_method("PUT").is_ok());
        assert!(hosted_request_method("TRACE").is_err());
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
