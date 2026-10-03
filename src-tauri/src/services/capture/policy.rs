//! Resource Capture Phase 1 policy primitives.
//!
//! Everything in this module is pure and side-effect free so it can be proven
//! by focused unit tests without launching a browser:
//!
//! - media classification from CDP response metadata (never from a body),
//! - sanitization of every text field that is allowed to reach the Vue layer,
//! - the default-deny header replay allowlist,
//! - the destination policy (loopback / private / link-local / metadata).
//!
//! Raw URL material is intentionally never accepted by the sanitizers; callers
//! keep it in native memory only.

use std::net::IpAddr;
use url::{Host, Url};

/// Hard ceiling for a single captured URL. Longer URLs are rejected instead of
/// being truncated, because truncation could silently change resource identity.
pub const MAX_URL_BYTES: usize = 4096;

/// Ceiling for any text field that crosses to the frontend.
pub const MAX_SUMMARY_TEXT_BYTES: usize = 120;

/// Ceiling for a replayed header value.
pub const MAX_REPLAY_HEADER_BYTES: usize = 1024;

/// Ceiling for a sanitized filename hint.
const MAX_FILENAME_HINT_BYTES: usize = 96;

/// MIME types that carry no media meaning and therefore allow a conservative
/// URL hint to decide the kind.
const GENERIC_MIMES: [&str; 3] = [
    "application/octet-stream",
    "binary/octet-stream",
    "application/binary",
];

const HLS_MIMES: [&str; 5] = [
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl",
    "application/mpegurl",
];

const DASH_MIMES: [&str; 3] = [
    "application/dash+xml",
    "application/xml+dash",
    "video/vnd.mpeg.dash.mpd",
];

const STREAM_MIMES: [&str; 3] = ["video/x-flv", "video/flv", "application/x-flv"];

/// Adaptive-streaming segments are fetched by the player, not by the user; they
/// must never flood the candidate list.
const SEGMENT_MIMES: [&str; 3] = ["video/mp2t", "video/iso.segment", "application/iso.segment"];

const VIDEO_EXTENSIONS: [&str; 5] = ["mp4", "m4v", "mov", "webm", "mkv"];
const AUDIO_EXTENSIONS: [&str; 8] = ["mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wav"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Video,
    Audio,
    Hls,
    Dash,
    Stream,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaKind::Video => "video",
            MediaKind::Audio => "audio",
            MediaKind::Hls => "hls",
            MediaKind::Dash => "dash",
            MediaKind::Stream => "stream",
        }
    }

    /// Placeholder MIME used only when the network metadata did not report one.
    fn placeholder_mime(self) -> &'static str {
        match self {
            MediaKind::Video => "video/mp4",
            MediaKind::Audio => "audio/mpeg",
            MediaKind::Hls => "application/vnd.apple.mpegurl",
            MediaKind::Dash => "application/dash+xml",
            MediaKind::Stream => "video/x-flv",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceClassification {
    pub kind: MediaKind,
    pub mime: String,
    pub size_hint: Option<u64>,
}

/// Classify a response from Network-domain metadata only.
///
/// `mime` and `url` come from `Network.responseReceived` /
/// `Network.requestWillBeSent`; `size_hint` comes from the reported
/// `Content-Length`. The classifier never needs (and never asks for) a body.
pub fn classify_resource(
    mime: Option<&str>,
    url: &str,
    size_hint: Option<u64>,
) -> Option<ResourceClassification> {
    let sanitized_mime = mime.and_then(sanitize_mime);
    let url_kind = classify_url_hint(url);

    let mime_is_generic = sanitized_mime
        .as_deref()
        .is_some_and(|value| GENERIC_MIMES.contains(&value));

    let kind = match sanitized_mime.as_deref() {
        Some(value) => mime_kind(value).or(if mime_is_generic { url_kind } else { None }),
        None => url_kind,
    }?;

    let resolved_mime = sanitized_mime
        .filter(|_| !mime_is_generic)
        .unwrap_or_else(|| kind.placeholder_mime().to_string());

    Some(ResourceClassification {
        kind,
        mime: resolved_mime,
        size_hint,
    })
}

fn mime_kind(mime: &str) -> Option<MediaKind> {
    if SEGMENT_MIMES.contains(&mime) {
        return None;
    }
    if HLS_MIMES.contains(&mime) {
        return Some(MediaKind::Hls);
    }
    if DASH_MIMES.contains(&mime) {
        return Some(MediaKind::Dash);
    }
    if STREAM_MIMES.contains(&mime) {
        return Some(MediaKind::Stream);
    }
    if mime.starts_with("video/") {
        return Some(MediaKind::Video);
    }
    if mime.starts_with("audio/") {
        return Some(MediaKind::Audio);
    }
    None
}

fn classify_url_hint(url: &str) -> Option<MediaKind> {
    let parsed = Url::parse(url).ok()?;
    let extension = parsed
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .and_then(|segment| segment.rsplit_once('.'))
        .map(|(_, extension)| extension.trim().to_ascii_lowercase())?;

    if extension == "m3u8" {
        return Some(MediaKind::Hls);
    }
    if extension == "mpd" {
        return Some(MediaKind::Dash);
    }
    if extension == "flv" {
        return Some(MediaKind::Stream);
    }
    if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        return Some(MediaKind::Video);
    }
    if AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        return Some(MediaKind::Audio);
    }
    None
}

/// Site label: registrable-ish host only. Never userinfo, port, path, query or
/// fragment.
pub fn sanitize_site_label(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = match parsed.host()? {
        Host::Domain(domain) => domain.trim_end_matches('.').to_ascii_lowercase(),
        Host::Ipv4(address) => address.to_string(),
        Host::Ipv6(address) => address.to_string(),
    };

    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    if host.is_empty() || host.len() > MAX_SUMMARY_TEXT_BYTES {
        return None;
    }
    if !host
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '-' | ':'))
    {
        return None;
    }
    if !host.contains('.') && !host.contains(':') {
        return None;
    }
    sanitize_summary_text(&host)
}

/// Sanitized filename hint. Percent-decoded path segment when it is a plausible
/// media filename; otherwise omitted.
pub fn sanitize_filename_hint(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let segment = parsed
        .path_segments()?
        .rfind(|segment| !segment.is_empty())?;

    let decoded = percent_decode_ascii(segment)?;
    let decoded = decoded.trim();
    if decoded.is_empty() || decoded.len() > MAX_FILENAME_HINT_BYTES {
        return None;
    }
    if decoded.starts_with('.') || decoded.ends_with('.') || !decoded.contains('.') {
        return None;
    }
    if !decoded
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' '))
    {
        return None;
    }

    Some(decoded.to_string())
}

/// Resolution hint extracted from a path such as `/1080p/index.m3u8`.
pub fn sanitize_resolution_hint(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    for segment in parsed.path_segments()? {
        let lowered = segment.to_ascii_lowercase();
        if lowered.len() == 4 || lowered.len() == 5 {
            if let Some(digits) = lowered.strip_suffix('p') {
                if (digits.len() == 3 || digits.len() == 4)
                    && digits.chars().all(|ch| ch.is_ascii_digit())
                    && digits != "000"
                {
                    return Some(lowered);
                }
            }
        }
    }
    None
}

/// Strip MIME parameters and reject anything that is not a plain
/// `type/subtype` token.
pub fn sanitize_mime(mime: &str) -> Option<String> {
    let base = mime.split(';').next()?.trim().to_ascii_lowercase();
    if base.is_empty() || base.len() > 64 {
        return None;
    }
    let (major, minor) = base.split_once('/')?;
    if major.is_empty() || minor.is_empty() {
        return None;
    }
    let valid = |token: &str| {
        token.chars().all(|ch| {
            ch.is_ascii_alphanumeric()
                || matches!(
                    ch,
                    '!' | '#' | '$' | '&' | '^' | '_' | '+' | '.' | '-' | '*'
                )
        })
    };
    if !valid(major) || !valid(minor) {
        return None;
    }
    Some(base)
}

/// Strict charset guard for every text field that leaves native memory.
///
/// Rejects anything URL-shaped (`://`, `/`, `?`, `#`, `@`, `=`), control
/// characters and oversized text.
pub fn sanitize_summary_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_SUMMARY_TEXT_BYTES {
        return None;
    }
    if trimmed.chars().any(|ch| {
        !(ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '.' | '-' | '_' | ':' | '(' | ')'))
    }) {
        return None;
    }
    // A leading scheme-ish token such as `http:` or `data:` must never survive.
    if trimmed
        .split_once(':')
        .is_some_and(|(head, _)| head.chars().all(|ch| ch.is_ascii_alphabetic()))
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn percent_decode_ascii(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = hex_value(bytes[index + 1])?;
            let low = hex_value(bytes[index + 2])?;
            let decoded = (high << 4) | low;
            if !(0x20..=0x7E).contains(&decoded) {
                return None;
            }
            out.push(decoded);
            index += 3;
        } else {
            if !(0x20..=0x7E).contains(&byte) {
                return None;
            }
            out.push(byte);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderReject {
    Empty,
    TooLong,
    ControlCharacters,
    NonAscii,
    NotAllowlisted,
    Phase1Forbidden,
}

/// Default-deny replay policy. Phase 1 replays only User-Agent / Accept /
/// Accept-Language and only after value validation.
pub fn validate_replay_header(name: &str, value: &str) -> Result<(String, String), HeaderReject> {
    let normalized_name = name.trim().to_ascii_lowercase();
    if is_phase1_forbidden_header(&normalized_name) {
        return Err(HeaderReject::Phase1Forbidden);
    }
    if !is_replayable_header(&normalized_name) {
        return Err(HeaderReject::NotAllowlisted);
    }

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(HeaderReject::Empty);
    }
    if trimmed.len() > MAX_REPLAY_HEADER_BYTES {
        return Err(HeaderReject::TooLong);
    }
    if trimmed.bytes().any(|byte| byte < 0x20 || byte == 0x7F) {
        return Err(HeaderReject::ControlCharacters);
    }
    if !trimmed.is_ascii() {
        return Err(HeaderReject::NonAscii);
    }

    Ok((normalized_name, trimmed.to_string()))
}

pub fn is_replayable_header(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "user-agent" | "accept" | "accept-language"
    )
}

pub fn is_phase1_forbidden_header(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    const EXACT: [&str; 22] = [
        "cookie",
        "cookie2",
        "authorization",
        "proxy-authorization",
        "host",
        "content-length",
        "transfer-encoding",
        "connection",
        "keep-alive",
        "upgrade",
        "te",
        "trailer",
        "forwarded",
        "referer",
        "referrer",
        "origin",
        "range",
        "via",
        "accept-encoding",
        "accept-charset",
        "dnt",
        "x-real-ip",
    ];
    if EXACT.contains(&normalized.as_str()) {
        return true;
    }

    const PREFIXES: [&str; 6] = [
        "proxy-",
        "x-forwarded-",
        "sec-",
        "if-",
        "x-api-key",
        "x-auth",
    ];
    PREFIXES.iter().any(|prefix| normalized.starts_with(prefix))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestinationReject {
    UnsupportedScheme,
    MissingHost,
    Loopback,
    Private,
    LinkLocal,
    UniqueLocal,
    Cgnat,
    Metadata,
    ReservedHostname,
    Reserved,
}

impl DestinationReject {
    pub fn code(self) -> &'static str {
        match self {
            DestinationReject::UnsupportedScheme => "unsupported-scheme",
            DestinationReject::MissingHost => "missing-host",
            DestinationReject::Loopback => "loopback",
            DestinationReject::Private => "private-network",
            DestinationReject::LinkLocal => "link-local",
            DestinationReject::UniqueLocal => "unique-local",
            DestinationReject::Cgnat => "cgnat",
            DestinationReject::Metadata => "cloud-metadata",
            DestinationReject::ReservedHostname => "reserved-hostname",
            DestinationReject::Reserved => "reserved-address",
        }
    }
}

/// Textual destination check: scheme plus hostname/IP literal inspection.
/// DNS resolution is checked separately by [`check_resolved_ip`].
pub fn check_destination_textual(url: &str) -> Result<(), DestinationReject> {
    let parsed = Url::parse(url).map_err(|_| DestinationReject::MissingHost)?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(DestinationReject::UnsupportedScheme);
    }

    match parsed.host().ok_or(DestinationReject::MissingHost)? {
        Host::Ipv4(address) => check_resolved_ip(IpAddr::V4(address)),
        Host::Ipv6(address) => check_resolved_ip(IpAddr::V6(address)),
        Host::Domain(domain) => {
            let host = domain.trim_end_matches('.').to_ascii_lowercase();
            if host.is_empty() {
                return Err(DestinationReject::MissingHost);
            }
            if is_metadata_host(&host) {
                return Err(DestinationReject::Metadata);
            }
            if host == "localhost" || host.ends_with(".localhost") {
                return Err(DestinationReject::Loopback);
            }
            if host.ends_with(".local")
                || host.ends_with(".internal")
                || host.ends_with(".home.arpa")
            {
                return Err(DestinationReject::ReservedHostname);
            }
            if !host.contains('.') {
                return Err(DestinationReject::ReservedHostname);
            }
            Ok(())
        }
    }
}

/// Address-level destination check used after DNS resolution and again at
/// execution boundaries.
pub fn check_resolved_ip(ip: IpAddr) -> Result<(), DestinationReject> {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            if is_metadata_ipv4(&octets) {
                return Err(DestinationReject::Metadata);
            }
            if octets[0] == 127 || octets[0] == 0 {
                return Err(DestinationReject::Loopback);
            }
            if octets[0] == 10
                || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 168)
            {
                return Err(DestinationReject::Private);
            }
            if octets[0] == 169 && octets[1] == 254 {
                return Err(DestinationReject::LinkLocal);
            }
            if octets[0] == 100 && (64..=127).contains(&octets[1]) {
                return Err(DestinationReject::Cgnat);
            }
            if octets[0] >= 224 {
                return Err(DestinationReject::Reserved);
            }
            if (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
            {
                return Err(DestinationReject::Reserved);
            }
            Ok(())
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return check_resolved_ip(IpAddr::V4(mapped));
            }
            let segments = v6.segments();
            if v6.is_loopback() {
                return Err(DestinationReject::Loopback);
            }
            if v6.is_unspecified() {
                return Err(DestinationReject::Reserved);
            }
            if v6.is_multicast() {
                return Err(DestinationReject::Reserved);
            }
            if (segments[0] & 0xffc0) == 0xfe80 {
                return Err(DestinationReject::LinkLocal);
            }
            if (segments[0] & 0xfe00) == 0xfc00 {
                return Err(DestinationReject::UniqueLocal);
            }
            if (segments[0] & 0xffc0) == 0xfec0
                || segments[0] == 0x2002
                || (segments[0] == 0x2001 && segments[1] == 0x0000)
                || (segments[0] == 0x0064
                    && segments[1] == 0xff9b
                    && (segments[2] == 0x0000 || segments[2] == 0x0001))
            {
                return Err(DestinationReject::Reserved);
            }
            if segments[0] == 0x2001 && segments[1] == 0x0db8 {
                return Err(DestinationReject::Reserved);
            }
            Ok(())
        }
    }
}

pub fn is_metadata_host(host: &str) -> bool {
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "metadata.google.internal"
            | "metadata.goog"
            | "169.254.169.254"
            | "100.100.100.200"
            | "fd00:ec2::254"
    )
}

fn is_metadata_ipv4(octets: &[u8; 4]) -> bool {
    matches!(octets, [169, 254, 169, 254] | [100, 100, 100, 200])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    fn ip(text: &str) -> IpAddr {
        text.parse().expect("test IP literal must parse")
    }

    #[test]
    fn classified_media_responses_produce_expected_kinds() {
        let cases = [
            ("video/mp4", MediaKind::Video),
            ("video/webm; codecs=\"vp9\"", MediaKind::Video),
            ("audio/mpeg", MediaKind::Audio),
            ("audio/mp4", MediaKind::Audio),
            ("application/vnd.apple.mpegurl", MediaKind::Hls),
            ("application/x-mpegURL", MediaKind::Hls),
            ("application/dash+xml", MediaKind::Dash),
            ("video/x-flv", MediaKind::Stream),
        ];

        for (mime, expected) in cases {
            let classified = classify_resource(
                Some(mime),
                "https://cdn.example.com/media/stream?token=abc",
                None,
            )
            .unwrap_or_else(|| panic!("mime {mime} must classify"));
            assert_eq!(classified.kind, expected, "mime {mime}");
        }
    }

    #[test]
    fn unsupported_responses_are_not_classified() {
        for mime in [
            "text/html",
            "application/json",
            "image/png",
            "text/css",
            "application/javascript",
            "application/octet-stream",
            "video/mp2t",
            "video/iso.segment",
        ] {
            assert!(
                classify_resource(Some(mime), "https://example.com/page", None).is_none(),
                "mime {mime} must not classify"
            );
        }
    }

    #[test]
    fn conservative_url_hints_classify_when_mime_is_missing_or_generic() {
        let hls = classify_resource(
            None,
            "https://cdn.example.com/live/index.m3u8?sig=abc",
            None,
        )
        .expect("m3u8 hint");
        assert_eq!(hls.kind, MediaKind::Hls);

        let dash = classify_resource(
            Some("application/octet-stream"),
            "https://cdn.example.com/stream/manifest.mpd",
            None,
        )
        .expect("mpd hint");
        assert_eq!(dash.kind, MediaKind::Dash);

        let mp4 = classify_resource(
            Some("binary/octet-stream"),
            "https://cdn.example.com/clip.mp4",
            None,
        )
        .expect("mp4 hint");
        assert_eq!(mp4.kind, MediaKind::Video);

        let flv = classify_resource(None, "https://cdn.example.com/live/room.flv", None)
            .expect("flv hint");
        assert_eq!(flv.kind, MediaKind::Stream);

        let audio = classify_resource(None, "https://cdn.example.com/audio/song.m4a", None)
            .expect("m4a hint");
        assert_eq!(audio.kind, MediaKind::Audio);

        assert!(
            classify_resource(Some("text/html"), "https://example.com/clip.mp4", None).is_none(),
            "an HTML document must never be promoted by its extension"
        );
    }

    #[test]
    fn size_hint_comes_from_reported_length_only() {
        let classified = classify_resource(
            Some("video/mp4"),
            "https://cdn.example.com/a.mp4",
            Some(4_194_304),
        )
        .expect("video/mp4");
        assert_eq!(classified.size_hint, Some(4_194_304));
    }

    #[test]
    fn site_label_keeps_only_the_host() {
        assert_eq!(
            sanitize_site_label("https://user:secret@www.example.com:8443/path?q=1#frag"),
            Some("example.com".to_string())
        );
        assert_eq!(
            sanitize_site_label("https://cdn.example.co.uk/a/b.mp4"),
            Some("cdn.example.co.uk".to_string())
        );
        assert_eq!(
            sanitize_site_label("https://127.0.0.1:9000/a.mp4"),
            Some("127.0.0.1".to_string())
        );
        assert_eq!(sanitize_site_label("not a url"), None);
    }

    #[test]
    fn filename_hint_strips_query_and_rejects_opaque_segments() {
        assert_eq!(
            sanitize_filename_hint("https://cdn.example.com/media/My%20Clip.mp4?token=abc#frag"),
            Some("My Clip.mp4".to_string())
        );
        assert_eq!(
            sanitize_filename_hint("https://cdn.example.com/media/clip.webm"),
            Some("clip.webm".to_string())
        );
        assert_eq!(
            sanitize_filename_hint("https://cdn.example.com/hls/9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"),
            None,
            "opaque path segments must not become display names"
        );
        assert_eq!(sanitize_filename_hint("https://cdn.example.com/"), None);
    }

    #[test]
    fn resolution_hint_is_extracted_conservatively() {
        assert_eq!(
            sanitize_resolution_hint("https://cdn.example.com/1080p/index.m3u8"),
            Some("1080p".to_string())
        );
        assert_eq!(
            sanitize_resolution_hint("https://cdn.example.com/720/clip.mp4"),
            None
        );
    }

    #[test]
    fn mime_sanitizer_requires_a_plain_token() {
        assert_eq!(
            sanitize_mime("Video/MP4; codecs=avc1"),
            Some("video/mp4".to_string())
        );
        assert_eq!(sanitize_mime("text/html"), Some("text/html".to_string()));
        assert_eq!(sanitize_mime("nonsense"), None);
        assert_eq!(sanitize_mime(""), None);
        assert_eq!(
            sanitize_mime("video/mp4\r\nX: 1"),
            None,
            "CRLF must never survive into a summary"
        );
    }

    #[test]
    fn summary_text_sanitizer_rejects_executable_or_secret_shaped_text() {
        assert_eq!(
            sanitize_summary_text("https://cdn.example.com/x.mp4?token=1#f"),
            None
        );
        assert_eq!(
            sanitize_summary_text("cdn.example.com"),
            Some("cdn.example.com".to_string())
        );
        assert_eq!(
            sanitize_summary_text("clip 2024.mp4"),
            Some("clip 2024.mp4".to_string())
        );
        assert_eq!(sanitize_summary_text("cookie=abc"), None);
        assert_eq!(sanitize_summary_text("a\r\nb"), None);
        assert_eq!(
            sanitize_summary_text(&"a".repeat(MAX_SUMMARY_TEXT_BYTES + 1)),
            None
        );
        assert_eq!(sanitize_summary_text(""), None);
    }

    #[test]
    fn header_allowlist_accepts_only_phase1_headers() {
        assert!(validate_replay_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0)").is_ok());
        assert!(validate_replay_header("accept", "*/*").is_ok());
        assert!(validate_replay_header("Accept-Language", "zh-CN,zh;q=0.9").is_ok());

        for forbidden in [
            "Cookie",
            "Authorization",
            "Host",
            "Content-Length",
            "Transfer-Encoding",
            "Connection",
            "Proxy-Authorization",
            "Forwarded",
            "X-Forwarded-For",
            "X-Forwarded-Host",
            "Range",
            "X-Real-IP",
            "Accept-Encoding",
            "X-Custom-Header",
        ] {
            let rejected = validate_replay_header(forbidden, "value");
            assert!(
                matches!(
                    rejected,
                    Err(HeaderReject::NotAllowlisted) | Err(HeaderReject::Phase1Forbidden)
                ),
                "{forbidden} must not be replayable, got {rejected:?}"
            );
        }

        assert_eq!(
            validate_replay_header("Referer", "https://example.com/watch"),
            Err(HeaderReject::Phase1Forbidden)
        );
        assert_eq!(
            validate_replay_header("Origin", "https://example.com"),
            Err(HeaderReject::Phase1Forbidden)
        );
        assert!(is_phase1_forbidden_header("X-Forwarded-Proto"));
        assert!(is_phase1_forbidden_header("Proxy-Connection"));
        assert!(is_replayable_header("user-agent"));
        assert!(!is_replayable_header("authorization"));
    }

    #[test]
    fn header_values_reject_crlf_nul_and_non_ascii() {
        assert_eq!(
            validate_replay_header("User-Agent", "ok\r\nX-Evil: 1"),
            Err(HeaderReject::ControlCharacters)
        );
        assert_eq!(
            validate_replay_header("User-Agent", "ok\0bad"),
            Err(HeaderReject::ControlCharacters)
        );
        assert_eq!(
            validate_replay_header("User-Agent", "naïve"),
            Err(HeaderReject::NonAscii)
        );
        assert_eq!(
            validate_replay_header("User-Agent", "   "),
            Err(HeaderReject::Empty)
        );
        assert_eq!(
            validate_replay_header("User-Agent", &"a".repeat(MAX_REPLAY_HEADER_BYTES + 1)),
            Err(HeaderReject::TooLong)
        );
    }

    #[test]
    fn destination_textual_policy_rejects_loopback_private_and_metadata() {
        let forbidden = [
            "http://127.0.0.1:8080/a.mp4",
            "http://127.9.9.9/a.mp4",
            "http://[::1]/a.mp4",
            "http://localhost/a.mp4",
            "http://localhost:9000/a.mp4",
            "http://sub.localhost/a.mp4",
            "http://10.0.0.5/a.mp4",
            "http://192.168.1.20/a.mp4",
            "http://172.16.4.4/a.mp4",
            "http://172.31.255.254/a.mp4",
            "http://169.254.169.254/latest/meta-data/",
            "http://metadata.google.internal/computeMetadata/v1/",
            "http://100.100.100.200/latest/meta-data/",
            "http://[fd00::1]/a.mp4",
            "http://[fe80::1]/a.mp4",
            "http://0.0.0.0/a.mp4",
            "http://printer.local/a.mp4",
            "file:///C:/secret.mp4",
            "ftp://cdn.example.com/a.mp4",
        ];

        for url in forbidden {
            assert!(
                check_destination_textual(url).is_err(),
                "{url} must be rejected by the destination policy"
            );
        }

        assert!(check_destination_textual("https://cdn.example.com/video.mp4?sig=abc").is_ok());
        assert!(check_destination_textual("http://93.184.216.34/video.mp4").is_ok());
    }

    #[test]
    fn resolved_address_policy_rejects_forbidden_ranges() {
        for forbidden in [
            "127.0.0.1",
            "0.0.0.0",
            "::1",
            "::",
            "10.1.2.3",
            "192.168.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "169.254.10.10",
            "100.64.0.1",
            "fe80::1",
            "fd00::1",
            "fc00::1",
            "224.0.0.1",
            "::ffff:127.0.0.1",
        ] {
            assert!(
                check_resolved_ip(ip(forbidden)).is_err(),
                "{forbidden} must be rejected after resolution"
            );
        }

        for allowed in ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"] {
            assert!(
                check_resolved_ip(ip(allowed)).is_ok(),
                "{allowed} must stay allowed"
            );
        }
    }

    #[test]
    fn ipv6_transition_and_deprecated_local_ranges_fail_closed() {
        for forbidden in [
            "fec0::1",
            "2002:7f00:1::1",
            "2001:0000:4136:e378::1",
            "64:ff9b::7f00:1",
            "64:ff9b:1::7f00:1",
        ] {
            assert!(
                check_resolved_ip(ip(forbidden)).is_err(),
                "{forbidden} must be rejected rather than tunnel an obscured destination"
            );
        }
    }

    #[test]
    fn metadata_hosts_are_recognised() {
        assert!(is_metadata_host("metadata.google.internal"));
        assert!(is_metadata_host("METADATA.GOOGLE.INTERNAL"));
        assert!(is_metadata_host("169.254.169.254"));
        assert!(is_metadata_host("100.100.100.200"));
        assert!(!is_metadata_host("cdn.example.com"));
    }

    #[test]
    fn loopback_ipv6_mapped_literals_are_checked() {
        assert!(check_destination_textual("http://[::ffff:127.0.0.1]/a.mp4").is_err());
        assert!(check_destination_textual("http://[0:0:0:0:0:0:0:1]/a.mp4").is_err());
    }

    #[test]
    fn ipv4_literals_with_unusual_encodings_are_rejected_or_checked() {
        // Browsers may accept decimal/hex IPv4 encodings; the URL crate rejects
        // most of them, and anything that resolves to a literal is checked.
        assert!(check_destination_textual("http://2130706433/a.mp4").is_err());
        assert!(check_destination_textual("http://0x7f000001/a.mp4").is_err());
    }

    #[test]
    fn ip_literals_are_checked_without_dns() {
        assert_eq!(
            check_destination_textual("http://192.168.1.1/a.mp4"),
            Err(DestinationReject::Private)
        );
        assert_eq!(
            check_destination_textual("http://169.254.169.254/a.mp4"),
            Err(DestinationReject::Metadata)
        );
    }

    #[test]
    fn ipv6_unique_local_and_link_local_are_rejected() {
        assert_eq!(
            check_resolved_ip(ip("fd12:3456::1")),
            Err(DestinationReject::UniqueLocal)
        );
        assert_eq!(
            check_resolved_ip(ip("fe80::abcd")),
            Err(DestinationReject::LinkLocal)
        );
    }

    #[test]
    fn ipv4_private_loopback_and_metadata_mapping() {
        assert_eq!(
            check_resolved_ip(ip("127.0.0.1")),
            Err(DestinationReject::Loopback)
        );
        assert_eq!(
            check_resolved_ip(ip("10.0.0.1")),
            Err(DestinationReject::Private)
        );
        assert_eq!(
            check_resolved_ip(ip("169.254.169.254")),
            Err(DestinationReject::Metadata)
        );
        assert_eq!(Ipv4Addr::new(172, 20, 0, 1).octets(), [172, 20, 0, 1]);
        assert_eq!(
            check_resolved_ip(IpAddr::V6(Ipv6Addr::LOCALHOST)),
            Err(DestinationReject::Loopback)
        );
    }
}
