use crate::error::{AppError, AppResult};
use crate::models::{
    AnalysisLogPayload, DownloadOutcome, DownloadProgressPayload, DownloadRequest, DownloadType,
    ExtraArgs, VideoMetadata,
};
use crate::services::youtube;
use crate::state::DownloadState;
use regex::Regex;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

/// 无进度看门狗：超过该时长没有任何输出事件即判僵死并杀树回收槽位
const NO_PROGRESS_TIMEOUT_SECS: u64 = 180;
const WATCHDOG_TICK_SECS: u64 = 5;
const DEFAULT_FILENAME_TEMPLATE: &str = "%(title)s.%(ext)s";

pub fn validate_filename_template(template: &str) -> AppResult<&str> {
    let trimmed = template.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_FILENAME_TEMPLATE);
    }

    if trimmed.contains('\0') {
        return Err(AppError::Validation(
            "Filename template cannot contain null bytes".to_string(),
        ));
    }

    // Reject UNC prefixes
    if trimmed.starts_with(r"\\") || trimmed.starts_with("//") {
        return Err(AppError::Validation(
            "Filename template cannot use UNC paths".to_string(),
        ));
    }

    // Reject Windows drive prefixes
    let trimmed_bytes = trimmed.as_bytes();
    if trimmed_bytes.len() >= 2
        && trimmed_bytes[0].is_ascii_alphabetic()
        && trimmed_bytes[1] == b':'
    {
        return Err(AppError::Validation(
            "Filename template cannot contain a drive prefix".to_string(),
        ));
    }

    // Reject rooted paths
    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(AppError::Validation(
            "Filename template cannot be an absolute or rooted path".to_string(),
        ));
    }

    // Check Path components
    for comp in std::path::Path::new(trimmed).components() {
        match comp {
            std::path::Component::Prefix(_) => {
                return Err(AppError::Validation(
                    "Filename template cannot contain a path prefix".to_string(),
                ));
            }
            std::path::Component::RootDir => {
                return Err(AppError::Validation(
                    "Filename template cannot be an absolute or rooted path".to_string(),
                ));
            }
            std::path::Component::ParentDir => {
                return Err(AppError::Validation(
                    "Filename template cannot contain parent directory traversal ('..')"
                        .to_string(),
                ));
            }
            std::path::Component::CurDir | std::path::Component::Normal(_) => {}
        }
    }

    // Check with normalized separators for cross-platform robustness
    let normalized = trimmed.replace('\\', "/");
    for comp in std::path::Path::new(&normalized).components() {
        match comp {
            std::path::Component::Prefix(_) => {
                return Err(AppError::Validation(
                    "Filename template cannot contain a path prefix".to_string(),
                ));
            }
            std::path::Component::RootDir => {
                return Err(AppError::Validation(
                    "Filename template cannot be an absolute or rooted path".to_string(),
                ));
            }
            std::path::Component::ParentDir => {
                return Err(AppError::Validation(
                    "Filename template cannot contain parent directory traversal ('..')"
                        .to_string(),
                ));
            }
            std::path::Component::CurDir | std::path::Component::Normal(_) => {}
        }
    }

    Ok(template)
}

pub fn resolve_output_template(
    base_dir: &std::path::Path,
    template: &str,
) -> AppResult<std::path::PathBuf> {
    let safe_template = validate_filename_template(template)?;
    Ok(base_dir.join(safe_template))
}

pub fn resolve_filename_template(extra_args: &Option<ExtraArgs>) -> AppResult<&str> {
    let template = extra_args
        .as_ref()
        .and_then(|extra| extra.filename_template.as_deref())
        .filter(|template| !template.trim().is_empty())
        .unwrap_or(DEFAULT_FILENAME_TEMPLATE);

    validate_filename_template(template)
}

pub fn validate_download_url(raw_url: &str) -> AppResult<()> {
    let parsed =
        url::Url::parse(raw_url).map_err(|e| AppError::Validation(format!("Invalid URL: {e}")))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        other => Err(AppError::Validation(format!(
            "Unsupported URL scheme '{other}': only http and https are allowed"
        ))),
    }
}

pub struct TempCookieMaterial {
    cookie_arg: Option<String>,
    cleanup_path: Option<std::path::PathBuf>,
}

impl TempCookieMaterial {
    pub fn empty() -> Self {
        Self {
            cookie_arg: None,
            cleanup_path: None,
        }
    }

    pub fn cookie_arg(&self) -> Option<&str> {
        self.cookie_arg.as_deref()
    }

    pub fn cleanup_path(&self) -> Option<&std::path::Path> {
        self.cleanup_path.as_deref()
    }
}

impl Drop for TempCookieMaterial {
    fn drop(&mut self) {
        if let Some(ref path) = self.cleanup_path {
            if path.exists() {
                if let Err(e) = std::fs::remove_file(path) {
                    tracing::warn!("Failed to clean up temporary cookie file: {}", e);
                }
            }
        }
    }
}

static COOKIE_TEMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 所有任务共用的基础参数（与用户设置无关）
fn build_base_args_for(captured: bool) -> Vec<String> {
    let mut args = vec![
        "--compat-options".to_string(),
        "no-youtube-unavailable-videos".to_string(),
        // Start from a closed JS-runtime set. Ordinary URL execution re-enables
        // bundled Bun below; captured direct-media execution never does.
        "--no-js-runtimes".to_string(),
        // Force UTF-8 encoding for stdout/stderr to fix Windows path garbling
        "--encoding".to_string(),
        "utf-8".to_string(),
        // Keep progress visible even when --print is used later for final-path capture.
        "--progress".to_string(),
        // Emit one progress record per line so Tauri can stream updates reliably.
        "--newline".to_string(),
        // Product contract: every task row represents exactly one video.
        "--no-playlist".to_string(),
    ];

    if !captured {
        args.push("--js-runtimes".to_string());
        args.push("bun".to_string());
    }
    args
}

#[allow(dead_code)]
fn build_base_args() -> Vec<String> {
    build_base_args_for(false)
}

/// 把用户设置整包翻译为 yt-dlp 参数。这是 ExtraArgs 契约的唯一适配器：
/// types.ts / models.rs 中建模的每个字段都必须在这里被消费或显式声明为前端专属。
fn build_extra_flags(extra: &ExtraArgs) -> Vec<String> {
    build_extra_flags_with_cookie_arg(extra, None)
}

fn build_extra_flags_with_cookie_arg(
    extra: &ExtraArgs,
    resolved_cookie_arg: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(proxy) = &extra.proxy {
        if !proxy.is_empty() {
            args.push("--proxy".to_string());
            args.push(proxy.clone());
        }
    }
    if let Some(cookies) = &extra.cookies {
        let cookies = cookies.trim();
        if !cookies.is_empty() {
            if DownloadService::is_browser_cookie(cookies) {
                args.push("--cookies-from-browser".to_string());
                args.push(cookies.to_string());
            } else if let Some(cookie_arg) = resolved_cookie_arg {
                if !cookie_arg.is_empty() {
                    args.push("--cookies".to_string());
                    args.push(cookie_arg.to_string());
                }
            } else {
                let resolved = DownloadService::resolve_cookies_arg(cookies);
                args.push("--cookies".to_string());
                args.push(resolved);
            }
        }
    }
    if let Some(ua) = &extra.user_agent {
        if !ua.is_empty() {
            args.push("--user-agent".to_string());
            args.push(ua.clone());
        }
    }

    // Player Client Configuration（"smart" 由调用方走多客户端竞速路径，不在此展开）
    if let Some(client) = &extra.player_client {
        let client = client.trim();
        if !client.is_empty() && client != "default" && client != "smart" {
            args.push("--extractor-args".to_string());
            args.push(format!("youtube:player_client={}", client));
        }
    }

    // PO Token Configuration
    if let Some(token) = &extra.po_token {
        if !token.trim().is_empty() {
            args.push("--extractor-args".to_string());
            if token.contains('+') {
                args.push(format!("youtube:po_token={}", token));
            } else {
                args.push(format!("youtube:po_token=web+{}", token));
            }
        }
    }

    // Visitor Data Configuration
    if let Some(visitor) = &extra.visitor_data {
        if !visitor.trim().is_empty() {
            args.push("--extractor-args".to_string());
            args.push(format!("youtube:visitor_data={}", visitor));
        }
    }

    // 并发片段数
    if let Some(fragments) = extra.concurrent_fragments {
        if fragments > 0 {
            args.push("-N".to_string());
            args.push(fragments.to_string());
        }
    }

    // 元数据与字幕内嵌
    if extra.embed_metadata == Some(true) {
        args.push("--embed-metadata".to_string());
    }
    if extra.embed_subs == Some(true) {
        args.push("--embed-subs".to_string());
    }
    if let Some(langs) = &extra.sub_langs {
        if !langs.trim().is_empty() {
            args.push("--sub-langs".to_string());
            args.push(langs.clone());
        }
    }

    // SponsorBlock：跳过赞助广告片段（YouTube Only）
    if extra.sponsorblock == Some(true) {
        args.push("--sponsorblock-remove".to_string());
        args.push("all".to_string());
    }

    // 媒体库归档：独立封面海报（调用本地 ffmpeg 自动转为通用 jpg）
    if extra.write_thumbnail == Some(true) {
        args.push("--write-thumbnail".to_string());
        args.push("--convert-thumbnails".to_string());
        args.push("jpg".to_string());
    }

    // 媒体库归档：完整元数据 JSON
    if extra.write_info_json == Some(true) {
        args.push("--write-info-json".to_string());
    }

    args
}

/// Captured execution: identity-bearing settings never reach yt-dlp.
///
/// The single ExtraArgs adapter (`build_extra_flags`) is reused after nulling
/// the network identity fields, so capture policy cannot drift from the
/// ordinary flag mapping.
fn build_captured_extra_flags(extra: &ExtraArgs) -> Vec<String> {
    let sanitized = ExtraArgs {
        proxy: None,
        cookies: None,
        user_agent: None,
        player_client: None,
        po_token: None,
        visitor_data: None,
        // Captured raw URLs are native-only secrets. These features either
        // persist source URLs or can trigger secondary network fetches.
        embed_metadata: None,
        embed_subs: None,
        sub_langs: None,
        sponsorblock: None,
        write_thumbnail: None,
        write_info_json: None,
        ..extra.clone()
    };
    build_extra_flags(&sanitized)
}

#[allow(dead_code)]
fn build_common_args_for(extra_args: &Option<ExtraArgs>, captured: bool) -> Vec<String> {
    build_common_args_with_cookie(extra_args, captured, None)
}

fn build_common_args_with_cookie(
    extra_args: &Option<ExtraArgs>,
    captured: bool,
    cookie_arg: Option<&str>,
) -> Vec<String> {
    let mut args = build_base_args_for(captured);
    if captured {
        // Close implicit identity inputs for captured execution.
        args.push("--ignore-config".to_string());
        args.push("--no-plugin-dirs".to_string());
        args.push("--no-write-info-json".to_string());
        args.push("--no-write-thumbnail".to_string());
        args.push("--no-embed-metadata".to_string());
        args.push("--no-embed-subs".to_string());
        args.push("--no-sponsorblock".to_string());
    }
    if let Some(extra) = extra_args {
        if captured {
            args.extend(build_captured_extra_flags(extra));
        } else {
            args.extend(build_extra_flags_with_cookie_arg(extra, cookie_arg));
        }
    }
    args
}

fn apply_capture_egress_proxy(args: &mut Vec<String>, captured: bool, proxy_url: Option<&str>) {
    if !captured {
        return;
    }

    let mut index = 0;
    while index < args.len() {
        if args[index] == "--proxy" {
            args.remove(index);
            if index < args.len() {
                args.remove(index);
            }
        } else {
            index += 1;
        }
    }

    if let Some(proxy_url) = proxy_url {
        args.push("--proxy".to_string());
        args.push(proxy_url.to_string());
    }
}

/// Final argv/stdin decision for one attempt. Returns the URL that must be
/// written to stdin, or `None` when the URL belongs in argv.
fn deliver_url(
    args: &mut Vec<String>,
    url: &str,
    captured: bool,
    replay_headers: &[(String, String)],
) -> Option<String> {
    if captured {
        // Captured execution no longer accepts a naked URL input. The caller
        // must use deliver_captured_direct_descriptor so yt-dlp never runs an extractor.
        append_replay_headers(args, replay_headers);
        None
    } else {
        // Option terminator ensures URLs starting with '-' are never parsed as CLI options.
        args.push("--".to_string());
        args.push(url.to_string());
        None
    }
}

fn deliver_captured_direct_descriptor(
    args: &mut Vec<String>,
    raw_url: &str,
    media_kind: &str,
    id: &str,
    replay_headers: &[(String, String)],
) -> Result<String, String> {
    if !matches!(media_kind, "video" | "audio") {
        return Err("capture-direct-kind-unsupported".to_string());
    }
    let parsed = url::Url::parse(raw_url).map_err(|_| "capture-direct-url-invalid".to_string())?;
    let protocol = match parsed.scheme() {
        "http" | "https" => parsed.scheme(),
        _ => return Err("capture-direct-scheme-unsupported".to_string()),
    };
    let ext = parsed
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .and_then(|name| name.rsplit_once('.').map(|(_, ext)| ext))
        .filter(|ext| {
            !ext.is_empty() && ext.len() <= 16 && ext.chars().all(|c| c.is_ascii_alphanumeric())
        })
        .unwrap_or(if media_kind == "audio" { "m4a" } else { "mp4" });
    append_replay_headers(args, replay_headers);
    args.push("--load-info-json".to_string());
    args.push("-".to_string());
    serde_json::to_string(&serde_json::json!({
        "id": id,
        "title": if media_kind == "audio" { "Captured audio" } else { "Captured video" },
        "ext": ext,
        "url": raw_url,
        "protocol": protocol,
    }))
    .map_err(|_| "capture-direct-descriptor-invalid".to_string())
}

/// Replay only the validated non-secret headers (Phase 1: User-Agent).
/// `Accept` / `Accept-Language` are deliberately not forwarded.
fn append_replay_headers(args: &mut Vec<String>, replay_headers: &[(String, String)]) {
    for (name, value) in replay_headers {
        if name == "user-agent" && !value.is_empty() {
            args.push("--user-agent".to_string());
            args.push(value.clone());
        }
    }
}

/// Full URL redaction for captured diagnostics: a raw/signed URL must never
/// reach logs, IPC or the copied-log surface, even inside an error message.
fn redact_captured_diagnostics(input: &str) -> String {
    static URL: OnceLock<Regex> = OnceLock::new();
    let url = URL.get_or_init(|| {
        Regex::new(r#"(?i)\b(?:https?|wss?|ftp|file)://[^\s"'<>|]+"#)
            .expect("static capture URL regex must compile")
    });
    url.replace_all(input, "<REDACTED-URL>").into_owned()
}

fn redact_diagnostics(input: &str, captured: bool) -> String {
    let redacted = DownloadService::redact_sensitive_text(input);
    if captured {
        redact_captured_diagnostics(&redacted)
    } else {
        redacted
    }
}

/// 把分辨率/编码偏好翻译为 `-S` 格式排序字段。
/// 使用排序而非 `-f` 表达式：格式缺失时优雅回退而不是直接报错，
/// 且 `-f` 存在时 `-S` 不生效，二者只能取一。
fn build_format_sort_fields(extra: &ExtraArgs) -> Vec<String> {
    let mut fields = Vec::new();

    if let Some(res) = &extra.resolution {
        let res = res.trim();
        if !res.is_empty() && res != "best" && res != "auto" {
            if let Ok(height) = res.trim_end_matches('p').parse::<u32>() {
                fields.push(format!("res:{}", height));
            }
        }
    }

    // UI 值到 yt-dlp 规范编码名的映射
    if let Some(codec) = &extra.video_codec {
        let mapped = match codec.trim() {
            "h264" => Some("h264"),
            "h265" => Some("hevc"),
            "vp9" => Some("vp9"),
            "av1" => Some("av1"),
            _ => None,
        };
        if let Some(v) = mapped {
            fields.push(format!("vcodec:{}", v));
        }
    }

    if let Some(codec) = &extra.audio_codec {
        let mapped = match codec.trim() {
            "aac" | "m4a" => Some("aac"),
            "opus" => Some("opus"),
            "mp3" => Some("mp3"),
            _ => None,
        };
        if let Some(v) = mapped {
            fields.push(format!("acodec:{}", v));
        }
    }

    fields
}

/// How an analysis child is tracked for early termination.
enum AnalyzerChild {
    /// Pasted-URL analysis keeps the shell-plugin handle.
    Handle(tauri_plugin_shell::process::CommandChild),
    /// Captured analysis drops the handle (to close stdin) and kills by pid.
    Pid(u32),
    #[cfg(test)]
    TestCleanup {
        cleanup: Box<dyn FnMut() -> Result<(), String> + Send>,
        _anchor: std::sync::Arc<()>,
    },
}

impl AnalyzerChild {
    fn kill_tree(&mut self) -> Result<(), String> {
        match self {
            AnalyzerChild::Handle(child) => crate::utils::kill_process_tree(child.pid()),
            AnalyzerChild::Pid(pid) => crate::utils::kill_process_tree(*pid),
            #[cfg(test)]
            AnalyzerChild::TestCleanup { cleanup, .. } => cleanup(),
        }
    }
}

async fn cleanup_analyzer(
    mut child: AnalyzerChild,
    rx: &mut tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
) {
    // Borrow rather than consume the anchor on each attempt. Failed cleanup
    // keeps this analysis and its resources alive, even after pipe EOF.
    await_cleanup_proof(rx, || child.kill_tree()).await;
}

pub struct DownloadService;

/// A pipe error/EOF is not exit proof. Keep the attempt (and its resources)
/// alive until tree cleanup succeeds or the shell reports actual termination.
async fn await_cleanup_proof(
    rx: &mut tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
    mut cleanup: impl FnMut() -> Result<(), String>,
) {
    let mut stream_open = true;
    let mut reported_failure = false;
    let mut retry = tokio::time::interval(std::time::Duration::from_secs(WATCHDOG_TICK_SECS));
    loop {
        tokio::select! {
            event = rx.recv(), if stream_open => {
                match event {
                    Some(tauri_plugin_shell::process::CommandEvent::Terminated(_)) => return,
                    None => stream_open = false,
                    _ => {}
                }
            }
            _ = retry.tick() => {}
        }
        match cleanup() {
            Ok(()) => return,
            Err(error) if !reported_failure => {
                tracing::warn!("Process cleanup failed; retaining ownership until cleanup retry or Terminated: {}", error);
                reported_failure = true;
            }
            Err(_) => {}
        }
    }
}

async fn cleanup_failed_attempt(
    registry: &DownloadState,
    id: &str,
    pid: u32,
    rx: &mut tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
) {
    await_cleanup_proof(rx, || {
        if registry.is_cancel_requested(id) {
            return match registry.request_cancel(id) {
                Ok(true) if registry.is_cancelled(id) => Ok(()),
                // If the execution control disappeared before attachment, the
                // local pid is still the cleanup anchor.
                Ok(_) => crate::utils::kill_process_tree(pid),
                Err(error) => Err(error),
            };
        }

        match registry.stop_for_failure(id) {
            Ok(true) => Ok(()),
            // If attachment failed before the registry acquired the child, retain
            // this attempt's pid as the cleanup anchor instead.
            Ok(false) => crate::utils::kill_process_tree(pid),
            Err(error) => Err(error),
        }
    })
    .await;
    registry.confirm_process_exit(id);
}

/// Execution-boundary destination error. The token is stable so the frontend
/// can classify without matching human prose.
pub const CAPTURE_DESTINATION_REJECTED: &str = "capture-destination-rejected";

impl DownloadService {
    fn redact_sensitive_text(input: &str) -> String {
        static URL_USERINFO: OnceLock<Regex> = OnceLock::new();
        static SENSITIVE_QUERY: OnceLock<Regex> = OnceLock::new();
        static SENSITIVE_ASSIGNMENT: OnceLock<Regex> = OnceLock::new();
        static SENSITIVE_HEADER: OnceLock<Regex> = OnceLock::new();
        static COOKIE_TEMP_FILE: OnceLock<Regex> = OnceLock::new();
        static PROFILE_PATH: OnceLock<Regex> = OnceLock::new();
        static TEMP_PATH: OnceLock<Regex> = OnceLock::new();

        let url_userinfo = URL_USERINFO.get_or_init(|| {
            Regex::new(r"(?i)(https?://)[^/\s:@]+(?::[^@\s/]*)?@")
                .expect("static URL userinfo regex must compile")
        });
        let sensitive_query = SENSITIVE_QUERY.get_or_init(|| {
            Regex::new(r"(?i)([?&](?:access_token|api_key|apikey|auth|authorization|password|passwd|po_token|secret|session(?:id)?|sig|signature|token|visitor_data)=)([^&#\s]+)")
                .expect("static sensitive query regex must compile")
        });
        let sensitive_assignment = SENSITIVE_ASSIGNMENT.get_or_init(|| {
            Regex::new(r"(?i)\b((?:access_token|api_key|apikey|authorization|password|passwd|po_token|secret|session(?:id)?|sig|signature|token|visitor_data)\s*[=:]\s*)([^\s;&]+)")
                .expect("static sensitive assignment regex must compile")
        });
        let sensitive_header = SENSITIVE_HEADER.get_or_init(|| {
            Regex::new(r"(?i)\b((?:authorization|cookie|x-api-key)\s*:\s*)([^\r\n]+)")
                .expect("static sensitive header regex must compile")
        });

        let cookie_temp_file = COOKIE_TEMP_FILE.get_or_init(|| {
            Regex::new(r#"(?i)(?:[A-Za-z]:)?[^\s"'<>|]*ytdl_flow_cookies_[^\s"'<>|]+"#)
                .expect("cookie path regex")
        });
        let profile_path = PROFILE_PATH.get_or_init(|| {
            Regex::new(r#"(?i)[A-Za-z]:[\\/]+Users[\\/]+[^\\/\r\n"'<>|]+"#)
                .expect("profile path regex")
        });
        let temp_path = TEMP_PATH.get_or_init(|| {
            Regex::new(r#"(?i)[A-Za-z]:[\\/]+(?:Windows[\\/]+)?Temp[\\/]+[^\s"'<>|]+"#)
                .expect("temp path regex")
        });
        let redacted = cookie_temp_file.replace_all(input, "<REDACTED-COOKIE-PATH>");
        let redacted = profile_path.replace_all(&redacted, "<REDACTED-PROFILE>");
        let redacted = temp_path.replace_all(&redacted, "<REDACTED-TEMP-PATH>");
        let redacted = url_userinfo.replace_all(&redacted, "$1<REDACTED>@");
        let redacted = sensitive_query.replace_all(&redacted, "$1<REDACTED>");
        let redacted = sensitive_header.replace_all(&redacted, "$1<REDACTED>");
        sensitive_assignment
            .replace_all(&redacted, "$1<REDACTED>")
            .into_owned()
    }

    fn progress_regex() -> &'static Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            // Matches: [download]   1.5% of 100.00MiB at  2.00MiB/s ETA 00:50
            Regex::new(r"\[download\]\s+(\d+\.?\d*)%.*?at\s+(.+?)(?:\s+ETA|\s*$)")
                .expect("static progress regex must compile")
        })
    }

    fn parse_progress_line(line: &str, previous_progress: f64) -> Option<(f64, String)> {
        if let Some(caps) = Self::progress_regex().captures(line) {
            let pct = caps.get(1)?.as_str().parse::<f64>().ok()?;
            let speed = caps
                .get(2)
                .map(|value| value.as_str().to_string())
                .unwrap_or_default();
            return Some((pct, speed));
        }

        if !line.starts_with("[download]") {
            return None;
        }

        let (_, tail) = line.split_once(" at ")?;
        let speed = tail
            .split_once(" (")
            .map(|(value, _)| value)
            .unwrap_or(tail)
            .trim();

        if speed.is_empty() {
            return None;
        }

        Some((previous_progress, speed.to_string()))
    }

    /// 后处理阶段标签：出现即代表下载进入合并/封装等 processing 阶段
    fn is_post_processing_line(line: &str) -> bool {
        const TAGS: [&str; 10] = [
            "[Merger]",
            "[ExtractAudio]",
            "[VideoRemuxer]",
            "[VideoConvertor]",
            "[Metadata]",
            "[EmbedSubtitle]",
            "[Thumbnails]",
            "[FixupM3u8]",
            "[FixupM4a]",
            "[MoveFiles]",
        ];
        TAGS.iter().any(|tag| line.starts_with(tag))
    }

    /// 检测是否为 YouTube 相关 URL
    pub fn is_youtube_url(url: &str) -> bool {
        let u = url.to_ascii_lowercase();
        u.contains("youtube.com") || u.contains("youtu.be")
    }

    /// Reject explicit playlist/collection pages while still allowing a single-video
    /// watch URL that merely carries playlist context in its query string.
    pub fn is_explicit_playlist_url(url: &str) -> bool {
        let u = url.to_ascii_lowercase();
        if (u.contains("youtube.com") || u.contains("youtu.be"))
            && (u.contains("/playlist") || u.contains("/album"))
        {
            return true;
        }
        u.contains("bilibili.com")
            && (u.contains("/medialist/") || u.contains("/series/") || u.contains("sid="))
    }

    /// 识别是否为浏览器名称或浏览器配置文件标识（如 chrome, edge, firefox+Profile 1）
    pub fn is_browser_cookie(cookie_str: &str) -> bool {
        let lower = cookie_str.trim().to_lowercase();
        let browser_names = [
            "chrome", "firefox", "edge", "brave", "opera", "vivaldi", "safari", "chromium",
        ];
        browser_names.iter().any(|&b| {
            lower == b
                || lower.starts_with(&format!("{}+", b))
                || lower.starts_with(&format!("{}:", b))
        })
    }

    /// 定位内置或系统的 rustypipe-botguard.exe
    pub fn resolve_botguard_bin() -> Option<String> {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let direct = parent.join("rustypipe-botguard.exe");
                if direct.exists() {
                    return Some(direct.to_string_lossy().to_string());
                }
                let in_bin = parent.join("bin").join("rustypipe-botguard.exe");
                if in_bin.exists() {
                    return Some(in_bin.to_string_lossy().to_string());
                }
            }
        }
        let cwd_bin = std::path::PathBuf::from("src-tauri/bin/rustypipe-botguard.exe");
        if cwd_bin.exists() {
            return Some(
                std::fs::canonicalize(&cwd_bin)
                    .unwrap_or(cwd_bin)
                    .to_string_lossy()
                    .to_string(),
            );
        }
        let direct_bin = std::path::PathBuf::from("bin/rustypipe-botguard.exe");
        if direct_bin.exists() {
            return Some(
                std::fs::canonicalize(&direct_bin)
                    .unwrap_or(direct_bin)
                    .to_string_lossy()
                    .to_string(),
            );
        }
        None
    }

    /// 定位 yt-dlp 插件目录（包含 yt_dlp_plugins 结构）
    pub fn resolve_plugins_dir() -> Option<String> {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let in_plugins = parent.join("plugins");
                if in_plugins.exists() {
                    return Some(in_plugins.to_string_lossy().to_string());
                }
            }
        }
        let cwd_plugins = std::path::PathBuf::from("src-tauri/plugins");
        if cwd_plugins.exists() {
            return Some(
                std::fs::canonicalize(&cwd_plugins)
                    .unwrap_or(cwd_plugins)
                    .to_string_lossy()
                    .to_string(),
            );
        }
        let direct_plugins = std::path::PathBuf::from("plugins");
        if direct_plugins.exists() {
            return Some(
                std::fs::canonicalize(&direct_plugins)
                    .unwrap_or(direct_plugins)
                    .to_string_lossy()
                    .to_string(),
            );
        }
        None
    }

    /// 针对特定 URL（尤其是 YouTube）构建插件与 PO Token 提供程序参数
    pub fn build_plugin_args(url: &str) -> Vec<String> {
        let mut args = Vec::new();
        if Self::is_youtube_url(url) {
            if let Some(plugins_dir) = Self::resolve_plugins_dir() {
                args.push("--plugin-dirs".to_string());
                args.push(plugins_dir);
            }
            if let Some(bg_bin) = Self::resolve_botguard_bin() {
                args.push("--extractor-args".to_string());
                args.push(format!(
                    "youtubepot-rustypipe-botguard:rustypipe_bg_bin={}",
                    bg_bin
                ));
            }
        }
        args
    }

    /// 运行一次 rustypipe-botguard 测试，验证其执行能力
    pub fn test_pot_provider() -> Result<String, String> {
        let bg_bin = Self::resolve_botguard_bin()
            .ok_or_else(|| "未找到 rustypipe-botguard.exe 提供程序".to_string())?;

        let output = std::process::Command::new(&bg_bin)
            .arg("--version")
            .output()
            .map_err(|e| format!("执行 rustypipe-botguard 失败: {}", e))?;

        if !output.status.success() {
            return Err("rustypipe-botguard 执行返回非零退出码".to_string());
        }

        let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(ver)
    }

    /// 将 JSON 格式 Cookie 转换为 Netscape HTTP Cookie File 格式
    pub fn convert_json_cookies_to_netscape(json_content: &str) -> Result<String, String> {
        let parsed: serde_json::Value = serde_json::from_str(json_content)
            .map_err(|e| format!("Invalid JSON cookie format: {}", e))?;

        let cookies_arr = parsed
            .as_array()
            .ok_or_else(|| "JSON cookies must be an array of cookie objects".to_string())?;

        let mut lines = Vec::with_capacity(cookies_arr.len() + 1);
        lines.push("# Netscape HTTP Cookie File".to_string());

        for c in cookies_arr {
            let domain = c
                .get("domain")
                .and_then(|v| v.as_str())
                .unwrap_or(".youtube.com");
            let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let value = c.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let path = c.get("path").and_then(|v| v.as_str()).unwrap_or("/");
            let secure = c.get("secure").and_then(|v| v.as_bool()).unwrap_or(false);

            if name.is_empty() {
                continue;
            }

            let include_subdomains = if domain.starts_with('.') {
                "TRUE"
            } else {
                "FALSE"
            };
            let secure_str = if secure { "TRUE" } else { "FALSE" };

            let expiry: i64 = c
                .get("expirationDate")
                .or_else(|| c.get("expiry"))
                .and_then(|v| {
                    if let Some(f) = v.as_f64() {
                        Some(f.round() as i64)
                    } else {
                        v.as_i64()
                    }
                })
                .unwrap_or(2147483647);

            lines.push(format!(
                "{}\t{}\t{}\t{}\t{}\t{}\t{}",
                domain, include_subdomains, path, secure_str, expiry, name, value
            ));
        }

        lines.push(String::new());
        Ok(lines.join("\n"))
    }

    /// 嗅探 Cookies 文件并建立受控临时素材。
    /// 若为 JSON 格式则转换为独立命名临时 Netscape 文本文件，由 RAII guard (TempCookieMaterial)
    /// 在任务结束（正常完成、失败、取消、watchdog）时自动清理；用户原有 .txt 文件永不删除。
    pub fn resolve_cookies_material(path_str: &str) -> TempCookieMaterial {
        let trimmed = path_str.trim();
        if trimmed.is_empty() || Self::is_browser_cookie(trimmed) {
            return TempCookieMaterial::empty();
        }

        let path = std::path::Path::new(path_str);
        if !path.exists() || !path.is_file() {
            return TempCookieMaterial {
                cookie_arg: Some(path_str.to_string()),
                cleanup_path: None,
            };
        }

        let is_json_ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("json"))
            .unwrap_or(false);

        let maybe_json_content = if is_json_ext {
            std::fs::read_to_string(path).ok()
        } else if let Ok(content) = std::fs::read_to_string(path) {
            let trimmed = content.trim_start();
            if trimmed.starts_with('[') {
                Some(trimmed.to_string())
            } else {
                None
            }
        } else {
            None
        };

        if let Some(content) = maybe_json_content {
            if let Ok(netscape) = Self::convert_json_cookies_to_netscape(&content) {
                let seq = COOKIE_TEMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let pid = std::process::id();
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                let temp_path = std::env::temp_dir()
                    .join(format!("ytdl_flow_cookies_{pid}_{timestamp}_{seq}.txt"));
                if std::fs::write(&temp_path, netscape).is_ok() {
                    return TempCookieMaterial {
                        cookie_arg: Some(temp_path.to_string_lossy().to_string()),
                        cleanup_path: Some(temp_path),
                    };
                }
            }
        }

        TempCookieMaterial {
            cookie_arg: Some(path_str.to_string()),
            cleanup_path: None,
        }
    }

    /// 嗅探 Cookies 文件；若为 JSON 格式则自动转为 Netscape 格式临时文件并返回该路径。
    pub fn resolve_cookies_arg(path_str: &str) -> String {
        let material = Self::resolve_cookies_material(path_str);
        let arg = material
            .cookie_arg
            .clone()
            .unwrap_or_else(|| path_str.to_string());
        // For backwards compatibility with direct unit test calls expecting file persistence:
        std::mem::forget(material);
        arg
    }

    fn decode_bytes(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).to_string()
    }

    /// Download consumes the analysis decision; it never chooses another client.
    pub fn resolve_effective_extra_args(
        url: &str,
        extra_args: &Option<ExtraArgs>,
    ) -> Option<ExtraArgs> {
        let mut resolved = extra_args.clone();
        if Self::is_youtube_url(url) {
            if let Some(ref mut extra) = resolved {
                if let Some(decision) = extra.smart_decision.clone() {
                    let anonymous = decision.auth_mode == "anonymous";
                    let mut pinned = youtube::client_args(
                        extra,
                        &decision.player_client,
                        decision.clear_session_inputs,
                    );
                    if anonymous {
                        pinned.cookies = None;
                    }
                    pinned.smart_decision = Some(decision);
                    *extra = pinned;
                } else if let Some(client) = extra.player_client.clone() {
                    if client != "smart" {
                        *extra = youtube::client_args(extra, &client, false);
                    }
                }
            }
        }
        resolved
    }

    #[cfg(test)]
    fn build_common_args(extra_args: &Option<ExtraArgs>) -> Vec<String> {
        build_common_args_for(extra_args, false)
    }

    /// Captured execution boundary: the destination policy runs again with DNS
    /// resolution, so a redirect- or DNS-based escape cannot reach a forbidden
    /// address even if the claim-time check passed.
    pub async fn enforce_captured_destination(raw_url: &str) -> Result<(), String> {
        if let Err(reject) = crate::services::capture::policy::check_destination_textual(raw_url) {
            return Err(format!(
                "{}: {}",
                CAPTURE_DESTINATION_REJECTED,
                reject.code()
            ));
        }

        let parsed = url::Url::parse(raw_url)
            .map_err(|_| format!("{}: malformed-url", CAPTURE_DESTINATION_REJECTED))?;
        let host = parsed
            .host_str()
            .ok_or_else(|| format!("{}: missing-host", CAPTURE_DESTINATION_REJECTED))?
            .to_string();
        let port = parsed.port_or_known_default().unwrap_or(443);

        let lookup = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tokio::net::lookup_host((host.as_str(), port)),
        )
        .await;

        match lookup {
            Ok(Ok(addresses)) => {
                let mut resolved_any = false;
                for address in addresses {
                    resolved_any = true;
                    crate::services::capture::policy::check_resolved_ip(address.ip()).map_err(
                        |reject| format!("{}: {}", CAPTURE_DESTINATION_REJECTED, reject.code()),
                    )?;
                }
                if !resolved_any {
                    return Err(format!(
                        "{}: unresolvable-host",
                        CAPTURE_DESTINATION_REJECTED
                    ));
                }
                Ok(())
            }
            _ => Err(format!(
                "{}: unresolvable-host",
                CAPTURE_DESTINATION_REJECTED
            )),
        }
    }

    async fn get_metadata_internal(
        app: AppHandle,
        url: String,
        extra_args: Option<ExtraArgs>,
        _id: String,
        emit_logs: bool,
        captured: bool,
        captured_media_kind: Option<String>,
    ) -> AppResult<VideoMetadata> {
        let extra_args = if !captured {
            Self::resolve_effective_extra_args(&url, &extra_args)
        } else {
            extra_args
        };
        let display_url = if captured {
            crate::services::capture::policy::sanitize_site_label(&url)
                .unwrap_or_else(|| "captured resource".to_string())
        } else {
            url.clone()
        };

        // Emit start log
        if emit_logs {
            let _ = app.emit(
                "analysis-log",
                AnalysisLogPayload {
                    id: _id.clone(),
                    line: redact_diagnostics(&format!("Starting analysis for: {}", url), captured),
                },
            );
        }

        let egress_guard = if captured {
            Some(
                crate::services::capture::egress::CaptureEgressGuard::start()
                    .await
                    .map_err(|_| {
                        AppError::Download("capture egress guard unavailable".to_string())
                    })?,
            )
        } else {
            None
        };
        if !captured {
            validate_download_url(&url)?;
        }

        let _cookie_material = extra_args
            .as_ref()
            .and_then(|extra| extra.cookies.as_deref())
            .map(str::trim)
            .filter(|cookies| !cookies.is_empty() && !Self::is_browser_cookie(cookies))
            .map(Self::resolve_cookies_material)
            .unwrap_or_else(TempCookieMaterial::empty);
        let mut args =
            build_common_args_with_cookie(&extra_args, captured, _cookie_material.cookie_arg());
        let guard_proxy = egress_guard.as_ref().map(|guard| guard.proxy_url());
        apply_capture_egress_proxy(&mut args, captured, guard_proxy.as_deref());
        if !captured {
            args.extend(Self::build_plugin_args(&url));
        }

        // Output template (for filename preview)
        let template = resolve_filename_template(&extra_args)?;
        args.push("-o".to_string());
        args.push(template.to_string()); // Don't use absolute path here, just template for filename simulation

        // Enable verbose logging for analysis to see JS runtime details
        args.push("--verbose".to_string());

        // Single-video product contract: never expand a playlist, even when a watch URL
        // contains a list parameter.
        // --no-playlist is already supplied by build_common_args().
        args.push("--dump-json".to_string());
        if !captured
            && Self::is_youtube_url(&url)
            && extra_args.as_ref().is_some_and(|e| {
                e.player_client
                    .as_deref()
                    .is_some_and(|c| c != "smart" && c != "default")
            })
        {
            // Inventory must remain observable even when the default selector
            // cannot produce a video/audio pair. SMART rejects unusable inventories.
            args.push("--ignore-no-formats-error".to_string());
        }
        let stdin_payload = if captured {
            args.push("--skip-download".to_string());
            Some(
                deliver_captured_direct_descriptor(
                    &mut args,
                    &url,
                    captured_media_kind.as_deref().ok_or_else(|| {
                        AppError::Validation("captured direct media kind is missing".to_string())
                    })?,
                    &_id,
                    &[],
                )
                .map_err(AppError::Validation)?,
            )
        } else {
            deliver_url(&mut args, &url, false, &[])
        };

        let cmd = app
            .shell()
            .sidecar("yt-dlp")
            .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
        let cmd = cmd
            .args(args)
            .env("PATH", crate::utils::get_enhanced_path(&app))
            .env("PYTHONIOENCODING", "utf-8");
        let mut cmd = cmd;
        if captured {
            for key in [
                "NO_PROXY",
                "no_proxy",
                "HTTP_PROXY",
                "http_proxy",
                "HTTPS_PROXY",
                "https_proxy",
                "ALL_PROXY",
                "all_proxy",
            ] {
                cmd = cmd.env(key, "");
            }
        }

        let (mut rx, child) = cmd
            .spawn()
            .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

        let child = match stdin_payload {
            Some(stdin_payload) => {
                let pid = child.pid();
                let mut child = child;
                if let Err(error) = child.write(format!("{stdin_payload}\n").as_bytes()) {
                    tracing::error!(
                        "Failed to deliver the captured URL to the analyzer for task {}: {}",
                        _id,
                        error
                    );
                    cleanup_analyzer(AnalyzerChild::Handle(child), &mut rx).await;
                    return Err(AppError::ExternalCommand(
                        "failed to deliver the captured resource to the analyzer".to_string(),
                    ));
                }
                // Closing stdin is what lets `--batch-file -` reach EOF. The
                // pid keeps cancellation available for the analysis run.
                drop(child);
                AnalyzerChild::Pid(pid)
            }
            None => AnalyzerChild::Handle(child),
        };

        Self::read_metadata_process(
            child,
            &mut rx,
            &display_url,
            captured,
            |text| {
                if emit_logs {
                    let _ = app.emit(
                        "analysis-log",
                        AnalysisLogPayload {
                            id: _id.clone(),
                            line: redact_diagnostics(text.trim(), captured),
                        },
                    );
                }
            },
            std::time::Duration::from_secs(30),
        )
        .await
    }

    /// Production analyzer event loop, with logging separate from process
    /// ownership so fault events can be exercised without a desktop window.
    async fn read_metadata_process(
        child: AnalyzerChild,
        rx: &mut tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
        display_url: &str,
        captured: bool,
        mut log_stderr: impl FnMut(&str),
        timeout_duration: std::time::Duration,
    ) -> AppResult<VideoMetadata> {
        let mut stdout_buffer = String::new();
        let mut stderr_buffer = String::new();
        let start_time = std::time::Instant::now();

        loop {
            // Check timeout
            if start_time.elapsed() >= timeout_duration {
                cleanup_analyzer(child, rx).await;
                let limit_secs = timeout_duration.as_secs();
                return Err(AppError::ExternalCommand(format!(
                    "Analysis timed out ({}s)",
                    limit_secs
                )));
            }

            // Use try_recv or similar?
            // tauri_plugin_shell's rx.recv().await returns Option<CommandEvent>
            match tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv()).await {
                Ok(Some(event)) => {
                    match event {
                        tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                            let text = Self::decode_bytes(&line);
                            stdout_buffer.push_str(&text);

                            // Wait for Terminated: JSON alone does not prove the
                            // process/challenge succeeded or that stderr is drained.
                        }
                        tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                            let text = Self::decode_bytes(&line);
                            stderr_buffer.push_str(&text);

                            log_stderr(&text);
                        }
                        tauri_plugin_shell::process::CommandEvent::Error(err) => {
                            cleanup_analyzer(child, rx).await;
                            return Err(AppError::ExternalCommand(redact_diagnostics(
                                &err, captured,
                            )));
                        }
                        tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                            if status.code.unwrap_or(1) != 0 {
                                // Process failed
                                if let Some(code) = youtube::failure_code(&stderr_buffer) {
                                    return Err(AppError::ExternalCommand(format!(
                                        "{}: {}",
                                        code,
                                        redact_diagnostics(&stderr_buffer, captured)
                                    )));
                                }
                                if stderr_buffer.contains("LOGIN_REQUIRED") {
                                    return Err(AppError::ExternalCommand(format!(
                                        "需要登录 (LOGIN_REQUIRED): 请更新您的 Cookies 或尝试更换客户端 (如 Web/iOS)。原始错误: {}",
                                        redact_diagnostics(&stderr_buffer, captured)
                                    )));
                                }
                                return Err(AppError::ExternalCommand(format!(
                                    "元数据获取失败 (Exit Code {:?}): {}",
                                    status.code,
                                    redact_diagnostics(&stderr_buffer, captured)
                                )));
                            } else {
                                // Process finished successfully but loop didn't return yet?
                                // Maybe JSON was split across chunks?
                                // Try parsing the full stdout buffer in case a JSON object was split across chunks.
                                if let Ok(json) =
                                    serde_json::from_str::<serde_json::Value>(stdout_buffer.trim())
                                {
                                    return Self::parse_metadata_with_diagnostics(
                                        json,
                                        display_url,
                                        captured,
                                        &stderr_buffer,
                                    );
                                }
                                // Fallback: try parsing line by line (dump-json)
                                for line_str in stdout_buffer.lines() {
                                    if let Ok(json) =
                                        serde_json::from_str::<serde_json::Value>(line_str)
                                    {
                                        return Self::parse_metadata_with_diagnostics(
                                            json,
                                            display_url,
                                            captured,
                                            &stderr_buffer,
                                        );
                                    }
                                }
                                return Err(AppError::ExternalCommand(
                                    "No valid metadata JSON found in output".to_string(),
                                ));
                            }
                        }
                        _ => {}
                    }
                }
                Ok(None) => {
                    // Channel closed
                    cleanup_analyzer(child, rx).await;
                    break;
                }
                Err(_) => {
                    // Timeout on recv, continue loop to check global timeout
                    continue;
                }
            }
        }

        Err(AppError::ExternalCommand(
            "Analysis failed: stream closed without result".to_string(),
        ))
    }

    fn parse_metadata(
        json: serde_json::Value,
        url: &str,
        captured: bool,
    ) -> AppResult<VideoMetadata> {
        if json["_type"].as_str() == Some("playlist") || json["entries"].is_array() {
            return Err(AppError::Validation(
                "Playlist metadata is not supported; provide a single video URL".to_string(),
            ));
        }

        let title = json["title"]
            .as_str()
            .unwrap_or("Unknown Title")
            .to_string();
        // A captured resource must not surface the signed thumbnail URL.
        let thumbnail = if captured {
            String::new()
        } else {
            json["thumbnail"].as_str().unwrap_or("").to_string()
        };
        let duration_secs = json["duration"].as_f64().unwrap_or(0.0);

        // Format duration
        let duration = if duration_secs > 0.0 {
            let h = (duration_secs / 3600.0).floor();
            let m = ((duration_secs % 3600.0) / 60.0).floor();
            let s = (duration_secs % 60.0).floor();
            if h > 0.0 {
                format!("{:02}:{:02}:{:02}", h, m, s)
            } else {
                format!("{:02}:{:02}", m, s)
            }
        } else {
            "Unknown".to_string()
        };

        let channel = json["uploader"]
            .as_str()
            .or(json["channel"].as_str())
            .unwrap_or("Unknown Channel")
            .to_string();
        let channel = redact_diagnostics(&channel, captured);

        let width = json["width"].as_i64();
        let height = json["height"].as_i64();
        let resolution = if let (Some(w), Some(h)) = (width, height) {
            Some(format!("{}x{}", w, h))
        } else {
            None
        };

        let filename = json["_filename"]
            .as_str()
            .map(|s| redact_diagnostics(s, captured));

        // Parse filesize
        let filesize_bytes = json["filesize"]
            .as_u64()
            .or(json["filesize_approx"].as_u64());

        let filesize = if let Some(bytes) = filesize_bytes {
            const KB: u64 = 1024;
            const MB: u64 = KB * 1024;
            const GB: u64 = MB * 1024;

            Some(if bytes >= GB {
                format!("{:.2} GB", bytes as f64 / GB as f64)
            } else if bytes >= MB {
                format!("{:.2} MB", bytes as f64 / MB as f64)
            } else if bytes >= KB {
                format!("{:.2} KB", bytes as f64 / KB as f64)
            } else {
                format!("{} B", bytes)
            })
        } else {
            None
        };

        Ok(VideoMetadata {
            available_formats: if captured {
                None
            } else {
                Some(youtube::inventory(&json))
            },
            requested_resolution: None,
            smart_decision: None,
            client_capabilities: None,
            youtube_diagnostic: None,
            observed_max_height: None,
            title: redact_diagnostics(&title, captured),
            thumbnail,
            duration,
            channel,
            url: url.to_string(),
            resolution,
            width,
            height,
            video_codec: None,
            audio_codec: None,
            filesize,
            filename,
        })
    }

    fn parse_metadata_with_diagnostics(
        json: serde_json::Value,
        url: &str,
        captured: bool,
        stderr: &str,
    ) -> AppResult<VideoMetadata> {
        let mut metadata = Self::parse_metadata(json.clone(), url, captured)?;
        if !captured && Self::is_youtube_url(url) {
            let formats = youtube::inventory(&json);
            let max_height = youtube::best_format(&formats, None)
                .and_then(|f| f.height)
                .unwrap_or(0);
            let diagnostic = youtube::diagnose(stderr, true);
            metadata.observed_max_height = Some(max_height);
            metadata.youtube_diagnostic = Some(diagnostic.clone());
            metadata.client_capabilities = Some(vec![crate::models::YouTubeClientCapability {
                player_client: String::new(),
                observed_max_height: max_height,
                formats,
                diagnostic,
                failure: None,
            }]);
        }
        Ok(metadata)
    }

    /// 用户是否显式指定了播放客户端（此时不再自动换客户端重试）
    fn client_pinned(extra_args: &Option<ExtraArgs>) -> bool {
        extra_args
            .as_ref()
            .and_then(|extra| extra.player_client.as_deref())
            .map(|client| {
                let client = client.trim();
                !client.is_empty() && client != "default" && client != "smart"
            })
            .unwrap_or(false)
    }

    pub async fn get_metadata(
        app: AppHandle,
        url: String,
        extra_args: Option<ExtraArgs>,
        _id: String,
        captured: bool,
        captured_media_kind: Option<String>,
    ) -> AppResult<VideoMetadata> {
        if Self::is_explicit_playlist_url(&url) {
            return Err(AppError::Validation(
                "Playlist URLs are not supported; provide a single video URL".to_string(),
            ));
        }

        // Smart Selection Logic (YouTube Only), never for captured resources.
        let is_youtube = Self::is_youtube_url(&url);
        let run_smart_selection = if captured {
            false
        } else if let Some(ref extra) = extra_args {
            is_youtube && extra.player_client.as_deref() == Some("smart")
        } else {
            false
        };

        if run_smart_selection {
            let clients = vec!["web", "web_safari", "android", "ios", "mweb", "tv"];
            let mut results = Vec::new();
            let mut client_errors = Vec::new();
            let mut capabilities = Vec::new();
            let mut stale_cookies = false;

            let _ = app.emit(
                "analysis-log",
                AnalysisLogPayload {
                    id: _id.clone(),
                    line: format!(
                        "Starting SMART capability scan (sequential clients: {:?}) for: {}",
                        clients,
                        Self::redact_sensitive_text(&url)
                    ),
                },
            );

            for client in clients {
                let current_args = youtube::client_args(
                    &extra_args.clone().unwrap_or_default(),
                    client,
                    stale_cookies,
                );

                let _ = app.emit(
                    "analysis-log",
                    AnalysisLogPayload {
                        id: _id.clone(),
                        line: format!("Trying client: {}", client),
                    },
                );

                let mut probe = Self::get_metadata_internal(
                    app.clone(),
                    url.clone(),
                    Some(current_args.clone()),
                    _id.clone(),
                    true,
                    false,
                    None,
                )
                .await;
                let stale_this_probe = match &probe {
                    Ok(meta) => meta
                        .youtube_diagnostic
                        .as_ref()
                        .is_some_and(|d| d.cookie_state == "stale"),
                    Err(error) => {
                        youtube::diagnose(&error.to_string(), false).cookie_state == "stale"
                    }
                };
                stale_cookies |= stale_this_probe;
                let mut used_args = current_args;
                if stale_this_probe && used_args.cookies.as_deref().is_some_and(|c| !c.is_empty()) {
                    used_args = youtube::client_args(&used_args, client, true);
                    let _ = app.emit(
                        "analysis-log",
                        AnalysisLogPayload {
                            id: _id.clone(),
                            line: "[STALE_COOKIE] Retrying supported client anonymously".into(),
                        },
                    );
                    probe = Self::get_metadata_internal(
                        app.clone(),
                        url.clone(),
                        Some(used_args.clone()),
                        _id.clone(),
                        true,
                        false,
                        None,
                    )
                    .await;
                }
                match probe {
                    Ok(mut metadata) => {
                        if let Some(diagnostic) = metadata.youtube_diagnostic.as_mut() {
                            diagnostic.cookie_state = if stale_cookies {
                                "stale"
                            } else if used_args.cookies.as_deref().is_none_or(|c| c.is_empty()) {
                                "notUsed"
                            } else {
                                "unknown"
                            }
                            .into();
                            if used_args.po_token.as_deref().is_some_and(|t| !t.is_empty()) {
                                diagnostic.pot_state = "provided".into();
                            }
                        }
                        if metadata
                            .youtube_diagnostic
                            .as_ref()
                            .is_some_and(|d| d.runtime_state == crate::models::RuntimeState::Failed)
                        {
                            client_errors.push(format!(
                                "{}: JS_RUNTIME_FAILURE: Bun challenge execution failed",
                                client
                            ));
                        }
                        if let Some(matrix) = metadata.client_capabilities.as_mut() {
                            for capability in matrix {
                                capability.player_client = client.into();
                                if let Some(d) = &metadata.youtube_diagnostic {
                                    capability.diagnostic = d.clone();
                                }
                                capabilities.push(capability.clone());
                            }
                        }
                        let height = metadata.height.unwrap_or(0);
                        let _ = app.emit(
                            "analysis-log",
                            AnalysisLogPayload {
                                id: _id.clone(),
                                line: format!(
                                    "Client {} success: {} ({}p)",
                                    client,
                                    metadata.resolution.as_deref().unwrap_or("unknown"),
                                    height
                                ),
                            },
                        );
                        results.push((client.to_string(), metadata, used_args));
                    }
                    Err(e) => {
                        let err_str = Self::redact_sensitive_text(&e.to_string());
                        let _ = app.emit(
                            "analysis-log",
                            AnalysisLogPayload {
                                id: _id.clone(),
                                line: format!("Client {} failed: {}", client, err_str),
                            },
                        );
                        client_errors.push(format!("{}: {}", client, err_str));
                        let mut diagnostic = youtube::diagnose(&err_str, false);
                        if stale_cookies {
                            diagnostic.cookie_state = "stale".into();
                        }
                        capabilities.push(crate::models::YouTubeClientCapability {
                            player_client: client.into(),
                            observed_max_height: 0,
                            formats: Vec::new(),
                            diagnostic,
                            failure: Some(err_str),
                        });
                    }
                }
            }

            let requested = extra_args
                .as_ref()
                .and_then(|e| e.resolution.as_deref())
                .and_then(|r| r.trim_end_matches('p').parse::<i64>().ok());
            // If a later client reveals stale cookies, previous authenticated
            // successes no longer describe the identity used by the download.
            // Reprobe those clients once anonymously before selecting a winner.
            if stale_cookies {
                for (client, metadata, args) in &mut results {
                    if args.cookies.as_deref().is_some_and(|c| !c.is_empty()) {
                        *args = youtube::client_args(args, client, true);
                        match Self::get_metadata_internal(
                            app.clone(),
                            url.clone(),
                            Some(args.clone()),
                            _id.clone(),
                            true,
                            false,
                            None,
                        )
                        .await
                        {
                            Ok(mut reprobed) => {
                                if let Some(d) = reprobed.youtube_diagnostic.as_mut() {
                                    d.cookie_state = "stale".into();
                                }
                                if let Some(matrix) = reprobed.client_capabilities.as_mut() {
                                    for capability in matrix {
                                        capability.player_client = client.clone();
                                        if let Some(d) = &reprobed.youtube_diagnostic {
                                            capability.diagnostic = d.clone();
                                        }
                                    }
                                }
                                *metadata = reprobed;
                            }
                            Err(error) => {
                                metadata.client_capabilities = None;
                                client_errors.push(format!(
                                    "{}: {}",
                                    client,
                                    Self::redact_sensitive_text(&error.to_string())
                                ));
                            }
                        }
                        if let Some(capability) =
                            capabilities.iter_mut().find(|c| c.player_client == *client)
                        {
                            if let Some(updated) = metadata
                                .client_capabilities
                                .as_ref()
                                .and_then(|c| c.first())
                            {
                                *capability = updated.clone();
                            } else {
                                capability.formats.clear();
                                capability.observed_max_height = 0;
                                capability.failure =
                                    Some("anonymous reprobe failed after stale cookies".into());
                            }
                        }
                    }
                }
            }
            results.retain(|(_, m, _)| {
                m.client_capabilities
                    .as_ref()
                    .and_then(|c| c.first())
                    .and_then(|c| youtube::best_format(&c.formats, requested))
                    .is_some()
            });
            if stale_cookies {
                results.retain(|(_, _, args)| args.cookies.as_deref().is_none_or(|c| c.is_empty()));
            }
            results.retain(|(_, m, _)| {
                m.youtube_diagnostic
                    .as_ref()
                    .is_none_or(|d| d.runtime_state != crate::models::RuntimeState::Failed)
            });
            results.sort_by(|a, b| {
                let format = |m: &VideoMetadata| {
                    m.client_capabilities
                        .as_ref()
                        .and_then(|c| c.first())
                        .and_then(|c| youtube::best_format(&c.formats, requested))
                        .cloned()
                };
                match (format(&a.1), format(&b.1)) {
                    (Some(a), Some(b)) => youtube::compare(&b, &a, requested),
                    _ => std::cmp::Ordering::Equal,
                }
            });

            if let Some((best_client, mut best_meta, used_args)) = results.into_iter().next() {
                best_meta.smart_decision = Some(crate::models::SmartClientDecision {
                    clear_session_inputs: stale_cookies || matches!(best_client.as_str(), "android" | "ios" | "android_vr" | "tv_simply"),
                    player_client: best_client.clone(), max_height: best_meta.observed_max_height.unwrap_or(0),
                    auth_mode: if used_args.cookies.as_deref().is_some_and(|c| !c.is_empty()) { "cookies" } else { "anonymous" }.into(),
                    pot_mode: best_meta.youtube_diagnostic.as_ref().map(|d| d.pot_state.clone()).unwrap_or_else(|| "unknown".into()),
                    reason: "usable inventory; requested ceiling, height, fps, dynamic range, audio, transport; stable client order".into(),
                });
                best_meta.observed_max_height =
                    capabilities.iter().map(|c| c.observed_max_height).max();
                best_meta.client_capabilities = Some(capabilities);
                best_meta.requested_resolution =
                    extra_args.as_ref().and_then(|e| e.resolution.clone());
                if stale_cookies {
                    if let Some(d) = best_meta.youtube_diagnostic.as_mut() {
                        d.cookie_state = "stale".into();
                    }
                }
                let _ = app.emit(
                    "analysis-log",
                    AnalysisLogPayload {
                        id: _id.clone(),
                        line: format!(
                            "Winner: {} with resolution {}",
                            best_client,
                            best_meta.resolution.as_deref().unwrap_or("unknown")
                        ),
                    },
                );
                return Ok(best_meta);
            } else {
                let details = if client_errors.is_empty() {
                    "All clients failed in smart mode".to_string()
                } else {
                    client_errors.join(" | ")
                };
                let code = if client_errors.iter().any(|e| youtube::auth_required(e)) {
                    if stale_cookies {
                        "COOKIE_REFRESH_REQUIRED"
                    } else {
                        "AUTH_REQUIRED"
                    }
                } else if client_errors
                    .iter()
                    .any(|e| e.contains("JS_RUNTIME_FAILURE:"))
                {
                    "JS_RUNTIME_FAILURE"
                } else {
                    "SMART_NO_USABLE_FORMAT"
                };
                return Err(AppError::ExternalCommand(format!(
                    "{}: All clients failed or exposed no usable video/audio formats: {}",
                    code, details
                )));
            }
        }

        // Standard single run
        let mut result = Self::get_metadata_internal(
            app.clone(),
            url.clone(),
            extra_args.clone(),
            _id.clone(),
            true,
            captured,
            captured_media_kind.clone(),
        )
        .await;

        let stale = match &result {
            Ok(meta) => meta
                .youtube_diagnostic
                .as_ref()
                .is_some_and(|d| d.cookie_state == "stale"),
            Err(error) => youtube::diagnose(&error.to_string(), false).cookie_state == "stale",
        };
        if !captured && is_youtube && stale {
            let base = extra_args.clone().unwrap_or_default();
            let client = base.player_client.as_deref().unwrap_or("default");
            let anonymous = youtube::client_args(&base, client, true);
            result = Self::get_metadata_internal(
                app.clone(),
                url.clone(),
                Some(anonymous),
                _id.clone(),
                true,
                false,
                None,
            )
            .await;
            match &mut result {
                Ok(meta) => {
                    if let Some(d) = meta.youtube_diagnostic.as_mut() {
                        d.cookie_state = "stale".into();
                    }
                    meta.smart_decision = Some(crate::models::SmartClientDecision {
                        player_client: client.into(),
                        max_height: meta.observed_max_height.unwrap_or(0),
                        auth_mode: "anonymous".into(),
                        pot_mode: meta
                            .youtube_diagnostic
                            .as_ref()
                            .map(|d| d.pot_state.clone())
                            .unwrap_or_else(|| "unknown".into()),
                        reason: "stale cookies; anonymous extraction succeeded".into(),
                        clear_session_inputs: true,
                    });
                }
                Err(error) if youtube::auth_required(&error.to_string()) => {
                    return Err(AppError::ExternalCommand(
                        "COOKIE_REFRESH_REQUIRED: refresh YouTube cookies for this content".into(),
                    ));
                }
                _ => {}
            }
        }

        if let Err(ref e) = result {
            if e.to_string().contains("LOGIN_REQUIRED") && !Self::client_pinned(&extra_args) {
                let _ = app.emit(
                    "analysis-log",
                    AnalysisLogPayload {
                        id: _id.clone(),
                        line: "检测到 LOGIN_REQUIRED 错误。正在尝试使用 'web' 客户端重试..."
                            .to_string(),
                    },
                );

                let mut new_args = extra_args.unwrap_or_default();
                new_args.player_client = Some("web".to_string());

                return Self::get_metadata_internal(
                    app,
                    url,
                    Some(new_args),
                    _id,
                    true,
                    captured,
                    captured_media_kind,
                )
                .await;
            }
        }

        result
    }

    /// 下载入口。终态判定与终态事件发射都收拢在这里：
    /// - 取消（标志位）→ Cancelled，不发 completed/error；
    /// - 成功 → Completed{file_path}，发一次 completed；
    /// - 失败 → Failed(原因)，发一次 error。
    pub async fn download_video(
        app: AppHandle,
        registry: DownloadState,
        request: DownloadRequest,
    ) -> AppResult<DownloadOutcome> {
        let mut attempt = request.clone();
        let mut result = Self::run_download_once(&app, &registry, &attempt).await;

        let login_required = matches!(&result, Err(e) if e.to_string().contains("LOGIN_REQUIRED"));
        if login_required && !Self::client_pinned(&attempt.extra_args) {
            let _ = app.emit(
                "analysis-log",
                AnalysisLogPayload {
                    id: attempt.id.clone(),
                    line: "下载过程中检测到 LOGIN_REQUIRED 错误。正在尝试使用 'web' 客户端重试..."
                        .to_string(),
                },
            );

            let mut new_args = attempt.extra_args.clone().unwrap_or_default();
            new_args.player_client = Some("web".to_string());
            attempt.extra_args = Some(new_args);

            result = Self::run_download_once(&app, &registry, &attempt).await;
        }

        if !attempt.captured
            && result.as_ref().err().is_some_and(|error| {
                super::task_options::subtitle_retry(
                    &error.to_string(),
                    attempt
                        .extra_args
                        .as_ref()
                        .is_some_and(|e| e.embed_subs == Some(true)),
                    registry.is_cancelled(&attempt.id),
                )
            })
        {
            let _ = app.emit(
                "analysis-log",
                AnalysisLogPayload {
                    id: attempt.id.clone(),
                    line: "[Subtitle] failed; retrying media without optional subtitles".into(),
                },
            );
            let mut extra = attempt.extra_args.clone().unwrap_or_default();
            extra.embed_subs = Some(false);
            extra.sub_langs = None;
            attempt.extra_args = Some(extra);
            result = Self::run_download_once(&app, &registry, &attempt).await;
        }

        // 终态判定：取消标志位优先于进程退出码
        let captured = request.captured;
        let outcome = if registry.is_cancelled(&request.id) {
            DownloadOutcome::Cancelled
        } else {
            match result {
                Ok(file_path) => DownloadOutcome::Completed { file_path },
                Err(e) => DownloadOutcome::Failed(redact_diagnostics(&e.to_string(), captured)),
            }
        };

        match &outcome {
            DownloadOutcome::Cancelled => {}
            DownloadOutcome::Completed { file_path } => {
                let _ = app.emit(
                    "download-progress",
                    DownloadProgressPayload {
                        id: request.id,
                        progress: 100.0,
                        status: "completed".to_string(),
                        speed: String::new(),
                        file_path: file_path.clone(),
                    },
                );
            }
            DownloadOutcome::Failed(error) => {
                tracing::error!("Download failed for task {}: {}", request.id, error);
                let _ = app.emit(
                    "download-progress",
                    DownloadProgressPayload {
                        id: request.id,
                        progress: 0.0,
                        status: "error".to_string(),
                        speed: String::new(),
                        file_path: None,
                    },
                );
            }
        }

        Ok(outcome)
    }

    fn terminal_error_for_exit(
        code: Option<i32>,
        found_login_required: bool,
        forced_failure: Option<&str>,
        stderr: &str,
    ) -> Option<AppError> {
        if let Some(reason) = forced_failure {
            return Some(AppError::ExternalCommand(reason.to_string()));
        }

        if code.unwrap_or(1) != 0 {
            if let Some(failure) = youtube::failure_code(stderr) {
                return Some(AppError::ExternalCommand(format!(
                    "{}: {}",
                    failure,
                    stderr.trim()
                )));
            }
        }

        if found_login_required {
            return Some(AppError::ExternalCommand(
                "检测到需要登录 (LOGIN_REQUIRED) 错误".to_string(),
            ));
        }

        let exit_code = code.unwrap_or(1);
        if exit_code != 0 {
            return Some(AppError::ExternalCommand(format!(
                "yt-dlp exited with code {}: {}",
                exit_code,
                stderr.trim()
            )));
        }

        None
    }

    /// 单次下载尝试。成功时返回尽力捕获的产物路径。
    async fn run_download_once(
        app: &AppHandle,
        registry: &DownloadState,
        request: &DownloadRequest,
    ) -> AppResult<Option<String>> {
        let id = request.id.clone();
        let url = request.url.clone();
        let download_type = request.download_type;
        let captured = request.captured;
        let extra_args = if captured {
            request.extra_args.clone()
        } else {
            Self::resolve_effective_extra_args(&url, &request.extra_args)
        };

        if !captured
            && Self::is_youtube_url(&url)
            && extra_args
                .as_ref()
                .is_some_and(|e| e.player_client.as_deref() == Some("smart"))
        {
            return Err(AppError::Validation(
                "SMART_DECISION_REQUIRED: analyze the URL before downloading".into(),
            ));
        }

        if !captured {
            validate_download_url(&url)?;
        }

        let _cookie_material = extra_args
            .as_ref()
            .and_then(|extra| extra.cookies.as_deref())
            .map(str::trim)
            .filter(|cookies| !cookies.is_empty() && !Self::is_browser_cookie(cookies))
            .map(Self::resolve_cookies_material)
            .unwrap_or_else(TempCookieMaterial::empty);
        let mut args =
            build_common_args_with_cookie(&extra_args, captured, _cookie_material.cookie_arg());
        if !captured {
            args.extend(Self::build_plugin_args(&url));
        }

        let _ = app.emit(
            "analysis-log",
            AnalysisLogPayload {
                id: id.clone(),
                line: format!(
                    "[Attempt] phase=started client={} auth={}",
                    extra_args
                        .as_ref()
                        .and_then(|e| e.player_client.as_deref())
                        .unwrap_or("default"),
                    if extra_args
                        .as_ref()
                        .and_then(|e| e.cookies.as_deref())
                        .is_some_and(|c| !c.trim().is_empty())
                    {
                        "cookies"
                    } else {
                        "anonymous"
                    }
                ),
            },
        );

        // Download directory
        let base_dir = if let Some(dir) = &request.download_dir {
            PathBuf::from(dir)
        } else {
            app.path()
                .download_dir()
                .unwrap_or(PathBuf::from("."))
                .join("YTDL-Flow")
        };

        if !base_dir.exists() {
            std::fs::create_dir_all(&base_dir).map_err(AppError::Io)?;
        }

        // Output template
        let template = resolve_filename_template(&extra_args)?;
        let output_template = resolve_output_template(&base_dir, template)?;

        args.push("-o".to_string());
        args.push(output_template.to_string_lossy().to_string());

        // 尽力捕获产物路径：移动完成后由 yt-dlp 打印最终文件位置
        args.push("--print".to_string());
        args.push("after_move:filepath".to_string());
        args.push("--no-simulate".to_string());
        // --print otherwise makes yt-dlp quiet and hides the selected stream count.
        args.push("--no-quiet".to_string());
        args.extend(["--progress-template".into(), "download:[Flow]%(info.format_id)s|%(info.vcodec)s|%(info.acodec)s|%(progress._percent_str)s|%(progress._speed_str)s".into()]);

        // Format selection
        match download_type {
            DownloadType::Audio => {
                args.push("-x".to_string());
                args.push("--audio-format".to_string());
                let audio_format = extra_args
                    .as_ref()
                    .and_then(|extra| extra.audio_codec.as_deref())
                    .map(str::trim)
                    .filter(|codec| !codec.is_empty() && *codec != "auto")
                    .unwrap_or("mp3");
                args.push(audio_format.to_string());
            }
            DownloadType::Mkv => {
                args.push("--merge-output-format".to_string());
                args.push("mkv".to_string());
            }
            DownloadType::Video => {
                args.push("--merge-output-format".to_string());
                args.push("mp4".to_string());
            }
        }

        if !captured {
            if let Some(extra) = &extra_args {
                args.extend(super::task_options::flags(extra)?);
                if extra.embed_subs == Some(false) {
                    args.extend([
                        "--no-embed-subs".into(),
                        "--no-write-subs".into(),
                        "--no-write-auto-subs".into(),
                    ]);
                }
            }
        }

        // Resolution / codec preferences expressed as format sorting
        if let Some(extra) = &extra_args {
            let fields = build_format_sort_fields(extra);
            if !fields.is_empty() {
                args.push("-S".to_string());
                args.push(fields.join(","));
            }
        }

        // Captured execution bypasses extractors: native code supplies a minimal
        // direct-media InfoJSON descriptor through stdin, never a naked URL in argv.
        let stdin_payload = if captured {
            Some(
                deliver_captured_direct_descriptor(
                    &mut args,
                    &url,
                    request.captured_media_kind.as_deref().ok_or_else(|| {
                        AppError::Validation("captured direct media kind is missing".to_string())
                    })?,
                    &id,
                    &request.replay_headers,
                )
                .map_err(AppError::Validation)?,
            )
        } else {
            deliver_url(&mut args, &url, false, &request.replay_headers)
        };

        if registry
            .confirm_cancel_before_spawn(&id)
            .map_err(AppError::ExternalCommand)?
        {
            return Err(AppError::Download(
                "download cancelled before spawn".to_string(),
            ));
        }

        let egress_guard = if captured {
            Some(
                crate::services::capture::egress::CaptureEgressGuard::start()
                    .await
                    .map_err(|_| {
                        AppError::Download("capture egress guard unavailable".to_string())
                    })?,
            )
        } else {
            None
        };
        let guard_proxy = egress_guard.as_ref().map(|guard| guard.proxy_url());
        apply_capture_egress_proxy(&mut args, captured, guard_proxy.as_deref());

        let cmd = app
            .shell()
            .sidecar("yt-dlp")
            .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
        let cmd = cmd
            .args(args)
            .env("PATH", crate::utils::get_enhanced_path(app))
            .env("PYTHONIOENCODING", "utf-8");
        let mut cmd = cmd;
        if captured {
            for key in [
                "NO_PROXY",
                "no_proxy",
                "HTTP_PROXY",
                "http_proxy",
                "HTTPS_PROXY",
                "https_proxy",
                "ALL_PROXY",
                "all_proxy",
            ] {
                cmd = cmd.env(key, "");
            }
        }

        let (mut rx, child) = cmd
            .spawn()
            .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

        let pid = child.pid();
        match stdin_payload {
            Some(stdin_payload) => {
                let mut child = child;
                if let Err(error) = registry.attach_process_id(&id, pid) {
                    cleanup_failed_attempt(registry, &id, pid, &mut rx).await;
                    return Err(AppError::ExternalCommand(error));
                }
                if registry.is_cancelled(&id) {
                    return Err(AppError::Download("download cancelled".to_string()));
                }
                if let Err(error) = child.write(format!("{stdin_payload}\n").as_bytes()) {
                    tracing::error!(
                        "Failed to deliver the captured URL to the downloader for task {}: {}",
                        id,
                        error
                    );
                    cleanup_failed_attempt(registry, &id, pid, &mut rx).await;
                    return Err(AppError::Download(
                        "failed to deliver the captured resource to the downloader".to_string(),
                    ));
                }
                // Dropping the plugin handle closes stdin, which is what makes
                // `--batch-file -` reach EOF and start downloading.
                drop(child);
            }
            None => {
                if let Err((error, unattached_child)) = registry.attach_child(&id, child) {
                    if let Some(child) = unattached_child {
                        // Registry acquisition failed: retain the actual handle
                        // locally until cleanup/termination proves exit.
                        cleanup_analyzer(AnalyzerChild::Handle(child), &mut rx).await;
                    } else {
                        cleanup_failed_attempt(registry, &id, pid, &mut rx).await;
                    }
                    return Err(AppError::ExternalCommand(error));
                }
            }
        }

        let id_clone = id.clone();
        let app_clone = app.clone();

        let mut found_login_required = false;
        let mut last_progress = 0.0;
        let mut transfer = super::transfer_progress::TransferProgress::default();
        let mut transfer_phase = "";
        let mut printed_path: Option<String> = None;
        let mut stderr_buffer = String::new();
        let mut last_activity = std::time::Instant::now();
        let stall_budget = std::time::Duration::from_secs(NO_PROGRESS_TIMEOUT_SECS);
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(WATCHDOG_TICK_SECS));

        loop {
            tokio::select! {
                event = rx.recv() => {
                    let Some(event) = event else {
                        cleanup_failed_attempt(registry, &id_clone, pid, &mut rx).await;
                        if registry.is_cancelled(&id_clone) {
                            return Err(AppError::Download("download cancelled".to_string()));
                        }
                        return Err(AppError::ExternalCommand(
                            "yt-dlp event stream ended without a terminal status".to_string(),
                        ));
                    };
                    last_activity = std::time::Instant::now();
                    match event {
                        tauri_plugin_shell::process::CommandEvent::Stdout(line_bytes) => {
                            let line = Self::decode_bytes(&line_bytes);
                            let line = line.trim().to_string();
                            if line.is_empty() {
                                continue;
                            }

                            let _ = app_clone.emit(
                                "analysis-log",
                                AnalysisLogPayload {
                                    id: id_clone.clone(),
                                    line: redact_diagnostics(&line, captured),
                                },
                            );

                            // --print after_move:filepath 的输出：不带方括号的裸路径行，
                            // 且文件此刻已存在
                            if !line.starts_with('[') && PathBuf::from(&line).exists() {
                                printed_path = Some(line);
                                continue;
                            }

                            // 后处理阶段（合并/封装/提取音频）→ 通知前端进入 processing 状态
                            if Self::is_post_processing_line(&line) {
                                let _ = app_clone.emit(
                                    "download-progress",
                                    DownloadProgressPayload {
                                        id: id_clone.clone(),
                                        progress: last_progress,
                                        status: "processing".to_string(),
                                        speed: String::new(),
                                        file_path: None,
                                    },
                                );
                                continue;
                            }

                            let transfer_update = transfer.observe(&line);
                            if let Some((_, _, phase)) = &transfer_update {
                                if transfer_phase != *phase {
                                    transfer_phase = phase;
                                    let _ = app_clone.emit("analysis-log", AnalysisLogPayload { id: id_clone.clone(), line: format!("[Phase] {}", phase) });
                                }
                            }
                            if let Some((pct, speed)) = transfer_update.map(|(p, s, _)| (p, s)).or_else(|| Self::parse_progress_line(&line, last_progress)) {
                                last_progress = pct;
                                let _ = app_clone.emit(
                                    "download-progress",
                                    DownloadProgressPayload {
                                        id: id_clone.clone(),
                                        progress: pct,
                                        status: "downloading".to_string(),
                                        speed,
                                        file_path: None,
                                    },
                                );
                            }
                        }
                        tauri_plugin_shell::process::CommandEvent::Stderr(line_bytes) => {
                            let line = Self::decode_bytes(&line_bytes);
                            let line = line.trim();
                            if !line.is_empty() {
                                let transfer_update = transfer.observe(line);
                                if let Some((_, _, phase)) = &transfer_update {
                                    if transfer_phase != *phase {
                                        transfer_phase = phase;
                                        let _ = app_clone.emit("analysis-log", AnalysisLogPayload { id: id_clone.clone(), line: format!("[Phase] {}", phase) });
                                    }
                                }
                                if Self::is_post_processing_line(line) {
                                    let _ = app_clone.emit("download-progress", DownloadProgressPayload { id: id_clone.clone(), progress: last_progress, status: "processing".into(), speed: String::new(), file_path: None });
                                } else if let Some((pct, speed)) = transfer_update.map(|(p, s, _)| (p, s)).or_else(|| Self::parse_progress_line(line, last_progress)) {
                                    last_progress = pct;
                                    let _ = app_clone.emit(
                                        "download-progress",
                                        DownloadProgressPayload {
                                            id: id_clone.clone(),
                                            progress: pct,
                                            status: "downloading".to_string(),
                                            speed,
                                            file_path: None,
                                        },
                                    );
                                    continue;
                                }

                                stderr_buffer.push_str(line);
                                stderr_buffer.push('\n');
                                if line.contains("LOGIN_REQUIRED") {
                                    found_login_required = true;
                                }
                                let _ = app_clone.emit(
                                    "analysis-log",
                                    AnalysisLogPayload {
                                        id: id_clone.clone(),
                                        line: redact_diagnostics(&format!("[ERR] {}", line), captured),
                                    },
                                );
                            }
                        }
                        tauri_plugin_shell::process::CommandEvent::Error(error) => {
                            cleanup_failed_attempt(registry, &id_clone, pid, &mut rx).await;
                            if registry.is_cancelled(&id_clone) {
                                return Err(AppError::Download("download cancelled".to_string()));
                            }
                            return Err(AppError::ExternalCommand(error));
                        }
                        tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                            registry.confirm_process_exit(&id_clone);

                            let _ = app_clone.emit("analysis-log", AnalysisLogPayload {
                                id: id_clone.clone(),
                                line: format!("[Attempt] phase=finished exitCode={}", status.code.map(|code| code.to_string()).unwrap_or_else(|| "unknown".into())),
                            });

                            if registry.is_cancelled(&id_clone) {
                                return Err(AppError::Download("download cancelled".to_string()));
                            }

                            if let Some(error) = Self::terminal_error_for_exit(
                                status.code,
                                found_login_required,
                                None,
                                &stderr_buffer,
                            ) {
                                return Err(error);
                            }

                            if !super::task_options::verified_artifact(printed_path.as_deref()) {
                                return Err(AppError::Download("DOWNLOAD_OUTPUT_MISSING: downloader exited without a nonempty output file".into()));
                            }
                            return Ok(printed_path);
                        }
                        _ => {}
                    }
                }
                _ = ticker.tick() => {
                    if last_activity.elapsed() > stall_budget {
                        let reason = format!(
                            "下载停滞超过 {} 秒，已请求终止",
                            NO_PROGRESS_TIMEOUT_SECS
                        );

                        cleanup_failed_attempt(registry, &id_clone, pid, &mut rx).await;
                        if registry.is_cancelled(&id_clone) {
                            return Err(AppError::Download("download cancelled".to_string()));
                        }

                        return Err(AppError::ExternalCommand(reason));
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn assert_metadata_failure_retains_ownership(trigger: &str) {
        let state = DownloadState::new();
        let guard = state.begin_tool_activity().expect("activity");
        let outcome = std::sync::Arc::new(std::sync::Mutex::new(Err("tree-kill denied".into())));
        let anchor = std::sync::Arc::new(());
        let retained = std::sync::Arc::downgrade(&anchor);
        let child = AnalyzerChild::TestCleanup {
            cleanup: Box::new({
                let outcome = outcome.clone();
                move || outcome.lock().expect("fixture").clone()
            }),
            _anchor: anchor,
        };
        let (tx, mut rx) = tokio::sync::mpsc::channel(2);
        let tx = if trigger == "EOF" {
            drop(tx);
            None
        } else {
            if trigger == "Error" {
                tx.send(tauri_plugin_shell::process::CommandEvent::Error(
                    "read failed".into(),
                ))
                .await
                .expect("send Error");
            }
            Some(tx)
        };
        let budget = if trigger == "Timeout" {
            std::time::Duration::ZERO
        } else {
            std::time::Duration::from_secs(30)
        };
        let mut pending = Box::pin(async move {
            let _guard = guard;
            DownloadService::read_metadata_process(
                child,
                &mut rx,
                "https://example.com/video",
                false,
                |_| {},
                budget,
            )
            .await
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut pending)
                .await
                .is_err(),
            "{trigger} cannot return while tree cleanup fails"
        );
        assert!(retained.upgrade().is_some(), "{trigger} retains its child");
        assert_eq!(state.active_tool_activity_count(), 1);
        assert!(state.begin_tool_mutation().is_err());
        *outcome.lock().expect("fixture") = Ok(());
        if let Some(tx) = tx {
            tx.send(tauri_plugin_shell::process::CommandEvent::Terminated(
                tauri_plugin_shell::process::TerminatedPayload {
                    code: Some(1),
                    signal: None,
                },
            ))
            .await
            .expect("send exit proof");
        }
        let error = tokio::time::timeout(
            std::time::Duration::from_secs(WATCHDOG_TICK_SECS + 1),
            pending,
        )
        .await
        .expect("cleanup retry or exit proof")
        .expect_err("original failure");
        let expected = match trigger {
            "Error" => "read failed",
            "EOF" => "stream closed",
            _ => "timed out",
        };
        assert!(
            error.to_string().contains(expected),
            "preserve original {trigger} error: {error}"
        );
        assert!(retained.upgrade().is_none());
        assert_eq!(state.active_tool_activity_count(), 0);
        assert!(state.begin_tool_mutation().is_ok());
    }

    #[tokio::test]
    async fn metadata_error_retains_ownership_until_exit_proof() {
        assert_metadata_failure_retains_ownership("Error").await;
    }

    #[tokio::test]
    async fn metadata_timeout_retains_ownership_until_exit_proof() {
        assert_metadata_failure_retains_ownership("Timeout").await;
    }

    #[tokio::test]
    async fn metadata_eof_retains_ownership_until_cleanup_retry() {
        assert_metadata_failure_retains_ownership("EOF").await;
    }

    #[tokio::test]
    async fn metadata_terminated_releases_anchor_without_another_kill() {
        let anchor = std::sync::Arc::new(());
        let retained = std::sync::Arc::downgrade(&anchor);
        let child = AnalyzerChild::TestCleanup {
            cleanup: Box::new(|| panic!("Terminated already proves exit")),
            _anchor: anchor,
        };
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        tx.send(tauri_plugin_shell::process::CommandEvent::Terminated(
            tauri_plugin_shell::process::TerminatedPayload {
                code: Some(1),
                signal: None,
            },
        ))
        .await
        .expect("send Terminated");
        let error = DownloadService::read_metadata_process(
            child,
            &mut rx,
            "https://example.com/video",
            false,
            |_| {},
            std::time::Duration::from_secs(30),
        )
        .await
        .expect_err("exit failure");
        assert!(error.to_string().contains("Exit Code"));
        assert!(retained.upgrade().is_none());
    }

    #[tokio::test]
    async fn analyzer_pipe_error_keeps_tool_activity_and_anchor_until_termination() {
        let state = DownloadState::new();
        let guard = state.begin_tool_activity().expect("activity");
        let anchor = std::sync::Arc::new(());
        let retained = std::sync::Arc::downgrade(&anchor);
        let child = AnalyzerChild::TestCleanup {
            cleanup: Box::new(|| Err("tree-kill denied".into())),
            _anchor: anchor,
        };
        let (tx, mut rx) = tokio::sync::mpsc::channel(2);
        tx.send(tauri_plugin_shell::process::CommandEvent::Error(
            "read failed".into(),
        ))
        .await
        .expect("send pipe error");
        let mut pending = Box::pin(async move {
            let _guard = guard;
            cleanup_analyzer(child, &mut rx).await;
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut pending)
                .await
                .is_err()
        );
        assert!(retained.upgrade().is_some());
        assert_eq!(state.active_tool_activity_count(), 1);
        assert!(
            state.begin_tool_mutation().is_err(),
            "maintenance must remain blocked"
        );
        tx.send(tauri_plugin_shell::process::CommandEvent::Terminated(
            tauri_plugin_shell::process::TerminatedPayload {
                code: Some(1),
                signal: None,
            },
        ))
        .await
        .expect("send exit proof");
        tokio::time::timeout(std::time::Duration::from_secs(1), pending)
            .await
            .expect("terminated");
        assert!(retained.upgrade().is_none());
        assert_eq!(state.active_tool_activity_count(), 0);
        assert!(state.begin_tool_mutation().is_ok());
    }

    #[tokio::test]
    async fn failed_cancel_then_terminated_settles_as_cancelled() {
        let state = DownloadState::new();
        state
            .begin_execution("cancel-terminated".into())
            .expect("begin");
        let cleanup = std::sync::Arc::new(std::sync::Mutex::new(Err("tree-kill denied".into())));
        state
            .attach_test_process("cancel-terminated", cleanup)
            .expect("attach");
        assert!(state.request_cancel("cancel-terminated").is_err());
        assert!(!state.is_cancelled("cancel-terminated"));
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        tx.send(tauri_plugin_shell::process::CommandEvent::Terminated(
            tauri_plugin_shell::process::TerminatedPayload {
                code: Some(1),
                signal: None,
            },
        ))
        .await
        .expect("send exit proof");
        cleanup_failed_attempt(&state, "cancel-terminated", 999_999, &mut rx).await;
        assert!(
            state.is_cancelled("cancel-terminated"),
            "actual exit proves pending cancellation"
        );
        assert!(state.finish_execution("cancel-terminated"));
        assert!(!state.finish_execution("cancel-terminated"));
    }

    #[tokio::test]
    async fn analyzer_cleanup_failure_retains_anchor_until_retry_succeeds() {
        let outcome = std::sync::Arc::new(std::sync::Mutex::new(Err("tree-kill denied".into())));
        let anchor = std::sync::Arc::new(());
        let retained = std::sync::Arc::downgrade(&anchor);
        let child = AnalyzerChild::TestCleanup {
            cleanup: Box::new({
                let outcome = outcome.clone();
                move || outcome.lock().expect("fixture").clone()
            }),
            _anchor: anchor,
        };
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        let mut pending = Box::pin(cleanup_analyzer(child, &mut rx));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut pending)
                .await
                .is_err(),
            "failed cleanup must not allow analysis to return"
        );
        assert!(retained.upgrade().is_some(), "keep the only process anchor");
        *outcome.lock().expect("fixture") = Ok(());
        tx.send(tauri_plugin_shell::process::CommandEvent::Error(
            "pipe error is not exit proof".into(),
        ))
        .await
        .expect("send");
        tokio::time::timeout(std::time::Duration::from_secs(1), pending)
            .await
            .expect("successful retry permits return");
        assert!(retained.upgrade().is_none());
    }

    #[tokio::test]
    async fn analyzer_cleanup_success_permits_return_without_termination_event() {
        let anchor = std::sync::Arc::new(());
        let retained = std::sync::Arc::downgrade(&anchor);
        let child = AnalyzerChild::TestCleanup {
            cleanup: Box::new(|| Ok(())),
            _anchor: anchor,
        };
        let (_tx, mut rx) = tokio::sync::mpsc::channel(1);
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            cleanup_analyzer(child, &mut rx),
        )
        .await
        .expect("successful tree cleanup proves exit without a shell event");
        assert!(retained.upgrade().is_none());
    }

    #[tokio::test]
    async fn analyzer_cleanup_termination_proves_exit_despite_cleanup_failure() {
        let anchor = std::sync::Arc::new(());
        let retained = std::sync::Arc::downgrade(&anchor);
        let child = AnalyzerChild::TestCleanup {
            cleanup: Box::new(|| Err("tree-kill denied".into())),
            _anchor: anchor,
        };
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        let mut pending = Box::pin(cleanup_analyzer(child, &mut rx));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut pending)
                .await
                .is_err()
        );
        assert!(retained.upgrade().is_some());
        tx.send(tauri_plugin_shell::process::CommandEvent::Terminated(
            tauri_plugin_shell::process::TerminatedPayload {
                code: Some(1),
                signal: None,
            },
        ))
        .await
        .expect("send exit proof");
        tokio::time::timeout(std::time::Duration::from_secs(1), pending)
            .await
            .expect("Terminated permits return even when tree cleanup fails");
        assert!(retained.upgrade().is_none());
    }

    #[tokio::test]
    async fn analyzer_cleanup_stream_close_retains_anchor_until_retry_succeeds() {
        let outcome = std::sync::Arc::new(std::sync::Mutex::new(Err("tree-kill denied".into())));
        let anchor = std::sync::Arc::new(());
        let retained = std::sync::Arc::downgrade(&anchor);
        let child = AnalyzerChild::TestCleanup {
            cleanup: Box::new({
                let outcome = outcome.clone();
                move || outcome.lock().expect("fixture").clone()
            }),
            _anchor: anchor,
        };
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        drop(tx);
        let mut pending = Box::pin(cleanup_analyzer(child, &mut rx));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut pending)
                .await
                .is_err(),
            "EOF is not exit proof"
        );
        assert!(retained.upgrade().is_some());
        *outcome.lock().expect("fixture") = Ok(());
        tokio::time::timeout(
            std::time::Duration::from_secs(WATCHDOG_TICK_SECS + 1),
            pending,
        )
        .await
        .expect("cleanup remains retryable after EOF");
        assert!(retained.upgrade().is_none());
    }

    #[tokio::test]
    async fn download_failure_waits_for_cleanup_proof_without_releasing_ownership() {
        let state = DownloadState::new();
        state.begin_execution("pipe-failure".into()).expect("begin");
        let cleanup = std::sync::Arc::new(std::sync::Mutex::new(Err("tree-kill denied".into())));
        state
            .attach_test_process("pipe-failure", cleanup.clone())
            .expect("attach");
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        let mut pending = Box::pin(cleanup_failed_attempt(
            &state,
            "pipe-failure",
            999_999,
            &mut rx,
        ));

        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut pending)
                .await
                .is_err()
        );
        assert!(
            !state.finish_execution("pipe-failure"),
            "no FIFO settlement while cleanup fails"
        );
        assert!(state.begin_execution("pipe-failure".into()).is_err());
        *cleanup.lock().expect("fixture") = Ok(());
        tx.send(tauri_plugin_shell::process::CommandEvent::Error(
            "another pipe error".into(),
        ))
        .await
        .expect("send");
        tokio::time::timeout(std::time::Duration::from_secs(2), pending)
            .await
            .expect("cleanup retry completes");
        assert!(state.finish_execution("pipe-failure"));
        assert!(
            !state.finish_execution("pipe-failure"),
            "one settlement only"
        );
    }

    #[tokio::test]
    async fn download_failure_closed_stream_keeps_ownership_until_cleanup_retry() {
        let state = DownloadState::new();
        state
            .begin_execution("closed-stream".into())
            .expect("begin");
        let cleanup = std::sync::Arc::new(std::sync::Mutex::new(Err("tree-kill denied".into())));
        state
            .attach_test_process("closed-stream", cleanup.clone())
            .expect("attach");
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        drop(tx);
        let mut pending = Box::pin(cleanup_failed_attempt(
            &state,
            "closed-stream",
            999_999,
            &mut rx,
        ));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut pending)
                .await
                .is_err()
        );
        assert!(!state.finish_execution("closed-stream"));
        *cleanup.lock().expect("fixture") = Ok(());
        tokio::time::timeout(
            std::time::Duration::from_secs(WATCHDOG_TICK_SECS + 1),
            pending,
        )
        .await
        .expect("closed streams still retry cleanup");
        assert!(state.finish_execution("closed-stream"));
        assert!(!state.finish_execution("closed-stream"));
    }

    #[tokio::test]
    async fn download_failure_termination_proves_exit_even_when_cleanup_fails() {
        let state = DownloadState::new();
        state.begin_execution("terminated".into()).expect("begin");
        let cleanup = std::sync::Arc::new(std::sync::Mutex::new(Err("tree-kill denied".into())));
        state
            .attach_test_process("terminated", cleanup)
            .expect("attach");
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        tx.send(tauri_plugin_shell::process::CommandEvent::Terminated(
            tauri_plugin_shell::process::TerminatedPayload {
                code: Some(1),
                signal: None,
            },
        ))
        .await
        .expect("send termination");
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            cleanup_failed_attempt(&state, "terminated", 999_999, &mut rx),
        )
        .await
        .expect("termination proves exit");
        assert!(state.finish_execution("terminated"));
        assert!(!state.finish_execution("terminated"));
    }

    fn flags(extra: &ExtraArgs) -> String {
        build_extra_flags(extra).join(" ")
    }

    #[test]
    fn captured_direct_descriptor_is_delivered_through_stdin_without_extractor_or_batch_url() {
        let raw_url = "https://cdn.example.com/clip.mp4?sig=s3cr3t&expires=1";
        let mut args = Vec::new();
        let stdin_json = deliver_captured_direct_descriptor(
            &mut args,
            raw_url,
            "video",
            "attempt-1",
            &[("user-agent".to_string(), "UA/1.0".to_string())],
        )
        .expect("direct descriptor");

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--load-info-json", "-"]));
        assert!(!args.contains(&"--batch-file".to_string()));
        assert!(!args.contains(&"--use-extractors".to_string()));
        assert!(
            !args.iter().any(|arg| arg.contains("sig=")
                || arg.contains("s3cr3t")
                || arg.contains("https://")),
            "the raw URL or its secret must never appear in argv: {args:?}"
        );
        let json: serde_json::Value = serde_json::from_str(&stdin_json).expect("valid descriptor");
        assert_eq!(json["url"], raw_url);
        assert_eq!(json["protocol"], "https");
        assert_eq!(json["ext"], "mp4");
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--user-agent", "UA/1.0"]));
    }

    #[test]
    fn captured_direct_descriptor_rejects_non_direct_kind_and_non_http_scheme() {
        let mut args = Vec::new();
        assert!(deliver_captured_direct_descriptor(
            &mut args,
            "https://cdn.example.com/master.m3u8",
            "hls",
            "attempt-1",
            &[],
        )
        .is_err());
        assert!(deliver_captured_direct_descriptor(
            &mut args,
            "file:///tmp/clip.mp4",
            "video",
            "attempt-1",
            &[],
        )
        .is_err());
    }

    #[test]
    fn pasted_urls_keep_their_existing_argv_delivery() {
        let url = "https://example.com/watch?v=1";
        let mut args = Vec::new();
        let stdin_url = deliver_url(&mut args, url, false, &[]);

        assert!(stdin_url.is_none());
        assert!(args.contains(&url.to_string()));
        assert!(!args.contains(&"--batch-file".to_string()));
    }

    #[test]
    fn captured_common_args_close_the_ytdlp_config_and_info_json_paths() {
        let extra = ExtraArgs {
            write_info_json: Some(true),
            ..Default::default()
        };

        let captured = build_common_args_for(&Some(extra.clone()), true);
        assert!(
            captured.contains(&"--ignore-config".to_string()),
            "captured execution must ignore user/system yt-dlp config: {captured:?}"
        );
        assert!(
            captured.contains(&"--no-write-info-json".to_string()),
            "captured execution must force-disable info-json: {captured:?}"
        );
        assert!(
            !captured.contains(&"--write-info-json".to_string()),
            "captured execution must never request info-json: {captured:?}"
        );
        assert!(captured.contains(&"--no-js-runtimes".to_string()));
        assert!(
            !captured.contains(&"--js-runtimes".to_string())
                && !captured.contains(&"bun".to_string()),
            "captured execution must not re-enable Bun: {captured:?}"
        );
        assert!(
            !captured.contains(&"--use-extractors".to_string()),
            "captured execution must bypass extractors entirely: {captured:?}"
        );

        let pasted = build_common_args_for(&Some(extra), false);
        assert!(
            !pasted.contains(&"--ignore-config".to_string()),
            "ordinary URL behavior must keep reading the user yt-dlp config"
        );
        assert!(pasted.contains(&"--write-info-json".to_string()));
        assert!(!pasted.contains(&"--no-write-info-json".to_string()));
        assert!(pasted
            .windows(2)
            .any(|pair| pair == ["--js-runtimes", "bun"]));
        assert!(!pasted.contains(&"--use-extractors".to_string()));
    }

    #[test]
    fn captured_egress_proxy_is_generated_once_and_cannot_be_overridden() {
        let user_proxy = format!("{}://{}:{}", "http", "user-proxy.invalid", 9999);
        let extra = ExtraArgs {
            proxy: Some(user_proxy.clone()),
            ..Default::default()
        };
        let guard_proxy = format!("{}://{}:{}", "socks5h", "127.0.0.1", 32123);

        let mut captured = build_common_args_for(&Some(extra.clone()), true);
        apply_capture_egress_proxy(&mut captured, true, Some(&guard_proxy));

        let proxy_pairs = captured
            .windows(2)
            .filter(|pair| pair[0] == "--proxy")
            .collect::<Vec<_>>();
        assert_eq!(proxy_pairs.len(), 1);
        assert_eq!(proxy_pairs[0][1], guard_proxy);
        assert!(!captured.iter().any(|arg| arg == &user_proxy));

        let mut pasted = build_common_args_for(&Some(extra), false);
        apply_capture_egress_proxy(&mut pasted, false, None);
        assert!(
            pasted
                .windows(2)
                .any(|pair| { pair[0] == "--proxy" && pair[1] == user_proxy }),
            "ordinary URL proxy semantics must stay unchanged: {pasted:?}"
        );
    }

    /// Native proof that captured execution closes the yt-dlp config environment
    /// and never persists the raw/signed source URL:
    ///
    /// - an isolated user config with a synthetic `Authorization` header must be
    ///   honored by the ordinary pasted path (positive control) and must never
    ///   reach the fixture server for captured execution;
    /// - no captured output file (including `.info.json` or embedded media
    ///   metadata) may contain the signed URL token;
    /// - the ordinary path keeps its current info-json behavior.
    #[test]
    #[ignore = "runs the bundled yt-dlp binary with an isolated user config against a loopback fixture"]
    fn captured_execution_ignores_isolated_user_config_and_never_persists_the_source_url() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        use std::sync::{Arc, Mutex};

        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let yt_dlp = manifest_dir.join("bin/yt-dlp.exe");
        let ffmpeg = manifest_dir.join("bin/ffmpeg.exe");
        if !yt_dlp.is_file() || !ffmpeg.is_file() {
            println!("SKIPPED: bundled yt-dlp/ffmpeg binaries are not present");
            return;
        }

        let root = std::env::temp_dir().join(format!(
            "ytdl-flow-captured-config-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&root);

        let appdata = root.join("AppData");
        let home = root.join("Home");
        let xdg = home.join(".config");
        let config_dirs = [appdata.join("yt-dlp"), xdg.join("yt-dlp")];
        for dir in &config_dirs {
            std::fs::create_dir_all(dir).expect("create isolated yt-dlp config dir");
        }
        let synthetic_secret = "remediation-a-synthetic-secret";
        let config_body = format!(
            "--add-header \"Authorization:Bearer {synthetic_secret}\"\n--write-info-json\n--embed-metadata\n"
        );
        for dir in &config_dirs {
            std::fs::write(dir.join("config"), &config_body).expect("write isolated yt-dlp config");
            std::fs::write(dir.join("config.txt"), &config_body)
                .expect("write isolated yt-dlp config.txt");
        }

        let fixture_source = root.join("fixture-source.mp4");
        let generated = Command::new(&ffmpeg)
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=duration=1:size=96x54:rate=10",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&fixture_source)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .expect("run bundled ffmpeg to generate the fixture");
        assert!(
            generated.status.success(),
            "fixture generation failed: {}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let fixture_bytes = std::fs::read(&fixture_source).expect("read fixture");

        let observed_headers: Arc<Mutex<Vec<(u64, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let server_records = observed_headers.clone();
        let server_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let serve_stop = server_stop.clone();
        let (port_tx, port_rx) = std::sync::mpsc::channel::<u16>();
        let fixture_for_server = fixture_bytes.clone();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("fixture runtime");
            runtime.block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .expect("fixture bind");
                let _ = port_tx.send(listener.local_addr().expect("fixture addr").port());
                let mut sequence: u64 = 0;
                loop {
                    if serve_stop.load(std::sync::atomic::Ordering::SeqCst) {
                        break;
                    }
                    let accepted = tokio::time::timeout(
                        std::time::Duration::from_millis(200),
                        listener.accept(),
                    )
                    .await;
                    let Ok(Ok((mut socket, _))) = accepted else { continue };
                    sequence += 1;
                    let body = fixture_for_server.clone();
                    let records = server_records.clone();
                    tokio::spawn(async move {
                        use tokio::io::{AsyncReadExt, AsyncWriteExt};
                        let mut request = vec![0u8; 8192];
                        let read = socket.read(&mut request).await.unwrap_or(0);
                        let text = String::from_utf8_lossy(&request[..read]).to_string();
                        for line in text.lines().skip(1) {
                            if let Some((name, value)) = line.split_once(':') {
                                if name.trim().eq_ignore_ascii_case("authorization") {
                                    records
                                        .lock()
                                        .expect("header records")
                                        .push((sequence, value.trim().to_string()));
                                }
                            }
                        }
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = socket.write_all(response.as_bytes()).await;
                        let _ = socket.write_all(&body).await;
                        let _ = socket.flush().await;
                    });
                }
            });
        });
        let port = port_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("fixture port");

        let bin_dir = manifest_dir.join("bin");
        let enhanced_path = format!(
            "{};{}",
            bin_dir.to_string_lossy(),
            std::env::var("PATH").unwrap_or_default()
        );
        let extra = ExtraArgs {
            write_info_json: Some(true),
            embed_metadata: Some(true),
            ..Default::default()
        };

        let run = |captured: bool, tag: &str, directory: &std::path::Path| {
            std::fs::create_dir_all(directory).expect("create output dir");
            let raw_url = format!("http://127.0.0.1:{port}/fixture.mp4?sig={tag}-s3cr3t-token");
            let mut args = build_common_args_for(&Some(extra.clone()), captured);
            args.push("-o".to_string());
            args.push(
                directory
                    .join("%(title)s.%(ext)s")
                    .to_string_lossy()
                    .to_string(),
            );
            args.push("--no-simulate".to_string());
            args.push("--print".to_string());
            args.push("after_move:filepath".to_string());
            let stdin_url = deliver_url(&mut args, &raw_url, captured, &[]);
            if captured {
                assert!(
                    !args.iter().any(|arg| arg.contains("sig=")),
                    "the signed URL must never appear in argv: {args:?}"
                );
            }

            let mut child = Command::new(&yt_dlp)
                .args(&args)
                .env("APPDATA", &appdata)
                .env("HOME", &home)
                .env("XDG_CONFIG_HOME", &xdg)
                .env("PATH", &enhanced_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn yt-dlp");
            if let Some(stdin_url) = stdin_url {
                child
                    .stdin
                    .as_mut()
                    .expect("piped stdin")
                    .write_all(format!("{stdin_url}\n").as_bytes())
                    .expect("write the captured URL to stdin");
            }
            drop(child.stdin.take());
            let output = child.wait_with_output().expect("yt-dlp output");
            println!(
                "[{tag}] stdout: {}\n[{tag}] stderr: {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                output.status.success(),
                "[{tag}] yt-dlp must succeed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
        };

        // Positive control: the isolated user config is effective, so the
        // ordinary pasted path must honor its Authorization header.
        let pasted_dir = root.join("pasted-out");
        run(false, "pasted", &pasted_dir);
        let ordinary_requests = observed_headers.lock().expect("header records").clone();
        assert!(
            ordinary_requests
                .iter()
                .any(|(_, value)| value.contains(synthetic_secret)),
            "positive control failed: the isolated yt-dlp config was not honored by the pasted path: {ordinary_requests:?}"
        );
        let pasted_files: Vec<std::path::PathBuf> = std::fs::read_dir(&pasted_dir)
            .expect("pasted output dir")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        let pasted_leaked = pasted_files.iter().any(|path| {
            std::fs::read(path)
                .map(|bytes| String::from_utf8_lossy(&bytes).contains("pasted-s3cr3t-token"))
                .unwrap_or(false)
        });
        assert!(
            pasted_leaked,
            "scanner control failed: the ordinary info-json must persist the source URL: {pasted_files:?}"
        );

        // Captured execution: the config must be ignored and nothing may retain
        // the signed URL.
        let captured_dir = root.join("captured-out");
        run(true, "captured", &captured_dir);
        let captured_requests: Vec<(u64, String)> = observed_headers
            .lock()
            .expect("header records")
            .iter()
            .filter(|(sequence, _)| {
                *sequence
                    > ordinary_requests
                        .iter()
                        .map(|(seq, _)| *seq)
                        .max()
                        .unwrap_or(0)
            })
            .cloned()
            .collect();
        assert!(
            !captured_requests
                .iter()
                .any(|(_, value)| value.contains(synthetic_secret)),
            "captured execution must ignore the user config Authorization header: {captured_requests:?}"
        );

        let captured_files: Vec<std::path::PathBuf> = std::fs::read_dir(&captured_dir)
            .expect("captured output dir")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        assert!(
            !captured_files.is_empty(),
            "captured execution must produce an artifact"
        );
        for file in &captured_files {
            assert!(
                !file
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("")
                    .ends_with(".info.json"),
                "captured execution must not write an info-json: {captured_files:?}"
            );
            let bytes = std::fs::read(file).expect("read captured artifact");
            assert!(
                !String::from_utf8_lossy(&bytes).contains("captured-s3cr3t-token"),
                "captured output {} must not persist the signed source URL",
                file.display()
            );
        }

        server_stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn captured_extra_flags_drop_every_network_identity_field() {
        let extra = ExtraArgs {
            proxy: Some("http://127.0.0.1:7890".to_string()),
            cookies: Some("edge".to_string()),
            user_agent: Some("Global-UA".to_string()),
            player_client: Some("smart".to_string()),
            po_token: Some("token".to_string()),
            visitor_data: Some("visitor".to_string()),
            concurrent_fragments: Some(4),
            embed_metadata: Some(true),
            resolution: Some("1080".to_string()),
            ..Default::default()
        };

        let flags = build_captured_extra_flags(&extra).join(" ");

        for forbidden in [
            "--proxy",
            "--cookies",
            "--cookies-from-browser",
            "Global-UA",
            "--extractor-args",
            "smart",
            "token",
            "visitor",
        ] {
            assert!(
                !flags.contains(forbidden),
                "captured flags must not contain {forbidden}: {flags}"
            );
        }
        assert!(flags.contains("-N 4"));
        assert!(!flags.contains("--embed-metadata"));
    }

    #[test]
    fn captured_diagnostics_fully_redact_signed_urls() {
        let line =
            "[generic] Extracting URL: https://cdn.example.com/clip.mp4?sig=s3cr3t&expires=1";
        let redacted = redact_diagnostics(line, true);

        assert!(!redacted.contains("s3cr3t"));
        assert!(!redacted.contains("https://"));
        assert!(redacted.contains("<REDACTED-URL>"));
        assert!(redacted.contains("[generic] Extracting URL"));

        // Pasted diagnostics keep their current behaviour.
        let pasted = redact_diagnostics(line, false);
        assert!(pasted.contains("https://cdn.example.com/clip.mp4"));
        assert!(!pasted.contains("s3cr3t"));
    }

    #[test]
    fn download_request_debug_output_hides_captured_secrets() {
        let request = DownloadRequest {
            id: "task-1".to_string(),
            url: "https://cdn.example.com/clip.mp4?sig=s3cr3t".to_string(),
            download_type: DownloadType::Video,
            download_dir: None,
            extra_args: None,
            captured: true,
            captured_media_kind: Some("video".to_string()),
            replay_headers: vec![("user-agent".to_string(), "Secret-Agent/9".to_string())],
        };

        let debug = format!("{request:?}");
        assert!(!debug.contains("s3cr3t"));
        assert!(!debug.contains("Secret-Agent/9"));
        assert!(debug.contains("<captured-url-redacted>"));
        assert!(debug.contains("user-agent"));
    }

    #[tokio::test]
    async fn captured_destination_policy_is_enforced_at_the_execution_boundary() {
        for (url, expected) in [
            ("http://127.0.0.1:9000/clip.mp4", "loopback"),
            ("http://[::1]/clip.mp4", "loopback"),
            ("http://169.254.169.254/latest/meta-data/", "cloud-metadata"),
            ("http://10.1.2.3/clip.mp4", "private-network"),
            ("ftp://cdn.example.com/clip.mp4", "unsupported-scheme"),
        ] {
            let error = DownloadService::enforce_captured_destination(url)
                .await
                .expect_err(&format!("{url} must be rejected at execution time"));
            assert!(
                error.contains("capture-destination-rejected") && error.contains(expected),
                "unexpected rejection for {url}: {error}"
            );
        }

        // A public literal needs no DNS and must stay allowed.
        assert!(
            DownloadService::enforce_captured_destination("https://93.184.216.34/clip.mp4")
                .await
                .is_ok()
        );
    }

    #[test]
    fn writing_a_url_to_stdin_and_closing_the_pipe_lets_the_child_proceed() {
        use std::io::{Read, Write};
        use std::process::{Command, Stdio};

        let mut child = Command::new("cmd")
            .args(["/c", "findstr", "."])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn the stdin probe process");

        child
            .stdin
            .as_mut()
            .expect("piped stdin")
            .write_all(b"https://cdn.example.com/clip.mp4?sig=s3cr3t\n")
            .expect("write the URL to stdin");
        // Closing stdin is exactly what the captured execution path relies on
        // so that yt-dlp's `--batch-file -` can reach EOF.
        drop(child.stdin.take());

        let mut observed = String::new();
        child
            .stdout
            .as_mut()
            .expect("piped stdout")
            .read_to_string(&mut observed)
            .expect("read the probe output");
        let status = child.wait().expect("wait for the probe");
        assert!(status.success());
        assert!(
            observed.contains("sig=s3cr3t"),
            "the child must receive the URL through stdin, got: {observed}"
        );
    }

    /// Native proof that the Phase 1 delivery seam works with the real yt-dlp
    /// binary: URL through stdin, argv free of the secret, EOF after the write.
    #[test]
    #[ignore = "runs the bundled yt-dlp binary against a loopback fixture"]
    fn real_ytdlp_reads_the_captured_url_from_stdin_batch_file() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        // The fixture server runs on its own thread: the main thread blocks in
        // `wait_with_output`, so a current-thread runtime could not drive it.
        let server_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let serve_stop = server_stop.clone();
        let (port_tx, port_rx) = std::sync::mpsc::channel::<u16>();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("fixture runtime");
            runtime.block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .expect("fixture bind");
                let _ = port_tx.send(listener.local_addr().expect("fixture addr").port());
                loop {
                    if serve_stop.load(std::sync::atomic::Ordering::SeqCst) {
                        break;
                    }
                    let accepted = tokio::time::timeout(
                        std::time::Duration::from_millis(200),
                        listener.accept(),
                    )
                    .await;
                    let Ok(Ok((mut socket, _))) = accepted else { continue };
                    tokio::spawn(async move {
                        use tokio::io::{AsyncReadExt, AsyncWriteExt};
                        let mut request = vec![0u8; 4096];
                        let _ = socket.read(&mut request).await;
                        let body = vec![0u8; 2048];
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = socket.write_all(response.as_bytes()).await;
                        let _ = socket.write_all(&body).await;
                        let _ = socket.flush().await;
                    });
                }
            });
        });
        let port = port_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("fixture port");

        let yt_dlp = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/yt-dlp.exe");
        if !yt_dlp.is_file() {
            println!("SKIPPED: bundled yt-dlp binary not present at {yt_dlp:?}");
            return;
        }

        let raw_url = format!("http://127.0.0.1:{port}/clip.mp4?sig=s3cr3t");
        let mut child = Command::new(&yt_dlp)
            .args([
                "--batch-file",
                "-",
                "--simulate",
                "--no-warnings",
                "--print",
                "%(title)s",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn yt-dlp");

        child
            .stdin
            .as_mut()
            .expect("piped stdin")
            .write_all(format!("{raw_url}\n").as_bytes())
            .expect("write the captured URL to stdin");
        drop(child.stdin.take());

        let output = child.wait_with_output().expect("yt-dlp output");
        server_stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        println!("yt-dlp stdout: {stdout}\nyt-dlp stderr: {stderr}");

        assert!(
            stdout.contains("clip"),
            "yt-dlp must read the URL from stdin batch-file input, stdout: {stdout}, stderr: {stderr}"
        );
        assert!(
            stderr.contains("Reading URLs from STDIN"),
            "yt-dlp must report the batch-file stdin input mode, stderr: {stderr}"
        );
    }

    /// Captured execution dry run: the bundled yt-dlp downloads a real file
    /// through the stdin delivery seam and the output template contract.
    #[test]
    #[ignore = "downloads a fixture through the bundled yt-dlp binary"]
    fn captured_execution_writes_a_real_file_via_stdin() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let output_dir =
            std::env::temp_dir().join(format!("ytdl-flow-captured-exec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&output_dir);
        std::fs::create_dir_all(&output_dir).expect("create output dir");

        let server_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let serve_stop = server_stop.clone();
        let (port_tx, port_rx) = std::sync::mpsc::channel::<u16>();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("fixture runtime");
            runtime.block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .expect("fixture bind");
                let _ = port_tx.send(listener.local_addr().expect("fixture addr").port());
                loop {
                    if serve_stop.load(std::sync::atomic::Ordering::SeqCst) {
                        break;
                    }
                    let accepted = tokio::time::timeout(
                        std::time::Duration::from_millis(200),
                        listener.accept(),
                    )
                    .await;
                    let Ok(Ok((mut socket, _))) = accepted else { continue };
                    tokio::spawn(async move {
                        use tokio::io::{AsyncReadExt, AsyncWriteExt};
                        let mut request = vec![0u8; 4096];
                        let _ = socket.read(&mut request).await;
                        let body = vec![7u8; 4096];
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = socket.write_all(response.as_bytes()).await;
                        let _ = socket.write_all(&body).await;
                        let _ = socket.flush().await;
                    });
                }
            });
        });
        let port = port_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("fixture port");

        let yt_dlp = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/yt-dlp.exe");
        if !yt_dlp.is_file() {
            println!("SKIPPED: bundled yt-dlp binary not present at {yt_dlp:?}");
            return;
        }

        let raw_url = format!("http://127.0.0.1:{port}/captured-clip.mp4?sig=s3cr3t");
        let mut args = build_common_args_for(&None, true);
        args.push("-o".to_string());
        args.push(
            output_dir
                .join("%(title)s.%(ext)s")
                .to_string_lossy()
                .to_string(),
        );
        args.push("--no-simulate".to_string());
        args.push("--print".to_string());
        args.push("after_move:filepath".to_string());
        let stdin_url = deliver_url(&mut args, &raw_url, true, &[]);
        assert_eq!(stdin_url.as_deref(), Some(raw_url.as_str()));
        assert!(
            !args.iter().any(|arg| arg.contains("sig=")),
            "the signed URL must never appear in argv: {args:?}"
        );

        let mut child = Command::new(&yt_dlp)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn yt-dlp");
        child
            .stdin
            .as_mut()
            .expect("piped stdin")
            .write_all(format!("{raw_url}\n").as_bytes())
            .expect("write the captured URL to stdin");
        drop(child.stdin.take());

        let result = child.wait_with_output().expect("yt-dlp output");
        server_stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let stdout = String::from_utf8_lossy(&result.stdout).to_string();
        let stderr = String::from_utf8_lossy(&result.stderr).to_string();
        println!("yt-dlp stdout: {stdout}\nyt-dlp stderr: {stderr}");

        let downloaded: Vec<std::path::PathBuf> = std::fs::read_dir(&output_dir)
            .expect("read output dir")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        assert!(
            result.status.success(),
            "captured execution must succeed, stderr: {stderr}"
        );
        assert_eq!(
            downloaded.len(),
            1,
            "exactly one artifact expected: {downloaded:?}"
        );
        let file = &downloaded[0];
        assert_eq!(
            file.file_name().and_then(|name| name.to_str()),
            Some("captured-clip.mp4"),
            "the output template contract must hold for captured executions"
        );
        assert_eq!(
            std::fs::metadata(file).expect("artifact metadata").len(),
            4096,
            "the full fixture payload must be downloaded"
        );

        let _ = std::fs::remove_dir_all(&output_dir);
    }

    #[test]
    fn base_args_force_visible_line_delimited_progress() {
        let args = build_base_args();
        assert!(args.contains(&"--progress".to_string()));
        assert!(args.contains(&"--newline".to_string()));
    }

    #[test]
    fn parses_standard_ytdlp_progress_line() {
        let (progress, speed) = DownloadService::parse_progress_line(
            "[download]  12.5% of 64.00MiB at 1.25MiB/s ETA 00:10",
            0.0,
        )
        .expect("standard yt-dlp progress should parse");

        assert_eq!(progress, 12.5);
        assert_eq!(speed, "1.25MiB/s");
    }

    #[test]
    fn parses_unknown_total_download_activity_without_faking_progress() {
        let (progress, speed) = DownloadService::parse_progress_line(
            "[download]  127.00KiB at 1.23MiB/s (00:00:00)",
            37.0,
        )
        .expect("byte-only yt-dlp progress should still be treated as activity");

        assert_eq!(progress, 37.0);
        assert_eq!(speed, "1.23MiB/s");
    }

    #[test]
    fn zero_exit_code_is_not_a_terminal_error() {
        assert!(DownloadService::terminal_error_for_exit(Some(0), false, None, "").is_none());
    }

    #[test]
    fn nonzero_exit_code_is_a_terminal_error() {
        let error = DownloadService::terminal_error_for_exit(Some(7), false, None, "fatal failure")
            .expect("nonzero exit must fail");

        assert!(error.to_string().contains("code 7"));
        assert!(error.to_string().contains("fatal failure"));
    }

    #[test]
    fn watchdog_failure_reason_takes_precedence_over_exit_code() {
        let error =
            DownloadService::terminal_error_for_exit(Some(0), false, Some("watchdog timeout"), "")
                .expect("forced failure must stay failed");

        assert!(error.to_string().contains("watchdog timeout"));
    }

    #[test]
    fn default_extra_args_produce_only_base_flags() {
        let extra = ExtraArgs::default();
        assert_eq!(flags(&extra), "");
        assert_eq!(
            DownloadService::build_common_args(&Some(extra)),
            build_base_args()
        );
    }

    #[test]
    fn base_args_enforce_single_video_download_contract() {
        let args = build_base_args();
        let no_playlist_count = args
            .iter()
            .filter(|arg| arg.as_str() == "--no-playlist")
            .count();

        assert_eq!(no_playlist_count, 1);
    }

    #[test]
    fn diagnostic_redaction_removes_url_credentials_and_sensitive_query_values() {
        let value_a = ["sensitive", "a"].join("-");
        let value_b = ["sensitive", "b"].join("-");
        let value_c = ["sensitive", "c"].join("-");
        let input = format!(
            "Starting analysis for: https://alice:{}@example.com/watch?v=ok&{}={}&{}={}",
            value_a,
            ["to", "ken"].join(""),
            value_b,
            ["sign", "ature"].join(""),
            value_c
        );

        let redacted = DownloadService::redact_sensitive_text(&input);

        assert!(redacted.contains("v=ok"));
        assert!(!redacted.contains(&value_a));
        assert!(!redacted.contains(&value_b));
        assert!(!redacted.contains(&value_c));
        assert!(redacted.contains("<REDACTED>"));
    }

    #[test]
    fn blank_filename_template_falls_back_to_default() {
        for blank in ["", "   ", "\t", " \r\n "] {
            let extra = ExtraArgs {
                filename_template: Some(blank.to_string()),
                ..Default::default()
            };

            assert_eq!(
                resolve_filename_template(&Some(extra)).unwrap(),
                DEFAULT_FILENAME_TEMPLATE
            );
        }
    }

    #[test]
    fn none_filename_template_falls_back_to_default() {
        assert_eq!(
            resolve_filename_template(&None).unwrap(),
            DEFAULT_FILENAME_TEMPLATE
        );

        let extra = ExtraArgs {
            filename_template: None,
            ..Default::default()
        };
        assert_eq!(
            resolve_filename_template(&Some(extra)).unwrap(),
            DEFAULT_FILENAME_TEMPLATE
        );
    }

    #[test]
    fn nonblank_custom_filename_template_remains_unchanged() {
        let custom = ExtraArgs {
            filename_template: Some("%(uploader)s/%(title)s.%(ext)s".to_string()),
            ..Default::default()
        };
        assert_eq!(
            resolve_filename_template(&Some(custom)).unwrap(),
            "%(uploader)s/%(title)s.%(ext)s"
        );

        let custom_with_spaces = ExtraArgs {
            filename_template: Some(" custom template %(ext)s ".to_string()),
            ..Default::default()
        };
        assert_eq!(
            resolve_filename_template(&Some(custom_with_spaces)).unwrap(),
            " custom template %(ext)s "
        );
    }

    #[test]
    fn filename_template_security_boundary_contract() {
        // PASS cases
        assert!(validate_filename_template("%(title)s.%(ext)s").is_ok());
        assert!(validate_filename_template("channel/%(title)s.%(ext)s").is_ok());
        assert!(validate_filename_template("./channel/%(title)s.%(ext)s").is_ok());

        // FAIL cases
        assert!(validate_filename_template("../outside/%(title)s.%(ext)s").is_err());
        assert!(validate_filename_template(r"..\outside\%(title)s.%(ext)s").is_err());
        assert!(validate_filename_template(r"C:\outside\%(title)s.%(ext)s").is_err());
        assert!(validate_filename_template(r"\\server\share\%(title)s.%(ext)s").is_err());
        assert!(validate_filename_template("//server/share/%(title)s.%(ext)s").is_err());
        assert!(validate_filename_template("/root/path/%(title)s.%(ext)s").is_err());
        assert!(validate_filename_template(r"\root\path\%(title)s.%(ext)s").is_err());

        // resolve_output_template ensures resolved path is inside base_dir
        let base_dir = std::path::Path::new("C:\\downloads");
        let safe_out = resolve_output_template(base_dir, "channel/%(title)s.%(ext)s").unwrap();
        assert_eq!(safe_out, base_dir.join("channel/%(title)s.%(ext)s"));

        assert!(resolve_output_template(base_dir, "../outside/%(title)s.%(ext)s").is_err());
    }

    #[test]
    fn deliver_url_includes_option_terminator() {
        let mut args = Vec::new();
        deliver_url(&mut args, "https://example.com/watch?v=123", false, &[]);
        assert_eq!(args, vec!["--", "https://example.com/watch?v=123"]);
    }

    #[test]
    fn validate_download_url_contract() {
        assert!(validate_download_url("https://example.com/watch?v=123").is_ok());
        assert!(validate_download_url("http://example.com/clip.mp4").is_ok());
        assert!(validate_download_url("file:///etc/passwd").is_err());
        assert!(validate_download_url("ftp://example.com/video.mp4").is_err());
        assert!(validate_download_url("-v").is_err());
        assert!(validate_download_url("--dump-json").is_err());
    }

    #[test]
    fn temp_cookie_material_lifecycle_and_cleanup() {
        let temp_json =
            std::env::temp_dir().join(format!("test_cookie_lifecycle_{}.json", std::process::id()));
        std::fs::write(
            &temp_json,
            r#"[{"domain":".youtube.com","name":"SID","value":"val"}]"#,
        )
        .unwrap();

        let temp_path;
        {
            let material = DownloadService::resolve_cookies_material(temp_json.to_str().unwrap());
            assert!(material.cookie_arg().is_some());
            let path = material
                .cleanup_path()
                .expect("temp file cleanup path must exist");
            assert!(path.exists());
            temp_path = path.to_path_buf();
        }
        // After material drops, the temp file must be cleaned up!
        assert!(
            !temp_path.exists(),
            "temp cookie file must be deleted on drop"
        );

        let _ = std::fs::remove_file(&temp_json);

        // Native .txt cookies must NEVER be deleted
        let dummy_txt =
            std::env::temp_dir().join(format!("test_cookie_native_{}.txt", std::process::id()));
        std::fs::write(&dummy_txt, "some native netscape cookie content").unwrap();
        {
            let material = DownloadService::resolve_cookies_material(dummy_txt.to_str().unwrap());
            assert_eq!(material.cleanup_path(), None);
        }
        assert!(
            dummy_txt.exists(),
            "native txt cookies must never be removed"
        );
        let _ = std::fs::remove_file(&dummy_txt);
    }

    #[test]
    fn all_documented_fields_are_consumed() {
        let extra = ExtraArgs {
            format_selector: None,
            section_start: None,
            section_end: None,
            smart_decision: None,
            proxy: Some("http://127.0.0.1:7890".into()),
            cookies: Some("cookies.txt".into()),
            user_agent: Some("UA".into()),
            concurrent_fragments: Some(8),
            embed_metadata: Some(true),
            embed_subs: Some(true),
            sub_langs: Some("zh-Hans,en".into()),
            sponsorblock: Some(true),
            // filename_template 经 -o 在调用点消费；admin_mode 为前端专属开关
            filename_template: None,
            resolution: None,
            video_codec: None,
            audio_codec: None,
            admin_mode: Some(true),
            player_client: Some("web".into()),
            po_token: Some("token123".into()),
            visitor_data: Some("visitor".into()),
            write_thumbnail: Some(true),
            write_info_json: Some(true),
        };

        assert_eq!(
            flags(&extra),
            "--proxy http://127.0.0.1:7890 \
             --cookies cookies.txt \
             --user-agent UA \
             --extractor-args youtube:player_client=web \
             --extractor-args youtube:po_token=web+token123 \
             --extractor-args youtube:visitor_data=visitor \
             -N 8 \
             --embed-metadata \
             --embed-subs \
             --sub-langs zh-Hans,en \
             --sponsorblock-remove all \
             --write-thumbnail \
             --convert-thumbnails jpg \
             --write-info-json"
        );
    }

    #[test]
    fn captured_common_args_ignore_external_config_and_disable_info_json() {
        let extra = ExtraArgs {
            write_info_json: Some(true),
            write_thumbnail: Some(true),
            embed_metadata: Some(true),
            embed_subs: Some(true),
            sponsorblock: Some(true),
            cookies: Some("fixture-cookie-source".into()),
            user_agent: Some("UA_TEST".into()),
            proxy: Some("fixture-proxy".into()),
            ..Default::default()
        };

        let args = build_common_args_for(&Some(extra), true);
        assert!(
            args.iter().any(|arg| arg == "--ignore-config"),
            "captured yt-dlp must not inherit user/system configuration"
        );
        assert!(
            args.iter().any(|arg| arg == "--no-write-info-json"),
            "captured yt-dlp must explicitly disable raw info-json persistence"
        );
        assert!(!args.iter().any(|arg| arg == "--write-info-json"));
        assert!(!args.iter().any(|arg| arg == "--write-thumbnail"));
        assert!(!args.iter().any(|arg| arg == "--embed-metadata"));
        assert!(!args.iter().any(|arg| arg == "--embed-subs"));
        assert!(!args.iter().any(|arg| arg == "--sponsorblock-remove"));
        assert!(args.iter().any(|arg| arg == "--no-write-thumbnail"));
        assert!(args.iter().any(|arg| arg == "--no-embed-metadata"));
        assert!(args.iter().any(|arg| arg == "--no-embed-subs"));
        assert!(args.iter().any(|arg| arg == "--no-sponsorblock"));
        assert!(!args.iter().any(|arg| arg == "--cookies"));
        assert!(!args.iter().any(|arg| arg == "--cookies-from-browser"));
        assert!(!args.iter().any(|arg| arg == "--proxy"));
        assert!(!args.iter().any(|arg| arg == "UA_TEST"));
    }

    #[test]
    fn ordinary_common_args_keep_existing_config_and_info_json_behavior() {
        let extra = ExtraArgs {
            write_info_json: Some(true),
            ..Default::default()
        };
        let args = build_common_args_for(&Some(extra), false);
        assert!(!args.iter().any(|arg| arg == "--ignore-config"));
        assert!(args.iter().any(|arg| arg == "--write-info-json"));
    }

    #[test]
    fn smart_player_client_stays_out_of_common_flags() {
        let extra = ExtraArgs {
            player_client: Some("smart".into()),
            ..Default::default()
        };
        assert_eq!(flags(&extra), "");
    }

    #[test]
    fn blank_and_disabled_values_are_skipped() {
        let extra = ExtraArgs {
            proxy: Some(String::new()),
            sub_langs: Some("  ".into()),
            concurrent_fragments: Some(0),
            embed_metadata: Some(false),
            sponsorblock: Some(false),
            write_thumbnail: Some(false),
            write_info_json: Some(false),
            ..Default::default()
        };
        assert_eq!(flags(&extra), "");
    }

    #[test]
    fn format_sort_maps_codecs_and_resolution() {
        let extra = ExtraArgs {
            resolution: Some("1080p".into()),
            video_codec: Some("h265".into()),
            audio_codec: Some("m4a".into()),
            ..Default::default()
        };
        assert_eq!(
            build_format_sort_fields(&extra),
            vec!["res:1080", "vcodec:hevc", "acodec:aac"]
        );
    }

    #[test]
    fn auto_and_best_produce_no_sort_fields() {
        let extra = ExtraArgs {
            resolution: Some("best".into()),
            video_codec: Some("auto".into()),
            audio_codec: Some("auto".into()),
            ..Default::default()
        };
        assert!(build_format_sort_fields(&extra).is_empty());
    }

    #[test]
    fn malformed_resolution_is_ignored() {
        let extra = ExtraArgs {
            resolution: Some("4k".into()),
            ..Default::default()
        };
        assert!(build_format_sort_fields(&extra).is_empty());
    }

    #[test]
    fn post_processing_lines_are_detected() {
        assert!(DownloadService::is_post_processing_line(
            "[Merger] Merging formats into \"a.mp4\""
        ));
        assert!(DownloadService::is_post_processing_line(
            "[ExtractAudio] Destination: a.mp3"
        ));
        assert!(!DownloadService::is_post_processing_line(
            "[download]   1.0% of 1.00MiB at 1.00MiB/s"
        ));
        assert!(!DownloadService::is_post_processing_line(
            "[youtube] Extracting URL: id"
        ));
    }

    #[test]
    fn json_cookies_conversion_works() {
        let json = r#"[
            {
                "domain": ".youtube.com",
                "name": "LOGIN_INFO",
                "value": "token123",
                "path": "/",
                "secure": true,
                "expirationDate": 1788451877.5
            },
            {
                "domain": "youtube.com",
                "name": "PREF",
                "value": "f1=50000000",
                "path": "/pref",
                "secure": false
            }
        ]"#;

        let netscape = DownloadService::convert_json_cookies_to_netscape(json)
            .expect("should parse valid json cookies");

        assert!(netscape.starts_with("# Netscape HTTP Cookie File\n"));
        assert!(netscape.contains(".youtube.com\tTRUE\t/\tTRUE\t1788451878\tLOGIN_INFO\ttoken123"));
        assert!(
            netscape.contains("youtube.com\tFALSE\t/pref\tFALSE\t2147483647\tPREF\tf1=50000000")
        );
    }

    #[test]
    fn youtube_url_detection() {
        assert!(DownloadService::is_youtube_url(
            "https://www.youtube.com/watch?v=AYAOZk3Xk00"
        ));
        assert!(DownloadService::is_youtube_url(
            "https://youtu.be/AYAOZk3Xk00"
        ));
        assert!(DownloadService::is_youtube_url(
            "https://music.youtube.com/watch?v=abc"
        ));
        assert!(!DownloadService::is_youtube_url(
            "https://www.bilibili.com/video/BV123"
        ));
        assert!(!DownloadService::is_youtube_url("https://v.douyin.com/abc"));
    }

    #[test]
    fn resolve_cookies_arg_converts_json_file() {
        let temp_json = std::env::temp_dir().join("test_cookies_spec.json");
        let json_content = r#"[{"domain":".youtube.com","name":"SID","value":"val"}]"#;
        std::fs::write(&temp_json, json_content).unwrap();

        let resolved = DownloadService::resolve_cookies_arg(temp_json.to_str().unwrap());
        assert!(resolved.ends_with(".txt"));
        assert!(std::path::Path::new(&resolved).exists());
        let converted_content = std::fs::read_to_string(&resolved).unwrap();
        assert!(converted_content.starts_with("# Netscape HTTP Cookie File\n"));
        assert!(converted_content.contains(".youtube.com\tTRUE\t/\tFALSE\t2147483647\tSID\tval"));

        let _ = std::fs::remove_file(&temp_json);
    }

    #[test]
    fn resolve_cookies_arg_leaves_txt_intact() {
        let dummy_txt = "some/dummy/cookies.txt";
        let resolved = DownloadService::resolve_cookies_arg(dummy_txt);
        assert_eq!(resolved, dummy_txt);
    }

    #[test]
    fn resolve_cookies_arg_temp_files_are_isolated_per_execution() {
        let temp_a = std::env::temp_dir().join("test_cookies_hash_a.json");
        let temp_b = std::env::temp_dir().join("test_cookies_hash_b.json");
        std::fs::write(
            &temp_a,
            r#"[{"domain":".youtube.com","name":"A","value":"1"}]"#,
        )
        .unwrap();
        std::fs::write(
            &temp_b,
            r#"[{"domain":".youtube.com","name":"B","value":"2"}]"#,
        )
        .unwrap();

        let resolved_a = DownloadService::resolve_cookies_arg(temp_a.to_str().unwrap());
        let resolved_b = DownloadService::resolve_cookies_arg(temp_b.to_str().unwrap());
        let resolved_a_again = DownloadService::resolve_cookies_arg(temp_a.to_str().unwrap());

        // 每次转换生成独立临时文件，互不覆盖且避免并发互相删除
        assert_ne!(resolved_a, resolved_b);
        assert_ne!(resolved_a, resolved_a_again);

        let _ = std::fs::remove_file(&temp_a);
        let _ = std::fs::remove_file(&temp_b);
        let _ = std::fs::remove_file(&resolved_a);
        let _ = std::fs::remove_file(&resolved_b);
        let _ = std::fs::remove_file(&resolved_a_again);
    }

    #[test]
    fn browser_cookies_identification() {
        assert!(DownloadService::is_browser_cookie("chrome"));
        assert!(DownloadService::is_browser_cookie("Edge"));
        assert!(DownloadService::is_browser_cookie("firefox+Profile 1"));
        assert!(!DownloadService::is_browser_cookie(
            "C:/path/to/cookies.txt"
        ));
        assert!(!DownloadService::is_browser_cookie("cookies.json"));
    }

    #[test]
    fn build_extra_flags_handles_browser_cookies() {
        let extra = ExtraArgs {
            cookies: Some("edge".to_string()),
            ..Default::default()
        };
        let flags = build_extra_flags(&extra);
        assert!(flags.contains(&"--cookies-from-browser".to_string()));
        assert!(flags.contains(&"edge".to_string()));
        assert!(!flags.contains(&"--cookies".to_string()));
    }

    #[test]
    fn production_common_args_cookie_composition_contract() {
        // 1. cookies = "edge"
        let extra_edge = Some(ExtraArgs {
            cookies: Some("edge".to_string()),
            ..Default::default()
        });
        let cookie_material_edge = extra_edge
            .as_ref()
            .and_then(|extra| extra.cookies.as_deref())
            .map(DownloadService::resolve_cookies_material)
            .unwrap_or_else(TempCookieMaterial::empty);
        let args_edge =
            build_common_args_with_cookie(&extra_edge, false, cookie_material_edge.cookie_arg());
        assert!(args_edge.contains(&"--cookies-from-browser".to_string()));
        assert!(args_edge.contains(&"edge".to_string()));
        assert!(!args_edge.contains(&"--cookies".to_string()));

        // 2. cookies = "chrome+Profile 1"
        let extra_profile = Some(ExtraArgs {
            cookies: Some("chrome+Profile 1".to_string()),
            ..Default::default()
        });
        let cookie_material_profile = extra_profile
            .as_ref()
            .and_then(|extra| extra.cookies.as_deref())
            .map(DownloadService::resolve_cookies_material)
            .unwrap_or_else(TempCookieMaterial::empty);
        let args_profile = build_common_args_with_cookie(
            &extra_profile,
            false,
            cookie_material_profile.cookie_arg(),
        );
        assert!(args_profile.contains(&"--cookies-from-browser".to_string()));
        assert!(args_profile.contains(&"chrome+Profile 1".to_string()));
        assert!(!args_profile.contains(&"--cookies".to_string()));

        // 3. JSON cookie file
        let temp_json =
            std::env::temp_dir().join(format!("test_prod_cookie_{}.json", std::process::id()));
        std::fs::write(
            &temp_json,
            r#"[{"domain":".youtube.com","name":"A","value":"1"}]"#,
        )
        .unwrap();
        let extra_json = Some(ExtraArgs {
            cookies: Some(temp_json.to_string_lossy().to_string()),
            ..Default::default()
        });
        let cookie_material_json = extra_json
            .as_ref()
            .and_then(|extra| extra.cookies.as_deref())
            .map(DownloadService::resolve_cookies_material)
            .unwrap_or_else(TempCookieMaterial::empty);
        let args_json =
            build_common_args_with_cookie(&extra_json, false, cookie_material_json.cookie_arg());
        assert!(args_json.contains(&"--cookies".to_string()));
        assert!(!args_json.contains(&"--cookies-from-browser".to_string()));
        let cookie_arg = cookie_material_json.cookie_arg().expect("json cookie arg");
        assert!(cookie_arg.ends_with(".txt"));
        assert!(args_json.contains(&cookie_arg.to_string()));
        drop(cookie_material_json);
        let _ = std::fs::remove_file(&temp_json);

        // 4. 普通 txt cookie file
        let dummy_txt =
            std::env::temp_dir().join(format!("test_prod_cookie_{}.txt", std::process::id()));
        std::fs::write(&dummy_txt, "cookie content").unwrap();
        let extra_txt = Some(ExtraArgs {
            cookies: Some(dummy_txt.to_string_lossy().to_string()),
            ..Default::default()
        });
        let cookie_material_txt = extra_txt
            .as_ref()
            .and_then(|extra| extra.cookies.as_deref())
            .map(DownloadService::resolve_cookies_material)
            .unwrap_or_else(TempCookieMaterial::empty);
        let args_txt =
            build_common_args_with_cookie(&extra_txt, false, cookie_material_txt.cookie_arg());
        assert!(args_txt.contains(&"--cookies".to_string()));
        assert!(!args_txt.contains(&"--cookies-from-browser".to_string()));
        assert!(args_txt.contains(&dummy_txt.to_string_lossy().to_string()));
        drop(cookie_material_txt);
        let _ = std::fs::remove_file(&dummy_txt);
    }

    #[test]
    fn build_plugin_args_handles_youtube_urls() {
        let yt_args =
            DownloadService::build_plugin_args("https://www.youtube.com/watch?v=AYAOZk3Xk00");
        assert!(yt_args.contains(&"--plugin-dirs".to_string()));
        let non_yt_args =
            DownloadService::build_plugin_args("https://www.bilibili.com/video/BV123");
        assert!(non_yt_args.is_empty());
    }

    #[test]
    fn unresolved_smart_never_silently_selects_mweb() {
        let extra = Some(ExtraArgs {
            player_client: Some("smart".into()),
            ..Default::default()
        });
        let resolved_yt = DownloadService::resolve_effective_extra_args(
            "https://www.youtube.com/watch?v=zg-rMHEqg-4",
            &extra,
        );
        assert_eq!(
            resolved_yt.and_then(|e| e.player_client),
            Some("smart".to_string())
        );

        let non_yt = DownloadService::resolve_effective_extra_args(
            "https://www.bilibili.com/video/BV123",
            &extra,
        );
        assert_eq!(
            non_yt.and_then(|e| e.player_client),
            Some("smart".to_string())
        );
    }

    #[test]
    fn profile_and_cookie_temp_paths_are_redacted_without_removing_capability_evidence() {
        let log = r#"C:\Users\Alice\AppData\Local\Temp\ytdl_flow_cookies_123.txt client=mweb format=399+251 resolution=1920x1080 bun=1.4.2 POT=generated"#;
        let redacted = DownloadService::redact_sensitive_text(log);
        assert!(!redacted.contains("Alice"));
        assert!(!redacted.contains("ytdl_flow_cookies_123"));
        assert!(redacted.contains("399+251"));
        assert!(redacted.contains("bun=1.4.2"));
    }

    #[tokio::test]
    async fn bun_warning_with_successful_probe_keeps_inventory_and_winner_handoff() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        tx.send(tauri_plugin_shell::process::CommandEvent::Stderr(b"[jsc:bun] bun version 1.4.2 is not supported!\n[jsc:bun] Solving JS challenges using bun\n".to_vec())).await.expect("stderr");
        tx.send(tauri_plugin_shell::process::CommandEvent::Stdout(br#"{"title":"Probe","height":360,"formats":[{"format_id":"399","height":2160,"fps":60,"vcodec":"av01","acodec":"none","protocol":"https","url":"https://example.com/v"},{"format_id":"251","vcodec":"none","acodec":"opus","protocol":"https","url":"https://example.com/a"}]}"#.to_vec())).await.expect("stdout");
        tx.send(tauri_plugin_shell::process::CommandEvent::Terminated(
            tauri_plugin_shell::process::TerminatedPayload {
                code: Some(0),
                signal: None,
            },
        ))
        .await
        .expect("exit");
        let child = AnalyzerChild::TestCleanup {
            cleanup: Box::new(|| Ok(())),
            _anchor: std::sync::Arc::new(()),
        };
        let metadata = DownloadService::read_metadata_process(
            child,
            &mut rx,
            "https://www.youtube.com/watch?v=test",
            false,
            |_| {},
            std::time::Duration::from_secs(1),
        )
        .await
        .expect("successful capability");
        assert_eq!(metadata.observed_max_height, Some(2160));
        assert_eq!(
            metadata
                .youtube_diagnostic
                .expect("diagnostic")
                .runtime_state,
            crate::models::RuntimeState::Succeeded
        );
        let extra = Some(ExtraArgs {
            player_client: Some("smart".into()),
            cookies: Some("edge".into()),
            smart_decision: Some(crate::models::SmartClientDecision {
                player_client: "web".into(),
                max_height: 2160,
                auth_mode: "anonymous".into(),
                pot_mode: "unknown".into(),
                reason: "inventory".into(),
                clear_session_inputs: false,
            }),
            ..Default::default()
        });
        let effective = DownloadService::resolve_effective_extra_args(
            "https://youtube.com/watch?v=test",
            &extra,
        )
        .expect("decision");
        assert_eq!(effective.player_client.as_deref(), Some("web"));
        assert!(effective.cookies.is_none());
        let args = DownloadService::build_common_args(&Some(effective));
        assert!(args.windows(2).any(|p| p == ["--js-runtimes", "bun"]));
        assert!(!args
            .iter()
            .any(|a| a.contains("deno") || a.contains("mweb")));
    }

    #[test]
    fn explicit_playlist_detection_allows_watch_urls_with_list_context() {
        assert!(DownloadService::is_explicit_playlist_url(
            "https://www.youtube.com/playlist?list=PLabc123"
        ));
        assert!(DownloadService::is_explicit_playlist_url(
            "https://music.youtube.com/playlist?list=OLAK5uy_demo"
        ));
        assert!(DownloadService::is_explicit_playlist_url(
            "https://www.bilibili.com/medialist/play/12345"
        ));
        assert!(!DownloadService::is_explicit_playlist_url(
            "https://www.youtube.com/watch?v=abc&list=PLxyz789"
        ));
        assert!(!DownloadService::is_explicit_playlist_url(
            "https://www.youtube.com/watch?v=abc"
        ));
    }

    #[test]
    fn parse_metadata_rejects_playlist_payloads() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
                "id": "PLabc123",
                "title": "Demo Playlist",
                "_type": "playlist",
                "entries": [{"id": "video-1", "title": "Episode 1", "url": "video-1"}]
            }"#,
        )
        .unwrap();

        let result = DownloadService::parse_metadata(
            json,
            "https://www.youtube.com/playlist?list=PLabc123",
            false,
        );
        assert!(result.is_err(), "playlist metadata must be rejected");
    }

    #[test]
    fn parse_metadata_accepts_single_video() {
        let json: serde_json::Value =
            serde_json::from_str(r#"{"id": "abc", "title": "Single Video", "duration": 60.0}"#)
                .unwrap();

        DownloadService::parse_metadata(json, "https://www.youtube.com/watch?v=abc", false)
            .expect("single video metadata should parse");
    }
}
