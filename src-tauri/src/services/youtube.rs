//! YouTube capability boundary: inventory is observed, never a source limit.
use crate::models::{ExtraArgs, RuntimeState, YouTubeDiagnostic, YouTubeFormatCapability};
use serde_json::Value;
use std::cmp::Ordering;

pub fn diagnose(log: &str, extraction_succeeded: bool) -> YouTubeDiagnostic {
    let lower = log.to_ascii_lowercase();
    let invoked = lower.contains("solving js challenges using bun");
    let failed = lower.lines().any(|line| {
        ((line.contains("[jsc:bun]")
            || line.contains("using bun")
            || line.contains("\"bun\" provider"))
            && (line.contains("error executing")
                || line.contains("challenge solving failed")
                || line.contains("solver failed")
                || line.contains("error solving")
                || line.contains("error running bun process")))
            || (invoked
                && (line.contains("n challenge solving failed")
                    || line.contains("signature solving failed")))
    });
    YouTubeDiagnostic {
        cookie_state: if lower.contains("account cookies are no longer valid") {
            "stale"
        } else {
            "unknown"
        }
        .into(),
        runtime_state: if failed {
            RuntimeState::Failed
        } else if invoked && extraction_succeeded {
            RuntimeState::Succeeded
        } else {
            RuntimeState::Unknown
        },
        pot_state: if lower.lines().any(|line| {
            (line.contains("pot") || line.contains("po token"))
                && (line.contains("generated") || line.contains("successfully"))
        }) {
            "generated"
        } else {
            "unknown"
        }
        .into(),
    }
}

pub fn client_args(base: &ExtraArgs, client: &str, stale: bool) -> ExtraArgs {
    let mut args = base.clone();
    args.player_client = Some(client.into());
    args.smart_decision = None;
    if stale || matches!(client, "android" | "ios" | "android_vr" | "tv_simply") {
        args.cookies = None;
        // Session-bound inputs cannot be reused after switching auth identity.
        args.po_token = None;
        args.visitor_data = None;
    }
    args
}

pub fn auth_required(log: &str) -> bool {
    let lower = log.to_ascii_lowercase();
    [
        "login_required",
        "sign in to confirm your age",
        "private video",
        "members-only",
        "join this channel",
        "sign in to watch",
    ]
    .iter()
    .any(|s| lower.contains(s))
}

pub fn failure_code(log: &str) -> Option<&'static str> {
    let diagnostic = diagnose(log, false);
    if auth_required(log) {
        Some(if diagnostic.cookie_state == "stale" {
            "COOKIE_REFRESH_REQUIRED"
        } else {
            "AUTH_REQUIRED"
        })
    } else if diagnostic.runtime_state == RuntimeState::Failed {
        Some("JS_RUNTIME_FAILURE")
    } else {
        None
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value[key].as_str().map(str::to_string)
}

pub fn inventory(json: &Value) -> Vec<YouTubeFormatCapability> {
    let Some(formats) = json["formats"].as_array() else {
        return Vec::new();
    };
    let has_audio = formats
        .iter()
        .any(|f| transport_usable(f) && f["acodec"].as_str().is_some_and(|c| c != "none"));
    formats
        .iter()
        .map(|f| {
            let video = f["vcodec"].as_str().is_some_and(|c| c != "none")
                && f["height"].as_i64().unwrap_or(0) > 0;
            let audio = f["acodec"].as_str().is_some_and(|c| c != "none");
            YouTubeFormatCapability {
                format_id: f["format_id"].as_str().unwrap_or("").into(),
                language: text(f, "language"),
                width: f["width"].as_i64(),
                height: f["height"].as_i64(),
                fps: f["fps"].as_f64(),
                dynamic_range: text(f, "dynamic_range"),
                vcodec: text(f, "vcodec"),
                acodec: text(f, "acodec"),
                protocol: text(f, "protocol"),
                ext: text(f, "ext"),
                filesize: f["filesize"].as_u64(),
                filesize_approx: f["filesize_approx"].as_u64(),
                bitrate: f["tbr"].as_f64(),
                has_drm: f["has_drm"].as_bool(),
                usable: transport_usable(f) && (audio || (video && has_audio)),
            }
        })
        .collect()
}

fn transport_usable(f: &Value) -> bool {
    f["url"].as_str().is_some_and(|u| !u.is_empty())
        && f["has_drm"].as_bool() != Some(true)
        && matches!(
            f["protocol"].as_str(),
            Some("https" | "http" | "m3u8_native" | "m3u8" | "http_dash_segments" | "dash")
        )
}

/// Lexicographic ordering, no weighted magic score. Requested ceiling precedes
/// dimensions, fps and HDR. yt-dlp's inventory preference resolves codec ties.
/// HTTPS precedes segmented transports only after equivalent quality/audio.
pub fn compare(
    a: &YouTubeFormatCapability,
    b: &YouTubeFormatCapability,
    requested: Option<i64>,
) -> Ordering {
    let within =
        |f: &YouTubeFormatCapability| requested.is_none_or(|max| f.height.unwrap_or(0) <= max);
    let hdr = |f: &YouTubeFormatCapability| {
        f.dynamic_range
            .as_deref()
            .is_some_and(|r| !matches!(r, "SDR" | "unknown"))
    };
    let audio = |f: &YouTubeFormatCapability| f.acodec.as_deref().is_some_and(|c| c != "none");
    let reliable =
        |f: &YouTubeFormatCapability| matches!(f.protocol.as_deref(), Some("https" | "http"));
    a.usable
        .cmp(&b.usable)
        .then_with(|| within(a).cmp(&within(b)))
        .then_with(|| {
            if requested.is_some() && !within(a) && !within(b) {
                b.height.unwrap_or(0).cmp(&a.height.unwrap_or(0))
            } else {
                a.height.unwrap_or(0).cmp(&b.height.unwrap_or(0))
            }
        })
        .then_with(|| a.fps.unwrap_or(0.0).total_cmp(&b.fps.unwrap_or(0.0)))
        .then_with(|| hdr(a).cmp(&hdr(b)))
        .then_with(|| {
            codec_preference(a.vcodec.as_deref()).cmp(&codec_preference(b.vcodec.as_deref()))
        })
        .then_with(|| audio(a).cmp(&audio(b)))
        .then_with(|| reliable(a).cmp(&reliable(b)))
        .then_with(|| {
            a.bitrate
                .unwrap_or(0.0)
                .total_cmp(&b.bitrate.unwrap_or(0.0))
        })
}

/// yt-dlp documented default video-codec order (codec:vcodec). Dimensions,
/// frame rate and dynamic range precede it; no codec preference is hard-filtered.
fn codec_preference(codec: Option<&str>) -> Option<usize> {
    let value = codec.unwrap_or("");
    ["h264", "h265", "vp9", "av1"]
        .iter()
        .position(|family| match *family {
            "h264" => value.starts_with("avc") || value.starts_with("h264"),
            "h265" => {
                value.starts_with("hev") || value.starts_with("hvc") || value.starts_with("hevc")
            }
            "vp9" => value.starts_with("vp9") || value.starts_with("vp09"),
            "av1" => value.starts_with("av01") || value.starts_with("av1"),
            _ => false,
        })
}

pub fn best_format(
    formats: &[YouTubeFormatCapability],
    requested: Option<i64>,
) -> Option<&YouTubeFormatCapability> {
    // last equal inventory entry follows yt-dlp's documented worst-to-best order.
    formats
        .iter()
        .filter(|f| f.usable && f.height.unwrap_or(0) > 0)
        .max_by(|a, b| compare(a, b, requested))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn smart_comparison_keeps_scanning_after_360p_and_selects_real_quality() {
        let make = |height, fps| {
            inventory(&json!({"formats":[{"format_id":"test","height":height,"fps":fps,"vcodec":"av01","acodec":"aac","protocol":"https","url":"https://example.com"}]})).remove(0)
        };
        assert_eq!(
            compare(&make(1080, 30), &make(360, 30), None),
            Ordering::Greater
        );
        assert_eq!(
            compare(&make(2160, 30), &make(1080, 30), None),
            Ordering::Greater
        );
        assert_eq!(
            compare(&make(1080, 60), &make(1080, 30), None),
            Ordering::Greater
        );
        assert_eq!(
            compare(&make(1080, 30), &make(2160, 60), Some(1080)),
            Ordering::Greater
        );
    }

    #[test]
    fn stale_auth_required_is_cookie_refresh_and_generic_format_failure_is_not_bun_failure() {
        assert_eq!(
            failure_code("The provided YouTube account cookies are no longer valid. Private video"),
            Some("COOKIE_REFRESH_REQUIRED")
        );
        assert_eq!(
            failure_code("Sign in to confirm your age"),
            Some("AUTH_REQUIRED")
        );
        assert_eq!(failure_code("[jsc] Error solving n challenge request using \"bun\" provider: Error running bun process"), Some("JS_RUNTIME_FAILURE"));
        assert_eq!(
            failure_code(
                "[jsc:bun] bun version 1.4.2 is not supported! Requested format is not available"
            ),
            None
        );
    }

    #[test]
    fn requested_ceiling_uses_nearest_higher_format_when_none_fit() {
        let make = |height| {
            inventory(&json!({"formats":[{"format_id":"test","height":height,"vcodec":"av01","acodec":"aac","protocol":"https","url":"https://example.com"}]})).remove(0)
        };
        assert_eq!(
            compare(&make(1440), &make(2160), Some(1080)),
            Ordering::Greater
        );
    }

    #[test]
    fn inventory_ignores_drm_and_missing_audio_and_observes_more_than_selected_format() {
        let json = json!({"height": 360, "formats": [
            {"format_id":"drm", "height":4320,"vcodec":"av01", "has_drm":true,"url":"https://media.invalid/1"},
            {"format_id":"399", "height":2160,"fps":60,"vcodec":"av01", "acodec":"none","protocol":"https","url":"https://media.invalid/2"},
            {"format_id":"251", "vcodec":"none","acodec":"opus","protocol":"https","url":"https://media.invalid/3"}
        ]});
        let formats = inventory(&json);
        assert!(!formats[0].usable);
        assert_eq!(
            best_format(&formats, None).map(|f| f.height),
            Some(Some(2160))
        );
        let video_only = inventory(
            &json!({"formats":[{"format_id":"399","height":2160,"vcodec":"av01","acodec":"none","url":"https://media.invalid/2","protocol":"https"}]}),
        );
        assert!(best_format(&video_only, None).is_none());
    }

    #[test]
    fn warning_is_not_runtime_failure_and_success_keeps_bun() {
        let warning = "[jsc:bun] bun version 1.4.2 is not supported!";
        assert_eq!(
            diagnose(warning, false).runtime_state,
            RuntimeState::Unknown
        );
        assert_eq!(
            diagnose(
                &format!("{warning}\n[jsc:bun] Solving JS challenges using bun\n"),
                true
            )
            .runtime_state,
            RuntimeState::Succeeded
        );
        assert_eq!(
            diagnose("[jsc:bun] Error executing challenge solver", false).runtime_state,
            RuntimeState::Failed
        );
        assert_eq!(
            diagnose("Requested format is not available", false).runtime_state,
            RuntimeState::Unknown
        );
    }

    #[test]
    fn mobile_clients_never_receive_account_cookies() {
        for client in ["android", "ios"] {
            let args = client_args(
                &ExtraArgs {
                    cookies: Some("edge".into()),
                    ..Default::default()
                },
                client,
                false,
            );
            assert!(args.cookies.is_none());
        }
        assert!(client_args(
            &ExtraArgs {
                cookies: Some("edge".into()),
                ..Default::default()
            },
            "mweb",
            false
        )
        .cookies
        .is_some());
        assert!(client_args(
            &ExtraArgs {
                cookies: Some("edge".into()),
                ..Default::default()
            },
            "web",
            true
        )
        .cookies
        .is_none());
    }
}
