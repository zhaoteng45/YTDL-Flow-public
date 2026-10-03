use serde::Serialize;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CookieInspection {
    pub state: String,
    pub total: usize,
    pub matching: usize,
    pub fresh: usize,
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
        let Ok(serde_json::Value::Array(values)) = serde_json::from_str(text) else {
            return invalid();
        };
        let mut rows = Vec::new();
        for value in values {
            let Some(domain) = value
                .get("domain")
                .and_then(|v| v.as_str())
                .filter(|d| !d.is_empty())
            else {
                return invalid();
            };
            let Some(name) = value
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|n| !n.is_empty())
            else {
                return invalid();
            };
            let Some(cookie_value) = value.get("value").and_then(|v| v.as_str()) else {
                return invalid();
            };
            if [domain, name, cookie_value]
                .iter()
                .any(|v| v.contains(['\r', '\n', '\t']))
            {
                return invalid();
            }
            let expiry = if value.get("session").and_then(|v| v.as_bool()) == Some(true) {
                0
            } else {
                let expiry = value
                    .get("expirationDate")
                    .or_else(|| value.get("expiry"))
                    .or_else(|| value.get("expires"));
                match expiry {
                    None => 0,
                    Some(v) => match v.as_f64() {
                        Some(n) if n.is_finite() => n as i64,
                        _ => return invalid(),
                    },
                }
            };
            rows.push((
                domain.into(),
                expiry,
                value
                    .get("hostOnly")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(!domain.starts_with('.')),
            ));
        }
        rows
    } else {
        let mut rows = Vec::new();
        for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
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
}
