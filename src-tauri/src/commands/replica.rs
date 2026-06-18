//! Tauri commands exposing the native hosted-vault replica store to the
//! frontend. Each command resolves the replica under the shared app config
//! directory. Mutations other than `replica_seed` require an already-seeded
//! replica (the replica is seeded when a hosted vault is opened).

use super::app_config_dir;
use crate::replica::{
    CacheCleanupReport, PendingOpStatus, PendingOperation, ReplicaIntegrityReport, ReplicaStore,
    ReplicaSyncState, Tombstone,
};
use collab_protocol::HostedVaultManifest;

fn existing(server_url: &str, vault_id: &str) -> Result<ReplicaStore, String> {
    let config_root = app_config_dir()?;
    ReplicaStore::open_existing(&config_root, server_url, vault_id)
        .ok_or_else(|| format!("No local replica for vault {vault_id}"))
}

#[tauri::command]
pub fn replica_seed(
    server_url: String,
    vault_id: String,
    vault_name: String,
    manifest: HostedVaultManifest,
    sync_state: ReplicaSyncState,
) -> Result<(), String> {
    let config_root = app_config_dir()?;
    let store = ReplicaStore::open_or_create(&config_root, &server_url, &vault_id, &vault_name)?;
    store.write_manifest(&manifest)?;
    store.write_sync_state(&sync_state)
}

#[tauri::command]
pub fn replica_read_manifest(
    server_url: String,
    vault_id: String,
) -> Result<Option<HostedVaultManifest>, String> {
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
        Some(store) => store.read_manifest(),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn replica_read_sync_state(
    server_url: String,
    vault_id: String,
) -> Result<ReplicaSyncState, String> {
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
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
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
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
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
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
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
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
    use base64::Engine;
    let bytes = match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
        Some(store) => store.read_cached_asset(&file_id)?,
        None => None,
    };
    Ok(bytes.map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes)))
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
    use base64::Engine;
    let bytes = match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
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
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
        Some(store) => store.clear_cached_crdt_state(&file_id),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn replica_verify(
    server_url: String,
    vault_id: String,
) -> Result<ReplicaIntegrityReport, String> {
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
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
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
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
    match ReplicaStore::open_existing(&app_config_dir()?, &server_url, &vault_id) {
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
    Ok(())
}
