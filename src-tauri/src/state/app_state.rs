use crate::models::{note::NoteMetadata, vault::VaultMeta};
use collab_protocol::ServerUser;
use notify::RecommendedWatcher;
use notify_debouncer_mini::Debouncer;
use parking_lot::RwLock;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct ServerSessionState {
    pub server_url: String,
    pub allow_invalid_certificates: bool,
    pub persist_across_reboots: bool,
    pub access_token: String,
    /// Held in memory (like `access_token`) so reconnects and the auto-reconnect
    /// retry loop can rotate the session without re-reading the OS keyring — the
    /// keyring is otherwise touched once per launch. Never leaves the backend.
    pub refresh_token: String,
    pub access_expires_at: String,
    pub user: ServerUser,
}

pub struct AppState {
    pub active_vault: RwLock<Option<VaultMeta>>,
    pub watcher: parking_lot::Mutex<Option<Debouncer<RecommendedWatcher>>>,
    pub note_index: RwLock<Vec<NoteMetadata>>,
    /// AES-256 key derived from the vault password. Present only while the
    /// vault is unlocked. Cleared whenever a new vault is opened.
    pub encryption_key: RwLock<Option<[u8; 32]>>,
    /// Native server access tokens are intentionally memory-only. Keyed by
    /// normalized server URL so the app can be connected to several hosted
    /// servers at once; every hosted request selects its session by URL.
    pub server_sessions: RwLock<HashMap<String, ServerSessionState>>,
    /// In-memory cache of the current refresh token per server URL, primed from
    /// the OS keyring on the first reconnect of a launch. Lets the reconnect
    /// retry loop rotate the session without re-reading the keyring (which on
    /// Linux can trigger a Secret Service unlock prompt each time). Keyed by
    /// normalized server URL so it extends unchanged to multiple servers.
    pub refresh_token_cache: RwLock<HashMap<String, String>>,
    /// Serializes native refresh-token rotation. Refresh tokens are single-use on
    /// the server; concurrent refreshes with the same token would otherwise
    /// revoke the session.
    pub server_refresh_lock: tokio::sync::Mutex<()>,
    /// Active backend-proxied live-collaboration WebSockets. Routing the live
    /// socket through Rust lets it reuse the session TLS config (including the
    /// untrusted-certificate opt-in), which the webview's own `WebSocket` cannot.
    pub live_ws: crate::commands::live_ws::LiveWsRegistry,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            active_vault: RwLock::new(None),
            watcher: parking_lot::Mutex::new(None),
            note_index: RwLock::new(Vec::new()),
            encryption_key: RwLock::new(None),
            server_sessions: RwLock::new(HashMap::new()),
            refresh_token_cache: RwLock::new(HashMap::new()),
            server_refresh_lock: tokio::sync::Mutex::new(()),
            live_ws: crate::commands::live_ws::LiveWsRegistry::default(),
        }
    }
}
