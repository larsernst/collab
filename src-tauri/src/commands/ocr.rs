use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use super::app_config_dir;

const MAX_LANGUAGE_PACK_BYTES: usize = 80 * 1024 * 1024;
const OFFICIAL_FAST_BASE_URL: &str = "https://github.com/tesseract-ocr/tessdata_fast/raw/main";

#[derive(Clone, Copy)]
struct OcrLanguageDefinition {
    code: &'static str,
    label: &'static str,
}

const OCR_LANGUAGES: &[OcrLanguageDefinition] = &[
    OcrLanguageDefinition { code: "eng", label: "English" },
    OcrLanguageDefinition { code: "deu", label: "German" },
    OcrLanguageDefinition { code: "fra", label: "French" },
    OcrLanguageDefinition { code: "spa", label: "Spanish" },
    OcrLanguageDefinition { code: "ita", label: "Italian" },
    OcrLanguageDefinition { code: "por", label: "Portuguese" },
    OcrLanguageDefinition { code: "nld", label: "Dutch" },
    OcrLanguageDefinition { code: "pol", label: "Polish" },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLanguagePack {
    code: String,
    label: String,
    bundled: bool,
    installed: bool,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    installed_at: Option<String>,
    source_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLanguagePackData {
    code: String,
    data_base64: String,
}

fn language_definition(code: &str) -> Option<OcrLanguageDefinition> {
    OCR_LANGUAGES.iter().copied().find(|language| language.code == code)
}

fn official_fast_url(code: &str) -> String {
    format!("{OFFICIAL_FAST_BASE_URL}/{code}.traineddata")
}

fn language_pack_dir() -> Result<PathBuf, String> {
    let dir = app_config_dir()?.join("ocr").join("languages").join("official-fast");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create OCR language directory: {e}"))?;
    Ok(dir)
}

fn language_pack_path(code: &str) -> Result<PathBuf, String> {
    Ok(language_pack_dir()?.join(format!("{code}.traineddata")))
}

fn metadata_path(code: &str) -> Result<PathBuf, String> {
    Ok(language_pack_dir()?.join(format!("{code}.json")))
}

fn file_sha256(path: &PathBuf) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read OCR language pack: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(hex::encode(hasher.finalize()))
}

fn installed_metadata(code: &str) -> (Option<u64>, Option<String>, Option<String>) {
    let Ok(path) = language_pack_path(code) else {
        return (None, None, None);
    };
    if !path.exists() {
        return (None, None, None);
    }
    let size_bytes = std::fs::metadata(&path).ok().map(|metadata| metadata.len());
    let sha256 = file_sha256(&path).ok();
    let installed_at = metadata_path(code)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("installedAt").and_then(|value| value.as_str()).map(str::to_string));
    (size_bytes, sha256, installed_at)
}

fn pack_info(language: OcrLanguageDefinition) -> OcrLanguagePack {
    let bundled = language.code == "eng";
    let path_exists = language_pack_path(language.code)
        .map(|path| path.exists())
        .unwrap_or(false);
    let installed = bundled || path_exists;
    let (size_bytes, sha256, installed_at) = if path_exists {
        installed_metadata(language.code)
    } else {
        (None, None, None)
    };

    OcrLanguagePack {
        code: language.code.to_string(),
        label: language.label.to_string(),
        bundled,
        installed,
        size_bytes,
        sha256,
        installed_at,
        source_url: official_fast_url(language.code),
    }
}

#[tauri::command]
pub fn list_ocr_language_packs() -> Result<Vec<OcrLanguagePack>, String> {
    Ok(OCR_LANGUAGES.iter().copied().map(pack_info).collect())
}

#[tauri::command]
pub async fn install_ocr_language_pack(code: String) -> Result<OcrLanguagePack, String> {
    let language = language_definition(&code).ok_or_else(|| "Unsupported OCR language pack".to_string())?;
    if language.code == "eng" {
        return Ok(pack_info(language));
    }

    let source_url = official_fast_url(language.code);
    let response = reqwest::Client::new()
        .get(&source_url)
        .header(reqwest::header::USER_AGENT, "collab-ocr-language-manager")
        .send()
        .await
        .map_err(|e| format!("Failed to download OCR language pack: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Failed to download OCR language pack: HTTP {}", response.status()));
    }

    if let Some(length) = response.content_length() {
        if length > MAX_LANGUAGE_PACK_BYTES as u64 {
            return Err("OCR language pack is too large".to_string());
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read OCR language pack download: {e}"))?;
    if bytes.len() < 1024 {
        return Err("Downloaded OCR language pack was unexpectedly small".to_string());
    }
    if bytes.len() > MAX_LANGUAGE_PACK_BYTES {
        return Err("OCR language pack is too large".to_string());
    }

    let pack_path = language_pack_path(language.code)?;
    let temp_path = pack_path.with_extension("traineddata.part");
    std::fs::write(&temp_path, &bytes).map_err(|e| format!("Failed to write OCR language pack: {e}"))?;
    std::fs::rename(&temp_path, &pack_path).map_err(|e| format!("Failed to install OCR language pack: {e}"))?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let metadata = serde_json::json!({
        "code": language.code,
        "source": "official-fast",
        "sourceUrl": source_url,
        "sizeBytes": bytes.len(),
        "sha256": hex::encode(hasher.finalize()),
        "installedAt": Utc::now().to_rfc3339(),
    });
    std::fs::write(
        metadata_path(language.code)?,
        serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write OCR language metadata: {e}"))?;

    Ok(pack_info(language))
}

#[tauri::command]
pub fn remove_ocr_language_pack(code: String) -> Result<OcrLanguagePack, String> {
    let language = language_definition(&code).ok_or_else(|| "Unsupported OCR language pack".to_string())?;
    if language.code == "eng" {
        return Err("The bundled English OCR language pack cannot be removed".to_string());
    }

    let pack_path = language_pack_path(language.code)?;
    if pack_path.exists() {
        std::fs::remove_file(&pack_path).map_err(|e| format!("Failed to remove OCR language pack: {e}"))?;
    }
    let metadata = metadata_path(language.code)?;
    if metadata.exists() {
        std::fs::remove_file(metadata).map_err(|e| format!("Failed to remove OCR language metadata: {e}"))?;
    }

    Ok(pack_info(language))
}

#[tauri::command]
pub fn read_ocr_language_pack_data(code: String) -> Result<OcrLanguagePackData, String> {
    let language = language_definition(&code).ok_or_else(|| "Unsupported OCR language pack".to_string())?;
    if language.code == "eng" {
        return Err("Bundled OCR language packs are loaded from application assets".to_string());
    }

    let pack_path = language_pack_path(language.code)?;
    if !pack_path.exists() {
        return Err("OCR language pack is not installed".to_string());
    }

    let bytes = std::fs::read(&pack_path).map_err(|e| format!("Failed to read OCR language pack: {e}"))?;
    if bytes.len() > MAX_LANGUAGE_PACK_BYTES {
        return Err("OCR language pack is too large".to_string());
    }

    Ok(OcrLanguagePackData {
        code: language.code.to_string(),
        data_base64: STANDARD.encode(bytes),
    })
}

fn decode_image_data_url(data_url: &str) -> Result<(Vec<u8>, &'static str), String> {
    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "OCR input is not a valid data URL.".to_string())?;
    if !header.starts_with("data:image/") || !header.ends_with(";base64") {
        return Err("OCR input must be a base64 image data URL.".to_string());
    }

    let extension = if header.starts_with("data:image/png") {
        "png"
    } else if header.starts_with("data:image/jpeg") || header.starts_with("data:image/jpg") {
        "jpg"
    } else if header.starts_with("data:image/webp") {
        "webp"
    } else {
        return Err("OCR supports PNG, JPEG, and WebP images.".to_string());
    };

    let bytes = STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| "OCR input image is not valid base64.".to_string())?;
    if bytes.is_empty() {
        return Err("OCR input image is empty.".to_string());
    }
    Ok((bytes, extension))
}

fn normalize_ocr_language(language: Option<String>) -> Result<String, String> {
    let language = language.unwrap_or_else(|| "eng".to_string());
    let codes: Vec<&str> = language.split('+').collect();
    if codes.is_empty() || codes.iter().any(|code| language_definition(code).is_none()) {
        return Err("Unsupported OCR language".to_string());
    }
    Ok(codes.join("+"))
}

#[tauri::command]
pub async fn recognize_image_data_url(data_url: String, language: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, extension) = decode_image_data_url(&data_url)?;
        let language = normalize_ocr_language(language)?;
        let mut input = tempfile::Builder::new()
            .prefix("collab-ocr-")
            .suffix(&format!(".{extension}"))
            .tempfile()
            .map_err(|e| format!("Failed to prepare OCR image: {e}"))?;
        input
            .write_all(&bytes)
            .map_err(|e| format!("Failed to write OCR image: {e}"))?;
        input
            .flush()
            .map_err(|e| format!("Failed to flush OCR image: {e}"))?;

        let mut command = Command::new("tesseract");
        command
            .arg(input.path())
            .arg("stdout")
            .arg("-l")
            .arg(&language);
        if !language.split('+').any(|code| code == "eng") {
            command.env("TESSDATA_PREFIX", language_pack_dir()?);
        }

        let output = command
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "OCR requires the tesseract command to be installed.".to_string()
                } else {
                    format!("Failed to start OCR: {e}")
                }
            })?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                "OCR failed.".to_string()
            } else {
                format!("OCR failed: {detail}")
            });
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
    .await
    .map_err(|e| format!("OCR task failed: {e}"))?
}
