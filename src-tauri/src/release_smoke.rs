//! Explicit, on-demand installed-application check used by Windows release CI.
//! Only a loopback media fixture is accepted. Normal launches never enter here.
use crate::models::{DownloadOutcome, DownloadRequest, DownloadType, ExtraArgs};
use crate::services::download::DownloadService;
use crate::state::DownloadState;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    url: String,
    expected_sha256: String,
}

async fn check(app: &AppHandle, request_file: &Path) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    crate::release_smoke_job::contain_current_process()
        .map_err(|e| format!("Cannot contain smoke processes: {e}"))?;
    let request: Request =
        serde_json::from_slice(&std::fs::read(request_file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let url = url::Url::parse(&request.url).map_err(|e| e.to_string())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/fixture.mp4"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Release smoke accepts only an explicit loopback fixture URL".into());
    }
    if request.expected_sha256.len() != 64
        || !request
            .expected_sha256
            .bytes()
            .all(|c| c.is_ascii_hexdigit())
    {
        return Err("Expected fixture SHA256 is invalid".into());
    }
    let root = request_file.parent().ok_or("Request file has no parent")?;
    let destination = root.join("download");
    // Refuse to reuse files from another attempt, including symlinked folders.
    std::fs::create_dir(&destination).map_err(|e| e.to_string())?;
    if app.get_webview_window("main").is_none() {
        return Err("Installed application did not create its main window".into());
    }
    let extra = ExtraArgs {
        format_selector: Some("best".into()),
        embed_metadata: Some(false),
        embed_subs: Some(false),
        write_info_json: Some(false),
        write_thumbnail: Some(false),
        filename_template: Some("release-fixture.%(ext)s".into()),
        ..Default::default()
    };
    let metadata = DownloadService::get_metadata(
        app.clone(),
        request.url.clone(),
        Some(extra.clone()),
        "release-smoke-analysis".into(),
        false,
        None,
    )
    .await
    .map_err(|e| e.to_string())?;
    if metadata.title.is_empty() {
        return Err("Installed analysis returned no title".into());
    }
    let registry = app.state::<DownloadState>().inner().clone();
    let _activity = registry.begin_tool_activity()?;
    let id = "release-smoke-download".to_string();
    registry.begin_execution(id.clone())?;
    let result = DownloadService::download_video(
        app.clone(),
        registry.clone(),
        DownloadRequest {
            id: id.clone(),
            url: request.url,
            download_type: DownloadType::Video,
            download_dir: Some(destination.to_string_lossy().into_owned()),
            extra_args: Some(extra),
            captured: false,
            captured_media_kind: None,
            replay_headers: Vec::new(),
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    if !registry.finish_execution(&id) {
        return Err("Installed download retained process ownership".into());
    }
    let DownloadOutcome::Completed {
        file_path: Some(file_path),
    } = result
    else {
        return Err(format!("Installed download did not complete: {result:?}"));
    };
    let output = std::fs::canonicalize(file_path).map_err(|e| e.to_string())?;
    if !output.starts_with(std::fs::canonicalize(&destination).map_err(|e| e.to_string())?) {
        return Err("Installed download wrote outside its fixture directory".into());
    }
    let bytes = std::fs::read(&output).map_err(|e| e.to_string())?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if bytes.is_empty() || actual != request.expected_sha256.to_lowercase() {
        return Err("Installed download differs from the served media fixture".into());
    }
    Ok(serde_json::json!({
        "status": "passed", "mainWindowCreated": true,
        "analysis": "passed", "download": "passed", "outputSha256": actual,
        "scope": "installed native analysis/download service with loopback fixture",
        "youtubeNetworkTest": "not-run", "visualReview": "not-run",
    }))
}

pub async fn run(app: AppHandle, request_file: std::path::PathBuf) {
    // Production download watchdog is 180s. 240s allows cleanup before the
    // external CI process timeout (300s); a timeout is a failure, never a skip.
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(240),
        check(&app, &request_file),
    )
    .await;
    let report = match result {
        Ok(Ok(report)) => report,
        Ok(Err(error)) => serde_json::json!({"status": "failed", "error": error}),
        Err(_) => {
            serde_json::json!({"status": "failed", "error": "Native smoke exceeded 240 seconds"})
        }
    };
    app.state::<DownloadState>().kill_all();
    let passed = report["status"] == "passed";
    let report_file = request_file.with_file_name("native-smoke.json");
    let wrote = serde_json::to_vec_pretty(&report)
        .map_err(std::io::Error::other)
        .and_then(|bytes| std::fs::write(report_file, bytes));
    app.exit(if passed && wrote.is_ok() { 0 } else { 1 });
}
