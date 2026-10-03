//! Capture session orchestration: isolated browser + CDP Network observation.
//!
//! This module owns browser lifecycle and discovery only. It never touches a
//! task: discovered resources are handed to [`CaptureState`], which is the
//! bounded, sanitized native capture store.

use super::browser::{self, LaunchedBrowser};
use super::cdp::{self, TargetInfo};
use super::ws::{WsClient, WsMessage};
use super::{CaptureSessionDescriptor, CaptureState, RecordOutcome};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Poll cadence for new page targets.
pub const TARGET_POLL_INTERVAL: Duration = Duration::from_millis(300);

/// Called after the capture state changed, so the caller can publish updates.
pub type CaptureUpdateCallback = Arc<dyn Fn(&CaptureState) + Send + Sync>;

/// Called once when a capture session ends, with the reason.
pub type CaptureEndCallback = Arc<dyn Fn(CaptureEndReason) + Send + Sync>;

/// Consecutive failed target polls before the browser is considered gone.
const BROWSER_GONE_POLLS: u32 = 10;

/// Consecutive empty-page polls after pages were seen before the session is
/// considered closed by the user.
const EMPTY_PAGE_POLLS: u32 = 10;

/// Upper bound for the `/json/list` response body.
const MAX_HTTP_BODY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureEndReason {
    Stopped,
    BrowserClosed,
}

impl CaptureEndReason {
    pub fn as_str(self) -> &'static str {
        match self {
            CaptureEndReason::Stopped => "stopped",
            CaptureEndReason::BrowserClosed => "browser-closed",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSessionStatus {
    pub active: bool,
    pub capture_id: Option<String>,
    pub browser_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

struct SessionHandle {
    capture_id: String,
    browser_name: String,
    pid: u32,
    stop: Arc<AtomicBool>,
    observer: JoinHandle<()>,
}

/// Result of stopping a capture session, used for the status event.
#[derive(Debug, Clone)]
pub struct CaptureStopResult {
    pub capture_id: String,
    pub browser_name: String,
    pub reason: CaptureEndReason,
}

/// Native capture runtime managed by Tauri. Holds only browser/session state;
/// task lifecycle stays with CurrentTaskService.
pub struct CaptureRuntime {
    state: CaptureState,
    session: std::sync::Mutex<Option<SessionHandle>>,
    active: Arc<AtomicBool>,
}

impl Default for CaptureRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureRuntime {
    pub fn new() -> Self {
        Self {
            state: CaptureState::default(),
            session: std::sync::Mutex::new(None),
            active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn state(&self) -> CaptureState {
        self.state.clone()
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    /// Launch an isolated capture browser and start observing its network.
    pub async fn start(
        &self,
        open_url: Option<String>,
        on_resources: CaptureUpdateCallback,
        on_session_end: CaptureEndCallback,
    ) -> Result<super::CaptureSessionInfo, String> {
        if self.is_active() {
            return Err("a capture session is already active".to_string());
        }

        let candidate = browser::find_capture_browser().ok_or_else(|| {
            "no Chromium or Microsoft Edge browser was found for resource capture".to_string()
        })?;
        let profile_dir = browser::create_capture_profile_dir()?;
        let headless = capture_headless_from_env();

        let browser_name = candidate.name.clone();
        let executable = candidate.executable.clone();
        let launch_profile = profile_dir.clone();
        let launched = tokio::task::spawn_blocking(move || {
            LaunchedBrowser::launch(
                &browser_name,
                &executable,
                &launch_profile,
                open_url.as_deref(),
                headless,
            )
        })
        .await
        .map_err(|error| format!("capture browser launch task failed: {error}"))??;

        let capture_id = uuid::Uuid::new_v4().to_string();
        let session = match self.state.begin_session(CaptureSessionDescriptor {
            capture_id: capture_id.clone(),
            browser_name: launched.browser_name.clone(),
        }) {
            Ok(session) => session,
            Err(error) => {
                let mut abandoned = launched;
                let _ = tokio::task::spawn_blocking(move || abandoned.terminate()).await;
                return Err(error);
            }
        };

        let stop = Arc::new(AtomicBool::new(false));
        let observer = spawn_observer(
            self.state.clone(),
            capture_id.clone(),
            stop.clone(),
            self.active.clone(),
            on_resources,
            on_session_end,
            Some(launched),
        );

        let handle = SessionHandle {
            capture_id: capture_id.clone(),
            browser_name: session.browser_name.clone(),
            pid: observer.pid,
            stop,
            observer: observer.handle,
        };
        self.replace_session(Some(handle));
        self.active.store(true, Ordering::SeqCst);

        Ok(session)
    }

    /// Stop discovery and tear the capture browser down. Claimed contexts stay
    /// usable so an imported task can still finish.
    pub async fn stop(&self) -> Option<CaptureStopResult> {
        let handle = self.take_session();
        let Some(handle) = handle else {
            self.active.store(false, Ordering::SeqCst);
            return None;
        };

        handle.stop.store(true, Ordering::SeqCst);
        // Give the observer a moment to terminate the browser it owns.
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while !handle.observer.inner().is_finished() && std::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if !handle.observer.inner().is_finished() {
            handle.observer.abort();
        }
        terminate_capture_process(handle.pid);

        self.state.end_session(&handle.capture_id);
        self.active.store(false, Ordering::SeqCst);
        Some(CaptureStopResult {
            capture_id: handle.capture_id,
            browser_name: handle.browser_name,
            reason: CaptureEndReason::Stopped,
        })
    }

    /// Synchronous shutdown path (`RunEvent::ExitRequested`).
    pub fn kill_now(&self) {
        let handle = self.take_session();
        let Some(handle) = handle else {
            self.state.dispose();
            return;
        };
        handle.stop.store(true, Ordering::SeqCst);
        handle.observer.abort();
        terminate_capture_process(handle.pid);
        self.state.dispose();
        self.active.store(false, Ordering::SeqCst);
    }

    fn replace_session(&self, handle: Option<SessionHandle>) {
        if let Ok(mut session) = self.session.lock() {
            *session = handle;
        }
    }

    fn take_session(&self) -> Option<SessionHandle> {
        match self.session.lock() {
            Ok(mut session) => session.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        }
    }
}

/// Kill a capture browser process tree by pid (also used by the shutdown path).
fn terminate_capture_process(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x08000000)
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = pid;
    }
}

fn capture_headless_from_env() -> bool {
    std::env::var("YTDL_CAPTURE_HEADLESS")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Spawn the capture observation loop. The task owns the browser lifecycle and
/// terminates it exactly once when the session ends.
pub fn spawn_observer(
    state: CaptureState,
    capture_id: String,
    stop: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    on_resources: CaptureUpdateCallback,
    on_session_end: CaptureEndCallback,
    browser: Option<LaunchedBrowser>,
) -> SpawnedObserver {
    let pid = browser.as_ref().map(|browser| browser.pid).unwrap_or(0);
    let handle = tauri::async_runtime::spawn(async move {
        let reason = run_capture_session(
            state,
            capture_id,
            stop,
            on_resources,
            on_session_end.clone(),
            browser,
        )
        .await;
        active.store(false, Ordering::SeqCst);
        on_session_end(reason);
    });
    SpawnedObserver { pid, handle }
}

pub struct SpawnedObserver {
    pub pid: u32,
    pub handle: JoinHandle<()>,
}

/// Observe a session and always terminate the browser it owns.
pub async fn run_capture_session(
    state: CaptureState,
    capture_id: String,
    stop: Arc<AtomicBool>,
    on_update: CaptureUpdateCallback,
    _on_session_end: CaptureEndCallback,
    browser: Option<LaunchedBrowser>,
) -> CaptureEndReason {
    let port = browser.as_ref().map(|browser| browser.port).unwrap_or(0);
    let reason =
        observe_capture_session(state.clone(), capture_id.clone(), port, stop, on_update).await;

    state.end_session(&capture_id);

    if let Some(browser) = browser {
        let _ = tokio::task::spawn_blocking(move || {
            let mut browser = browser;
            browser.terminate();
        })
        .await;
    }

    reason
}

/// Observe a capture browser until it stops or disappears. Feeds every complete
/// observation into `state` and calls `on_update` after state changes.
pub async fn observe_capture_session(
    state: CaptureState,
    capture_id: String,
    port: u16,
    stop: Arc<AtomicBool>,
    on_update: CaptureUpdateCallback,
) -> CaptureEndReason {
    let mut attached: HashMap<String, JoinHandle<()>> = HashMap::new();
    let mut consecutive_failures = 0u32;
    let mut consecutive_empty_pages = 0u32;
    let mut saw_pages = false;

    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }

        match fetch_page_targets(port).await {
            Ok(pages) => {
                consecutive_failures = 0;
                if pages.is_empty() {
                    consecutive_empty_pages += 1;
                    if saw_pages && consecutive_empty_pages >= EMPTY_PAGE_POLLS {
                        break;
                    }
                } else {
                    saw_pages = true;
                    consecutive_empty_pages = 0;
                }

                for target in pages {
                    if attached.len() >= cdp::MAX_TARGETS {
                        break;
                    }
                    if attached.contains_key(&target.id) {
                        continue;
                    }
                    let handle = spawn_target_reader(
                        state.clone(),
                        capture_id.clone(),
                        port,
                        target.ws_path.clone(),
                        stop.clone(),
                        on_update.clone(),
                    );
                    attached.insert(target.id, handle);
                }
                attached.retain(|_, handle| !handle.inner().is_finished());
            }
            Err(_) => {
                consecutive_failures += 1;
                if consecutive_failures >= BROWSER_GONE_POLLS {
                    break;
                }
            }
        }

        tokio::time::sleep(TARGET_POLL_INTERVAL).await;
    }

    for (_, handle) in attached.drain() {
        handle.abort();
    }

    if stop.load(Ordering::SeqCst) {
        CaptureEndReason::Stopped
    } else {
        CaptureEndReason::BrowserClosed
    }
}

fn spawn_target_reader(
    state: CaptureState,
    capture_id: String,
    port: u16,
    ws_path: String,
    stop: Arc<AtomicBool>,
    on_update: CaptureUpdateCallback,
) -> JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let Ok(mut client) = WsClient::connect(port, &ws_path, Duration::from_secs(5)).await else {
            return;
        };
        if client
            .send_text(&cdp::network_enable_message(1))
            .await
            .is_err()
        {
            return;
        }

        let mut observation = cdp::TargetObservation::new();
        loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }

            let message =
                match tokio::time::timeout(Duration::from_secs(1), client.next_message()).await {
                    Ok(Ok(Some(message))) => message,
                    Ok(Ok(None)) => break,
                    Ok(Err(_)) => break,
                    Err(_) => continue,
                };

            let WsMessage::Text(text) = message else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            let Some(method) = value.get("method").and_then(|method| method.as_str()) else {
                continue;
            };
            let params = value
                .get("params")
                .cloned()
                .unwrap_or(serde_json::Value::Null);

            if let Some(observed) = observation.observe(method, &params, &capture_id) {
                match state.record_observed(observed) {
                    RecordOutcome::Added { .. } | RecordOutcome::Merged { .. } => {
                        on_update(&state);
                    }
                    _ => {}
                }
            }
        }
    })
}

/// Fetch page targets from the DevTools HTTP endpoint over loopback.
pub async fn fetch_page_targets(port: u16) -> Result<Vec<TargetInfo>, String> {
    let body = http_get_json_list(port).await?;
    let targets = cdp::parse_target_list(&body)?;
    Ok(targets
        .into_iter()
        .filter(|target| target.target_type == "page")
        .collect())
}

async fn http_get_json_list(port: u16) -> Result<String, String> {
    let mut stream = tokio::time::timeout(
        Duration::from_secs(3),
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .map_err(|_| "devtools endpoint connect timed out".to_string())?
    .map_err(|error| format!("devtools endpoint connect failed: {error}"))?;

    let request =
        format!("GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|error| format!("devtools request failed: {error}"))?;

    let mut response = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if tokio::time::Instant::now() > deadline {
            return Err("devtools response timed out".to_string());
        }
        let mut chunk = [0u8; 8 * 1024];
        let read = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut chunk))
            .await
            .map_err(|_| "devtools response timed out".to_string())?
            .map_err(|error| format!("devtools response failed: {error}"))?;
        if read == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..read]);
        if response.len() > MAX_HTTP_BODY_BYTES {
            return Err("devtools response exceeded the size limit".to_string());
        }
        if let Some(body_start) = find_header_end(&response) {
            // Chromium keeps the connection open even for `Connection: close`,
            // so the body length comes from the headers instead of EOF.
            match content_length(&response[..body_start]) {
                Some(length) if response.len() >= body_start + length => break,
                _ => {}
            }
        }
    }

    let text = String::from_utf8_lossy(&response).to_string();
    let body_start =
        find_header_end(&response).ok_or_else(|| "malformed devtools response".to_string())?;
    Ok(text[body_start..].to_string())
}

fn find_header_end(response: &[u8]) -> Option<usize> {
    response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| position + 4)
}

fn content_length(headers: &[u8]) -> Option<usize> {
    let text = String::from_utf8_lossy(headers).to_ascii_lowercase();
    for line in text.split("\r\n") {
        if let Some(value) = line.strip_prefix("content-length:") {
            return value.trim().parse::<usize>().ok();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::capture::CaptureLimits;
    use std::sync::Mutex;
    use tokio::net::TcpListener;

    async fn serve_fixture_once(
        listener: TcpListener,
        body: &'static str,
        content_type: &'static str,
    ) {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut request = [0u8; 1024];
            let _ = socket.read(&mut request).await;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.flush().await;
        }
    }

    #[tokio::test]
    async fn loopback_http_fetch_reads_the_devtools_target_list() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fixture server");
        let port = listener.local_addr().expect("addr").port();
        let body = r#"[{"id":"A","type":"page","url":"about:blank","webSocketDebuggerUrl":"ws://127.0.0.1:1/devtools/page/A"},{"id":"B","type":"service_worker","url":"x","webSocketDebuggerUrl":"ws://127.0.0.1:1/devtools/page/B"}]"#;

        let server = tokio::spawn(serve_fixture_once(listener, body, "application/json"));
        let targets = fetch_page_targets(port).await.expect("target list");
        server.await.expect("fixture server");

        assert_eq!(targets.len(), 1, "only page targets are observed");
        assert_eq!(targets[0].id, "A");
        assert_eq!(targets[0].ws_path, "/devtools/page/A");
    }

    #[test]
    fn capture_session_status_is_serialized_for_the_frontend() {
        let status = CaptureSessionStatus {
            active: true,
            capture_id: Some("capture-1".to_string()),
            browser_name: Some("msedge".to_string()),
            reason: None,
        };
        let json = serde_json::to_string(&status).expect("serialize");
        assert!(json.contains("\"captureId\":\"capture-1\""));
        assert!(!json.contains("reason"));
    }

    #[test]
    fn stop_without_a_session_is_a_no_op() {
        let runtime = CaptureRuntime::new();
        assert!(!runtime.is_active());
        assert!(runtime.take_session().is_none());
        runtime.kill_now();
        assert_eq!(runtime.state().context_count(), 0);
    }

    #[tokio::test]
    async fn observer_completion_releases_capture_state_session_for_restart() {
        let state = CaptureState::new(CaptureLimits::default());
        state
            .begin_session(CaptureSessionDescriptor {
                capture_id: "capture-1".to_string(),
                browser_name: "msedge".to_string(),
            })
            .expect("first session");

        let stop = Arc::new(AtomicBool::new(true));
        let noop_update: CaptureUpdateCallback = Arc::new(|_| {});
        let noop_end: CaptureEndCallback = Arc::new(|_| {});
        let reason = run_capture_session(
            state.clone(),
            "capture-1".to_string(),
            stop,
            noop_update,
            noop_end,
            None,
        )
        .await;

        assert_eq!(reason, CaptureEndReason::Stopped);
        assert!(
            state.session().is_none(),
            "observer completion must release the native session record"
        );
        assert!(
            state
                .begin_session(CaptureSessionDescriptor {
                    capture_id: "capture-2".to_string(),
                    browser_name: "msedge".to_string(),
                })
                .is_ok(),
            "a new capture session must be allowed after observer completion"
        );
    }

    #[test]
    fn observation_without_a_browser_ends_as_browser_closed() {
        // Port 1 is reserved and refuses connections, standing in for a browser
        // that exited: the loop must give up instead of spinning forever.
        let state = CaptureState::new(CaptureLimits::default());
        let stop = Arc::new(AtomicBool::new(false));
        let observed = Arc::new(Mutex::new(Vec::<usize>::new()));
        let sink = observed.clone();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        let reason = runtime.block_on(observe_capture_session(
            state,
            "capture-1".to_string(),
            1,
            stop,
            Arc::new(move |capture: &CaptureState| {
                if let Ok(mut log) = sink.lock() {
                    log.push(capture.list_summaries().len());
                }
            }) as CaptureUpdateCallback,
        ));
        let _ = reason;

        assert_eq!(reason, CaptureEndReason::BrowserClosed);
        assert!(observed.lock().expect("log").is_empty());
    }

    // ---------------------------------------------------------------------
    // Native E2E gate: real isolated Edge/Chromium + real CDP observation.
    //
    // Run with:
    //   cargo test --lib native_edge_cdp_discovery -- --ignored --nocapture
    // Set YTDL_CAPTURE_HEADLESS=0 to watch the capture browser while it runs.
    // ---------------------------------------------------------------------

    const FIXTURE_PAGE: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><title>capture fixture</title></head>
<body>
<video preload="auto" autoplay muted playsinline src="/media/clip.mp4?sig=e2e-secret-token"></video>
<video preload="auto" autoplay muted playsinline src="/media/master.m3u8?sig=e2e-secret-token-2"></video>
</body></html>"#;

    const FIXTURE_PLAYLIST: &str = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:4.0,\n/seg0.ts\n";

    async fn serve_fixture_forever(listener: TcpListener, stop: Arc<AtomicBool>, origin: String) {
        loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let accepted =
                tokio::time::timeout(Duration::from_millis(200), listener.accept()).await;
            let Ok(Ok((mut socket, _))) = accepted else {
                continue;
            };
            let origin = origin.clone();
            tokio::spawn(async move {
                let mut request = vec![0u8; 4096];
                let read = match socket.read(&mut request).await {
                    Ok(read) => read,
                    Err(_) => return,
                };
                let request_text = String::from_utf8_lossy(&request[..read]).to_string();
                let path = request_text
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();

                let (content_type, body): (&str, Vec<u8>) =
                    match path.split('?').next().unwrap_or("/") {
                        "/index.html" => ("text/html", FIXTURE_PAGE.as_bytes().to_vec()),
                        "/media/clip.mp4" => ("video/mp4", vec![0u8; 65_536]),
                        "/media/master.m3u8" => (
                            "application/vnd.apple.mpegurl",
                            FIXTURE_PLAYLIST.as_bytes().to_vec(),
                        ),
                        _ => ("text/plain", b"not found".to_vec()),
                    };
                let _ = origin;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.write_all(&body).await;
                let _ = socket.flush().await;
            });
        }
    }

    /// Count capture-browser processes that still reference `profile_dir`.
    #[cfg(target_os = "windows")]
    fn capture_processes_for_profile(profile_dir: &std::path::Path) -> usize {
        use std::os::windows::process::CommandExt;
        let script = format!(
            "$dir='{}'; @(Get-CimInstance Win32_Process | Where-Object {{ $_.Name -in @('msedge.exe','chrome.exe','chromium.exe') -and $_.CommandLine -and $_.CommandLine.Contains($dir) }}).Count",
            profile_dir.to_string_lossy().replace('\'', "''")
        );
        match std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x08000000)
            .output()
        {
            Ok(output) => String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse::<usize>()
                .unwrap_or(usize::MAX),
            Err(_) => usize::MAX,
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn capture_processes_for_profile(_profile_dir: &std::path::Path) -> usize {
        0
    }

    #[test]
    #[ignore = "launches a real isolated Edge/Chromium instance"]
    fn native_edge_cdp_discovery_emits_a_sanitized_summary() {
        let Some(candidate) = browser::find_capture_browser() else {
            println!("SKIPPED: no Chromium/Edge browser found for the native capture gate");
            return;
        };
        println!(
            "native capture gate using {} at {:?}",
            candidate.name, candidate.executable
        );

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("test runtime");

        let fixture_stop = Arc::new(AtomicBool::new(false));
        let (_, fixture_origin) = runtime.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .expect("fixture bind");
            let port = listener.local_addr().expect("fixture addr").port();
            let origin = format!("http://127.0.0.1:{port}");
            let stop = fixture_stop.clone();
            let serve_origin = origin.clone();
            tokio::spawn(serve_fixture_forever(listener, stop, serve_origin));
            (port, origin)
        });
        let page_url = format!("{fixture_origin}/index.html");

        let profile_dir = browser::create_capture_profile_dir().expect("capture profile");
        let headless = capture_headless_from_env();
        println!("launching isolated capture browser (headless={headless})");

        let launched = LaunchedBrowser::launch(
            &candidate.name,
            &candidate.executable,
            &profile_dir,
            Some(&page_url),
            headless,
        )
        .expect("capture browser must launch");
        let port = launched.port;
        let captured_profile = launched.profile_dir.clone();
        println!("capture browser pid={} devtools port={port}", launched.pid);

        let state = CaptureState::new(CaptureLimits::default());
        state
            .begin_session(CaptureSessionDescriptor {
                capture_id: "e2e-capture".to_string(),
                browser_name: candidate.name.clone(),
            })
            .expect("capture session");

        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_watcher = stop.clone();
        let state_for_watcher = state.clone();
        let watcher = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(30);
            loop {
                if state_for_watcher.list_summaries().len() >= 2 {
                    break;
                }
                if std::time::Instant::now() > deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            stop_for_watcher.store(true, Ordering::SeqCst);
        });

        let reason = runtime.block_on(run_capture_session(
            state.clone(),
            "e2e-capture".to_string(),
            stop.clone(),
            Arc::new(|_: &CaptureState| {}) as CaptureUpdateCallback,
            Arc::new(|_: CaptureEndReason| {}) as CaptureEndCallback,
            Some(launched),
        ));
        watcher.join().expect("watcher thread");
        assert_eq!(reason, CaptureEndReason::Stopped);

        let summaries = state.list_summaries();
        println!("observed {} sanitized resources", summaries.len());
        for summary in &summaries {
            println!("  {summary:?}");
        }

        let video = summaries
            .iter()
            .find(|summary| summary.media_kind == "video")
            .expect("the fixture video must be discovered");
        assert_eq!(video.site_label, "127.0.0.1");
        assert_eq!(video.filename_hint.as_deref(), Some("clip.mp4"));
        assert!(video.size_bytes.is_some(), "Content-Length is reported");
        assert!(!video.requires_authenticated_replay);

        let playlist = summaries
            .iter()
            .find(|summary| summary.media_kind == "hls")
            .expect("the fixture HLS manifest must be discovered");
        assert_eq!(playlist.mime_type, "application/vnd.apple.mpegurl");

        // Secret isolation: no summary field may carry raw URL material.
        for summary in &summaries {
            let fields = [
                summary.capture_id.as_str(),
                summary.resource_id.as_str(),
                summary.site_label.as_str(),
                summary.media_kind.as_str(),
                summary.mime_type.as_str(),
                summary.filename_hint.as_deref().unwrap_or(""),
                summary.resolution_hint.as_deref().unwrap_or(""),
            ];
            for field in fields {
                for symbol in ["http", "sig=", "e2e-secret-token", "?", "#", "@"] {
                    assert!(
                        !field.contains(symbol),
                        "summary field '{field}' leaked '{symbol}'"
                    );
                }
            }
        }

        // Promotion is still guarded by the destination policy: the fixture is
        // loopback, so it can be discovered but never executed.
        let video_id = video.resource_id.clone();
        assert_eq!(
            state.prepare_claim(&video_id),
            Err(super::super::ClaimError::ForbiddenDestination("loopback")),
            "a discovered loopback resource must not be promoted to an executable context"
        );

        // Browser/profile teardown.
        let refused = runtime.block_on(fetch_page_targets(port));
        assert!(
            refused.is_err(),
            "the capture DevTools endpoint must be gone"
        );
        assert!(
            !captured_profile.exists(),
            "the disposable capture profile must be removed"
        );
        let leftovers = capture_processes_for_profile(&captured_profile);
        assert_eq!(leftovers, 0, "no capture browser process may remain");

        fixture_stop.store(true, Ordering::SeqCst);
        println!("native capture gate PASSED");
    }
}
