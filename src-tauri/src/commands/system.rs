use crate::error::{AppError, AppResult};
use crate::state::DownloadState;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;

#[derive(serde::Serialize)]
pub struct BinariesInfo {
    pub ytdlp: String,
    pub ffmpeg: String,
    pub bun: String,
}

#[tauri::command]
pub async fn get_binaries_info(
    app: AppHandle,
    state: State<'_, DownloadState>,
) -> AppResult<BinariesInfo> {
    let _activity_guard = state
        .begin_tool_activity()
        .map_err(AppError::ExternalCommand)?;
    let ytdlp = get_ytdlp_version_internal(&app)
        .await
        .unwrap_or_else(|_| "Unknown".to_string());
    let ffmpeg = get_ffmpeg_version_internal(&app).unwrap_or_else(|_| "Unknown".to_string());
    let bun = get_bun_version_internal(&app).unwrap_or_else(|_| "Not Found".to_string());
    Ok(BinariesInfo { ytdlp, ffmpeg, bun })
}

fn get_bun_version_internal(app: &AppHandle) -> AppResult<String> {
    let path = crate::utils::get_binary_path(app, "bun")?;

    let cmd_name = if path.exists() {
        path.into_os_string()
    } else {
        "bun".into()
    };

    let mut cmd = Command::new(cmd_name);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;

    let out_str = String::from_utf8_lossy(&output.stdout);
    let version = out_str
        .lines()
        .next()
        .unwrap_or("Unknown")
        .trim()
        .to_string();

    Ok(version)
}

async fn get_ytdlp_version_internal(app: &AppHandle) -> AppResult<String> {
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| {
            crate::error::AppError::ExternalCommand(format!("Failed to create sidecar: {}", e))
        })?
        .env("PATH", crate::utils::get_enhanced_path(app))
        .args(["--version"])
        .output()
        .await
        .map_err(|e| {
            crate::error::AppError::ExternalCommand(format!("Failed to execute yt-dlp: {}", e))
        })?;

    if !output.status.success() {
        return Err(crate::error::AppError::ExternalCommand(
            "Non-zero exit code".into(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn get_ffmpeg_version_internal(app: &AppHandle) -> AppResult<String> {
    let path = crate::utils::get_binary_path(app, "ffmpeg")?;

    if !path.exists() {
        return Ok("Not Found".to_string());
    }

    let mut cmd = Command::new(path);
    cmd.arg("-version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;

    let out_str = String::from_utf8_lossy(&output.stdout);
    let first_line = out_str.lines().next().unwrap_or("Unknown");

    // Parse version from "ffmpeg version 8.0.1-..."
    let version = first_line
        .split_whitespace()
        .nth(2)
        .unwrap_or(first_line)
        .to_string();

    Ok(version)
}

#[tauri::command]
pub fn set_taskbar_progress(
    app: AppHandle,
    progress: Option<u64>,
    _total: Option<u64>,
    status: Option<String>,
) -> AppResult<bool> {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let pb_status = match status.as_deref() {
            Some("normal") => Some(ProgressBarStatus::Normal),
            Some("indeterminate") => Some(ProgressBarStatus::Indeterminate),
            Some("paused") => Some(ProgressBarStatus::Paused),
            Some("error") => Some(ProgressBarStatus::Error),
            Some("none") => Some(ProgressBarStatus::None),
            _ => None,
        };

        let state = ProgressBarState {
            progress,
            status: pb_status,
        };

        let _ = window.set_progress_bar(state);
    }
    Ok(true)
}
