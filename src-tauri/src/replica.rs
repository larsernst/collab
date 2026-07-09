//! Thin re-export of the shared `collab-replica` crate.
//!
//! The native hosted-vault replica store lives in `crates/collab-replica` so the
//! desktop and Android Tauri clients share one implementation. The Tauri command
//! wrappers in `commands/replica.rs` consume it through `crate::replica::…`, so
//! this alias keeps those call sites unchanged after the extraction.

pub use collab_replica::*;
