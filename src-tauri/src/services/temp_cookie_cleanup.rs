use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const TEMP_COOKIE_PREFIX: &str = "ytdl_flow_cookies_";
const TEMP_COOKIE_SUFFIX: &str = ".txt";
pub const TEMP_COOKIE_STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

fn generated_cookie_identity(file_name: &str) -> Option<(u32, u128)> {
    let body = file_name
        .strip_prefix(TEMP_COOKIE_PREFIX)?
        .strip_suffix(TEMP_COOKIE_SUFFIX)?;
    let mut parts = body.split('_');
    let pid_text = parts.next()?;
    let timestamp_text = parts.next()?;
    let seq_text = parts.next()?;
    let pid = pid_text.parse::<u32>().ok()?;
    let timestamp = timestamp_text.parse::<u128>().ok()?;
    let seq = seq_text.parse::<u64>().ok()?;

    if parts.next().is_some()
        || pid.to_string() != pid_text
        || timestamp.to_string() != timestamp_text
        || seq.to_string() != seq_text
    {
        return None;
    }

    Some((pid, timestamp))
}

#[cfg(target_os = "windows")]
fn process_is_alive(pid: u32) -> Option<bool> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            let error = GetLastError();
            if error == ERROR_INVALID_PARAMETER {
                Some(false)
            } else {
                None
            }
        } else {
            let _ = CloseHandle(handle);
            Some(true)
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn process_is_alive(_pid: u32) -> Option<bool> {
    None
}

fn cleanup_stale_temp_cookie_material_in_with<F>(
    temp_dir: &Path,
    now_nanos: u128,
    mut is_process_alive: F,
) -> usize
where
    F: FnMut(u32) -> Option<bool>,
{
    let entries = match std::fs::read_dir(temp_dir) {
        Ok(entries) => entries,
        Err(error) => {
            tracing::warn!(
                "Could not scan temporary cookie directory {}: {}",
                temp_dir.display(),
                error
            );
            return 0;
        }
    };

    let stale_after_nanos = TEMP_COOKIE_STALE_AFTER.as_nanos();
    let mut removed = 0;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                tracing::warn!("Could not inspect temporary cookie entry: {}", error);
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                tracing::warn!(
                    "Could not inspect temporary cookie file type for {}: {}",
                    entry.path().display(),
                    error
                );
                continue;
            }
        };
        if !file_type.is_file() {
            continue;
        }

        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some((owner_pid, created_nanos)) = generated_cookie_identity(&file_name) else {
            continue;
        };
        if now_nanos.saturating_sub(created_nanos) <= stale_after_nanos {
            continue;
        }
        match is_process_alive(owner_pid) {
            Some(false) => {}
            Some(true) | None => continue,
        }

        if let Err(error) = std::fs::remove_file(entry.path()) {
            tracing::warn!(
                "Could not remove stale app-owned temporary cookie file {}: {}",
                entry.path().display(),
                error
            );
            continue;
        }
        removed += 1;
    }

    removed
}

pub fn cleanup_stale_temp_cookie_material() -> usize {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    cleanup_stale_temp_cookie_material_in_with(&std::env::temp_dir(), now_nanos, process_is_alive)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_only_stale_exact_app_owned_cookie_material() {
        let root = std::env::temp_dir().join(format!(
            "ytdl-flow-cookie-cleanup-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let now_nanos = 2_000_000_000_000_000_000_u128;
        let stale_nanos = now_nanos - TEMP_COOKIE_STALE_AFTER.as_nanos() - 1;
        let fresh_nanos = now_nanos - 1;
        let stale = root.join(format!("ytdl_flow_cookies_10_{stale_nanos}_0.txt"));
        let fresh = root.join(format!("ytdl_flow_cookies_11_{fresh_nanos}_1.txt"));
        let unrelated = root.join("cookies.txt");
        let lookalike = root.join(format!("ytdl_flow_cookies_bad_{stale_nanos}_0.txt"));

        for path in [&stale, &fresh, &unrelated, &lookalike] {
            std::fs::write(path, "fixture").unwrap();
        }

        assert_eq!(
            cleanup_stale_temp_cookie_material_in_with(&root, now_nanos, |_| Some(false)),
            1
        );
        assert!(!stale.exists());
        assert!(fresh.exists());
        assert!(unrelated.exists());
        assert!(lookalike.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn generated_cookie_identity_rejects_noncanonical_numeric_fields() {
        let timestamp = 2_000_000_000_000_000_000_u128;
        assert!(
            generated_cookie_identity(&format!("ytdl_flow_cookies_00010_{timestamp}_0.txt"))
                .is_none()
        );
        assert!(
            generated_cookie_identity(&format!("ytdl_flow_cookies_10_0{timestamp}_0.txt"))
                .is_none()
        );
        assert!(
            generated_cookie_identity(&format!("ytdl_flow_cookies_10_{timestamp}_00.txt"))
                .is_none()
        );
    }

    #[test]
    fn unknown_process_snapshot_preserves_stale_cookie_material() {
        let root = std::env::temp_dir().join(format!(
            "ytdl-flow-cookie-cleanup-unknown-owner-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let now_nanos = 2_000_000_000_000_000_000_u128;
        let stale_nanos = now_nanos - TEMP_COOKIE_STALE_AFTER.as_nanos() - 1;
        let stale = root.join(format!("ytdl_flow_cookies_42_{stale_nanos}_0.txt"));
        std::fs::write(&stale, "fixture").unwrap();

        assert_eq!(
            cleanup_stale_temp_cookie_material_in_with(&root, now_nanos, |_| None),
            0
        );
        assert!(stale.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stale_cookie_owned_by_a_live_process_is_preserved() {
        let root = std::env::temp_dir().join(format!(
            "ytdl-flow-cookie-cleanup-live-owner-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let now_nanos = 2_000_000_000_000_000_000_u128;
        let stale_nanos = now_nanos - TEMP_COOKIE_STALE_AFTER.as_nanos() - 1;
        let live_owner_pid = 42_u32;
        let stale = root.join(format!(
            "ytdl_flow_cookies_{live_owner_pid}_{stale_nanos}_0.txt"
        ));
        std::fs::write(&stale, "fixture").unwrap();

        assert_eq!(
            cleanup_stale_temp_cookie_material_in_with(&root, now_nanos, |pid| {
                Some(pid == live_owner_pid)
            }),
            0
        );
        assert!(stale.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn current_process_is_detected_as_alive() {
        assert_eq!(process_is_alive(std::process::id()), Some(true));
    }

    #[test]
    fn missing_temp_directory_is_non_fatal() {
        let missing = std::env::temp_dir().join(format!(
            "ytdl-flow-cookie-cleanup-missing-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&missing);

        assert_eq!(
            cleanup_stale_temp_cookie_material_in_with(&missing, u128::MAX, |_| Some(false)),
            0
        );
    }
}
