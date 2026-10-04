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
    let activity_guard = state
        .begin_tool_activity()
        .map_err(AppError::ExternalCommand)?;
    // Retain ownership inside the worker even if the IPC caller goes away.
    tokio::task::spawn_blocking(move || {
        let _activity_guard = activity_guard;
        let ytdlp = get_ytdlp_version_internal(&app).unwrap_or_else(|_| "Unknown".to_string());
        let ffmpeg = get_ffmpeg_version_internal(&app).unwrap_or_else(|_| "Unknown".to_string());
        let bun = get_bun_version_internal(&app).unwrap_or_else(|_| "Not Found".to_string());
        Ok(BinariesInfo { ytdlp, ffmpeg, bun })
    })
    .await
    .map_err(|error| AppError::ExternalCommand(error.to_string()))?
}

fn get_bun_version_internal(app: &AppHandle) -> AppResult<String> {
    let path = crate::utils::get_binary_path(app, "bun")?;
    get_bun_version_at_path(path)
}

fn get_bun_version_at_path(path: std::path::PathBuf) -> AppResult<String> {
    if !path.is_file() {
        return Err(AppError::ExternalCommand(
            "Bundled Bun executable is missing".into(),
        ));
    }

    let mut cmd = Command::new(path);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = super::maintenance_process::bounded_output(
        &mut cmd,
        super::maintenance_process::INSPECTION_TIMEOUT,
    )
    .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;

    if !output.status.success() || output.stdout.is_empty() {
        return Err(AppError::ExternalCommand(
            "Bun version detection failed".into(),
        ));
    }

    let out_str = String::from_utf8_lossy(&output.stdout);
    let version = out_str
        .lines()
        .next()
        .unwrap_or("Unknown")
        .trim()
        .to_string();

    Ok(version)
}

#[cfg(test)]
mod bundled_bun_tests {
    #[test]
    fn missing_bundled_bun_does_not_borrow_a_system_installation() {
        let directory = tempfile::tempdir().expect("fixture directory");
        let error = super::get_bun_version_at_path(directory.path().join("missing-bun.exe"))
            .expect_err("a missing bundled binary must be unavailable");
        assert!(error
            .to_string()
            .contains("Bundled Bun executable is missing"));
    }
}

fn get_ytdlp_version_internal(app: &AppHandle) -> AppResult<String> {
    let sidecar = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?
        .env("PATH", crate::utils::get_enhanced_path(app))
        .args(["--version"]);
    let mut command: Command = sidecar.into();
    let output = super::maintenance_process::bounded_output(
        &mut command,
        super::maintenance_process::INSPECTION_TIMEOUT,
    )?;

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

    let output = super::maintenance_process::bounded_output(
        &mut cmd,
        super::maintenance_process::INSPECTION_TIMEOUT,
    )
    .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;

    if !output.status.success() || output.stdout.is_empty() {
        return Err(AppError::ExternalCommand(
            "FFmpeg version detection failed".into(),
        ));
    }

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
