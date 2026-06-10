use crate::state::{AppState, ServerSessionState};
use collab_protocol::{DataResponse, NativeSession, ServerUser};
use serde::{Deserialize, Serialize};
use tauri::State;
use url::Url;

const KEYRING_SERVICE: &str = "collab-server";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConnectionStatus {
    pub connected: bool,
    pub server_url: Option<String>,
    pub user: Option<ServerUser>,
    pub access_expires_at: Option<String>,
}

#[tauri::command]
pub async fn connect_server(
    state: State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
) -> Result<ServerConnectionStatus, String> {
    let base = validate_server_url(&server_url)?;
    let response = reqwest::Client::new()
        .post(format!("{base}/api/v1/auth/native/login"))
        .json(&serde_json::json!({
            "username": username,
            "password": password,
            "clientName": "Collab desktop"
        }))
        .send()
        .await
        .map_err(|_| "Could not reach the Collab server.".to_string())?;
    let session = decode_session(response).await?;
    store_refresh_token(&base, &session.refresh_token)?;
    let status = status_from_session(&base, &session);
    *state.server_session.write() = Some(ServerSessionState {
        server_url: base,
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
) -> Result<ServerConnectionStatus, String> {
    let base = validate_server_url(&server_url)?;
    let refresh_token = keyring_entry(&base)?
        .get_password()
        .map_err(|_| "No saved server session was found.".to_string())?;
    let response = reqwest::Client::new()
        .post(format!("{base}/api/v1/auth/refresh"))
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|_| "Could not reach the Collab server.".to_string())?;
    let session = decode_session(response).await?;
    store_refresh_token(&base, &session.refresh_token)?;
    let status = status_from_session(&base, &session);
    *state.server_session.write() = Some(ServerSessionState {
        server_url: base,
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
        let _ = reqwest::Client::new()
            .post(format!("{}/api/v1/auth/native/logout", session.server_url))
            .bearer_auth(&session.access_token)
            .send()
            .await;
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
            user: Some(session.user.clone()),
            access_expires_at: Some(session.access_expires_at.clone()),
        },
        None => ServerConnectionStatus {
            connected: false,
            server_url: None,
            user: None,
            access_expires_at: None,
        },
    }
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

fn status_from_session(server_url: &str, session: &NativeSession) -> ServerConnectionStatus {
    ServerConnectionStatus {
        connected: true,
        server_url: Some(server_url.to_owned()),
        user: Some(session.user.clone()),
        access_expires_at: Some(session.access_expires_at.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_server_url;

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
}
