//! Privacy controls: saving an export where the person chooses, and saying where the data lives.
//!
//! A file is only ever written to a path the person picks in the system's own "Save as" dialog, opened from
//! here on their click. The webview hands over the text and a suggested name; it never supplies a path, so a
//! page can't write anywhere by itself. Nothing is sent over the network.

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Keep a suggested file name to plain characters and a known extension: no folders, nothing surprising.
fn safe_name(name: &str, extension: &str) -> String {
    let stem: String = name
        .trim_end_matches(&format!(".{extension}")[..])
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .take(80)
        .collect();
    let stem = if stem.is_empty() { "zeraphdesk-export".to_string() } else { stem };
    format!("{stem}.{extension}")
}

fn allowed_extension(extension: &str) -> Result<&'static str, String> {
    match extension {
        "json" => Ok("json"),
        "csv" => Ok("csv"),
        _ => Err("That kind of file isn't one ZeraphDesk exports.".to_string()),
    }
}

/// Ask where to save, then write `contents` there. Returns the chosen path, or None if the person cancelled.
#[tauri::command]
pub async fn save_export(app: tauri::AppHandle, file_name: String, extension: String, contents: String) -> Result<Option<String>, String> {
    let ext = allowed_extension(&extension)?;
    let name = safe_name(&file_name, ext);
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        let picked = app
            .dialog()
            .file()
            .set_file_name(&name)
            .add_filter(if ext == "json" { "JSON file" } else { "CSV file" }, &[ext])
            .blocking_save_file();
        let Some(path) = picked else { return Ok(None) };
        let path = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, contents.as_bytes()).map_err(|e| format!("Couldn't save the file: {e}"))?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct DataInfo {
    /// The folder ZeraphDesk keeps its database in.
    pub folder: String,
    /// Size of the database on disk, including its write-ahead file, in bytes.
    pub bytes: u64,
}

/// Where the database lives and how big it is, so the person can find it, back it up, or judge what's stored.
#[tauri::command]
pub fn data_info(app: tauri::AppHandle) -> Result<DataInfo, String> {
    let folder = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let mut bytes = 0;
    for name in ["zeraph.db", "zeraph.db-wal", "zeraph.db-shm"] {
        if let Ok(meta) = std::fs::metadata(folder.join(name)) {
            bytes += meta.len();
        }
    }
    Ok(DataInfo { folder: folder.display().to_string(), bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_plain_name_and_adds_the_extension() {
        assert_eq!(safe_name("zeraphdesk-export-2026-09-26", "json"), "zeraphdesk-export-2026-09-26.json");
        assert_eq!(safe_name("notes.json", "json"), "notes.json");
    }

    #[test]
    fn folders_and_odd_characters_can_not_get_through() {
        assert_eq!(safe_name("../../Windows/evil", "csv"), "------Windows-evil.csv");
        assert_eq!(safe_name("a\\b:c*d?.csv", "csv"), "a-b-c-d-.csv");
        assert!(!safe_name("..\\x", "json").contains('\\'));
    }

    #[test]
    fn an_empty_name_gets_a_default() {
        assert_eq!(safe_name("", "csv"), "zeraphdesk-export.csv");
        assert_eq!(safe_name(".csv", "csv"), "zeraphdesk-export.csv");
    }

    #[test]
    fn a_very_long_name_is_cut() {
        assert!(safe_name(&"a".repeat(500), "json").len() <= 85);
    }

    #[test]
    fn only_known_file_kinds_are_written() {
        assert!(allowed_extension("json").is_ok());
        assert!(allowed_extension("csv").is_ok());
        assert!(allowed_extension("exe").is_err());
        assert!(allowed_extension("").is_err());
    }
}
