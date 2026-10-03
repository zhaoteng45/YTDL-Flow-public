pub mod commands;
pub mod error;
pub mod models;
pub mod notification;
mod release_smoke;
mod release_smoke_input;
#[cfg(windows)]
mod release_smoke_job;
pub mod services {
    pub mod capture;
    pub mod cookie_inspection;
    pub mod download;
    pub mod task_options;
    pub mod temp_cookie_cleanup;
    pub mod transfer_progress;
    pub mod youtube;
}
pub mod state;
pub mod utils;

use commands::bilibili::{
    get_bilibili_qrcode, get_bilibili_user_info, poll_bilibili_qrcode, save_bilibili_cookies,
};
use commands::browsers::{check_browser_and_pot, check_browser_cookies, get_installed_browsers};
use commands::capture::{
    capture_claim, capture_dispose, capture_list, capture_release, capture_revoke, capture_start,
    capture_stop,
};
use commands::dependencies::check_dependencies;
use commands::system::{get_binaries_info, set_taskbar_progress};
use commands::updates::{update_bun, update_ffmpeg, update_ytdlp};
use commands::{
    cancel_download, check_zombie_processes, get_app_version, get_video_metadata,
    inspect_tool_health, kill_zombies, open_file, open_file_location, start_download,
};
use services::capture::session::CaptureRuntime;
use state::DownloadState;
use tauri::Manager;

// Notification module imports
use notification::{
    get_notification_settings, init_notification_i18n, update_notification_settings,
    NotificationManager,
};

#[cfg(target_os = "windows")]
fn set_dpi_awareness() {
    use std::ffi::c_int;
    // PROCESS_PER_MONITOR_DPI_AWARE = 2 (PerMonitorV2)
    #[link(name = "user32")]
    extern "system" {
        fn SetProcessDpiAwarenessContext(value: isize) -> c_int;
    }
    unsafe {
        // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        SetProcessDpiAwarenessContext(-4);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let smoke_request =
        release_smoke_input::smoke_request_path(&std::env::args().collect::<Vec<_>>())?;
    #[cfg(target_os = "windows")]
    set_dpi_awareness();

    tauri::Builder::default()
        .manage(DownloadState::default())
        .manage(CaptureRuntime::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch focuses the existing window instead of spawning
            // a duplicate app (and duplicate yt-dlp sidecar trees).
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let removed_stale_cookie_files =
                services::temp_cookie_cleanup::cleanup_stale_temp_cookie_material();
            if removed_stale_cookie_files > 0 {
                tracing::info!(
                    "Removed {} stale app-owned temporary cookie file(s)",
                    removed_stale_cookie_files
                );
            }
            // App self-update (desktop only; needs updater config in tauri.conf.json)
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            // Create NotificationManager after app is built (requires AppHandle)
            let notification_manager = NotificationManager::new(app.handle().clone());
            app.manage(notification_manager);
            if let Some(request_file) = smoke_request.clone() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(release_smoke::run(handle, request_file));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_video_metadata,
            start_download,
            cancel_download,
            open_file,
            open_file_location,
            check_dependencies,
            get_app_version,
            update_ytdlp,
            check_zombie_processes,
            inspect_tool_health,
            kill_zombies,
            get_installed_browsers,
            check_browser_cookies,
            commands::inspect_cookie_file,
            check_browser_and_pot,
            get_bilibili_qrcode,
            poll_bilibili_qrcode,
            save_bilibili_cookies,
            get_bilibili_user_info,
            get_binaries_info,
            set_taskbar_progress,
            update_bun,
            update_ffmpeg,
            // Resource Capture (Phase 1, isolated browser + CDP observation)
            capture_start,
            capture_stop,
            capture_list,
            capture_claim,
            capture_release,
            capture_revoke,
            capture_dispose,
            // Notification commands
            init_notification_i18n,
            get_notification_settings,
            update_notification_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<DownloadState>();
                state.kill_all();
                // Tear down the isolated capture browser and free native capture
                // material before the process exits.
                if let Some(capture) = app_handle.try_state::<CaptureRuntime>() {
                    capture.kill_now();
                }
            }
        });

    Ok(())
}
