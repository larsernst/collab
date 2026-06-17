pub mod collab;
pub mod crypto;
pub mod files;
pub mod index;
pub mod replica;
pub mod server;
pub mod templates;
pub mod ui;
pub mod update;
pub mod vault;
pub mod watcher;
pub mod web;

use std::path::{Path, PathBuf};

/// The application configuration directory (`%APPDATA%/collab` on Windows,
/// `~/.config/collab` elsewhere). Used for app-scoped templates/snippets and the
/// native hosted-vault replica store. The directory is created if missing.
pub fn app_config_dir() -> Result<PathBuf, String> {
    let dir = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("collab")
    } else {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map_err(|_| "Cannot determine home directory".to_string())?;
        Path::new(&home).join(".config").join("collab")
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
