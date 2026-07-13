use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAppDataProbe {
    pub value: String,
    pub previous_value: Option<String>,
    pub file_path: String,
}

#[tauri::command]
pub async fn mobile_app_data_probe(
    app: tauri::AppHandle,
    value: String,
) -> Result<MobileAppDataProbe, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not resolve the app data directory.".to_string())?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|_| "Could not create the app data directory.".to_string())?;
    let path = dir.join("mobile-phase0-probe.txt");
    let previous_value = tokio::fs::read_to_string(&path).await.ok();
    tokio::fs::write(&path, value.as_bytes())
        .await
        .map_err(|_| "Could not write the app data probe.".to_string())?;
    let restored = tokio::fs::read_to_string(&path)
        .await
        .map_err(|_| "Could not read the app data probe.".to_string())?;
    Ok(MobileAppDataProbe {
        value: restored,
        previous_value,
        file_path: path.display().to_string(),
    })
}

#[tauri::command]
pub fn mobile_exit_app(app: tauri::AppHandle) {
    app.exit(0);
}
