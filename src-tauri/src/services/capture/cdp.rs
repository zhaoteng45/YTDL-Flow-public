//! Chromium DevTools Protocol Network observation.
//!
//! The translation from CDP messages to [`ObservedResource`] is a pure function
//! so it can be proven with fixture payloads without launching a browser. Only
//! request/response *metadata* is used: response bodies are never requested and
//! body buffering is explicitly disabled by `Network.enable`.

use super::ObservedResource;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

/// Concurrent page targets observed per capture session.
pub const MAX_TARGETS: usize = 4;

/// Upper bound for in-flight request bookkeeping.
pub const MAX_PENDING_REQUESTS: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetInfo {
    pub id: String,
    pub target_type: String,
    pub url: String,
    pub ws_path: String,
}

#[derive(Debug, Clone, Default)]
struct PendingRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    saw_cookie: bool,
    saw_authorization: bool,
}

/// Per-page-target observation state.
#[derive(Debug, Default)]
pub struct TargetObservation {
    pending: HashMap<String, PendingRequest>,
    order: VecDeque<String>,
}

impl TargetObservation {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one CDP event. Returns an observation when the event completes a
    /// resource (a response for a request we saw).
    pub fn observe(
        &mut self,
        method: &str,
        params: &Value,
        capture_id: &str,
    ) -> Option<ObservedResource> {
        match method {
            "Network.requestWillBeSent" => {
                let request_id = params.get("requestId").and_then(Value::as_str)?;
                let request = params.get("request")?;
                let url = request.get("url").and_then(Value::as_str)?;
                let method_name = request
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or("GET")
                    .to_string();
                let headers = headers_from_json(request.get("headers"));

                let saw_cookie = has_header(&headers, "cookie");
                let saw_authorization = has_header(&headers, "authorization");

                let entry = self.pending.entry(request_id.to_string()).or_default();
                entry.url = url.to_string();
                entry.method = method_name;
                entry.headers = headers;
                entry.saw_cookie |= saw_cookie;
                entry.saw_authorization |= saw_authorization;

                self.enforce_bounds(request_id);
                None
            }
            "Network.requestWillBeSentExtraInfo" => {
                let request_id = params.get("requestId").and_then(Value::as_str)?;
                let headers = headers_from_json(params.get("headers"));
                let associated_cookies = params
                    .get("associatedCookies")
                    .and_then(Value::as_array)
                    .map(|cookies| cookies.len())
                    .unwrap_or(0);

                let entry = self.pending.entry(request_id.to_string()).or_default();
                entry.saw_cookie |= associated_cookies > 0 || has_header(&headers, "cookie");
                entry.saw_authorization |= has_header(&headers, "authorization");
                self.enforce_bounds(request_id);
                None
            }
            "Network.responseReceived" => {
                let request_id = params.get("requestId").and_then(Value::as_str)?;
                let response = params.get("response")?;

                let status = response
                    .get("status")
                    .and_then(Value::as_u64)
                    .map(|value| value as u16);
                let mime = response
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let content_length = response
                    .get("headers")
                    .and_then(|headers| {
                        headers
                            .get("Content-Length")
                            .or_else(|| headers.get("content-length"))
                    })
                    .and_then(Value::as_str)
                    .and_then(|value| value.trim().parse::<u64>().ok())
                    .or_else(|| {
                        response
                            .get("encodedDataLength")
                            .and_then(Value::as_u64)
                            .filter(|value| *value > 0)
                    });

                let request = self.take_pending(request_id)?;
                let response_url = response
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let url = if request.url.is_empty() {
                    response_url.to_string()
                } else {
                    request.url
                };
                if url.is_empty() {
                    return None;
                }

                Some(ObservedResource {
                    capture_id: capture_id.to_string(),
                    url,
                    mime,
                    content_length,
                    status,
                    saw_cookie_header: request.saw_cookie,
                    saw_authorization_header: request.saw_authorization,
                    request_headers: request.headers,
                })
            }
            _ => None,
        }
    }

    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    fn take_pending(&mut self, request_id: &str) -> Option<PendingRequest> {
        let request = self.pending.remove(request_id)?;
        if let Some(position) = self.order.iter().position(|id| id == request_id) {
            self.order.remove(position);
        }
        Some(request)
    }

    fn enforce_bounds(&mut self, request_id: &str) {
        if !self.order.iter().any(|id| id == request_id) {
            self.order.push_back(request_id.to_string());
        }
        while self.order.len() > MAX_PENDING_REQUESTS {
            if let Some(oldest) = self.order.pop_front() {
                self.pending.remove(&oldest);
            }
        }
    }
}

fn headers_from_json(value: Option<&Value>) -> Vec<(String, String)> {
    let Some(object) = value.and_then(Value::as_object) else {
        return Vec::new();
    };
    object
        .iter()
        .filter_map(|(name, value)| {
            value
                .as_str()
                .map(|value| (name.clone(), value.to_string()))
        })
        .collect()
}

fn has_header(headers: &[(String, String)], name: &str) -> bool {
    headers
        .iter()
        .any(|(header, _)| header.eq_ignore_ascii_case(name))
}

/// Parse the `/json/list` payload into page targets.
pub fn parse_target_list(json: &str) -> Result<Vec<TargetInfo>, String> {
    let value: Value =
        serde_json::from_str(json).map_err(|error| format!("invalid target list: {error}"))?;
    let entries = value
        .as_array()
        .ok_or_else(|| "target list is not an array".to_string())?;

    let mut targets = Vec::new();
    for entry in entries {
        let Some(id) = entry.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(target_type) = entry.get("type").and_then(Value::as_str) else {
            continue;
        };
        let Some(debugger_url) = entry.get("webSocketDebuggerUrl").and_then(Value::as_str) else {
            continue;
        };
        let Some(ws_path) = ws_path_from_debugger_url(debugger_url) else {
            continue;
        };

        targets.push(TargetInfo {
            id: id.to_string(),
            target_type: target_type.to_string(),
            url: entry
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            ws_path,
        });
    }
    Ok(targets)
}

/// Derive the websocket path for a target from its debugger URL.
pub fn ws_path_from_debugger_url(url: &str) -> Option<String> {
    if url.is_empty() {
        return None;
    }
    let scheme_end = url.find("://")? + 3;
    if scheme_end >= url.len() {
        return None;
    }
    let authority_end = url[scheme_end..].find('/')? + scheme_end;
    if authority_end >= url.len() {
        return None;
    }
    Some(url[authority_end..].to_string())
}

/// `Network.enable` with body buffering disabled for every resource type.
pub fn network_enable_message(id: u64) -> String {
    serde_json::json!({
        "id": id,
        "method": "Network.enable",
        "params": {
            "maxTotalBufferSize": 0,
            "maxResourceBufferSize": 0,
            "maxPostDataSize": 0
        }
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TARGET_LIST: &str = r#"[
      {
        "description": "",
        "devtoolsFrontendUrl": "/devtools/inspector.html?ws=127.0.0.1:9222/devtools/page/ABC",
        "id": "ABC",
        "title": "Fixture",
        "type": "page",
        "url": "http://127.0.0.1:8123/index.html",
        "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/ABC"
      },
      {
        "id": "DEF",
        "title": "Service Worker",
        "type": "service_worker",
        "url": "http://127.0.0.1:8123/sw.js",
        "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/DEF"
      }
    ]"#;

    fn request_will_be_sent(url: &str, headers: Value) -> Value {
        serde_json::json!({
            "requestId": "req-1",
            "loaderId": "loader-1",
            "documentURL": "http://127.0.0.1:8123/index.html",
            "request": {
                "url": url,
                "method": "GET",
                "headers": headers,
                "initialPriority": "High",
                "referrerPolicy": "strict-origin-when-cross-origin"
            },
            "timestamp": 1234.5,
            "wallTime": 1234.5,
            "initiator": { "type": "parser" },
            "type": "Media"
        })
    }

    fn extra_info(headers: Value, cookies: Value) -> Value {
        serde_json::json!({
            "requestId": "req-1",
            "associatedCookies": cookies,
            "headers": headers,
            "connectTiming": { "requestTime": 1234.5 }
        })
    }

    fn response_received(mime: &str, status: u16, headers: Value) -> Value {
        serde_json::json!({
            "requestId": "req-1",
            "loaderId": "loader-1",
            "timestamp": 1235.0,
            "type": "Media",
            "response": {
                "url": "https://cdn.example.com/master.m3u8",
                "status": status,
                "statusText": "OK",
                "headers": headers,
                "mimeType": mime,
                "connectionReused": false,
                "encodedDataLength": 512,
                "securityState": "secure"
            },
            "hasExtraInfo": true,
            "frameId": "frame-1"
        })
    }

    #[test]
    fn parses_the_devtools_target_list() {
        let targets = parse_target_list(TARGET_LIST).expect("target list must parse");
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].id, "ABC");
        assert_eq!(targets[0].target_type, "page");
        assert_eq!(targets[0].ws_path, "/devtools/page/ABC");

        assert_eq!(
            ws_path_from_debugger_url("ws://127.0.0.1:9222/devtools/page/XYZ"),
            Some("/devtools/page/XYZ".to_string())
        );
        assert_eq!(ws_path_from_debugger_url(""), None);
    }

    #[test]
    fn translates_a_media_response_into_an_observed_resource() {
        let mut observation = TargetObservation::new();
        assert!(observation
            .observe(
                "Network.requestWillBeSent",
                &request_will_be_sent(
                    "https://cdn.example.com/master.m3u8?sig=deadbeef",
                    serde_json::json!({ "User-Agent": "Mozilla/5.0", "Accept": "*/*" })
                ),
                "capture-1",
            )
            .is_none());

        let observed = observation
            .observe(
                "Network.responseReceived",
                &response_received(
                    "application/vnd.apple.mpegurl",
                    200,
                    serde_json::json!({ "Content-Length": "4096" }),
                ),
                "capture-1",
            )
            .expect("a completed response must produce an observation");

        assert_eq!(observed.capture_id, "capture-1");
        assert_eq!(
            observed.url,
            "https://cdn.example.com/master.m3u8?sig=deadbeef"
        );
        assert_eq!(
            observed.mime.as_deref(),
            Some("application/vnd.apple.mpegurl")
        );
        assert_eq!(observed.content_length, Some(4096));
        assert_eq!(observed.status, Some(200));
        assert!(!observed.saw_cookie_header);
        assert!(!observed.saw_authorization_header);
        assert!(
            observed
                .request_headers
                .iter()
                .any(|(name, value)| name.eq_ignore_ascii_case("user-agent")
                    && value == "Mozilla/5.0")
        );
    }

    #[test]
    fn detects_cookie_and_authorization_from_extra_info() {
        let mut observation = TargetObservation::new();
        observation.observe(
            "Network.requestWillBeSent",
            &request_will_be_sent("https://cdn.example.com/private.mp4", serde_json::json!({})),
            "capture-1",
        );

        observation.observe(
            "Network.requestWillBeSentExtraInfo",
            &extra_info(
                serde_json::json!({ "Authorization": "Bearer super-secret", "Cookie": "a=b" }),
                serde_json::json!([{ "cookie": { "name": "session", "value": "abc" } }]),
            ),
            "capture-1",
        );

        let observed = observation
            .observe(
                "Network.responseReceived",
                &response_received("video/mp4", 206, serde_json::json!({})),
                "capture-1",
            )
            .expect("observation must be produced");

        assert!(observed.saw_cookie_header);
        assert!(observed.saw_authorization_header);
    }

    #[test]
    fn detects_cookie_header_reported_on_the_request_itself() {
        let mut observation = TargetObservation::new();
        observation.observe(
            "Network.requestWillBeSent",
            &request_will_be_sent(
                "https://cdn.example.com/private.mp4",
                serde_json::json!({ "Cookie": "session=abc" }),
            ),
            "capture-1",
        );

        let observed = observation
            .observe(
                "Network.responseReceived",
                &response_received("video/mp4", 200, serde_json::json!({})),
                "capture-1",
            )
            .expect("observation must be produced");
        assert!(observed.saw_cookie_header);
    }

    #[test]
    fn responses_without_a_known_request_are_ignored() {
        let mut observation = TargetObservation::new();
        let observed = observation.observe(
            "Network.responseReceived",
            &response_received("video/mp4", 200, serde_json::json!({})),
            "capture-1",
        );
        assert!(observed.is_none());
    }

    #[test]
    fn unrelated_events_are_ignored() {
        let mut observation = TargetObservation::new();
        for method in [
            "Network.loadingFinished",
            "Network.dataReceived",
            "Page.frameNavigated",
            "Network.requestWillBeSentExtraInfo",
        ] {
            assert!(observation
                .observe(
                    method,
                    &serde_json::json!({ "requestId": "req-1" }),
                    "capture-1"
                )
                .is_none());
        }
    }

    #[test]
    fn pending_request_bookkeeping_is_bounded() {
        let mut observation = TargetObservation::new();
        for index in 0..(MAX_PENDING_REQUESTS + 50) {
            let mut event =
                request_will_be_sent("https://cdn.example.com/a.mp4", serde_json::json!({}));
            event["requestId"] = Value::String(format!("req-{index}"));
            observation.observe("Network.requestWillBeSent", &event, "capture-1");
        }
        assert!(observation.pending_len() <= MAX_PENDING_REQUESTS);
    }

    #[test]
    fn network_enable_disables_response_body_buffering() {
        let message: Value =
            serde_json::from_str(&network_enable_message(7)).expect("valid JSON-RPC message");
        assert_eq!(message["id"], 7);
        assert_eq!(message["method"], "Network.enable");
        assert_eq!(message["params"]["maxTotalBufferSize"], 0);
        assert_eq!(message["params"]["maxResourceBufferSize"], 0);
        assert_eq!(message["params"]["maxPostDataSize"], 0);
    }

    #[test]
    fn oversized_or_malformed_params_are_ignored() {
        let mut observation = TargetObservation::new();
        assert!(observation
            .observe(
                "Network.requestWillBeSent",
                &serde_json::json!({}),
                "capture-1"
            )
            .is_none());
        assert!(observation
            .observe(
                "Network.responseReceived",
                &serde_json::json!({ "requestId": "req-1", "response": { "status": "not-a-number" } }),
                "capture-1"
            )
            .is_none());
    }
}
