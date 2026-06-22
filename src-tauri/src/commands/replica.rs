//! Tauri commands exposing the native hosted-vault replica store to the
//! frontend. Each command resolves the replica under the shared app config
//! directory. Mutations other than `replica_seed` require an already-seeded
//! replica (the replica is seeded when a hosted vault is opened).

use super::app_config_dir;
use crate::replica::{
    server_key, CacheCleanupReport, CachedContentStatus, PendingOpStatus, PendingOperation,
    ReplicaIntegrityReport, ReplicaStore, ReplicaSummary, ReplicaSyncState, Tombstone,
};
use base64::Engine as _;
use collab_protocol::HostedVaultManifest;
use rand::RngCore;

const REPLICA_KEYRING_SERVICE: &str = "collab-replica";

fn existing(server_url: &str, vault_id: &str) -> Result<ReplicaStore, String> {
    let config_root = app_config_dir()?;
    let store = ReplicaStore::open_existing(&config_root, server_url, vault_id)
        .ok_or_else(|| format!("No local replica for vault {vault_id}"))?;
    let key = replica_key(server_url, vault_id, true)?
        .ok_or_else(|| "Could not create an offline replica key.".to_string())?;
    Ok(store.with_encryption_key(key))
}

fn existing_read(server_url: &str, vault_id: &str) -> Result<Option<ReplicaStore>, String> {
    let Some(store) = ReplicaStore::open_existing(&app_config_dir()?, server_url, vault_id) else {
        return Ok(None);
    };
    Ok(match replica_key(server_url, vault_id, false)? {
        Some(key) => Some(store.with_encryption_key(key)),
        None => Some(store),
    })
}

fn replica_keyring_entry(server_url: &str, vault_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        REPLICA_KEYRING_SERVICE,
        &format!("{}:{vault_id}", server_key(server_url)),
    )
    .map_err(|_| "The operating system credential store is unavailable.".into())
}

fn replica_key(server_url: &str, vault_id: &str, create: bool) -> Result<Option<[u8; 32]>, String> {
    let entry = match replica_keyring_entry(server_url, vault_id) {
        Ok(entry) => entry,
        Err(_) if !create => return Ok(None),
        Err(error) => return Err(error),
    };
    let encoded = match entry.get_password() {
        Ok(encoded) => encoded,
        Err(_) if create => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let encoded = base64::engine::general_purpose::STANDARD.encode(key);
            entry
                .set_password(&encoded)
                .map_err(|_| "Could not save the offline replica key in the operating system credential store.".to_string())?;
            encoded
        }
        Err(_) => return Ok(None),
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| "The saved offline replica key is invalid.".to_string())?;
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "The saved offline replica key has an invalid length.".to_string())?;
    Ok(Some(key))
}

#[tauri::command]
pub fn replica_seed(
    server_url: String,
    vault_id: String,
    vault_name: String,
    manifest: HostedVaultManifest,
    sync_state: ReplicaSyncState,
    role: Option<String>,
    capabilities: Option<Vec<String>>,
) -> Result<(), String> {
    let config_root = app_config_dir()?;
    let capabilities = capabilities.unwrap_or_default();
    let key = replica_key(&server_url, &vault_id, true)?
        .ok_or_else(|| "Could not create an offline replica key.".to_string())?;
    let store = ReplicaStore::open_or_create(
        &config_root,
        &server_url,
        &vault_id,
        &vault_name,
        role.as_deref(),
        &capabilities,
    )?
    .with_encryption_key(key);
    store.write_manifest(&manifest)?;
    store.write_sync_state(&sync_state)
}

#[tauri::command]
pub fn replica_list() -> Result<Vec<ReplicaSummary>, String> {
    ReplicaStore::list(&app_config_dir()?)
}

#[tauri::command]
pub fn replica_read_manifest(
    server_url: String,
    vault_id: String,
) -> Result<Option<HostedVaultManifest>, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.read_manifest(),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn replica_read_sync_state(
    server_url: String,
    vault_id: String,
) -> Result<ReplicaSyncState, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.read_sync_state(),
        None => Ok(ReplicaSyncState::default()),
    }
}

#[tauri::command]
pub fn replica_write_sync_state(
    server_url: String,
    vault_id: String,
    sync_state: ReplicaSyncState,
) -> Result<(), String> {
    existing(&server_url, &vault_id)?.write_sync_state(&sync_state)
}

#[tauri::command]
pub fn replica_enqueue_operation(
    server_url: String,
    vault_id: String,
    operation: PendingOperation,
) -> Result<(), String> {
    existing(&server_url, &vault_id)?.enqueue_operation(&operation)
}

#[tauri::command]
pub fn replica_list_pending_operations(
    server_url: String,
    vault_id: String,
) -> Result<Vec<PendingOperation>, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.list_pending_operations(),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn replica_update_operation_status(
    server_url: String,
    vault_id: String,
    operation_id: String,
    status: PendingOpStatus,
) -> Result<(), String> {
    existing(&server_url, &vault_id)?.update_operation_status(&operation_id, status)
}

#[tauri::command]
pub fn replica_record_operation_failure(
    server_url: String,
    vault_id: String,
    operation_id: String,
    failure_code: String,
    failure_message: String,
) -> Result<(), String> {
    existing(&server_url, &vault_id)?.record_operation_failure(
        &operation_id,
        &failure_code,
        &failure_message,
    )
}

#[tauri::command]
pub fn replica_remove_operation(
    server_url: String,
    vault_id: String,
    operation_id: String,
) -> Result<(), String> {
    existing(&server_url, &vault_id)?.remove_operation(&operation_id)
}

#[tauri::command]
pub fn replica_record_tombstone(
    server_url: String,
    vault_id: String,
    tombstone: Tombstone,
) -> Result<(), String> {
    existing(&server_url, &vault_id)?.record_tombstone(&tombstone)
}

#[tauri::command]
pub fn replica_list_tombstones(
    server_url: String,
    vault_id: String,
) -> Result<Vec<Tombstone>, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.list_tombstones(),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn replica_remove_tombstone(
    server_url: String,
    vault_id: String,
    file_id: String,
) -> Result<(), String> {
    existing(&server_url, &vault_id)?.remove_tombstone(&file_id)
}

#[tauri::command]
pub fn replica_cache_document(
    server_url: String,
    vault_id: String,
    file_id: String,
    content: String,
) -> Result<(), String> {
    existing(&server_url, &vault_id)?.cache_document(&file_id, &content)
}

#[tauri::command]
pub fn replica_read_cached_document(
    server_url: String,
    vault_id: String,
    file_id: String,
) -> Result<Option<String>, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.read_cached_document(&file_id),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn replica_cache_asset(
    server_url: String,
    vault_id: String,
    file_id: String,
    base64_content: String,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_content.as_bytes())
        .map_err(|e| e.to_string())?;
    existing(&server_url, &vault_id)?.cache_asset(&file_id, &bytes)
}

#[tauri::command]
pub fn replica_read_cached_asset(
    server_url: String,
    vault_id: String,
    file_id: String,
) -> Result<Option<String>, String> {
    let bytes = match existing_read(&server_url, &vault_id)? {
        Some(store) => store.read_cached_asset(&file_id)?,
        None => None,
    };
    Ok(bytes.map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn replica_cached_content_status(
    server_url: String,
    vault_id: String,
    file_id: String,
    kind: String,
    expected_sha256: Option<String>,
) -> Result<CachedContentStatus, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.cached_content_status(&file_id, &kind, expected_sha256.as_deref()),
        None => Ok(CachedContentStatus {
            present: false,
            matches_expected_hash: false,
            actual_sha256: None,
            size_bytes: None,
        }),
    }
}

#[tauri::command]
pub fn replica_cache_crdt_state(
    server_url: String,
    vault_id: String,
    file_id: String,
    base64_content: String,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_content.as_bytes())
        .map_err(|e| e.to_string())?;
    existing(&server_url, &vault_id)?.cache_crdt_state(&file_id, &bytes)
}

#[tauri::command]
pub fn replica_read_crdt_state(
    server_url: String,
    vault_id: String,
    file_id: String,
) -> Result<Option<String>, String> {
    let bytes = match existing_read(&server_url, &vault_id)? {
        Some(store) => store.read_cached_crdt_state(&file_id)?,
        None => None,
    };
    Ok(bytes.map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn replica_clear_crdt_state(
    server_url: String,
    vault_id: String,
    file_id: String,
) -> Result<(), String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.clear_cached_crdt_state(&file_id),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn replica_verify(
    server_url: String,
    vault_id: String,
) -> Result<ReplicaIntegrityReport, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.verify(),
        None => Ok(ReplicaIntegrityReport {
            ok: true,
            corrupt_files: Vec::new(),
        }),
    }
}

#[tauri::command]
pub fn replica_rebuild(
    server_url: String,
    vault_id: String,
) -> Result<ReplicaIntegrityReport, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.rebuild(),
        None => Ok(ReplicaIntegrityReport {
            ok: true,
            corrupt_files: Vec::new(),
        }),
    }
}

#[tauri::command]
pub fn replica_cleanup(
    server_url: String,
    vault_id: String,
    budget_bytes: u64,
) -> Result<CacheCleanupReport, String> {
    match existing_read(&server_url, &vault_id)? {
        Some(store) => store.cleanup(budget_bytes),
        None => Ok(CacheCleanupReport {
            removed_files: 0,
            freed_bytes: 0,
            remaining_bytes: 0,
        }),
    }
}

#[tauri::command]
pub fn replica_delete(server_url: String, vault_id: String) -> Result<(), String> {
    if let Some(store) = ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
        store.delete()?;
    }
    if let Ok(entry) = replica_keyring_entry(&server_url, &vault_id) {
        let _ = entry.delete_credential();
    }
    Ok(())
}
