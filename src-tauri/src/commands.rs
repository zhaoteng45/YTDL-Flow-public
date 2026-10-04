use crate::error::{AppError, AppResult};
use crate::models::{
    DownloadOutcome, DownloadRequest, DownloadResultPayload, DownloadResultStatus, DownloadType,
    ExtraArgs, VideoMetadata,
};
use crate::notification::NotificationManager;
use crate::services::capture::session::CaptureRuntime;
use crate::services::capture::{
    AttemptOutcome, CaptureContextError, CaptureState, ExecutionContext,
};
use crate::services::download::DownloadService;
use crate::state::DownloadState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadError {
    pub code: String,
    pub message: String,
    pub execution_may_exist: bool,
}

impl std::fmt::Display for StartDownloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for StartDownloadError {}

pub mod bilibili;
pub mod browsers;
pub mod capture;
pub mod dependencies;
mod maintenance_process;
pub mod system;
pub mod updates;

/// Inspect only a user-selected export. Return counts/status, never cookie values.
#[tauri::command]
pub async fn inspect_cookie_file(
    path: String,
    url: Option<String>,
) -> AppResult<crate::services::cookie_inspection::CookieInspection> {
    tokio::task::spawn_blocking(move || {
        let text = std::fs::read_to_string(path).map_err(|_| {
            AppError::Validation(
                "COOKIE_FILE_UNREADABLE: choose a readable UTF-8 cookie export".into(),
            )
        })?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| AppError::Validation(e.to_string()))?
            .as_secs() as i64;
        Ok(crate::services::cookie_inspection::inspect(
            &text,
            url.as_deref(),
            now,
        ))
    })
    .await
    .map_err(|e| AppError::ExternalCommand(e.to_string()))?
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Captured context failures surface a stable machine-readable token so the UI
/// never has to match human prose and never falls back to a bare URL.
fn capture_context_error(error: CaptureContextError) -> AppError {
    AppError::Download(format!(
        "{}: the captured resource is no longer available",
        error.code()
    ))
}

/// Captured analysis target: resolve the opaque context and re-run the
/// destination policy at the analysis boundary, not only at download time.
async fn resolve_captured_analysis_target(
    capture: &CaptureState,
    context_id: &str,
    row_id: &str,
    attempt_id: &str,
) -> AppResult<ExecutionContext> {
    let context = capture
        .resolve_for_analysis(context_id, row_id, attempt_id)
        .map_err(capture_context_error)?;
    DownloadService::enforce_captured_destination(&context.raw_url)
        .await
        .map_err(AppError::Download)?;
    Ok(context)
}

/// Preflight the current destination before taking the attempt lease.
async fn resolve_captured_execution_target(
    capture: &CaptureState,
    context_id: &str,
    row_id: &str,
    attempt_id: &str,
) -> AppResult<ExecutionContext> {
    let preflight = capture
        .resolve_for_analysis(context_id, row_id, attempt_id)
        .map_err(capture_context_error)?;
    DownloadService::enforce_captured_destination(&preflight.raw_url)
        .await
        .map_err(AppError::Download)?;
    let context = capture
        .begin_attempt(context_id, row_id, attempt_id)
        .map_err(capture_context_error)?;
    Ok(context)
}

/// Any pre-spawn failure after `begin_attempt` must settle the failed attempt so
/// no stale lease survives a rejected or unrunnable captured execution.
fn release_failed_capture_lease(
    capture: &CaptureRuntime,
    settle_context: &Option<String>,
    attempt_id: &str,
) {
    if let Some(context_id) = settle_context {
        capture
            .state()
            .settle_attempt(context_id, attempt_id, AttemptOutcome::Failed);
    }
}

// Tauri IPC commands expose named parameters directly to the generated command surface.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn get_video_metadata(
    app: AppHandle,
    state: State<'_, DownloadState>,
    capture: State<'_, CaptureRuntime>,
    url: Option<String>,
    capture_context_id: Option<String>,
    row_id: Option<String>,
    extra_args: Option<ExtraArgs>,
    id: String,
) -> AppResult<VideoMetadata> {
    let (execution_url, captured, captured_media_kind) = match (url, capture_context_id) {
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "provide either url or captureContextId, not both".to_string(),
            ))
        }
        (None, None) => {
            return Err(AppError::Validation(
                "metadata analysis needs a url or a captured context".to_string(),
            ))
        }
        (Some(url), None) => (url, false, None),
        (None, Some(context_id)) => {
            let row_id = row_id.ok_or_else(|| {
                AppError::Validation("a captured analysis requires its task row".to_string())
            })?;
            let context =
                resolve_captured_analysis_target(&capture.state(), &context_id, &row_id, &id)
                    .await?;
            (context.raw_url, true, Some(context.media_kind))
        }
    };

    let _activity_guard = state
        .begin_tool_activity()
        .map_err(AppError::ExternalCommand)?;
    DownloadService::get_metadata(
        app,
        execution_url,
        extra_args,
        id,
        captured,
        captured_media_kind,
    )
    .await
}

fn result_payload(id: &str, outcome: &DownloadOutcome) -> DownloadResultPayload {
    match outcome {
        DownloadOutcome::Completed { file_path } => DownloadResultPayload {
            id: id.to_string(),
            outcome: DownloadResultStatus::Completed,
            error: None,
            file_path: file_path.clone(),
        },
        DownloadOutcome::Failed(error) => DownloadResultPayload {
            id: id.to_string(),
            outcome: DownloadResultStatus::Failed,
            error: Some(error.clone()),
            file_path: None,
        },
        DownloadOutcome::Cancelled => DownloadResultPayload {
            id: id.to_string(),
            outcome: DownloadResultStatus::Cancelled,
            error: None,
            file_path: None,
        },
    }
}

fn notify_outcome(app: &AppHandle, id: &str, outcome: &DownloadOutcome) {
    if let Some(manager) = app.try_state::<NotificationManager>() {
        match outcome {
            DownloadOutcome::Cancelled => manager.notify_cancelled(id),
            _ => manager.notify_outcome(outcome),
        }
    }
}

// Keep the stable Tauri IPC parameter surface instead of wrapping it only to satisfy Clippy.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, DownloadState>,
    capture: State<'_, CaptureRuntime>,
    id: String,
    url: Option<String>,
    capture_context_id: Option<String>,
    row_id: Option<String>,
    download_type: DownloadType,
    download_dir: Option<String>,
    extra_args: Option<ExtraArgs>,
) -> Result<String, StartDownloadError> {
    // Exactly one execution target. A captured display label is never accepted
    // as a fallback execution address.
    let (execution_url, captured, captured_media_kind, replay_headers, settle_context) =
        match (url, capture_context_id) {
            (Some(_), Some(_)) => {
                return Err(StartDownloadError {
                    code: "validation".to_string(),
                    message: "provide either url or captureContextId, not both".to_string(),
                    execution_may_exist: false,
                })
            }
            (None, None) => {
                return Err(StartDownloadError {
                    code: "validation".to_string(),
                    message: "a download needs a url or a captured context".to_string(),
                    execution_may_exist: false,
                })
            }
            (Some(url), None) => {
                if let Err(e) = crate::services::download::validate_download_url(&url) {
                    return Err(StartDownloadError {
                        code: "validation".to_string(),
                        message: e.to_string(),
                        execution_may_exist: false,
                    });
                }
                (url, false, None, Vec::new(), None)
            }
            (None, Some(context_id)) => {
                let row_id = match row_id {
                    Some(r) => r,
                    None => {
                        return Err(StartDownloadError {
                            code: "validation".to_string(),
                            message: "a captured download requires its task row".to_string(),
                            execution_may_exist: false,
                        });
                    }
                };
                let context = match resolve_captured_execution_target(
                    &capture.state(),
                    &context_id,
                    &row_id,
                    &id,
                )
                .await
                {
                    Ok(ctx) => ctx,
                    Err(e) => {
                        return Err(StartDownloadError {
                            code: "capture_target_error".to_string(),
                            message: e.to_string(),
                            execution_may_exist: false,
                        });
                    }
                };
                (
                    context.raw_url,
                    true,
                    Some(context.media_kind),
                    context.replay_headers,
                    Some(context_id),
                )
            }
        };

    let request = DownloadRequest {
        id: id.clone(),
        url: execution_url,
        download_type,
        download_dir,
        extra_args,
        captured,
        captured_media_kind,
        replay_headers,
    };

    let activity_guard = match state.begin_tool_activity() {
        Ok(guard) => guard,
        Err(error) => {
            release_failed_capture_lease(&capture, &settle_context, &id);
            return Err(StartDownloadError {
                code: "tool_busy".to_string(),
                message: error,
                execution_may_exist: false,
            });
        }
    };

    if let Err(error) = state.begin_execution(id.clone()) {
        release_failed_capture_lease(&capture, &settle_context, &id);
        return Err(StartDownloadError {
            code: "execution_busy".to_string(),
            message: error,
            execution_may_exist: false,
        });
    }

    let registry = (*state).clone();
    let worker_registry = registry.clone();
    let task_id = id.clone();
    let capture_state = capture.state();

    tauri::async_runtime::spawn(async move {
        let _activity_guard = activity_guard;
        let outcome = DownloadService::download_video(app.clone(), worker_registry, request)
            .await
            .unwrap_or_else(|e| DownloadOutcome::Failed(e.to_string()));

        // A trusted terminal result may release the Application FIFO slot, so
        // publish it only after native process ownership has been released.
        if !registry.finish_execution(&task_id) {
            tracing::error!(
                "Refusing to publish trusted terminal result for task {} while process ownership remains",
                task_id
            );
            return;
        }

        if let Some(context_id) = settle_context {
            let settlement = match &outcome {
                DownloadOutcome::Completed { .. } => AttemptOutcome::Completed,
                DownloadOutcome::Cancelled => AttemptOutcome::Cancelled,
                DownloadOutcome::Failed(_) => AttemptOutcome::Failed,
            };
            capture_state.settle_attempt(&context_id, &task_id, settlement);
        }

        if let Err(error) = app.emit("download-result", result_payload(&task_id, &outcome)) {
            tracing::error!(
                "Failed to emit trusted download result for task {}: {}",
                task_id,
                error
            );
        }

        notify_outcome(&app, &task_id, &outcome);
    });

    Ok(id)
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, DownloadState>, id: String) -> AppResult<()> {
    let found = state
        .request_cancel(&id)
        .map_err(AppError::ExternalCommand)?;
    if !found {
        return Err(AppError::ExternalCommand(format!(
            "No active execution for task {}",
            id
        )));
    }

    Ok(())
}

fn resolve_open_location_target(path: &Path, base_dir_path: &Path) -> AppResult<PathBuf> {
    let is_relative = path.is_relative();
    let target_path = if is_relative {
        base_dir_path.join(path)
    } else {
        path.to_path_buf()
    };

    if !target_path.exists() {
        return Err(AppError::ExternalCommand(format!(
            "Path does not exist: {}",
            target_path.display()
        )));
    }

    let target_canon = std::fs::canonicalize(&target_path)
        .map_err(|e| AppError::ExternalCommand(format!("Path resolve failed: {}", e)))?;

    // base_dir is a resolver/sandbox only for relative task paths. Completed tasks
    // carry an authoritative absolute file path that must remain revealable even if
    // the user later changes the configured download directory.
    if is_relative {
        let base_canon =
            std::fs::canonicalize(base_dir_path).unwrap_or_else(|_| base_dir_path.to_path_buf());

        if !target_canon.starts_with(&base_canon) {
            return Err(AppError::ExternalCommand(
                "Path outside allowed directory".to_string(),
            ));
        }
    }

    Ok(target_canon)
}

const ALLOWED_OPEN_FILE_EXTENSIONS: &[&str] = &[
    // Video
    "mp4", "mkv", "webm", "mov", "m4v", "avi", "ts", "m2ts", // Audio
    "mp3", "m4a", "aac", "flac", "opus", "ogg", "wav", // Subtitles
    "srt", "vtt", "ass", "ssa", "lrc", // Images
    "jpg", "jpeg", "png", "webp", // Metadata
    "json",
];

pub fn is_allowed_open_file_extension(ext: &str) -> bool {
    ALLOWED_OPEN_FILE_EXTENSIONS
        .iter()
        .any(|allowed| ext.eq_ignore_ascii_case(allowed))
}

fn resolve_open_file_target(path: &Path, base_dir_path: &Path) -> AppResult<PathBuf> {
    let target = resolve_open_location_target(path, base_dir_path)?;
    if !target.is_file() {
        return Err(AppError::ExternalCommand(format!(
            "Path is not a file: {}",
            target.display()
        )));
    }

    let ext = target.extension().and_then(|s| s.to_str()).ok_or_else(|| {
        AppError::Validation(format!(
            "File has no extension or is not allowed: {}",
            target.display()
        ))
    })?;

    if !is_allowed_open_file_extension(ext) {
        return Err(AppError::Validation(format!(
            "File extension '{}' is not permitted for open_file",
            ext
        )));
    }

    Ok(target)
}

#[cfg(test)]
mod open_location_tests {
    use super::{resolve_open_file_target, resolve_open_location_target};
    use std::fs;
    use std::path::Path;

    fn unique_temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ytdl-flow-open-location-{}-{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn absolute_task_path_remains_valid_after_download_directory_changes() {
        let base = unique_temp_dir("base");
        let actual = unique_temp_dir("actual");
        let file = actual.join("video.mp4");
        fs::write(&file, b"test").expect("write test file");

        let resolved = resolve_open_location_target(&file, &base)
            .expect("absolute task path should be authoritative");
        assert_eq!(resolved, fs::canonicalize(&file).expect("canonical file"));

        let _ = fs::remove_dir_all(base);
        let _ = fs::remove_dir_all(actual);
    }

    #[test]
    fn relative_path_cannot_escape_the_configured_download_directory() {
        let root = unique_temp_dir("relative");
        let base = root.join("downloads");
        let outside = root.join("outside.mp4");
        fs::create_dir_all(&base).expect("create base");
        fs::write(&outside, b"test").expect("write outside file");

        let result = resolve_open_location_target(Path::new("../outside.mp4"), &base);
        assert!(result.is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn open_file_target_accepts_allowed_media_and_rejects_dangerous_or_unsupported_extensions() {
        let root = unique_temp_dir("file-target-ext");

        // Allowed media
        let mp4_file = root.join("video.mp4");
        fs::write(&mp4_file, b"test").expect("write mp4");
        assert!(resolve_open_file_target(&mp4_file, &root).is_ok());

        let mkv_file = root.join("video.mkv");
        fs::write(&mkv_file, b"test").expect("write mkv");
        assert!(resolve_open_file_target(&mkv_file, &root).is_ok());

        // Dangerous or non-media extensions MUST be rejected
        let exe_file = root.join("malicious.exe");
        fs::write(&exe_file, b"test").expect("write exe");
        assert!(resolve_open_file_target(&exe_file, &root).is_err());

        let bat_file = root.join("script.bat");
        fs::write(&bat_file, b"test").expect("write bat");
        assert!(resolve_open_file_target(&bat_file, &root).is_err());

        let ps1_file = root.join("script.ps1");
        fs::write(&ps1_file, b"test").expect("write ps1");
        assert!(resolve_open_file_target(&ps1_file, &root).is_err());

        let txt_file = root.join("notes.txt");
        fs::write(&txt_file, b"test").expect("write txt");
        assert!(resolve_open_file_target(&txt_file, &root).is_err());

        // Directory must be rejected
        assert!(resolve_open_file_target(&root, &root).is_err());

        // Relative path traversal must be rejected
        assert!(resolve_open_file_target(Path::new("../outside.mp4"), &root).is_err());

        let _ = fs::remove_dir_all(root);
    }
}

#[cfg(test)]
mod capture_lease_tests {
    use super::*;
    use crate::services::capture::{CaptureLimits, CaptureSessionDescriptor, ObservedResource};

    /// A host that passes the textual policy but cannot resolve: claim-time DNS
    /// failure does not block promotion, so the execution/analysis boundary is
    /// the authoritative destination check for this fixture.
    fn claimed_unresolvable_context(url: &str) -> (CaptureState, String) {
        let state = CaptureState::new(CaptureLimits::default());
        let session = state
            .begin_session(CaptureSessionDescriptor {
                capture_id: "capture-1".to_string(),
                browser_name: "msedge".to_string(),
            })
            .expect("capture session");
        state.record_observed(ObservedResource {
            capture_id: session.capture_id,
            url: url.to_string(),
            mime: Some("video/mp4".to_string()),
            content_length: Some(1024),
            status: Some(200),
            saw_cookie_header: false,
            saw_authorization_header: false,
            request_headers: Vec::new(),
        });
        let resource_id = state
            .list_summaries()
            .first()
            .expect("recorded resource")
            .resource_id
            .clone();
        let ticket = state.prepare_claim(&resource_id).expect("claim ticket");
        let claimed = state.commit_claim(&ticket, &[]).expect("claimed context");
        (state, claimed.context_id)
    }

    #[tokio::test]
    async fn rejected_download_preflight_releases_the_attempt_lease() {
        let (state, context_id) =
            claimed_unresolvable_context("https://remediation-a.invalid/clip.mp4");

        let error = resolve_captured_execution_target(&state, &context_id, "row-1", "attempt-1")
            .await
            .expect_err("an unresolvable host must be rejected at the execution boundary");
        assert!(
            error.to_string().contains("capture-destination-rejected"),
            "unexpected rejection: {error}"
        );
        assert!(
            state.release_context(&context_id),
            "a rejected preflight must not leave an attempt lease behind"
        );
    }

    #[tokio::test]
    async fn rejected_analysis_preflight_surfaces_a_typed_destination_failure() {
        let (state, context_id) =
            claimed_unresolvable_context("https://remediation-a.invalid/clip.mp4");

        let error = resolve_captured_analysis_target(&state, &context_id, "row-1", "attempt-1")
            .await
            .expect_err("captured metadata analysis must run the destination preflight");
        assert!(
            error.to_string().contains("capture-destination-rejected"),
            "unexpected rejection: {error}"
        );
    }
}

#[tauri::command]
pub async fn open_file(app: AppHandle, path: String, base_dir: Option<String>) -> AppResult<()> {
    let base_dir_path = if let Some(base) = base_dir {
        PathBuf::from(base)
    } else {
        app.path()
            .download_dir()
            .unwrap_or(PathBuf::from("."))
            .join("YTDL-Flow")
    };

    let target = resolve_open_file_target(Path::new(&path), &base_dir_path)?;
    #[allow(deprecated)]
    app.shell()
        .open(target.to_string_lossy().to_string(), None)
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn open_file_location(
    app: AppHandle,
    path: String,
    base_dir: Option<String>,
) -> AppResult<()> {
    let base_dir_path = if let Some(base) = base_dir {
        PathBuf::from(base)
    } else {
        app.path()
            .download_dir()
            .unwrap_or(PathBuf::from("."))
            .join("YTDL-Flow")
    };

    let target_canon = resolve_open_location_target(Path::new(&path), &base_dir_path)?;

    #[cfg(target_os = "windows")]
    {
        let target = target_canon.to_string_lossy().to_string();
        let command = app.shell().command("explorer");
        if target_canon.is_dir() {
            command
                .arg(target)
                .spawn()
                .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
        } else {
            command
                .args(["/select,", &target])
                .spawn()
                .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        let target = target_canon.to_string_lossy().to_string();
        let command = app.shell().command("open");
        if target_canon.is_dir() {
            command
                .arg(target)
                .spawn()
                .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
        } else {
            command
                .args(["-R", &target])
                .spawn()
                .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
        }
    }
    #[cfg(target_os = "linux")]
    {
        let reveal_target = if target_canon.is_dir() {
            target_canon.clone()
        } else {
            target_canon
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| target_canon.clone())
        };
        app.shell()
            .command("xdg-open")
            .arg(reveal_target.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn owned_tool_directories(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(path) = crate::utils::get_binary_path(app, "ffmpeg") {
        if let Some(parent) = path.parent() {
            dirs.push(std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf()));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf()));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        for candidate in [cwd.join("src-tauri/bin"), cwd.join("bin")] {
            if candidate.exists() {
                dirs.push(std::fs::canonicalize(&candidate).unwrap_or(candidate));
            }
        }
    }

    dirs.sort();
    dirs.dedup();
    dirs
}

#[cfg(target_os = "windows")]
const OWNED_TOOL_PROCESS_SCRIPT: &str = r#"$ErrorActionPreference='Stop'; $names=@('yt-dlp.exe','yt-dlp-x86_64-pc-windows-msvc.exe','ffmpeg.exe'); Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name -and $_.ExecutablePath } | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }"#;

#[cfg(target_os = "windows")]
fn find_owned_tool_processes(app: &AppHandle) -> AppResult<Vec<u32>> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let owned_dirs = owned_tool_directories(app);
    let script = OWNED_TOOL_PROCESS_SCRIPT;
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000);
    let output =
        maintenance_process::bounded_output(&mut command, maintenance_process::INSPECTION_TIMEOUT)
            .map_err(|e| {
                AppError::ExternalCommand(format!("Failed to inspect media processes: {e}"))
            })?;

    if !output.status.success() {
        return Err(AppError::ExternalCommand(format!(
            "Failed to inspect media processes: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let mut pids = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((pid_text, executable_text)) = line.split_once('|') else {
            continue;
        };
        let Ok(pid) = pid_text.trim().parse::<u32>() else {
            continue;
        };
        let executable = PathBuf::from(executable_text.trim());
        let canonical = std::fs::canonicalize(&executable).unwrap_or(executable);
        let owned = owned_dirs.iter().any(|dir| canonical.starts_with(dir));
        if owned {
            pids.push(pid);
        }
    }

    pids.sort_unstable();
    pids.dedup();
    Ok(pids)
}

#[tauri::command]
pub async fn check_zombie_processes(
    app: AppHandle,
    state: State<'_, DownloadState>,
) -> AppResult<usize> {
    let _maintenance_guard = state
        .begin_tool_mutation()
        .map_err(AppError::ExternalCommand)?;

    #[cfg(target_os = "windows")]
    {
        Ok(find_owned_tool_processes(&app)?.len())
    }

    #[cfg(not(target_os = "windows"))]
    Ok(0)
}

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ToolHealth {
    Ready {
        #[serde(rename = "zombieCount")]
        zombie_count: usize,
    },
    Busy {
        #[serde(rename = "activeOperations")]
        active_operations: usize,
    },
}

#[tauri::command]
pub async fn inspect_tool_health(
    app: AppHandle,
    state: State<'_, DownloadState>,
) -> AppResult<ToolHealth> {
    match state
        .try_begin_tool_inspection()
        .map_err(AppError::ExternalCommand)?
    {
        Err(active_operations) => Ok(ToolHealth::Busy { active_operations }),
        Ok(guard) => tokio::task::spawn_blocking(move || {
            let _guard = guard;
            #[cfg(target_os = "windows")]
            let zombie_count = find_owned_tool_processes(&app)?.len();
            #[cfg(not(target_os = "windows"))]
            let zombie_count = 0;
            Ok(ToolHealth::Ready { zombie_count })
        })
        .await
        .map_err(|error| AppError::ExternalCommand(error.to_string()))?,
    }
}

#[tauri::command]
pub async fn kill_zombies(app: AppHandle, state: State<'_, DownloadState>) -> AppResult<usize> {
    let _maintenance_guard = state
        .begin_tool_mutation()
        .map_err(AppError::ExternalCommand)?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let mut killed_count = 0;
        for pid in find_owned_tool_processes(&app)? {
            let output = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| {
                    AppError::ExternalCommand(format!(
                        "Failed to kill owned media process {pid}: {e}"
                    ))
                })?;
            if output.status.success() {
                killed_count += 1;
            }
        }
        Ok(killed_count)
    }

    #[cfg(not(target_os = "windows"))]
    Ok(0)
}

#[cfg(all(test, windows))]
mod tool_health_script_tests {
    use super::maintenance_process::{bounded_output, INSPECTION_TIMEOUT};
    use super::OWNED_TOOL_PROCESS_SCRIPT;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    #[test]
    fn health_scan_preserves_spaced_paths_and_fails_on_inspection_error() {
        let fixture = "function Get-CimInstance { [pscustomobject]@{Name='ffmpeg.exe';ProcessId=42;ExecutablePath='C:\\Synthetic Folder\\ffmpeg.exe'} }; ";
        let run = |fixture: &str| {
            bounded_output(
                Command::new("powershell").creation_flags(0x08000000).args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    &format!("{fixture}{OWNED_TOOL_PROCESS_SCRIPT}"),
                ]),
                INSPECTION_TIMEOUT,
            )
            .unwrap()
        };
        let output = run(fixture);
        assert!(output.status.success());
        assert!(output.stderr.is_empty());
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "42|C:\\Synthetic Folder\\ffmpeg.exe"
        );
        let failed =
            run("function Get-CimInstance { Write-Error 'synthetic inspection failure' }; ");
        assert!(!failed.status.success());
    }
}
