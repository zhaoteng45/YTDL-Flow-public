use crate::error::{AppError, AppResult};
use crate::state::DownloadState;
use regex::Regex;
use sha2::{Digest, Sha256};
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;

const BUN_WINDOWS_X64_URL: &str =
    "https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip";
const BUN_WINDOWS_X64_SHA256_URL: &str =
    "https://github.com/oven-sh/bun/releases/latest/download/SHASUMS256.txt";
const FFMPEG_WINDOWS_X64_URL: &str =
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const FFMPEG_WINDOWS_X64_SHA256_URL: &str =
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256";

// Helper to strip ANSI escape codes
fn strip_ansi(s: &str) -> String {
    let re = Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    re.replace_all(s, "").to_string()
}

#[cfg(test)]
fn verify_sha256(bytes: &[u8], expected_sha256: &str) -> AppResult<()> {
    let actual_sha256 = format!("{:x}", Sha256::digest(bytes));
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256.trim()) {
        return Err(AppError::Validation(format!(
            "SHA-256 mismatch: expected {}, got {}",
            expected_sha256.trim(),
            actual_sha256
        )));
    }
    Ok(())
}

// A five-minute transfer budget is an explicit interactive-operation limit,
// not a throughput claim. Streaming keeps memory independent of archive size.
async fn download_verified_archive(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    expected: &str,
) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;
    let mut response = client.get(url).send().await?.error_for_status()?;
    let mut file = tokio::fs::File::create(path).await?;
    let mut digest = Sha256::new();
    while let Some(chunk) = response.chunk().await? {
        digest.update(&chunk);
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    let actual = format!("{:x}", digest.finalize());
    if !actual.eq_ignore_ascii_case(expected.trim()) {
        return Err(AppError::Validation(format!(
            "SHA-256 mismatch: expected {}, got {}",
            expected.trim(),
            actual
        )));
    }
    Ok(())
}

fn parse_sha256(checksum_text: &str, artifact_name: Option<&str>) -> AppResult<String> {
    for line in checksum_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let mut parts = line.split_whitespace();
        let Some(digest) = parts.next() else {
            continue;
        };
        if digest.len() != 64 || !digest.chars().all(|ch| ch.is_ascii_hexdigit()) {
            continue;
        }

        if let Some(expected_name) = artifact_name {
            let Some(name) = parts.next() else {
                continue;
            };
            if name.trim_start_matches('*') != expected_name {
                continue;
            }
        }

        return Ok(digest.to_ascii_lowercase());
    }

    Err(AppError::Validation(
        "Could not resolve trusted SHA-256 from upstream checksum metadata".to_string(),
    ))
}

async fn fetch_bun_windows_x64_sha256(client: &reqwest::Client) -> AppResult<String> {
    let checksum_text = client
        .get(BUN_WINDOWS_X64_SHA256_URL)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    parse_sha256(&checksum_text, Some("bun-windows-x64.zip"))
}

async fn fetch_ffmpeg_windows_x64_sha256(client: &reqwest::Client) -> AppResult<String> {
    let checksum_text = client
        .get(FFMPEG_WINDOWS_X64_SHA256_URL)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    parse_sha256(&checksum_text, None)
}

fn create_update_temp_dir(app: &AppHandle, prefix: &str) -> AppResult<tempfile::TempDir> {
    let parent = app
        .path()
        .temp_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(parent)
        .map_err(AppError::Io)
}

#[cfg(target_os = "windows")]
fn expand_archive(zip_path: &Path, extract_dir: &Path) -> AppResult<()> {
    let mut command = Command::new("powershell");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:YTDL_FLOW_UPDATE_ZIP -DestinationPath $env:YTDL_FLOW_UPDATE_EXTRACT -Force",
        ])
        .env("YTDL_FLOW_UPDATE_ZIP", zip_path)
        .env("YTDL_FLOW_UPDATE_EXTRACT", extract_dir)
        .creation_flags(0x08000000);
    let output = super::maintenance_process::bounded_output(
        &mut command,
        super::maintenance_process::EXTRACTION_TIMEOUT,
    )
    .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::ExternalCommand(format!(
            "Failed to extract update archive: {}",
            stderr
        )));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn expand_archive(_zip_path: &Path, _extract_dir: &Path) -> AppResult<()> {
    Err(AppError::ExternalCommand(
        "Auto-update only supported on Windows".to_string(),
    ))
}

#[tauri::command]
pub async fn update_bun(app: AppHandle, state: State<'_, DownloadState>) -> AppResult<String> {
    let mutation_guard = state
        .begin_tool_mutation()
        .map_err(AppError::ExternalCommand)?;
    update_bun_impl(app, mutation_guard).await
}

async fn update_bun_impl(
    app: AppHandle,
    mutation_guard: crate::state::ToolActivityGuard,
) -> AppResult<String> {
    let url = BUN_WINDOWS_X64_URL;
    let update_dir = create_update_temp_dir(&app, "ytdl-flow-bun-update-")?;
    let zip_path = update_dir.path().join("bun.zip");

    let client = reqwest::Client::builder()
        .user_agent("YTDL-Flow")
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;
    let expected_sha256 = fetch_bun_windows_x64_sha256(&client).await?;

    download_verified_archive(&client, url, &zip_path, &expected_sha256).await?;

    tokio::task::spawn_blocking(move || {
        let _mutation_guard = mutation_guard;

        let extract_dir = update_dir.path().join("extract");
        expand_archive(&zip_path, &extract_dir)?;

        let mut found_bun = None;
        if let Ok(entries) = fs::read_dir(&extract_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let candidate = path.join("bun.exe");
                    if candidate.exists() {
                        found_bun = Some(candidate);
                        break;
                    }
                } else if path.file_name().and_then(|n| n.to_str()) == Some("bun.exe") {
                    found_bun = Some(path);
                    break;
                }
            }
        }

        let new_bun_path = found_bun.ok_or_else(|| {
            crate::error::AppError::ExternalCommand(
                "Could not find bun.exe in downloaded archive".to_string(),
            )
        })?;

        let target_path = crate::utils::get_binary_path(&app, "bun")?;
        atomic_replace_files(&[(new_bun_path, target_path)]).map_err(AppError::Io)?;

        drop(update_dir);
        Ok("Bun updated successfully".to_string())
    })
    .await
    .map_err(|error| AppError::ExternalCommand(error.to_string()))?
}

fn atomic_replace_files(replacements: &[(PathBuf, PathBuf)]) -> std::io::Result<()> {
    for (source, _) in replacements {
        if !source.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Update source does not exist: {}", source.display()),
            ));
        }
    }

    let mut staged: Vec<PathBuf> = Vec::with_capacity(replacements.len());
    for (source, target) in replacements {
        let file_name = target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("binary");
        let staged_path = target.with_file_name(format!("{file_name}.update-new"));
        if staged_path.exists() {
            let _ = fs::remove_file(&staged_path);
        }
        if let Err(error) = fs::copy(source, &staged_path) {
            for path in &staged {
                let _ = fs::remove_file(path);
            }
            return Err(error);
        }
        staged.push(staged_path);
    }

    // Preflight backup cleanup before moving any installed file. A failure on a
    // later target must not strand an earlier original at its backup path.
    for (_, target) in replacements {
        let file_name = target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("binary");
        let backup_path = target.with_file_name(format!("{file_name}.update-old"));
        if backup_path.exists() {
            if let Err(error) = fs::remove_file(&backup_path) {
                for path in &staged {
                    let _ = fs::remove_file(path);
                }
                return Err(error);
            }
        }
    }

    let mut backups: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (_, target) in replacements {
        if !target.exists() {
            continue;
        }
        let file_name = target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("binary");
        let backup_path = target.with_file_name(format!("{file_name}.update-old"));
        if let Err(error) = fs::rename(target, &backup_path) {
            for (original, backup) in backups.iter().rev() {
                let _ = fs::rename(backup, original);
            }
            for path in &staged {
                let _ = fs::remove_file(path);
            }
            return Err(error);
        }
        backups.push((target.clone(), backup_path));
    }

    for (index, (_, target)) in replacements.iter().enumerate() {
        if let Err(error) = fs::rename(&staged[index], target) {
            for (_, installed_target) in replacements.iter().take(index + 1) {
                let _ = fs::remove_file(installed_target);
            }
            for (original, backup) in backups.iter().rev() {
                let _ = fs::rename(backup, original);
            }
            for path in staged.iter().skip(index) {
                let _ = fs::remove_file(path);
            }
            return Err(error);
        }
    }

    for (_, backup) in backups {
        let _ = fs::remove_file(backup);
    }

    Ok(())
}

#[tauri::command]
pub async fn update_ffmpeg(app: AppHandle, state: State<'_, DownloadState>) -> AppResult<String> {
    let mutation_guard = state
        .begin_tool_mutation()
        .map_err(AppError::ExternalCommand)?;
    // 1. Download
    let url = FFMPEG_WINDOWS_X64_URL;
    let update_dir = create_update_temp_dir(&app, "ytdl-flow-ffmpeg-update-")?;
    let zip_path = update_dir.path().join("ffmpeg.zip");

    // Match Bun: bounded connection/transfer; timeout is surfaced to the user.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(300))
        .build()?;
    let expected_sha256 = fetch_ffmpeg_windows_x64_sha256(&client).await?;

    download_verified_archive(&client, url, &zip_path, &expected_sha256).await?;

    tokio::task::spawn_blocking(move || {
        let _mutation_guard = mutation_guard;

        // 2. Extract using PowerShell without interpolating paths into command source.
        let extract_dir = update_dir.path().join("extract");
        expand_archive(&zip_path, &extract_dir)?;

        // 3. Find ffmpeg.exe
        let mut found_ffmpeg = None;
        if let Ok(entries) = fs::read_dir(&extract_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    // Usually inside ffmpeg-x.y.z-essentials_build/bin/ffmpeg.exe
                    let candidate = path.join("bin").join("ffmpeg.exe");
                    if candidate.exists() {
                        found_ffmpeg = Some(candidate);
                        break;
                    }
                }
            }
        }

        let new_ffmpeg_path = found_ffmpeg.ok_or_else(|| {
            crate::error::AppError::ExternalCommand(
                "Could not find ffmpeg.exe in downloaded archive".to_string(),
            )
        })?;
        let new_ffprobe_path = new_ffmpeg_path
            .parent()
            .map(|parent| parent.join("ffprobe.exe"))
            .ok_or_else(|| {
                AppError::ExternalCommand(
                    "Could not resolve ffprobe.exe source directory".to_string(),
                )
            })?;

        // 4. Replace ffmpeg + ffprobe as one rollback-aware group. Handled failures restore prior targets; abrupt process loss is not crash-atomic.
        let target_ffmpeg = crate::utils::get_binary_path(&app, "ffmpeg")?;
        let target_ffprobe = crate::utils::get_binary_path(&app, "ffprobe")?;
        atomic_replace_files(&[
            (new_ffmpeg_path, target_ffmpeg),
            (new_ffprobe_path, target_ffprobe),
        ])
        .map_err(AppError::Io)?;

        drop(update_dir);
        Ok("FFmpeg updated successfully".to_string())
    })
    .await
    .map_err(|error| AppError::ExternalCommand(error.to_string()))?
}

#[tauri::command]
pub async fn update_ytdlp(app: AppHandle, state: State<'_, DownloadState>) -> AppResult<String> {
    let mutation_guard = state
        .begin_tool_mutation()
        .map_err(AppError::ExternalCommand)?;
    let sidecar = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?
        .args(["-U"]);
    let mut command: Command = sidecar.into();
    tokio::task::spawn_blocking(move || {
        let _mutation_guard = mutation_guard;
        let output = super::maintenance_process::bounded_output(
            &mut command,
            std::time::Duration::from_secs(300),
        )?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        let combined = format!("{}\n{}", stdout, stderr);
        let cleaned = strip_ansi(&combined).trim().to_string();

        if !output.status.success() {
            return Err(crate::error::AppError::ExternalCommand(format!(
                "Failed: {}",
                cleaned
            )));
        }

        Ok(cleaned)
    })
    .await
    .map_err(|error| AppError::ExternalCommand(error.to_string()))?
}

#[cfg(test)]
mod update_atomic_tests {
    use super::{atomic_replace_files, download_verified_archive, parse_sha256, verify_sha256};
    use std::fs;
    use std::path::PathBuf;

    #[tokio::test]
    async fn streamed_archive_checks_complete_body_before_replacement() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/fixture.zip", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 1024];
                let bytes_read = socket.read(&mut request).await.unwrap();
                assert!(bytes_read > 0, "fixture client must send a request");
                socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n1\r\na\r\n2\r\nbc\r\n0\r\n\r\n").await.unwrap();
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("archive.zip");
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        download_verified_archive(
            &client,
            &url,
            &path,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )
        .await
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"abc");
        assert!(
            download_verified_archive(&client, &url, &path, &"0".repeat(64))
                .await
                .is_err()
        );
        server.await.unwrap();
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ytdl-flow-updater-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn backup_cleanup_failure_preserves_every_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let src_a = dir.path().join("src-a.exe");
        let src_b = dir.path().join("src-b.exe");
        let dst_a = dir.path().join("dst-a.exe");
        let dst_b = dir.path().join("dst-b.exe");
        fs::write(&src_a, b"new-a").unwrap();
        fs::write(&src_b, b"new-b").unwrap();
        fs::write(&dst_a, b"old-a").unwrap();
        fs::write(&dst_b, b"old-b").unwrap();
        fs::create_dir(dir.path().join("dst-b.exe.update-old")).unwrap();

        assert!(atomic_replace_files(&[(src_a, dst_a.clone()), (src_b, dst_b.clone())]).is_err());
        assert_eq!(fs::read(&dst_a).unwrap(), b"old-a");
        assert_eq!(fs::read(&dst_b).unwrap(), b"old-b");
        assert!(!dir.path().join("dst-a.exe.update-new").exists());
        assert!(!dir.path().join("dst-b.exe.update-new").exists());
    }

    #[test]
    fn atomic_group_update_replaces_all_targets() {
        let dir = temp_dir("success");
        let src_a = dir.join("src-a.exe");
        let src_b = dir.join("src-b.exe");
        let dst_a = dir.join("dst-a.exe");
        let dst_b = dir.join("dst-b.exe");
        fs::write(&src_a, b"new-a").unwrap();
        fs::write(&src_b, b"new-b").unwrap();
        fs::write(&dst_a, b"old-a").unwrap();
        fs::write(&dst_b, b"old-b").unwrap();

        atomic_replace_files(&[
            (src_a.clone(), dst_a.clone()),
            (src_b.clone(), dst_b.clone()),
        ])
        .expect("atomic replacement");

        assert_eq!(fs::read(&dst_a).unwrap(), b"new-a");
        assert_eq!(fs::read(&dst_b).unwrap(), b"new-b");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn trusted_sha256_accepts_matching_bytes_and_rejects_mismatch() {
        const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

        assert!(verify_sha256(b"abc", ABC_SHA256).is_ok());
        assert!(verify_sha256(b"tampered", ABC_SHA256).is_err());
    }

    #[test]
    fn parses_bun_checksum_manifest_for_the_named_windows_archive() {
        let digest = "ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405";
        let manifest = format!("{digest}  bun-linux-x64.zip\n{digest}  bun-windows-x64.zip\n");

        assert_eq!(
            parse_sha256(&manifest, Some("bun-windows-x64.zip")).unwrap(),
            digest
        );
    }

    #[test]
    fn parses_single_digest_checksum_metadata() {
        let digest = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";

        assert_eq!(parse_sha256(digest, None).unwrap(), digest);
    }

    #[test]
    fn missing_source_preserves_every_existing_target() {
        let dir = temp_dir("missing");
        let src_a = dir.join("src-a.exe");
        let missing = dir.join("missing.exe");
        let dst_a = dir.join("dst-a.exe");
        let dst_b = dir.join("dst-b.exe");
        fs::write(&src_a, b"new-a").unwrap();
        fs::write(&dst_a, b"old-a").unwrap();
        fs::write(&dst_b, b"old-b").unwrap();

        let result =
            atomic_replace_files(&[(src_a.clone(), dst_a.clone()), (missing, dst_b.clone())]);

        assert!(result.is_err());
        assert_eq!(fs::read(&dst_a).unwrap(), b"old-a");
        assert_eq!(fs::read(&dst_b).unwrap(), b"old-b");
        let _ = fs::remove_dir_all(dir);
    }
}
