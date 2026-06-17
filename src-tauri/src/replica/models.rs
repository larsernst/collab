//! Typed persistence models for the native hosted-vault replica store.
//!
//! These mirror the camelCase DTO shapes used elsewhere for hosted vaults so
//! they round-trip cleanly to and from the frontend. The replica holds vault
//! *content* only — never access or refresh tokens.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Schema version for the on-disk replica layout. Bump when the layout changes
/// in a way that requires migration or a rebuild.
pub const REPLICA_SCHEMA_VERSION: u32 = 1;

/// Identifying metadata for a single hosted-vault replica.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaMeta {
    pub server_url: String,
    pub vault_id: String,
    pub vault_name: String,
    pub schema_version: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// The coarse synchronization status of a replica relative to the server.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncStatus {
    Idle,
    Syncing,
    Offline,
    Error,
}

impl Default for SyncStatus {
    fn default() -> Self {
        SyncStatus::Idle
    }
}

/// Tracks how far the replica has synchronized with the server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaSyncState {
    /// The server manifest sequence the replica last observed.
    pub manifest_sequence: i64,
    /// ISO-8601 timestamp of the last successful synchronization, if any.
    pub last_synced_at: Option<String>,
    pub status: SyncStatus,
}

impl Default for ReplicaSyncState {
    fn default() -> Self {
        Self {
            manifest_sequence: 0,
            last_synced_at: None,
            status: SyncStatus::Idle,
        }
    }
}

/// The kind of structural or content mutation a pending operation represents.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PendingOpKind {
    Create,
    Edit,
    Rename,
    Move,
    Trash,
    Restore,
    Delete,
    AssetUpload,
}

/// The lifecycle state of a pending operation in the replay queue.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PendingOpStatus {
    Pending,
    InFlight,
    Failed,
}

/// A locally-recorded mutation that has not yet been confirmed by the server.
/// The queue is append-only and replayed against the server on reconnect by a
/// later Phase 6 increment.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingOperation {
    pub id: String,
    pub kind: PendingOpKind,
    /// Stable hosted file id the operation targets, when known. Offline-created
    /// files may not yet have a server id, so this is optional.
    pub file_id: Option<String>,
    pub relative_path: Option<String>,
    /// Operation-specific payload (e.g. new content, destination path).
    pub payload: Value,
    /// The manifest sequence the operation was authored against, used for
    /// optimistic conflict detection during replay.
    pub base_manifest_sequence: i64,
    pub created_at: String,
    pub status: PendingOpStatus,
}

/// A locally-known deletion. Tombstones let the replica distinguish an item the
/// user deleted offline from one that simply never synced.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tombstone {
    pub file_id: String,
    pub relative_path: String,
    pub deleted_at: String,
}

/// The result of a replica integrity check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaIntegrityReport {
    pub ok: bool,
    /// Tracked JSON files whose contents no longer match their recorded checksum.
    pub corrupt_files: Vec<String>,
}
