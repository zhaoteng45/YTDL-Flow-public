//! Isolated capture browser lifecycle (Chromium/Edge).
//!
//! Phase 1 hard boundaries encoded here:
//! - a dedicated `--user-data-dir` under the OS temp directory, never the user's
//!   daily profile;
//! - no proxy override, no certificate-error bypass, no machine trust change;
//! - the browser is killed as a process tree when capture stops.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

/// Prefix of the disposable capture profile directory.
pub const CAPTURE_PROFILE_PREFIX: &str = "ytdl-flow-capture-";

const DEVTOOLS_ACTIVE_PORT_FILE: &str = "DevToolsActivePort";
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureBrowserCandidate {
    pub name: String,
    pub executable: PathBuf,
}

/// Flags that must never appear on a capture browser command line.
pub const FORBIDDEN_LAUNCH_FLAGS: [&str; 7] = [
    "--proxy-server",
    "--proxy-bypass-list",
    "--ignore-certificate-errors",
    "--ignore-certificate-errors-spki-list",
    "--allow-insecure-localhost",
    "--disable-web-security",
    "--headless=old",
];

/// Locate a Chromium/Edge executable. Microsoft Edge is preferred; Chrome is
/// only a fallback.
pub fn find_capture_browser() -> Option<CaptureBrowserCandidate> {
    browser_candidates()
        .into_iter()
        .find(|candidate| candidate.executable.is_file())
}

fn browser_candidates() -> Vec<CaptureBrowserCandidate> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;

        let registry_lookups = [("msedge.exe", "msedge"), ("chrome.exe", "chrome")];
        for (executable, name) in registry_lookups {
            for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
                let key = RegKey::predef(root);
                let path = format!(
                    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{executable}"
                );
                if let Ok(subkey) = key.open_subkey(&path) {
                    if let Ok(value) = subkey.get_value::<String, _>("") {
                        let trimmed = value.trim().trim_matches('"');
                        if !trimmed.is_empty() {
                            candidates.push(CaptureBrowserCandidate {
                                name: name.to_string(),
                                executable: PathBuf::from(trimmed),
                            });
                        }
                    }
                }
            }
        }

        for base in [
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ] {
            candidates.push(CaptureBrowserCandidate {
                name: "msedge".to_string(),
                executable: PathBuf::from(base),
            });
        }
        for base in [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ] {
            candidates.push(CaptureBrowserCandidate {
                name: "chrome".to_string(),
                executable: PathBuf::from(base),
            });
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(CaptureBrowserCandidate {
                name: "chromium".to_string(),
                executable: PathBuf::from(local).join("Chromium\\Application\\chrome.exe"),
            });
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(CaptureBrowserCandidate {
            name: "msedge".to_string(),
            executable: PathBuf::from(
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            ),
        });
        candidates.push(CaptureBrowserCandidate {
            name: "chrome".to_string(),
            executable: PathBuf::from(
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            ),
        });
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for (name, path) in [
            ("msedge", "/usr/bin/microsoft-edge"),
            ("msedge", "/usr/bin/microsoft-edge-stable"),
            ("chrome", "/usr/bin/google-chrome"),
            ("chromium", "/usr/bin/chromium"),
            ("chromium", "/usr/bin/chromium-browser"),
        ] {
            candidates.push(CaptureBrowserCandidate {
                name: name.to_string(),
                executable: PathBuf::from(path),
            });
        }
    }

    candidates
}

/// Create a fresh, disposable profile directory. The directory is always a new
/// child of the OS temp directory, never an existing browser profile.
pub fn create_capture_profile_dir() -> Result<PathBuf, String> {
    let base = std::env::temp_dir();
    let dir = base.join(format!("{CAPTURE_PROFILE_PREFIX}{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|error| {
        format!("failed to create an isolated capture profile directory: {error}")
    })?;
    Ok(dir)
}

/// Launch flags for the isolated capture browser.
pub fn build_launch_args(
    profile_dir: &Path,
    open_url: Option<&str>,
    headless: bool,
) -> Vec<String> {
    let mut args = vec![
        format!("--user-data-dir={}", profile_dir.to_string_lossy()),
        "--remote-debugging-port=0".to_string(),
        "--remote-debugging-address=127.0.0.1".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-sync".to_string(),
        "--no-service-autorun".to_string(),
        "--disable-features=msEdgeFirstRunExperience".to_string(),
    ];

    if headless {
        args.push("--headless=new".to_string());
    }
    if let Some(url) = open_url {
        if !url.is_empty() {
            args.push("--new-window".to_string());
            args.push(url.to_string());
        }
    }
    args
}

/// `DevToolsActivePort` content is `PORT\n<websocket path>\n`.
pub fn parse_devtools_active_port(contents: &str) -> Option<(u16, String)> {
    let mut lines = contents.lines();
    let port = lines.next()?.trim().parse::<u16>().ok()?;
    let path = lines.next().unwrap_or("").trim().to_string();
    if port == 0 {
        return None;
    }
    Some((port, path))
}

pub struct LaunchedBrowser {
    pub pid: u32,
    pub port: u16,
    pub browser_name: String,
    pub profile_dir: PathBuf,
    child: Option<Child>,
}

impl LaunchedBrowser {
    /// Synchronously launch the isolated browser and wait for its DevTools
    /// endpoint. Call from `spawn_blocking`.
    pub fn launch(
        browser_name: &str,
        executable: &Path,
        profile_dir: &Path,
        open_url: Option<&str>,
        headless: bool,
    ) -> Result<LaunchedBrowser, String> {
        let args = build_launch_args(profile_dir, open_url, headless);
        if let Some(forbidden) = args.iter().find(|arg| {
            FORBIDDEN_LAUNCH_FLAGS
                .iter()
                .any(|flag| arg.starts_with(flag))
        }) {
            return Err(format!(
                "refusing to launch the capture browser with a forbidden flag: {forbidden}"
            ));
        }

        let mut command = Command::new(executable);
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            // Do not attach a console window to this process.
            command.creation_flags(0x08000000);
        }

        let child = command
            .spawn()
            .map_err(|error| format!("failed to launch the capture browser: {error}"))?;
        let pid = child.id();

        let port_file = profile_dir.join(DEVTOOLS_ACTIVE_PORT_FILE);
        let deadline = std::time::Instant::now() + LAUNCH_TIMEOUT;
        let mut port = None;
        while std::time::Instant::now() < deadline {
            if let Ok(contents) = std::fs::read_to_string(&port_file) {
                if let Some((parsed_port, _)) = parse_devtools_active_port(&contents) {
                    port = Some(parsed_port);
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(120));
        }

        let Some(port) = port else {
            let mut browser = LaunchedBrowser {
                pid,
                port: 0,
                browser_name: browser_name.to_string(),
                profile_dir: profile_dir.to_path_buf(),
                child: Some(child),
            };
            browser.terminate();
            return Err(
                "the capture browser did not expose a DevTools endpoint in time".to_string(),
            );
        };

        Ok(LaunchedBrowser {
            pid,
            port,
            browser_name: browser_name.to_string(),
            profile_dir: profile_dir.to_path_buf(),
            child: Some(child),
        })
    }

    pub fn is_running(&mut self) -> bool {
        match self.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    /// Kill the whole capture browser process tree and release the profile.
    pub fn terminate(&mut self) {
        let Some(mut child) = self.child.take() else {
            cleanup_profile_dir(&self.profile_dir);
            return;
        };

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &self.pid.to_string()])
                .creation_flags(0x08000000)
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = child.kill();
        }

        for _ in 0..30 {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.wait();
        cleanup_profile_dir(&self.profile_dir);
    }
}

impl Drop for LaunchedBrowser {
    fn drop(&mut self) {
        if self.child.is_some() {
            self.terminate();
        }
    }
}

/// Best-effort removal of the disposable profile directory.
pub fn cleanup_profile_dir(dir: &Path) {
    for _ in 0..5 {
        if std::fs::remove_dir_all(dir).is_ok() || !dir.exists() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_args_pin_an_isolated_profile_and_remote_debugging() {
        let profile = std::env::temp_dir().join("ytdl-flow-capture-test-profile");
        let args = build_launch_args(&profile, Some("https://example.com/watch"), false);

        assert!(args
            .iter()
            .any(|arg| arg == &format!("--user-data-dir={}", profile.to_string_lossy())));
        assert!(args.iter().any(|arg| arg == "--remote-debugging-port=0"));
        assert!(args
            .iter()
            .any(|arg| arg == "--remote-debugging-address=127.0.0.1"));
        assert!(args.iter().any(|arg| arg == "--no-first-run"));
        assert!(args.iter().any(|arg| arg == "--no-default-browser-check"));
        assert!(args.contains(&"https://example.com/watch".to_string()));
        assert!(!args.iter().any(|arg| arg.starts_with("--headless")));
    }

    #[test]
    fn launch_args_never_disable_tls_validation_or_override_the_proxy() {
        let profile = std::env::temp_dir().join("ytdl-flow-capture-test-profile");
        for headless in [true, false] {
            let args = build_launch_args(&profile, None, headless);
            for forbidden in FORBIDDEN_LAUNCH_FLAGS {
                assert!(
                    !args.iter().any(|arg| arg.starts_with(forbidden)),
                    "capture browser must never receive {forbidden}"
                );
            }
        }
    }

    #[test]
    fn headless_is_opt_in_and_uses_the_modern_mode() {
        let profile = std::env::temp_dir().join("ytdl-flow-capture-test-profile");
        let args = build_launch_args(&profile, None, true);
        assert!(args.iter().any(|arg| arg == "--headless=new"));
        assert!(!args.iter().any(|arg| arg.starts_with("--headless=old")));
    }

    #[test]
    fn capture_profile_directories_are_fresh_and_isolated() {
        let first = create_capture_profile_dir().expect("profile dir");
        let second = create_capture_profile_dir().expect("profile dir");

        assert_ne!(first, second, "every capture gets a fresh profile");
        assert!(first.is_dir());
        assert!(first
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(CAPTURE_PROFILE_PREFIX)));
        assert!(
            first.starts_with(std::env::temp_dir()),
            "the capture profile must live in the disposable temp directory"
        );

        for variable in ["LOCALAPPDATA", "APPDATA"] {
            if let Ok(root) = std::env::var(variable) {
                let user_data = PathBuf::from(root);
                for browser_profile in [
                    "Microsoft\\Edge\\User Data",
                    "Google\\Chrome\\User Data",
                    "Chromium\\User Data",
                ] {
                    assert!(
                        !first.starts_with(user_data.join(browser_profile)),
                        "the capture profile must never live inside a daily browser profile"
                    );
                }
            }
        }

        cleanup_profile_dir(&first);
        cleanup_profile_dir(&second);
        assert!(!first.exists());
    }

    #[test]
    fn devtools_active_port_is_parsed_strictly() {
        assert_eq!(
            parse_devtools_active_port("51234\n/devtools/browser/abc-123\n"),
            Some((51234, "/devtools/browser/abc-123".to_string()))
        );
        assert_eq!(parse_devtools_active_port("0\n/devtools/browser/x\n"), None);
        assert_eq!(parse_devtools_active_port("\n"), None);
        assert_eq!(parse_devtools_active_port("not-a-port\n"), None);
    }

    #[test]
    fn cleanup_is_best_effort_and_tolerates_missing_directories() {
        let missing = std::env::temp_dir().join("ytdl-flow-capture-does-not-exist");
        cleanup_profile_dir(&missing);
        assert!(!missing.exists());
    }
}
