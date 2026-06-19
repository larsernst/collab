//! Filesystem + JSON implementation of the native hosted-vault replica store.
//!
//! The store is deliberately substrate-light to match the project's existing
//! conventions (templates, presence, and snapshots are all FS + JSON). Atomic
//! commits use a temp-file + rename, the pending-operation queue is an
//! append-only JSONL log, and corruption is detected through sidecar checksums
//! recorded in `integrity.json`.

use super::models::{
    CacheCleanupReport, PendingOpStatus, PendingOperation, ReplicaIntegrityReport, ReplicaMeta,
    ReplicaSyncState, Tombstone, REPLICA_SCHEMA_VERSION,
};
use collab_protocol::HostedVaultManifest;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const META_FILE: &str = "meta.json";
const MANIFEST_FILE: &str = "manifest.json";
const SYNC_STATE_FILE: &str = "sync-state.json";
const TOMBSTONES_FILE: &str = "tombstones.json";
const PENDING_OPS_FILE: &str = "pending-ops.jsonl";
const INTEGRITY_FILE: &str = "integrity.json";
const DOCUMENTS_DIR: &str = "documents";
const ASSETS_DIR: &str = "assets";
const CRDT_DIR: &str = "crdt";

/// A filesystem-safe key derived from a server URL. Trailing slashes are
/// trimmed so the same server resolves to a single replica namespace.
pub fn server_key(server_url: &str) -> String {
    let normalized = server_url.trim().trim_end_matches('/');
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hex::encode(hasher.finalize())
}

/// The root directory that holds every replica under a config root.
pub fn replica_root(config_root: &Path) -> PathBuf {
    config_root.join("replicas")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Reject file-id segments that could escape the replica directory. Hosted file
/// ids are server-issued UUID strings, so any path separator or traversal
/// component is treated as invalid input.
fn safe_segment(segment: &str) -> Result<&str, String> {
    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.contains('/')
        || segment.contains('\\')
    {
        return Err(format!("Invalid replica file id: {segment}"));
    }
    Ok(segment)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// A managed on-disk replica of a single hosted vault.
pub struct ReplicaStore {
    root: PathBuf,
}

/// A single cached-content file considered during bounded cache cleanup.
struct CacheEntry {
    path: PathBuf,
    id: String,
    size: u64,
    modified: std::time::SystemTime,
    protected: bool,
}

impl ReplicaStore {
    /// Open the replica for `(server_url, vault_id)` under `config_root`, creating
    /// the directory layout and (re)writing `meta.json` if needed. The original
    /// `createdAt` is preserved across reopenings.
    pub fn open_or_create(
        config_root: &Path,
        server_url: &str,
        vault_id: &str,
        vault_name: &str,
    ) -> Result<Self, String> {
        let vault_segment = safe_segment(vault_id)?;
        let root = replica_root(config_root)
            .join(server_key(server_url))
            .join(vault_segment);
        for dir in [
            &root,
            &root.join(DOCUMENTS_DIR),
            &root.join(ASSETS_DIR),
            &root.join(CRDT_DIR),
        ] {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let store = Self { root };

        let now = now_iso();
        let created_at = store
            .read_json::<ReplicaMeta>(META_FILE)?
            .map(|meta| meta.created_at)
            .unwrap_or_else(|| now.clone());
        let meta = ReplicaMeta {
            server_url: server_url.to_string(),
            vault_id: vault_id.to_string(),
            vault_name: vault_name.to_string(),
            schema_version: REPLICA_SCHEMA_VERSION,
            created_at,
            updated_at: now,
        };
        store.write_json(META_FILE, &meta)?;
        Ok(store)
    }

    /// Open an existing replica without creating or mutating it. Returns `None`
    /// when no replica directory exists for the target.
    pub fn open_existing(config_root: &Path, server_url: &str, vault_id: &str) -> Option<Self> {
        let vault_segment = safe_segment(vault_id).ok()?;
        let root = replica_root(config_root)
            .join(server_key(server_url))
            .join(vault_segment);
        if root.join(META_FILE).is_file() {
            Some(Self { root })
        } else {
            None
        }
    }

    #[cfg(test)]
    pub fn root(&self) -> &Path {
        &self.root
    }

    // ---- manifest -------------------------------------------------------

    pub fn write_manifest(&self, manifest: &HostedVaultManifest) -> Result<(), String> {
        self.write_json(MANIFEST_FILE, manifest)
    }

    pub fn read_manifest(&self) -> Result<Option<HostedVaultManifest>, String> {
        self.read_json(MANIFEST_FILE)
    }

    // ---- sync state -----------------------------------------------------

    pub fn write_sync_state(&self, state: &ReplicaSyncState) -> Result<(), String> {
        self.write_json(SYNC_STATE_FILE, state)
    }

    pub fn read_sync_state(&self) -> Result<ReplicaSyncState, String> {
        Ok(self.read_json(SYNC_STATE_FILE)?.unwrap_or_default())
    }

    // ---- pending operations (append-only JSONL) -------------------------

    pub fn enqueue_operation(&self, op: &PendingOperation) -> Result<(), String> {
        let mut ops = self.list_pending_operations()?;
        ops.push(op.clone());
        self.write_pending_operations(&ops)
    }

    pub fn list_pending_operations(&self) -> Result<Vec<PendingOperation>, String> {
        let path = self.root.join(PENDING_OPS_FILE);
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.to_string()),
        };
        let mut ops = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let op: PendingOperation = serde_json::from_str(line).map_err(|e| e.to_string())?;
            ops.push(op);
        }
        Ok(ops)
    }

    pub fn update_operation_status(&self, id: &str, status: PendingOpStatus) -> Result<(), String> {
        let mut ops = self.list_pending_operations()?;
        let mut found = false;
        for op in ops.iter_mut() {
            if op.id == id {
                op.status = status;
                found = true;
            }
        }
        if !found {
            return Err(format!("Pending operation not found: {id}"));
        }
        self.write_pending_operations(&ops)
    }

    pub fn record_operation_failure(
        &self,
        id: &str,
        failure_code: &str,
        failure_message: &str,
    ) -> Result<(), String> {
        let mut ops = self.list_pending_operations()?;
        let mut found = false;
        for op in ops.iter_mut() {
            if op.id == id {
                op.status = PendingOpStatus::Failed;
                op.failure_code = Some(failure_code.to_string());
                op.failure_message = Some(failure_message.to_string());
                found = true;
            }
        }
        if !found {
            return Err(format!("Pending operation not found: {id}"));
        }
        self.write_pending_operations(&ops)
    }

    pub fn remove_operation(&self, id: &str) -> Result<(), String> {
        let ops = self
            .list_pending_operations()?
            .into_iter()
            .filter(|op| op.id != id)
            .collect::<Vec<_>>();
        self.write_pending_operations(&ops)
    }

    fn write_pending_operations(&self, ops: &[PendingOperation]) -> Result<(), String> {
        let mut body = String::new();
        for op in ops {
            body.push_str(&serde_json::to_string(op).map_err(|e| e.to_string())?);
            body.push('\n');
        }
        self.write_atomic(PENDING_OPS_FILE, body.as_bytes())
    }

    // ---- tombstones -----------------------------------------------------

    pub fn record_tombstone(&self, tombstone: &Tombstone) -> Result<(), String> {
        let mut tombstones = self.list_tombstones()?;
        tombstones.retain(|existing| existing.file_id != tombstone.file_id);
        tombstones.push(tombstone.clone());
        self.write_json(TOMBSTONES_FILE, &tombstones)
    }

    pub fn list_tombstones(&self) -> Result<Vec<Tombstone>, String> {
        Ok(self.read_json(TOMBSTONES_FILE)?.unwrap_or_default())
    }

    pub fn remove_tombstone(&self, file_id: &str) -> Result<(), String> {
        let tombstones = self
            .list_tombstones()?
            .into_iter()
            .filter(|tombstone| tombstone.file_id != file_id)
            .collect::<Vec<_>>();
        self.write_json(TOMBSTONES_FILE, &tombstones)
    }

    // ---- content cache --------------------------------------------------

    pub fn cache_document(&self, file_id: &str, content: &str) -> Result<(), String> {
        let path = self.root.join(DOCUMENTS_DIR).join(safe_segment(file_id)?);
        write_file_atomic(&path, content.as_bytes())
    }

    pub fn read_cached_document(&self, file_id: &str) -> Result<Option<String>, String> {
        let path = self.root.join(DOCUMENTS_DIR).join(safe_segment(file_id)?);
        match std::fs::read_to_string(&path) {
            Ok(content) => Ok(Some(content)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }

    pub fn cache_asset(&self, file_id: &str, bytes: &[u8]) -> Result<(), String> {
        let path = self.root.join(ASSETS_DIR).join(safe_segment(file_id)?);
        write_file_atomic(&path, bytes)
    }

    pub fn read_cached_asset(&self, file_id: &str) -> Result<Option<Vec<u8>>, String> {
        let path = self.root.join(ASSETS_DIR).join(safe_segment(file_id)?);
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }

    /// Persist the encoded CRDT (Yjs) document state for a file. This is the
    /// latest compacted state the client holds locally; a later increment uses
    /// it to resume synchronization via state vectors after reconnecting.
    pub fn cache_crdt_state(&self, file_id: &str, bytes: &[u8]) -> Result<(), String> {
        let path = self.crdt_path(file_id)?;
        write_file_atomic(&path, bytes)
    }

    pub fn read_cached_crdt_state(&self, file_id: &str) -> Result<Option<Vec<u8>>, String> {
        let path = self.crdt_path(file_id)?;
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }

    /// Drop the cached CRDT state for a file so the next live session reseeds it
    /// from the server. Used when a structured-document seed is rejected as
    /// degenerate (e.g. it would lose nodes), so a corrupt cache cannot persist.
    /// A missing file is treated as success.
    pub fn clear_cached_crdt_state(&self, file_id: &str) -> Result<(), String> {
        let path = self.crdt_path(file_id)?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    }

    fn crdt_path(&self, file_id: &str) -> Result<PathBuf, String> {
        Ok(self
            .root
            .join(CRDT_DIR)
            .join(format!("{}.bin", safe_segment(file_id)?)))
    }

    // ---- integrity ------------------------------------------------------

    /// Recompute checksums for every tracked JSON/JSONL file and report any whose
    /// on-disk contents no longer match the recorded checksum (or are missing).
    pub fn verify(&self) -> Result<ReplicaIntegrityReport, String> {
        let recorded = self.read_integrity()?;
        let mut corrupt = Vec::new();
        for (name, expected) in recorded.iter() {
            match std::fs::read(self.root.join(name)) {
                Ok(bytes) => {
                    if &sha256_hex(&bytes) != expected {
                        corrupt.push(name.clone());
                    }
                }
                Err(_) => corrupt.push(name.clone()),
            }
        }
        Ok(ReplicaIntegrityReport {
            ok: corrupt.is_empty(),
            corrupt_files: corrupt,
        })
    }

    /// Drop tracked JSON/JSONL files that fail verification so they are reseeded
    /// on the next sync. The cached document/asset content is intentionally
    /// preserved. Returns the post-rebuild integrity report.
    pub fn rebuild(&self) -> Result<ReplicaIntegrityReport, String> {
        let report = self.verify()?;
        if report.ok {
            return Ok(report);
        }
        let mut integrity = self.read_integrity()?;
        for name in &report.corrupt_files {
            let path = self.root.join(name);
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
            integrity.remove(name);
        }
        self.write_integrity(&integrity)?;
        self.verify()
    }

    // ---- bounded cache cleanup -----------------------------------------

    /// Evict cached document/asset/CRDT content to keep the replica bounded.
    ///
    /// Two passes run in order, and both protect any file referenced by a pending
    /// operation (whose cached bytes are the only local copy of unsynced data):
    ///
    /// 1. **Orphan eviction** drops cached content whose file id is neither active
    ///    in the cached manifest nor protected (e.g. trashed/removed files).
    /// 2. **Budget eviction** removes the least-recently-modified non-protected
    ///    entries until the remaining cached bytes fit within `budget_bytes`.
    ///
    /// Stray atomic-write temp files are always removed. Cached content is
    /// re-fetchable from the server, so eviction is safe; protected (unsynced)
    /// content is never removed even if that leaves the cache above budget.
    pub fn cleanup(&self, budget_bytes: u64) -> Result<CacheCleanupReport, String> {
        let mut removed_files = 0u64;
        let mut freed_bytes = 0u64;

        // Always sweep stray `*.tmp` files left behind by an interrupted atomic
        // write before accounting for the real cache.
        for (path, size) in self.collect_stray_tmp_files()? {
            if std::fs::remove_file(&path).is_ok() {
                removed_files += 1;
                freed_bytes += size;
            }
        }

        let protected = self.protected_file_ids()?;
        let active = match self.read_manifest()? {
            Some(manifest) => manifest
                .files
                .iter()
                .filter(|file| file.state == collab_protocol::HostedFileState::Active)
                .map(|file| file.id.clone())
                .collect::<std::collections::HashSet<_>>(),
            None => std::collections::HashSet::new(),
        };

        let mut entries = self.collect_cache_entries(&protected)?;

        // Orphan pass: keep protected and active entries; remove the rest.
        entries.retain(|entry| {
            if entry.protected || active.contains(&entry.id) {
                return true;
            }
            if std::fs::remove_file(&entry.path).is_ok() {
                removed_files += 1;
                freed_bytes += entry.size;
            }
            false
        });

        // Budget pass: evict the oldest non-protected entries until under budget.
        let mut remaining_bytes: u64 = entries.iter().map(|entry| entry.size).sum();
        if remaining_bytes > budget_bytes {
            let mut evictable = entries
                .iter()
                .filter(|entry| !entry.protected)
                .collect::<Vec<_>>();
            evictable.sort_by_key(|entry| entry.modified);
            for entry in evictable {
                if remaining_bytes <= budget_bytes {
                    break;
                }
                if std::fs::remove_file(&entry.path).is_ok() {
                    removed_files += 1;
                    freed_bytes += entry.size;
                    remaining_bytes = remaining_bytes.saturating_sub(entry.size);
                }
            }
        }

        Ok(CacheCleanupReport {
            removed_files,
            freed_bytes,
            remaining_bytes,
        })
    }

    /// File ids whose cached content holds the only local copy of unsynced data
    /// (anything a pending operation references) and must never be evicted.
    fn protected_file_ids(&self) -> Result<std::collections::HashSet<String>, String> {
        let mut ids = std::collections::HashSet::new();
        for op in self.list_pending_operations()? {
            if let Some(id) = op.file_id {
                ids.insert(id);
            }
            if let Some(object) = op.payload.as_object() {
                for key in ["tempFileId", "assetCacheId", "targetFileId"] {
                    if let Some(value) = object.get(key).and_then(|value| value.as_str()) {
                        ids.insert(value.to_string());
                    }
                }
            }
        }
        Ok(ids)
    }

    /// Enumerate the cached content files across the document/asset/CRDT dirs.
    fn collect_cache_entries(
        &self,
        protected: &std::collections::HashSet<String>,
    ) -> Result<Vec<CacheEntry>, String> {
        let mut entries = Vec::new();
        for (dir, strip_bin) in [
            (DOCUMENTS_DIR, false),
            (ASSETS_DIR, false),
            (CRDT_DIR, true),
        ] {
            let read = match std::fs::read_dir(self.root.join(dir)) {
                Ok(read) => read,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => return Err(err.to_string()),
            };
            for entry in read {
                let entry = entry.map_err(|e| e.to_string())?;
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                if !metadata.is_file() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".tmp") {
                    continue; // handled by the stray-tmp sweep
                }
                let id = if strip_bin {
                    name.strip_suffix(".bin").unwrap_or(&name).to_string()
                } else {
                    name
                };
                entries.push(CacheEntry {
                    protected: protected.contains(&id),
                    id,
                    path: entry.path(),
                    size: metadata.len(),
                    modified: metadata
                        .modified()
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
                });
            }
        }
        Ok(entries)
    }

    /// Stray `*.tmp` files left in the cache dirs by an interrupted atomic write.
    fn collect_stray_tmp_files(&self) -> Result<Vec<(PathBuf, u64)>, String> {
        let mut stray = Vec::new();
        for dir in [DOCUMENTS_DIR, ASSETS_DIR, CRDT_DIR] {
            let read = match std::fs::read_dir(self.root.join(dir)) {
                Ok(read) => read,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => return Err(err.to_string()),
            };
            for entry in read {
                let entry = entry.map_err(|e| e.to_string())?;
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                if metadata.is_file() && entry.file_name().to_string_lossy().ends_with(".tmp") {
                    stray.push((entry.path(), metadata.len()));
                }
            }
        }
        Ok(stray)
    }

    /// Permanently remove the entire replica directory. Used when access is
    /// revoked or the vault is deleted on the server.
    pub fn delete(self) -> Result<(), String> {
        if self.root.exists() {
            std::fs::remove_dir_all(&self.root).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // ---- low-level helpers ---------------------------------------------

    fn read_json<T: DeserializeOwned>(&self, name: &str) -> Result<Option<T>, String> {
        let path = self.root.join(name);
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.to_string()),
        };
        serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string())
    }

    fn write_json<T: Serialize>(&self, name: &str, value: &T) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
        self.write_atomic(name, &bytes)
    }

    /// Atomically write a tracked file and update its recorded checksum.
    fn write_atomic(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        write_file_atomic(&self.root.join(name), bytes)?;
        let mut integrity = self.read_integrity()?;
        integrity.insert(name.to_string(), sha256_hex(bytes));
        self.write_integrity(&integrity)
    }

    fn read_integrity(&self) -> Result<BTreeMap<String, String>, String> {
        Ok(self.read_json(INTEGRITY_FILE)?.unwrap_or_default())
    }

    fn write_integrity(&self, integrity: &BTreeMap<String, String>) -> Result<(), String> {
        // The integrity map itself is not tracked (it cannot checksum itself).
        let bytes = serde_json::to_vec_pretty(integrity).map_err(|e| e.to_string())?;
        write_file_atomic(&self.root.join(INTEGRITY_FILE), &bytes)
    }
}

/// Write `bytes` to `path` via a temp file + rename so readers never observe a
/// partially written file.
fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!(
        "{}tmp",
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{ext}."))
            .unwrap_or_default()
    ));
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replica::models::{PendingOpKind, SyncStatus};
    use collab_protocol::HostedVaultManifest;
    use serde_json::json;
    use tempfile::TempDir;

    fn manifest(seq: i64) -> HostedVaultManifest {
        HostedVaultManifest {
            vault_id: "vault-1".into(),
            sequence: seq,
            files: Vec::new(),
        }
    }

    fn pending_op(id: &str) -> PendingOperation {
        PendingOperation {
            id: id.into(),
            kind: PendingOpKind::Edit,
            file_id: Some("file-1".into()),
            relative_path: Some("Notes/a.md".into()),
            payload: json!({ "content": "hi" }),
            base_manifest_sequence: 1,
            created_at: "2026-06-17T00:00:00Z".into(),
            status: PendingOpStatus::Pending,
            failure_code: None,
            failure_message: None,
        }
    }

    fn pending_op_for(id: &str, file_id: &str) -> PendingOperation {
        PendingOperation {
            id: id.into(),
            kind: PendingOpKind::Edit,
            file_id: Some(file_id.into()),
            relative_path: Some("Notes/a.md".into()),
            payload: json!({ "content": "hi" }),
            base_manifest_sequence: 1,
            created_at: "2026-06-18T00:00:00Z".into(),
            status: PendingOpStatus::Pending,
            failure_code: None,
            failure_message: None,
        }
    }

    fn open(dir: &TempDir) -> ReplicaStore {
        ReplicaStore::open_or_create(dir.path(), "https://example.test/", "vault-1", "Vault One")
            .unwrap()
    }

    #[test]
    fn open_or_create_round_trips_meta_manifest_and_sync_state() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);

        assert_eq!(
            store.read_sync_state().unwrap(),
            ReplicaSyncState::default()
        );
        assert!(store.read_manifest().unwrap().is_none());

        store.write_manifest(&manifest(7)).unwrap();
        store
            .write_sync_state(&ReplicaSyncState {
                manifest_sequence: 7,
                last_synced_at: Some("2026-06-17T00:00:00Z".into()),
                status: SyncStatus::Offline,
            })
            .unwrap();

        assert_eq!(store.read_manifest().unwrap().unwrap().sequence, 7);
        let state = store.read_sync_state().unwrap();
        assert_eq!(state.manifest_sequence, 7);
        assert_eq!(state.status, SyncStatus::Offline);
    }

    #[test]
    fn open_or_create_preserves_created_at_and_reopen_finds_existing() {
        let dir = TempDir::new().unwrap();
        let first = open(&dir);
        let created = first
            .read_json::<ReplicaMeta>(META_FILE)
            .unwrap()
            .unwrap()
            .created_at;

        let second = open(&dir);
        let reopened = second.read_json::<ReplicaMeta>(META_FILE).unwrap().unwrap();
        assert_eq!(reopened.created_at, created);

        assert!(
            ReplicaStore::open_existing(dir.path(), "https://example.test", "vault-1").is_some()
        );
        assert!(ReplicaStore::open_existing(dir.path(), "https://other.test", "vault-1").is_none());
    }

    #[test]
    fn pending_operations_enqueue_list_update_and_remove_in_order() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        assert!(store.list_pending_operations().unwrap().is_empty());

        store.enqueue_operation(&pending_op("a")).unwrap();
        store.enqueue_operation(&pending_op("b")).unwrap();
        let ops = store.list_pending_operations().unwrap();
        assert_eq!(
            ops.iter().map(|op| op.id.as_str()).collect::<Vec<_>>(),
            ["a", "b"]
        );

        store
            .update_operation_status("a", PendingOpStatus::InFlight)
            .unwrap();
        let ops = store.list_pending_operations().unwrap();
        assert_eq!(ops[0].status, PendingOpStatus::InFlight);
        assert_eq!(ops[1].status, PendingOpStatus::Pending);

        store
            .record_operation_failure("a", "manifest_conflict", "The vault manifest changed.")
            .unwrap();
        let ops = store.list_pending_operations().unwrap();
        assert_eq!(ops[0].status, PendingOpStatus::Failed);
        assert_eq!(ops[0].failure_code.as_deref(), Some("manifest_conflict"));
        assert_eq!(
            ops[0].failure_message.as_deref(),
            Some("The vault manifest changed.")
        );

        store.remove_operation("a").unwrap();
        let ops = store.list_pending_operations().unwrap();
        assert_eq!(
            ops.iter().map(|op| op.id.as_str()).collect::<Vec<_>>(),
            ["b"]
        );

        assert!(store
            .update_operation_status("missing", PendingOpStatus::Failed)
            .is_err());
    }

    #[test]
    fn tombstones_dedupe_by_file_id_and_remove() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        store
            .record_tombstone(&Tombstone {
                file_id: "f1".into(),
                relative_path: "old.md".into(),
                deleted_at: "t0".into(),
            })
            .unwrap();
        store
            .record_tombstone(&Tombstone {
                file_id: "f1".into(),
                relative_path: "new.md".into(),
                deleted_at: "t1".into(),
            })
            .unwrap();
        let tombstones = store.list_tombstones().unwrap();
        assert_eq!(tombstones.len(), 1);
        assert_eq!(tombstones[0].relative_path, "new.md");

        store.remove_tombstone("f1").unwrap();
        assert!(store.list_tombstones().unwrap().is_empty());
    }

    #[test]
    fn document_and_asset_cache_round_trip() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        assert!(store.read_cached_document("file-1").unwrap().is_none());
        store.cache_document("file-1", "# Hello").unwrap();
        assert_eq!(
            store.read_cached_document("file-1").unwrap().unwrap(),
            "# Hello"
        );

        store.cache_asset("asset-1", &[1, 2, 3]).unwrap();
        assert_eq!(
            store.read_cached_asset("asset-1").unwrap().unwrap(),
            vec![1, 2, 3]
        );

        assert!(store.cache_document("../escape", "x").is_err());
    }

    #[test]
    fn crdt_state_cache_round_trips() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        assert!(store.read_cached_crdt_state("file-1").unwrap().is_none());
        store
            .cache_crdt_state("file-1", &[9, 8, 7, 0, 255])
            .unwrap();
        assert_eq!(
            store.read_cached_crdt_state("file-1").unwrap().unwrap(),
            vec![9, 8, 7, 0, 255]
        );
        assert!(store.cache_crdt_state("../escape", &[1]).is_err());
    }

    #[test]
    fn clear_cached_crdt_state_removes_and_tolerates_missing() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        store.cache_crdt_state("file-1", &[1, 2, 3]).unwrap();
        store.clear_cached_crdt_state("file-1").unwrap();
        assert!(store.read_cached_crdt_state("file-1").unwrap().is_none());
        // Clearing an already-absent file is a no-op success.
        store.clear_cached_crdt_state("file-1").unwrap();
    }

    #[test]
    fn verify_detects_corruption_and_rebuild_recovers() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        store.write_manifest(&manifest(3)).unwrap();
        assert!(store.verify().unwrap().ok);

        // Corrupt the manifest on disk behind the store's back.
        std::fs::write(store.root().join(MANIFEST_FILE), b"{ not valid json").unwrap();
        let report = store.verify().unwrap();
        assert!(!report.ok);
        assert!(report.corrupt_files.contains(&MANIFEST_FILE.to_string()));

        let rebuilt = store.rebuild().unwrap();
        assert!(rebuilt.ok);
        // The corrupt manifest is dropped so it reseeds; the cache is untouched.
        assert!(store.read_manifest().unwrap().is_none());
    }

    fn manifest_with_active(ids: &[&str]) -> HostedVaultManifest {
        use collab_protocol::{HostedFileEntry, HostedFileKind, HostedFileState};
        HostedVaultManifest {
            vault_id: "vault-1".into(),
            sequence: 1,
            files: ids
                .iter()
                .map(|id| HostedFileEntry {
                    id: (*id).into(),
                    parent_id: None,
                    name: format!("{id}.md"),
                    relative_path: format!("{id}.md"),
                    kind: HostedFileKind::Document,
                    document_type: None,
                    state: HostedFileState::Active,
                    current_revision: None,
                    trashed_by_display_name: None,
                    trashed_at: None,
                    created_at: "t".into(),
                    updated_at: "t".into(),
                })
                .collect(),
        }
    }

    #[test]
    fn cleanup_evicts_orphans_but_keeps_active_and_pending_referenced_content() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        // active-1 is active in the manifest; orphan-1 is not; pending-1 is
        // referenced by a queued operation (its bytes are the only local copy).
        store
            .write_manifest(&manifest_with_active(&["active-1"]))
            .unwrap();
        store.cache_document("active-1", "keep").unwrap();
        store.cache_document("orphan-1", "drop").unwrap();
        store.cache_document("pending-1", "queued edit").unwrap();
        store
            .enqueue_operation(&pending_op_for("op-1", "pending-1"))
            .unwrap();

        let report = store.cleanup(u64::MAX).unwrap();

        assert_eq!(report.removed_files, 1);
        assert!(store.read_cached_document("active-1").unwrap().is_some());
        assert!(store.read_cached_document("pending-1").unwrap().is_some());
        assert!(store.read_cached_document("orphan-1").unwrap().is_none());
    }

    #[test]
    fn cleanup_enforces_budget_by_evicting_oldest_but_never_pending() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        store
            .write_manifest(&manifest_with_active(&["old", "new", "pending"]))
            .unwrap();
        // Each document is 100 bytes; budget allows ~one file.
        store.cache_document("old", &"a".repeat(100)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        store.cache_document("new", &"b".repeat(100)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        store.cache_document("pending", &"c".repeat(100)).unwrap();
        store
            .enqueue_operation(&pending_op_for("op-1", "pending"))
            .unwrap();

        // Budget of 250 bytes (3×100 = 300 cached): evict the single oldest
        // non-protected entry ("old"); "pending" is protected and never evicted.
        let report = store.cleanup(250).unwrap();

        assert_eq!(report.removed_files, 1);
        assert!(store.read_cached_document("pending").unwrap().is_some());
        assert!(store.read_cached_document("old").unwrap().is_none());
        assert!(store.read_cached_document("new").unwrap().is_some());
        assert_eq!(report.remaining_bytes, 200);
    }

    #[test]
    fn cleanup_removes_stray_temp_files() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        std::fs::write(store.root().join(DOCUMENTS_DIR).join("ghost.tmp"), b"junk").unwrap();
        let report = store.cleanup(u64::MAX).unwrap();
        assert_eq!(report.removed_files, 1);
        assert!(!store.root().join(DOCUMENTS_DIR).join("ghost.tmp").exists());
    }

    #[test]
    fn delete_removes_the_replica_directory() {
        let dir = TempDir::new().unwrap();
        let store = open(&dir);
        let root = store.root().to_path_buf();
        assert!(root.exists());
        store.delete().unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn server_key_is_stable_across_trailing_slash() {
        assert_eq!(server_key("https://a.test"), server_key("https://a.test/"));
        assert_ne!(server_key("https://a.test"), server_key("https://b.test"));
    }
}
