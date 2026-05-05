use crate::state::AppState;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

fn is_ignored_dir_name(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | "target" | "dist" | "dist-builds" | "build" | "flatpak-build" | "flatpak-repo"
    )
}

fn should_ignore_relative_path(relative: &str) -> bool {
    relative
        .split('/')
        .any(|segment| !segment.is_empty() && (segment.starts_with('.') || is_ignored_dir_name(segment)))
}

fn nearest_visible_relative_parent(relative: &str) -> Option<String> {
    let mut segments: Vec<&str> = relative.split('/').filter(|segment| !segment.is_empty()).collect();
    while !segments.is_empty() {
        segments.pop();
        if segments.is_empty() {
            break;
        }
        let candidate = segments.join("/");
        if !candidate.starts_with(".collab/") && !should_ignore_relative_path(&candidate) {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command]
pub fn watch_vault(
    vault_path: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    // Drop any existing watcher first
    {
        let mut watcher_lock = state.watcher.lock();
        *watcher_lock = None;
    }

    let app_handle = app.clone();
    let vault_path_clone = vault_path.clone();

    let mut debouncer =
        new_debouncer(
            Duration::from_millis(500),
            move |res: DebounceEventResult| {
                if let Ok(events) = res {
                    for event in events {
                        let path = &event.path;

                        // Get relative path string
                        let relative = path
                            .strip_prefix(&vault_path_clone)
                            .unwrap_or(path)
                            .to_string_lossy()
                            .replace('\\', "/");

                        if relative.starts_with(".collab/presence/") {
                            let _ = app_handle.emit("collab:presence-changed", serde_json::json!({}));
                            continue;
                        }

                        if relative == ".collab/chat/messages.json" {
                            let _ = app_handle.emit("collab:chat-updated", serde_json::json!({}));
                            continue;
                        }

                        if relative == ".collab/vault.json" {
                            let _ = app_handle.emit("collab:config-changed", serde_json::json!({}));
                            continue;
                        }

                        if should_ignore_relative_path(&relative) {
                            if let Some(parent) = nearest_visible_relative_parent(&relative) {
                                let payload = serde_json::json!({ "path": parent });
                                let _ = app_handle.emit("vault:file-modified", &payload);
                            }
                            continue;
                        }

                        // Skip all other .collab directory changes
                        if relative.starts_with(".collab/") {
                            continue;
                        }

                        let payload = serde_json::json!({ "path": relative });
                        let _ = app_handle.emit("vault:file-modified", &payload);
                    }
                }
            },
        )
        .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(Path::new(&vault_path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut watcher_lock = state.watcher.lock();
    *watcher_lock = Some(debouncer);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::nearest_visible_relative_parent;

    #[test]
    fn bubbles_hidden_temp_file_changes_to_visible_parent() {
        assert_eq!(
            nearest_visible_relative_parent("Docs/.goutputstream-ABC123"),
            Some("Docs".to_string())
        );
    }

    #[test]
    fn skips_hidden_root_items_without_visible_parent() {
        assert_eq!(nearest_visible_relative_parent(".hidden-file"), None);
    }

    #[test]
    fn bubbles_nested_hidden_temp_paths_to_nearest_visible_parent() {
        assert_eq!(
            nearest_visible_relative_parent("Docs/Sub/.tmp-upload/spec.pdf.part"),
            Some("Docs/Sub".to_string())
        );
    }
}

#[tauri::command]
pub fn unwatch_vault(state: State<AppState>) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock();
    *watcher_lock = None;
    Ok(())
}
