use crate::error::{AppError, AppResult};
use crate::state::DownloadState;
use tauri::path::BaseDirectory;
use tauri::{command, AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;

#[command]
pub async fn check_dependencies(
    app: AppHandle,
    state: State<'_, DownloadState>,
) -> AppResult<bool> {
    let _activity_guard = state
        .begin_tool_activity()
        .map_err(AppError::ExternalCommand)?;

    // 1. Check yt-dlp sidecar
    let yt_dlp_ok = match app.shell().sidecar("yt-dlp") {
        Ok(cmd) => cmd
            .env("PATH", crate::utils::get_enhanced_path(&app))
            .args(["--version"])
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false),
        Err(_) => false,
    };

    // 2. Check ffmpeg resource
    // On Windows, it's ffmpeg.exe. On others, likely ffmpeg.
    #[cfg(target_os = "windows")]
    let ffmpeg_bin = "bin/ffmpeg.exe";
    #[cfg(not(target_os = "windows"))]
    let ffmpeg_bin = "bin/ffmpeg";

    let ffmpeg_ok = app
        .path()
        .resolve(ffmpeg_bin, BaseDirectory::Resource)
        .map(|p| p.exists())
        .unwrap_or(false);

    // 3. Check required JS Runtime (Bun)
    #[cfg(target_os = "windows")]
    let bun_bin = "bin/bun.exe";
    #[cfg(not(target_os = "windows"))]
    let bun_bin = "bin/bun";

    let bun_ok = app
        .path()
        .resolve(bun_bin, BaseDirectory::Resource)
        .map(|p| p.exists())
        .unwrap_or(false);

    // If resource check fails (dev mode), try fallback logic
    let js_runtime_exists = if bun_ok {
        true
    } else {
        // Fallback check for dev mode
        let dev_candidates = vec!["src-tauri/bin", "bin", "../bin"];
        let mut found = false;
        for candidate in dev_candidates {
            if let Ok(abs_path) = std::fs::canonicalize(candidate) {
                #[cfg(target_os = "windows")]
                let check_bun = abs_path.join("bun.exe");
                #[cfg(not(target_os = "windows"))]
                let check_bun = abs_path.join("bun");

                if check_bun.exists() {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    // 4. Runtime Verification: execute Bun
    let enhanced_path = crate::utils::get_enhanced_path(&app);

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut bun_cmd = std::process::Command::new("bun");
    bun_cmd.env("PATH", &enhanced_path).arg("--version");
    #[cfg(target_os = "windows")]
    bun_cmd.creation_flags(CREATE_NO_WINDOW);

    let bun_run_ok = bun_cmd
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let js_runtime_run_ok = bun_run_ok;

    if !js_runtime_run_ok {
        println!(
            "[Warn] Bun was not found or failed to run via PATH lookup. Enhanced PATH: {}",
            enhanced_path
        );
    } else {
        println!("[Info] Bun runtime verification successful.");
    }

    Ok(yt_dlp_ok && ffmpeg_ok && js_runtime_exists && js_runtime_run_ok)
}
