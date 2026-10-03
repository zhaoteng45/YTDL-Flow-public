use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub available_formats: Option<Vec<YouTubeFormatCapability>>,
    pub requested_resolution: Option<String>,
    pub smart_decision: Option<SmartClientDecision>,
    pub client_capabilities: Option<Vec<YouTubeClientCapability>>,
    pub youtube_diagnostic: Option<YouTubeDiagnostic>,
    pub observed_max_height: Option<i64>,
    pub title: String,
    pub thumbnail: String,
    pub duration: String,
    pub channel: String,
    pub url: String,
    pub resolution: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub filesize: Option<String>,
    pub filename: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub id: String,
    pub progress: f64,
    pub speed: String,
    pub status: String, // 'downloading' | 'processing' | 'completed' | 'error'
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadResultStatus {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResultPayload {
    pub id: String,
    pub outcome: DownloadResultStatus,
    pub error: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum DownloadType {
    Video,
    Audio,
    Mkv,
}

/// 下载任务的完整请求（服务的 interface 单元）
#[derive(Clone)]
pub struct DownloadRequest {
    pub id: String,
    /// Raw execution URL. For captured tasks it is a secret and stays native.
    pub url: String,
    pub download_type: DownloadType,
    pub download_dir: Option<String>,
    pub extra_args: Option<ExtraArgs>,
    /// Captured execution: the raw URL stays native and is delivered inside a direct descriptor.
    pub captured: bool,
    /// Native-only captured media kind (video/audio); absent for ordinary URLs.
    pub captured_media_kind: Option<String>,
    /// Validated replay headers (Phase 1: User-Agent only).
    pub replay_headers: Vec<(String, String)>,
}

/// Debug output must never print a captured URL or a replayed header value.
impl std::fmt::Debug for DownloadRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let url = if self.captured {
            "<captured-url-redacted>"
        } else {
            self.url.as_str()
        };
        let header_names: Vec<&str> = self
            .replay_headers
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        formatter
            .debug_struct("DownloadRequest")
            .field("id", &self.id)
            .field("url", &url)
            .field("download_type", &self.download_type)
            .field("download_dir", &self.download_dir)
            .field("extra_args", &self.extra_args)
            .field("captured", &self.captured)
            .field("captured_media_kind", &self.captured_media_kind)
            .field("replay_headers", &header_names)
            .finish()
    }
}

/// 下载终态。Cancelled 不发 completed/error 进度事件，
/// 前端以 cancelRequested 标志位识别取消。
#[derive(Debug, Clone)]
pub enum DownloadOutcome {
    Completed { file_path: Option<String> },
    Failed(String),
    Cancelled,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtraArgs {
    pub format_selector: Option<String>,
    pub section_start: Option<f64>,
    pub section_end: Option<f64>,
    pub smart_decision: Option<SmartClientDecision>,
    pub proxy: Option<String>,
    pub cookies: Option<String>,
    pub user_agent: Option<String>,
    pub concurrent_fragments: Option<u32>,
    pub embed_metadata: Option<bool>,
    pub embed_subs: Option<bool>,
    pub sub_langs: Option<String>,
    pub sponsorblock: Option<bool>,
    pub filename_template: Option<String>,
    pub resolution: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub admin_mode: Option<bool>,
    // New fields for advanced client config
    pub player_client: Option<String>,
    pub po_token: Option<String>,
    pub visitor_data: Option<String>,
    pub write_thumbnail: Option<bool>,
    pub write_info_json: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SmartClientDecision {
    pub player_client: String,
    pub max_height: i64,
    pub auth_mode: String,
    pub pot_mode: String,
    pub reason: String,
    #[serde(default)]
    pub clear_session_inputs: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeFormatCapability {
    pub format_id: String,
    pub language: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub dynamic_range: Option<String>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub protocol: Option<String>,
    pub ext: Option<String>,
    pub filesize: Option<u64>,
    pub filesize_approx: Option<u64>,
    pub bitrate: Option<f64>,
    pub has_drm: Option<bool>,
    /// Inventory evidence only; this does not guarantee a subsequent network fetch.
    pub usable: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeState {
    Unknown,
    Succeeded,
    Failed,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeDiagnostic {
    pub cookie_state: String,
    pub runtime_state: RuntimeState,
    pub pot_state: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeClientCapability {
    pub player_client: String,
    pub observed_max_height: i64,
    pub formats: Vec<YouTubeFormatCapability>,
    pub diagnostic: YouTubeDiagnostic,
    pub failure: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisLogPayload {
    pub id: String,
    pub line: String,
}

/// Frontend-safe Resource Capture summary (ADR-0003 Opaque Capture Context).
///
/// This is the *only* capture payload allowed to cross IPC. It intentionally
/// carries no raw URL, query, fragment, userinfo, Cookie, Authorization,
/// Referer or arbitrary request headers.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapturedResourceSummary {
    /// Opaque capture session id (generated natively, never derived from a URL).
    pub capture_id: String,
    /// Opaque resource id used to claim the resource.
    pub resource_id: String,
    /// Generated 1-based resource number for the UI (`#3`).
    pub resource_number: u32,
    /// Reviewed site/domain label, e.g. `cdn.example.com`.
    pub site_label: String,
    /// `video` | `audio` | `hls` | `dash` | `stream`.
    pub media_kind: String,
    pub mime_type: String,
    pub size_bytes: Option<u64>,
    pub filename_hint: Option<String>,
    pub resolution_hint: Option<String>,
    /// Phase 1 cannot replay Cookie/Authorization for this resource.
    pub requires_authenticated_replay: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSessionInfo {
    pub capture_id: String,
    pub browser_name: String,
    pub profile_isolated: bool,
}

/// Claim result. Internally tagged by `type` so the Vue layer never has to
/// match error strings.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum CaptureClaimOutcome {
    Claimed {
        context_id: String,
        resource: CapturedResourceSummary,
    },
    NotFound,
    CaptureInactive,
    UnsupportedScheme,
    ForbiddenDestination {
        reason: String,
    },
    AuthenticatedReplayRequired,
    UnsupportedExecutionKind,
    LimitReached,
}
