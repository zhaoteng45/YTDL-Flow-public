use serde::Serialize;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CookieInspection {
    pub state: String,
    pub total: usize,
    pub matching: usize,
    pub fresh: usize,
}

/// JSON cookie exports express subdomain scope with `hostOnly`. When the flag
/// is absent, the leading-dot convention applies. Inspection and Netscape
/// conversion must agree on this rule or an accepted file loses its scope.
pub(crate) fn json_host_only(domain: &str, cookie: &serde_json::Value) -> bool {
    cookie
        .get("hostOnly")
        .and_then(|v| v.as_bool())
        .unwrap_or(!domain.starts_with('.'))
}

/// Epoch-second normalization shared by the inspection gate and the Netscape
/// exporter. An explicit `session:true` or a total absence of date fields is a
/// session cookie (0). A finite date is floored, never rounded, so conversion
/// cannot extend validity. Non-numeric or non-finite dates are rejected
/// instead of defaulting to a future date.
pub(crate) fn json_expiry(cookie: &serde_json::Value) -> Result<i64, ()> {
    if cookie.get("session").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(0);
    }
    match cookie
        .get("expirationDate")
        .or_else(|| cookie.get("expiry"))
        .or_else(|| cookie.get("expires"))
    {
        None => Ok(0),
        Some(v) => match v.as_f64() {
            Some(n) if n.is_finite() => Ok(n.floor() as i64),
            _ => Err(()),
        },
    }
}

/// Stable, content-free error code shared by the gate and the exporter.
pub(crate) const INVALID_JSON_COOKIE_EXPORT: &str = "invalid-json-cookie-export";

/// A JSON cookie export entry after minimal validation. Inspection and the
/// Netscape exporter both build on this, so what the gate accepts is exactly
/// what the exporter can safely serialize. Every serialized field is free of
/// control characters and the required fields (`domain`, `name`, `value`) are
/// present with the right types; a legal empty `value` is allowed.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct JsonCookie {
    pub domain: String,
    pub name: String,
    pub value: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub host_only: bool,
    pub expiry: i64,
}

fn required_text<'a>(
    cookie: &'a serde_json::Value,
    key: &str,
    allow_empty: bool,
) -> Result<&'a str, &'static str> {
    let value = cookie
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or(INVALID_JSON_COOKIE_EXPORT)?;
    if !allow_empty && value.is_empty() {
        return Err(INVALID_JSON_COOKIE_EXPORT);
    }
    if value.contains(['\0', '\r', '\n', '\t']) {
        return Err(INVALID_JSON_COOKIE_EXPORT);
    }
    Ok(value)
}

/// Minimal validated parse of a JSON cookie export, shared by `inspect` and
/// `DownloadService::convert_json_cookies_to_netscape`. A single bad entry
/// rejects the whole export (fail closed); required fields are never defaulted
/// and no field is silently skipped.
pub(crate) fn parse_json_cookie_export(text: &str) -> Result<Vec<JsonCookie>, &'static str> {
    let parsed: serde_json::Value =
        serde_json::from_str(text).map_err(|_| INVALID_JSON_COOKIE_EXPORT)?;
    let cookies = parsed.as_array().ok_or(INVALID_JSON_COOKIE_EXPORT)?;
    if cookies.is_empty() {
        return Err(INVALID_JSON_COOKIE_EXPORT);
    }
    let mut out = Vec::with_capacity(cookies.len());
    for cookie in cookies {
        let domain = required_text(cookie, "domain", false)?;
        let name = required_text(cookie, "name", false)?;
        let value = required_text(cookie, "value", true)?;
        // `path` is optional (defaults to "/") but is still an output field.
        let path = match cookie.get("path") {
            Some(_) => required_text(cookie, "path", true)?,
            None => "/",
        };
        let expiry = json_expiry(cookie).map_err(|_| INVALID_JSON_COOKIE_EXPORT)?;
        out.push(JsonCookie {
            domain: domain.to_string(),
            name: name.to_string(),
            value: value.to_string(),
            path: path.to_string(),
            secure: cookie
                .get("secure")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            http_only: cookie
                .get("httpOnly")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            host_only: json_host_only(domain, cookie),
            expiry,
        });
    }
    Ok(out)
}

pub fn inspect(text: &str, target: Option<&str>, now: i64) -> CookieInspection {
    let invalid = || CookieInspection {
        state: "invalid".into(),
        total: 0,
        matching: 0,
        fresh: 0,
    };
    if text.contains('\0') {
        return invalid();
    }
    let rows: Vec<(String, i64, bool)> = if text.trim_start().starts_with('[') {
        let Ok(cookies) = parse_json_cookie_export(text) else {
            return invalid();
        };
        cookies
            .into_iter()
            .map(|cookie| (cookie.domain, cookie.expiry, cookie.host_only))
            .collect()
    } else {
        let mut rows = Vec::new();
        // Never trim the whole data row: a structurally legal empty trailing
        // value is a trailing TAB that `trim()` would erase. Only the
        // blank/comment decision uses a trimmed view. A trailing CR is dropped
        // so CRLF files keep their previous behavior without trimming spaces
        // from the value itself.
        for raw_line in text.lines() {
            let line = raw_line.strip_suffix('\r').unwrap_or(raw_line).trim_start();
            if line.is_empty() {
                continue;
            }
            if line.starts_with('#') && !line.starts_with("#HttpOnly_") {
                continue;
            }
            let fields: Vec<_> = line.trim_start_matches("#HttpOnly_").split('\t').collect();
            if fields.len() != 7
                || fields[0].is_empty()
                || fields[5].is_empty()
                || !matches!(fields[1], "TRUE" | "FALSE")
                || !matches!(fields[3], "TRUE" | "FALSE")
            {
                return invalid();
            }
            let Ok(expiry) = fields[4].parse::<i64>() else {
                return invalid();
            };
            rows.push((fields[0].into(), expiry, fields[1] == "FALSE"));
        }
        rows
    };
    if rows.is_empty() {
        return invalid();
    }
    let host = match target {
        Some(target) => match url::Url::parse(target) {
            Ok(url)
                if matches!(url.scheme(), "https" | "http")
                    && url.username().is_empty()
                    && url.password().is_none() =>
            {
                url.host_str().map(str::to_lowercase)
            }
            _ => return invalid(),
        },
        None => None,
    };
    let matches_host = |domain: &str, host_only: bool| {
        let domain = domain.trim_start_matches('.').to_lowercase();
        host.as_ref().is_none_or(|host| {
            host == &domain || (!host_only && host.ends_with(&format!(".{domain}")))
        })
    };
    let matching = rows
        .iter()
        .filter(|(domain, _, host_only)| matches_host(domain, *host_only))
        .count();
    let fresh = rows
        .iter()
        .filter(|(domain, expiry, host_only)| {
            matches_host(domain, *host_only) && (*expiry == 0 || *expiry > now)
        })
        .count();
    CookieInspection {
        state: if matching == 0 {
            "mismatch"
        } else if fresh == 0 {
            "expired"
        } else {
            "imported"
        }
        .into(),
        total: rows.len(),
        matching,
        fresh,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_only_and_expiry_types_are_honest() {
        assert_eq!(inspect(r#"[{"domain":"youtube.com","hostOnly":true,"name":"SID","value":"x","expires":100}]"#, Some("https://www.youtube.com"), 200).state, "mismatch");
        assert_eq!(
            inspect(
                r#"[{"domain":".youtube.com","name":"SID","value":"x","expires":100}]"#,
                None,
                200
            )
            .state,
            "expired"
        );
        assert_eq!(
            inspect(
                r#"[{"domain":".youtube.com","name":"SID","value":"x","expirationDate":"bad"}]"#,
                None,
                200
            )
            .state,
            "invalid"
        );
    }
    #[test]
    fn json_import_is_not_a_login_claim_and_is_scoped_to_the_target() {
        let text =
            r#"[{"domain":".youtube.com","name":"SID","value":"fixture","expirationDate":2000}]"#;
        assert_eq!(
            inspect(text, Some("https://www.youtube.com/watch?v=test"), 1000).state,
            "imported"
        );
        assert_eq!(
            inspect(text, Some("https://notyoutube.com/watch"), 1000).state,
            "mismatch"
        );
        assert_eq!(inspect(text, None, 3000).state, "expired");
    }
    #[test]
    fn netscape_http_only_and_session_rows_are_supported() {
        let text =
            "# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfixture\n";
        let result = inspect(text, Some("https://youtube.com/watch"), 9000);
        assert_eq!(result.state, "imported");
        assert_eq!(result.fresh, 1);
    }
    #[test]
    fn rejects_binary_empty_and_malformed_files_without_exposing_values() {
        for text in [
            "SQLite format 3\0fixture",
            "[]",
            "{}",
            "random text",
            "[{\"domain\":\".youtube.com\"}]",
        ] {
            assert_eq!(inspect(text, None, 1000).state, "invalid");
        }
    }

    #[test]
    fn json_missing_fields_and_control_characters_are_rejected() {
        for text in [
            r#"[{"hostOnly":false,"name":"SID","value":"x"}]"#,
            r#"[{"domain":"youtube.com","value":"x"}]"#,
            r#"[{"domain":"youtube.com","name":"SID"}]"#,
            r#"[{"domain":"youtube.com","name":"SI\tD","value":"x"}]"#,
            r#"[{"domain":"youtube.com","name":"SID","value":"x\ny"}]"#,
            r#"[{"domain":"you\rtube.com","name":"SID","value":"x"}]"#,
        ] {
            assert_eq!(
                inspect(text, Some("https://www.youtube.com/"), 2000).state,
                "invalid",
                "{text}"
            );
        }
    }

    #[test]
    fn json_session_expiry_alias_and_boundary_semantics_are_honest() {
        let alias = r#"[{"domain":".youtube.com","name":"SID","value":"x","expires":1999999999}]"#;
        assert_eq!(
            inspect(alias, Some("https://www.youtube.com/"), 2000).state,
            "imported"
        );
        assert_eq!(
            inspect(alias, Some("https://www.youtube.com/"), 3000000000).state,
            "expired"
        );

        let session = r#"[{"domain":".youtube.com","name":"SID","value":"x","session":true,"expirationDate":100}]"#;
        assert_eq!(
            inspect(session, Some("https://www.youtube.com/"), 5000).state,
            "imported",
            "session cookies must not expire by date"
        );

        let boundary =
            r#"[{"domain":".youtube.com","name":"SID","value":"x","expirationDate":5000}]"#;
        assert_eq!(
            inspect(boundary, Some("https://www.youtube.com/"), 5000).state,
            "expired"
        );
        assert_eq!(
            inspect(boundary, Some("https://www.youtube.com/"), 4999).state,
            "imported"
        );
    }

    #[test]
    fn json_path_and_every_serialized_field_reject_control_characters() {
        // R1: the exporter writes domain/name/value/path verbatim, so the gate
        // must reject control characters in every serialized field. A TAB in
        // `path` could otherwise inject a second Cookie row.
        let injected = r#"[{"domain":".youtube.com","name":"TEST_ONLY","value":"SYNTHETIC","path":"/\tFALSE\t2147483647\tPREFIX\tSYNTHETIC\n.evil.test\tTRUE\t/"}]"#;
        assert_eq!(
            inspect(injected, Some("https://evil.test/"), 2000).state,
            "invalid"
        );
        for text in [
            r#"[{"domain":"you\rtube.com","name":"TEST_ONLY","value":"SYNTHETIC"}]"#,
            r#"[{"domain":".youtube.com","name":"SI\tD","value":"SYNTHETIC"}]"#,
            r#"[{"domain":".youtube.com","name":"TEST_ONLY","value":"x\u0000y"}]"#,
            r#"[{"domain":".youtube.com","name":"TEST_ONLY","value":"SYNTHETIC","path":"a\nb"}]"#,
            r#"[{"domain":".youtube.com","name":"TEST_ONLY","value":"SYNTHETIC","path":"a\u0000b"}]"#,
        ] {
            assert_eq!(
                inspect(text, Some("https://www.youtube.com/"), 2000).state,
                "invalid",
                "{text}"
            );
        }
    }

    #[test]
    fn json_required_field_types_are_enforced_without_defaulting() {
        for text in [
            r#"[{"name":"TEST_ONLY","value":"SYNTHETIC"}]"#,
            r#"[{"domain":123,"name":"TEST_ONLY","value":"SYNTHETIC"}]"#,
            r#"[{"domain":"","name":"TEST_ONLY","value":"SYNTHETIC"}]"#,
            r#"[{"domain":".youtube.com","name":"","value":"SYNTHETIC"}]"#,
            r#"[{"domain":".youtube.com","name":"TEST_ONLY"}]"#,
            r#"[{"domain":".youtube.com","name":"TEST_ONLY","value":false}]"#,
        ] {
            assert_eq!(
                inspect(text, Some("https://www.youtube.com/"), 2000).state,
                "invalid",
                "{text}"
            );
        }
        // A legal empty value stays accepted (R4 owns its round-trip).
        assert_eq!(
            inspect(
                r#"[{"domain":".youtube.com","name":"TEST_ONLY","value":""}]"#,
                Some("https://www.youtube.com/"),
                2000
            )
            .state,
            "imported"
        );
    }
}
