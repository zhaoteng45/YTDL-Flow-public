//! Resource Capture Phase 1 (ADR-0003 Opaque Capture Context).
//!
//! `policy` owns the pure security primitives; `CaptureState` owns bounded
//! discovery state and opaque context leases. It never owns a task: it cannot
//! queue, start, cancel or complete a download.

pub mod browser;
pub mod cdp;
pub mod egress;
pub mod policy;
pub mod session;
pub mod ws;

use crate::models::{CaptureClaimOutcome, CaptureSessionInfo, CapturedResourceSummary};
use policy::{
    check_destination_textual, check_resolved_ip, classify_resource, sanitize_filename_hint,
    sanitize_mime, sanitize_resolution_hint, sanitize_site_label, validate_replay_header,
    DestinationReject, MAX_URL_BYTES,
};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use url::Url;

/// Bounded capture state. Values are deliberate Phase 1 ceilings.
#[derive(Debug, Clone)]
pub struct CaptureLimits {
    pub max_resources_per_session: usize,
    pub max_contexts: usize,
    pub max_context_bytes: usize,
    pub max_url_bytes: usize,
    pub context_ttl: Duration,
}

impl Default for CaptureLimits {
    fn default() -> Self {
        Self {
            max_resources_per_session: 200,
            max_contexts: 32,
            max_context_bytes: 65_536,
            max_url_bytes: MAX_URL_BYTES,
            context_ttl: Duration::from_secs(30 * 60),
        }
    }
}

/// One Network-domain observation, translated by the CDP adapter.
/// Raw values stay native and are never serialized.
#[derive(Debug, Clone)]
pub struct ObservedResource {
    pub capture_id: String,
    pub url: String,
    pub mime: Option<String>,
    pub content_length: Option<u64>,
    pub status: Option<u16>,
    pub saw_cookie_header: bool,
    pub saw_authorization_header: bool,
    /// Native-only request headers; only the validated allowlist is retained.
    pub request_headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordOutcome {
    Added {
        resource_id: String,
        resource_number: u32,
        evicted: Option<u32>,
    },
    Merged {
        resource_id: String,
        resource_number: u32,
    },
    Skipped {
        reason: &'static str,
    },
    Rejected {
        reason: &'static str,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimError {
    NotFound,
    Inactive,
    UnsupportedScheme,
    ForbiddenDestination(&'static str),
    AuthenticatedReplayRequired,
    UnsupportedExecutionKind,
    LimitReached,
}

impl ClaimError {
    pub fn into_outcome(self) -> CaptureClaimOutcome {
        match self {
            ClaimError::NotFound => CaptureClaimOutcome::NotFound,
            ClaimError::Inactive => CaptureClaimOutcome::CaptureInactive,
            ClaimError::UnsupportedScheme => CaptureClaimOutcome::UnsupportedScheme,
            ClaimError::ForbiddenDestination(reason) => CaptureClaimOutcome::ForbiddenDestination {
                reason: reason.to_string(),
            },
            ClaimError::AuthenticatedReplayRequired => {
                CaptureClaimOutcome::AuthenticatedReplayRequired
            }
            ClaimError::UnsupportedExecutionKind => CaptureClaimOutcome::UnsupportedExecutionKind,
            ClaimError::LimitReached => CaptureClaimOutcome::LimitReached,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureContextError {
    NotFound,
    Revoked,
    Expired,
    RowMismatch,
}

impl CaptureContextError {
    /// Stable machine-readable token. Never match on the human message.
    pub fn code(&self) -> &'static str {
        match self {
            CaptureContextError::NotFound => "capture-context-not-found",
            CaptureContextError::Revoked => "capture-context-revoked",
            CaptureContextError::Expired => "capture-context-expired",
            CaptureContextError::RowMismatch => "capture-context-row-mismatch",
        }
    }
}

/// Native-only execution material resolved for one attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionContext {
    pub context_id: String,
    pub raw_url: String,
    pub site_label: String,
    pub media_kind: String,
    pub replay_headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttemptOutcome {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimTicket {
    pub resource_id: String,
    pub raw_url: String,
    pub summary: CapturedResourceSummary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedContext {
    pub context_id: String,
    pub summary: CapturedResourceSummary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureSessionDescriptor {
    pub capture_id: String,
    pub browser_name: String,
}

#[derive(Debug, Clone)]
struct StoredResource {
    resource_id: String,
    resource_number: u32,
    capture_id: String,
    site_label: String,
    media_kind: String,
    mime_type: String,
    size_bytes: Option<u64>,
    filename_hint: Option<String>,
    resolution_hint: Option<String>,
    requires_authenticated_replay: bool,
    raw_url: String,
    dedupe_key: String,
    replay_headers: Vec<(String, String)>,
}

impl StoredResource {
    fn summary(&self) -> CapturedResourceSummary {
        CapturedResourceSummary {
            capture_id: self.capture_id.clone(),
            resource_id: self.resource_id.clone(),
            resource_number: self.resource_number,
            site_label: self.site_label.clone(),
            media_kind: self.media_kind.clone(),
            mime_type: self.mime_type.clone(),
            size_bytes: self.size_bytes,
            filename_hint: self.filename_hint.clone(),
            resolution_hint: self.resolution_hint.clone(),
            requires_authenticated_replay: self.requires_authenticated_replay,
        }
    }

    /// Drop every piece of executable/secret material. Only sanitized display
    /// fields survive so the revoked context can still answer with a typed
    /// outcome instead of leaking or silently disappearing.
    fn scrub(&mut self) {
        self.raw_url.clear();
        self.replay_headers.clear();
        self.dedupe_key.clear();
    }

    fn is_scrubbed(&self) -> bool {
        self.raw_url.is_empty()
    }

    fn retained_bytes(&self) -> usize {
        self.raw_url.len()
            + self.dedupe_key.len()
            + self.site_label.len()
            + self.mime_type.len()
            + self.filename_hint.as_deref().unwrap_or("").len()
            + self.resolution_hint.as_deref().unwrap_or("").len()
            + self
                .replay_headers
                .iter()
                .map(|(name, value)| name.len() + value.len())
                .sum::<usize>()
    }
}

#[derive(Debug, Clone)]
struct StoredContext {
    context_id: String,
    generation: u64,
    resource: StoredResource,
    expires_at: Instant,
    bound_row_id: Option<String>,
    lease: Option<String>,
    revoked: bool,
}

#[derive(Debug, Default)]
struct CaptureInner {
    generation: u64,
    session: Option<CaptureSessionDescriptor>,
    resources: Vec<StoredResource>,
    contexts: HashMap<String, StoredContext>,
    next_resource_number: u32,
}

/// Shared native capture state (Tauri managed state).
#[derive(Clone)]
pub struct CaptureState {
    inner: Arc<Mutex<CaptureInner>>,
    limits: CaptureLimits,
    id_factory: Arc<dyn Fn() -> String + Send + Sync>,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self::new(CaptureLimits::default())
    }
}

impl CaptureState {
    pub fn new(limits: CaptureLimits) -> Self {
        Self {
            inner: Arc::new(Mutex::new(CaptureInner::default())),
            limits,
            id_factory: Arc::new(|| uuid::Uuid::new_v4().to_string()),
        }
    }

    /// Test seam for deterministic ids.
    pub fn with_id_factory(
        limits: CaptureLimits,
        id_factory: Arc<dyn Fn() -> String + Send + Sync>,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(CaptureInner::default())),
            limits,
            id_factory,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, CaptureInner> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn next_id(&self) -> String {
        (self.id_factory)()
    }

    pub fn begin_session(
        &self,
        descriptor: CaptureSessionDescriptor,
    ) -> Result<CaptureSessionInfo, String> {
        let mut inner = self.lock();
        if let Some(existing) = &inner.session {
            return Err(format!(
                "capture session '{}' is already active",
                existing.capture_id
            ));
        }

        inner.resources.clear();
        inner.next_resource_number = 0;
        inner.session = Some(descriptor.clone());

        Ok(CaptureSessionInfo {
            capture_id: descriptor.capture_id,
            browser_name: descriptor.browser_name,
            profile_isolated: true,
        })
    }

    pub fn session(&self) -> Option<CaptureSessionInfo> {
        let inner = self.lock();
        inner.session.as_ref().map(|descriptor| CaptureSessionInfo {
            capture_id: descriptor.capture_id.clone(),
            browser_name: descriptor.browser_name.clone(),
            profile_isolated: true,
        })
    }

    /// Stop discovery and clear unclaimed resources. Claimed contexts survive
    /// so an already imported task can still finish.
    pub fn end_session(&self, capture_id: &str) -> bool {
        let mut inner = self.lock();
        let matches = inner
            .session
            .as_ref()
            .is_some_and(|session| session.capture_id == capture_id);
        if !matches {
            return false;
        }

        inner.session = None;
        inner.resources.clear();
        inner.next_resource_number = 0;
        true
    }

    pub fn record_observed(&self, observed: ObservedResource) -> RecordOutcome {
        let mut inner = self.lock();

        let matches_session = inner
            .session
            .as_ref()
            .is_some_and(|session| session.capture_id == observed.capture_id);
        if !matches_session {
            return RecordOutcome::Skipped {
                reason: "capture-inactive",
            };
        }

        let Ok(parsed) = Url::parse(&observed.url) else {
            return RecordOutcome::Skipped {
                reason: "unsupported-url",
            };
        };
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return RecordOutcome::Skipped {
                reason: "unsupported-scheme",
            };
        }

        let mut identity = parsed.clone();
        identity.set_fragment(None);
        let dedupe_key = identity.as_str().to_string();
        if dedupe_key.len() > self.limits.max_url_bytes {
            return RecordOutcome::Rejected {
                reason: "url-too-long",
            };
        }

        if let Some(existing) = inner
            .resources
            .iter()
            .find(|resource| resource.dedupe_key == dedupe_key)
        {
            return RecordOutcome::Merged {
                resource_id: existing.resource_id.clone(),
                resource_number: existing.resource_number,
            };
        }

        let Some(classification) = classify_resource(
            observed.mime.as_deref(),
            &observed.url,
            observed.content_length,
        ) else {
            return RecordOutcome::Skipped {
                reason: "not-media",
            };
        };

        let Some(site_label) = sanitize_site_label(&observed.url) else {
            return RecordOutcome::Skipped {
                reason: "unlabelable-host",
            };
        };
        let Some(mime_type) = sanitize_mime(&classification.mime) else {
            return RecordOutcome::Skipped {
                reason: "unsupported-mime",
            };
        };

        let requires_authenticated_replay = observed.saw_cookie_header
            || observed.saw_authorization_header
            || matches!(observed.status, Some(401) | Some(403));

        let replay_headers = sanitize_replay_headers(&observed.request_headers);

        inner.next_resource_number = inner.next_resource_number.saturating_add(1);
        let resource = StoredResource {
            resource_id: self.next_id(),
            resource_number: inner.next_resource_number,
            capture_id: observed.capture_id,
            site_label,
            media_kind: classification.kind.as_str().to_string(),
            mime_type,
            size_bytes: classification.size_hint,
            filename_hint: sanitize_filename_hint(&observed.url),
            resolution_hint: sanitize_resolution_hint(&observed.url),
            requires_authenticated_replay,
            raw_url: observed.url,
            dedupe_key,
            replay_headers,
        };

        let mut evicted = None;
        while inner.resources.len() >= self.limits.max_resources_per_session {
            let removed = inner.resources.remove(0);
            evicted = Some(removed.resource_number);
        }

        let resource_id = resource.resource_id.clone();
        let resource_number = resource.resource_number;
        inner.resources.push(resource);

        RecordOutcome::Added {
            resource_id,
            resource_number,
            evicted,
        }
    }

    /// Unclaimed, sanitized discovery list, oldest first.
    pub fn list_summaries(&self) -> Vec<CapturedResourceSummary> {
        let inner = self.lock();
        inner
            .resources
            .iter()
            .map(StoredResource::summary)
            .collect()
    }

    /// Phase 1 of claim: validate the resource and run the textual destination
    /// policy. The ticket is native-only until `commit_claim` succeeds.
    pub fn prepare_claim(&self, resource_id: &str) -> Result<ClaimTicket, ClaimError> {
        let inner = self.lock();
        if inner.session.is_none() {
            return Err(ClaimError::Inactive);
        }

        let resource = inner
            .resources
            .iter()
            .find(|resource| resource.resource_id == resource_id)
            .ok_or(ClaimError::NotFound)?;

        check_destination_textual(&resource.raw_url).map_err(map_destination_reject)?;

        if resource.requires_authenticated_replay {
            return Err(ClaimError::AuthenticatedReplayRequired);
        }
        if !matches!(resource.media_kind.as_str(), "video" | "audio") {
            return Err(ClaimError::UnsupportedExecutionKind);
        }

        Ok(ClaimTicket {
            resource_id: resource.resource_id.clone(),
            raw_url: resource.raw_url.clone(),
            summary: resource.summary(),
        })
    }

    /// Phase 2 of claim: apply the resolved-address policy and create the
    /// opaque context.
    pub fn commit_claim(
        &self,
        ticket: &ClaimTicket,
        resolved: &[IpAddr],
    ) -> Result<ClaimedContext, ClaimError> {
        let mut inner = self.lock();

        let position = inner
            .resources
            .iter()
            .position(|resource| resource.resource_id == ticket.resource_id)
            .ok_or(ClaimError::NotFound)?;

        if inner.resources[position].raw_url != ticket.raw_url {
            return Err(ClaimError::NotFound);
        }
        check_destination_textual(&ticket.raw_url).map_err(map_destination_reject)?;
        if inner.resources[position].requires_authenticated_replay {
            return Err(ClaimError::AuthenticatedReplayRequired);
        }
        if !matches!(
            inner.resources[position].media_kind.as_str(),
            "video" | "audio"
        ) {
            return Err(ClaimError::UnsupportedExecutionKind);
        }
        for address in resolved {
            check_resolved_ip(*address)
                .map_err(|reject| ClaimError::ForbiddenDestination(reject.code()))?;
        }

        let now = Instant::now();
        inner
            .contexts
            .retain(|_, context| context.lease.is_some() || now < context.expires_at);
        let active_contexts = inner
            .contexts
            .values()
            .filter(|context| {
                !context.revoked && !context.resource.is_scrubbed() && now < context.expires_at
            })
            .count();
        if active_contexts >= self.limits.max_contexts {
            return Err(ClaimError::LimitReached);
        }
        let retained_bytes = inner.resources[position].retained_bytes();
        let used_bytes: usize = inner
            .contexts
            .values()
            .filter(|context| {
                !context.revoked && !context.resource.is_scrubbed() && now < context.expires_at
            })
            .map(|context| context.resource.retained_bytes())
            .sum();
        if used_bytes + retained_bytes > self.limits.max_context_bytes {
            return Err(ClaimError::LimitReached);
        }

        let resource = inner.resources.remove(position);
        let context_id = self.next_id();
        let summary = resource.summary();
        let expires_at = Instant::now() + self.limits.context_ttl;
        let generation = inner.generation;
        inner.contexts.insert(
            context_id.clone(),
            StoredContext {
                context_id: context_id.clone(),
                generation,
                resource,
                expires_at,
                bound_row_id: None,
                lease: None,
                revoked: false,
            },
        );

        Ok(ClaimedContext {
            context_id,
            summary,
        })
    }

    /// Claim/import failure path: release only when no attempt holds a lease.
    pub fn release_context(&self, context_id: &str) -> bool {
        let mut inner = self.lock();
        let removable = inner
            .contexts
            .get(context_id)
            .is_some_and(|context| context.lease.is_none());
        if removable {
            inner.contexts.remove(context_id);
        }
        removable
    }

    /// Remove/dispose path: revoke new use and scrub native material. An
    /// in-flight attempt keeps its lease until terminal settlement.
    pub fn revoke_context(&self, context_id: &str) -> bool {
        let mut inner = self.lock();
        let Some(context) = inner.contexts.get_mut(context_id) else {
            return false;
        };
        context.revoked = true;
        context.resource.scrub();
        true
    }

    /// Analysis is not a download attempt: it binds the row without a lease.
    pub fn resolve_for_analysis(
        &self,
        context_id: &str,
        row_id: &str,
        _analysis_attempt_id: &str,
    ) -> Result<ExecutionContext, CaptureContextError> {
        let mut inner = self.lock();
        let generation = inner.generation;
        let context = inner
            .contexts
            .get_mut(context_id)
            .ok_or(CaptureContextError::NotFound)?;

        if context.generation != generation || Instant::now() >= context.expires_at {
            return Err(CaptureContextError::Expired);
        }
        if context.revoked || context.resource.is_scrubbed() {
            return Err(CaptureContextError::Revoked);
        }
        if let Some(bound) = &context.bound_row_id {
            if bound != row_id {
                return Err(CaptureContextError::RowMismatch);
            }
        }
        context.bound_row_id = Some(row_id.to_string());

        Ok(context.execution_context())
    }

    pub fn begin_attempt(
        &self,
        context_id: &str,
        row_id: &str,
        attempt_id: &str,
    ) -> Result<ExecutionContext, CaptureContextError> {
        let mut inner = self.lock();
        let generation = inner.generation;
        let context = inner
            .contexts
            .get_mut(context_id)
            .ok_or(CaptureContextError::NotFound)?;

        let expired = Instant::now() >= context.expires_at;
        let lease_owns_attempt = context
            .lease
            .as_deref()
            .is_some_and(|lease| lease == attempt_id);

        if context.generation != generation || (expired && !lease_owns_attempt) {
            return Err(CaptureContextError::Expired);
        }
        if context.revoked || context.resource.is_scrubbed() {
            return Err(CaptureContextError::Revoked);
        }
        if let Some(bound) = &context.bound_row_id {
            if bound != row_id {
                return Err(CaptureContextError::RowMismatch);
            }
        }

        // A newer attempt of the same row supersedes the previous lease; an old
        // attempt can then never settle or revoke the newer lineage.
        context.bound_row_id = Some(row_id.to_string());
        context.lease = Some(attempt_id.to_string());

        Ok(context.execution_context())
    }

    pub fn settle_attempt(
        &self,
        context_id: &str,
        attempt_id: &str,
        outcome: AttemptOutcome,
    ) -> bool {
        let mut inner = self.lock();
        let Some(context) = inner.contexts.get_mut(context_id) else {
            return false;
        };
        let owns_lease = context
            .lease
            .as_deref()
            .is_some_and(|lease| lease == attempt_id);
        if !owns_lease {
            return false;
        }

        context.lease = None;
        let expired = Instant::now() >= context.expires_at;
        if outcome == AttemptOutcome::Completed {
            context.revoked = true;
            context.resource.scrub();
        } else if context.revoked || expired {
            context.resource.scrub();
        }
        true
    }

    /// Drop contexts whose absolute TTL elapsed and that hold no active lease.
    pub fn sweep_expired(&self) -> usize {
        let mut inner = self.lock();
        let now = Instant::now();
        let before = inner.contexts.len();
        inner
            .contexts
            .retain(|_, context| context.lease.is_some() || now < context.expires_at);
        before - inner.contexts.len()
    }

    /// App-session boundary: every context expires and native material is freed.
    pub fn dispose(&self) -> usize {
        let mut inner = self.lock();
        inner.generation = inner.generation.wrapping_add(1);
        inner.session = None;
        inner.resources.clear();
        inner.next_resource_number = 0;
        let removed = inner.contexts.len();
        inner.contexts.clear();
        removed
    }

    pub fn context_count(&self) -> usize {
        let inner = self.lock();
        let now = Instant::now();
        inner
            .contexts
            .values()
            .filter(|context| {
                !context.revoked && !context.resource.is_scrubbed() && now < context.expires_at
            })
            .count()
    }

    /// Retained native capture bytes (unclaimed resources + contexts). Exposed
    /// so tests can prove that revocation really frees sensitive material.
    pub fn retained_bytes_total(&self) -> usize {
        let inner = self.lock();
        let resources: usize = inner
            .resources
            .iter()
            .map(StoredResource::retained_bytes)
            .sum();
        let contexts: usize = inner
            .contexts
            .values()
            .map(|context| context.resource.retained_bytes())
            .sum();
        resources + contexts
    }
}

impl StoredContext {
    fn execution_context(&self) -> ExecutionContext {
        ExecutionContext {
            context_id: self.context_id.clone(),
            raw_url: self.resource.raw_url.clone(),
            site_label: self.resource.site_label.clone(),
            media_kind: self.resource.media_kind.clone(),
            replay_headers: self.resource.replay_headers.clone(),
        }
    }
}

fn map_destination_reject(reject: DestinationReject) -> ClaimError {
    match reject {
        DestinationReject::UnsupportedScheme => ClaimError::UnsupportedScheme,
        other => ClaimError::ForbiddenDestination(other.code()),
    }
}

/// Retain only allowlisted, validated request headers. Everything else is
/// dropped silently; nothing is ever inherited from global settings.
fn sanitize_replay_headers(headers: &[(String, String)]) -> Vec<(String, String)> {
    let mut retained = Vec::new();
    for (name, value) in headers {
        if let Ok(validated) = validate_replay_header(name, value) {
            if !retained.iter().any(|(kept, _)| kept == &validated.0) {
                retained.push(validated);
            }
        }
    }
    retained
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::thread::sleep;

    fn limits_for_tests() -> CaptureLimits {
        CaptureLimits::default()
    }

    fn state_with_ids(prefix: &'static str) -> CaptureState {
        let counter = Arc::new(AtomicU32::new(0));
        CaptureState::with_id_factory(
            limits_for_tests(),
            Arc::new(move || {
                let next = counter.fetch_add(1, Ordering::SeqCst) + 1;
                format!("{prefix}-{next}")
            }),
        )
    }

    fn start(state: &CaptureState) -> String {
        let info = state
            .begin_session(CaptureSessionDescriptor {
                capture_id: "capture-1".to_string(),
                browser_name: "msedge".to_string(),
            })
            .expect("session must start");
        info.capture_id
    }

    fn observed(capture_id: &str, url: &str, mime: &str) -> ObservedResource {
        ObservedResource {
            capture_id: capture_id.to_string(),
            url: url.to_string(),
            mime: Some(mime.to_string()),
            content_length: Some(1024),
            status: Some(200),
            saw_cookie_header: false,
            saw_authorization_header: false,
            request_headers: vec![],
        }
    }

    fn claim(state: &CaptureState, resource_id: &str) -> ClaimedContext {
        let ticket = state
            .prepare_claim(resource_id)
            .unwrap_or_else(|error| panic!("claim must prepare: {error:?}"));
        state
            .commit_claim(&ticket, &["93.184.216.34".parse().expect("public ip")])
            .unwrap_or_else(|error| panic!("claim must commit: {error:?}"))
    }

    fn claim_first(state: &CaptureState) -> ClaimedContext {
        let resource_id = state
            .list_summaries()
            .first()
            .expect("a recorded resource must exist")
            .resource_id
            .clone();
        claim(state, &resource_id)
    }

    fn assert_summary_hides_raw_material(
        summary: &CapturedResourceSummary,
        raw_url: &str,
        secrets: &[&str],
    ) {
        let fields = vec![
            summary.capture_id.as_str(),
            summary.resource_id.as_str(),
            summary.site_label.as_str(),
            summary.media_kind.as_str(),
            summary.mime_type.as_str(),
            summary.filename_hint.as_deref().unwrap_or(""),
            summary.resolution_hint.as_deref().unwrap_or(""),
        ];

        for field in &fields {
            assert!(
                !field.contains(raw_url),
                "summary field leaked the raw URL: {field}"
            );
            for symbol in ["://", "?", "#", "@", "="] {
                assert!(
                    !field.contains(symbol),
                    "summary field '{field}' contains a URL-shaped symbol '{symbol}'"
                );
            }
            for secret in secrets {
                assert!(
                    !field
                        .to_ascii_lowercase()
                        .contains(&secret.to_ascii_lowercase()),
                    "summary field '{field}' leaked secret '{secret}'"
                );
            }
        }
    }

    #[test]
    fn supported_media_is_recorded_with_a_sanitized_summary() {
        let state = state_with_ids("res");
        let capture = start(&state);

        let outcome = state.record_observed(observed(
            &capture,
            "https://user:pass@cdn.example.com/media/My%20Clip.mp4?token=abc&sig=deadbeef#frag",
            "video/mp4",
        ));

        match outcome {
            RecordOutcome::Added {
                resource_id,
                resource_number,
                evicted,
            } => {
                assert_eq!(resource_number, 1);
                assert_eq!(evicted, None);
                assert!(resource_id.starts_with("res-"));
            }
            other => panic!("expected Added, got {other:?}"),
        }

        let summaries = state.list_summaries();
        assert_eq!(summaries.len(), 1);
        let summary = &summaries[0];
        assert_eq!(summary.site_label, "cdn.example.com");
        assert_eq!(summary.media_kind, "video");
        assert_eq!(summary.mime_type, "video/mp4");
        assert_eq!(summary.size_bytes, Some(1024));
        assert_eq!(summary.filename_hint.as_deref(), Some("My Clip.mp4"));
        assert_eq!(summary.resource_number, 1);
        assert!(!summary.requires_authenticated_replay);

        assert_summary_hides_raw_material(
            summary,
            "https://user:pass@cdn.example.com/media/My%20Clip.mp4?token=abc&sig=deadbeef#frag",
            &["user:pass", "token=abc", "deadbeef", "s3cr3t"],
        );

        // The internal (native-only) record still needs the executable URL.
        assert!(state.context_count() == 0);
    }

    #[test]
    fn unsupported_and_unlabelable_responses_are_skipped() {
        let state = state_with_ids("res");
        let capture = start(&state);

        let page =
            state.record_observed(observed(&capture, "https://example.com/watch", "text/html"));
        assert!(matches!(page, RecordOutcome::Skipped { .. }));

        let script = state.record_observed(observed(
            &capture,
            "https://example.com/app.js",
            "application/javascript",
        ));
        assert!(matches!(script, RecordOutcome::Skipped { .. }));

        let segment = state.record_observed(observed(
            &capture,
            "https://cdn.example.com/live/seg-001.ts",
            "video/mp2t",
        ));
        assert!(
            matches!(segment, RecordOutcome::Skipped { .. }),
            "HLS segments must not flood the candidate list"
        );

        assert!(state.list_summaries().is_empty());
    }

    #[test]
    fn duplicate_raw_requests_collapse_into_one_entry() {
        let state = state_with_ids("res");
        let capture = start(&state);

        let first = state.record_observed(observed(
            &capture,
            "https://cdn.example.com/clip.mp4?token=abc",
            "video/mp4",
        ));
        let second = state.record_observed(observed(
            &capture,
            "https://cdn.example.com/clip.mp4?token=abc#playing",
            "video/mp4",
        ));

        assert!(matches!(first, RecordOutcome::Added { .. }));
        assert!(
            matches!(second, RecordOutcome::Merged { .. }),
            "same raw resource must dedupe, got {second:?}"
        );
        assert_eq!(state.list_summaries().len(), 1);

        let different_quality = state.record_observed(observed(
            &capture,
            "https://cdn.example.com/clip.mp4?token=abc&quality=720",
            "video/mp4",
        ));
        assert!(
            matches!(different_quality, RecordOutcome::Added { .. }),
            "a different query identity is a different resource"
        );
        assert_eq!(state.list_summaries().len(), 2);
    }

    #[test]
    fn resource_bounds_evict_the_oldest_unclaimed_entry() {
        let mut limits = limits_for_tests();
        limits.max_resources_per_session = 3;
        let state = CaptureState::new(limits);
        let capture = start(&state);

        for index in 0..4 {
            let url = format!("https://cdn.example.com/video-{index}.mp4");
            let outcome = state.record_observed(observed(&capture, &url, "video/mp4"));
            if index < 3 {
                assert!(matches!(outcome, RecordOutcome::Added { .. }));
            } else {
                match outcome {
                    RecordOutcome::Added { evicted, .. } => assert_eq!(evicted, Some(1)),
                    other => panic!("expected eviction on the 4th resource, got {other:?}"),
                }
            }
        }

        let summaries = state.list_summaries();
        assert_eq!(summaries.len(), 3);
        assert!(summaries.iter().all(|summary| summary.resource_number != 1));
    }

    #[test]
    fn claimed_resources_are_not_evicted_by_new_discovery() {
        let mut limits = limits_for_tests();
        limits.max_resources_per_session = 2;
        let state = CaptureState::new(limits);
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        claim_first(&state);

        for index in 0..3 {
            let url = format!("https://cdn.example.com/fill-{index}.mp4");
            state.record_observed(observed(&capture, &url, "video/mp4"));
        }

        assert_eq!(state.context_count(), 1);
    }

    #[test]
    fn claim_rejects_forbidden_destinations_and_auth_replay_resources() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "http://127.0.0.1:9000/a.mp4",
            "video/mp4",
        ));
        assert_eq!(
            state.prepare_claim("res-1"),
            Err(ClaimError::ForbiddenDestination("loopback")),
            "a forbidden destination must never even produce a promotion ticket"
        );

        let mut authenticated =
            observed(&capture, "https://cdn.example.com/private.mp4", "video/mp4");
        authenticated.saw_cookie_header = true;
        state.record_observed(authenticated);
        assert_eq!(
            state.prepare_claim("res-2"),
            Err(ClaimError::AuthenticatedReplayRequired),
            "Phase 1 classifies Cookie-authenticated resources before promotion"
        );

        let mut authorization = observed(
            &capture,
            "https://cdn.example.com/private-2.mp4",
            "video/mp4",
        );
        authorization.saw_authorization_header = true;
        state.record_observed(authorization);
        assert_eq!(
            state.prepare_claim("res-3"),
            Err(ClaimError::AuthenticatedReplayRequired),
            "Phase 1 classifies Authorization-authenticated resources before promotion"
        );

        let mut forbidden_status = observed(
            &capture,
            "https://cdn.example.com/private-3.mp4",
            "video/mp4",
        );
        forbidden_status.status = Some(403);
        state.record_observed(forbidden_status);
        assert_eq!(
            state.prepare_claim("res-4"),
            Err(ClaimError::AuthenticatedReplayRequired)
        );
    }

    #[test]
    fn resolved_private_addresses_are_rejected_even_when_the_host_is_public() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let ticket = state.prepare_claim("res-1").expect("resource must exist");

        assert_eq!(
            state.commit_claim(&ticket, &["10.0.0.7".parse().unwrap()]),
            Err(ClaimError::ForbiddenDestination("private-network"))
        );
        assert_eq!(state.context_count(), 0);
    }

    #[test]
    fn claim_rejects_unsupported_schemes_and_missing_resources() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "blob:https://example.com/9b1f",
            "video/mp4",
        ));
        assert!(state.list_summaries().is_empty());

        assert_eq!(state.prepare_claim("missing"), Err(ClaimError::NotFound));
    }

    #[test]
    fn phase1_execution_rejects_manifest_and_stream_resources() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/clip.mp4",
            "video/mp4",
        ));
        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/master.m3u8",
            "application/vnd.apple.mpegurl",
        ));
        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/manifest.mpd",
            "application/dash+xml",
        ));
        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/live.flv",
            "video/x-flv",
        ));

        assert!(
            state.prepare_claim("res-1").is_ok(),
            "direct video must stay executable in Phase 1"
        );
        assert!(
            state.prepare_claim("res-2").is_err(),
            "HLS discovery remains visible but Phase 1 must not dispatch it"
        );
        assert!(
            state.prepare_claim("res-3").is_err(),
            "DASH discovery remains visible but Phase 1 must not dispatch it"
        );
        assert!(
            state.prepare_claim("res-4").is_err(),
            "stream-like discovery remains visible but Phase 1 must not dispatch it"
        );
        assert_eq!(
            state.context_count(),
            0,
            "only direct media may create a context"
        );
    }

    #[test]
    fn context_ttl_is_absolute_and_expiry_blocks_new_attempts() {
        let mut limits = limits_for_tests();
        limits.context_ttl = Duration::from_millis(60);
        let state = CaptureState::new(limits);
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);

        assert!(state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
            .is_ok());
        assert!(state.settle_attempt(&claimed.context_id, "attempt-1", AttemptOutcome::Failed));

        sleep(Duration::from_millis(90));

        assert_eq!(
            state.begin_attempt(&claimed.context_id, "row-1", "attempt-2"),
            Err(CaptureContextError::Expired)
        );
        assert_eq!(
            state.resolve_for_analysis(&claimed.context_id, "row-1", "attempt-3"),
            Err(CaptureContextError::Expired)
        );
    }

    #[test]
    fn an_active_attempt_settles_after_ttl_but_cannot_start_a_new_one() {
        let mut limits = limits_for_tests();
        limits.context_ttl = Duration::from_millis(60);
        let state = CaptureState::new(limits);
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);

        state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
            .expect("active attempt may start before expiry");

        sleep(Duration::from_millis(90));

        assert!(
            state.settle_attempt(&claimed.context_id, "attempt-1", AttemptOutcome::Completed),
            "the active attempt keeps a bounded lease until terminal settlement"
        );
        assert_eq!(
            state.begin_attempt(&claimed.context_id, "row-1", "attempt-2"),
            Err(CaptureContextError::Expired),
            "settlement after TTL keeps the typed expired outcome"
        );
    }

    #[test]
    fn stale_attempt_cannot_release_a_newer_attempt_lease() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);

        state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
            .expect("first attempt");
        assert!(state.settle_attempt(&claimed.context_id, "attempt-1", AttemptOutcome::Failed));

        state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-2")
            .expect("retry within TTL");

        assert!(
            !state.settle_attempt(&claimed.context_id, "attempt-1", AttemptOutcome::Completed),
            "a stale attempt must not settle or revoke a newer lease"
        );

        let context = state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-3")
            .expect("the newer lineage is still usable");
        assert_eq!(context.context_id, claimed.context_id);
    }

    #[test]
    fn a_context_is_bound_to_exactly_one_task_row() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);

        state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
            .expect("first row binds");
        assert_eq!(
            state.begin_attempt(&claimed.context_id, "row-2", "attempt-2"),
            Err(CaptureContextError::RowMismatch)
        );
        assert_eq!(
            state.resolve_for_analysis(&claimed.context_id, "row-2", "attempt-3"),
            Err(CaptureContextError::RowMismatch)
        );
    }

    #[test]
    fn analysis_resolution_binds_the_row_without_taking_a_lease() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);

        let resolved = state
            .resolve_for_analysis(&claimed.context_id, "row-1", "analysis-1")
            .expect("analysis resolution works before any download attempt");
        assert_eq!(resolved.raw_url, "https://cdn.example.com/a.mp4");
        assert_eq!(resolved.site_label, "cdn.example.com");

        state
            .begin_attempt(&claimed.context_id, "row-1", "download-1")
            .expect("the download attempt of the same row still works");
    }

    #[test]
    fn stop_session_clears_unclaimed_resources_and_keeps_claimed_contexts() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/b.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);

        assert!(state.end_session(&capture));
        assert!(state.list_summaries().is_empty());
        assert_eq!(state.session(), None);
        assert_eq!(
            state.prepare_claim("res-1"),
            Err(ClaimError::Inactive),
            "unclaimed discovery state must be released on stop"
        );

        assert!(
            state
                .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
                .is_ok(),
            "an already claimed context survives Stop Capture"
        );
    }

    #[test]
    fn revoke_and_dispose_release_contexts_with_typed_outcomes() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);
        let retained_before = state.retained_bytes_total();

        assert!(state.revoke_context(&claimed.context_id));
        assert_eq!(
            state.begin_attempt(&claimed.context_id, "row-1", "attempt-1"),
            Err(CaptureContextError::Revoked),
            "revocation scrubs the material but keeps the typed outcome"
        );
        assert!(
            state.retained_bytes_total() < retained_before,
            "revocation must free the raw URL and replayed headers"
        );
        assert_eq!(
            state.resolve_for_analysis(&claimed.context_id, "row-1", "attempt-2"),
            Err(CaptureContextError::Revoked),
            "a revoked context can never resolve executable material again"
        );

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/b.mp4",
            "video/mp4",
        ));
        let second = claim_first(&state);

        assert_eq!(state.dispose(), 2);
        assert_eq!(state.context_count(), 0);
        assert_eq!(
            state.begin_attempt(&second.context_id, "row-2", "attempt-1"),
            Err(CaptureContextError::NotFound),
            "dispose frees native capture material immediately"
        );
    }

    #[test]
    fn completed_attempts_release_context_and_secrets() {
        let state = state_with_ids("res");
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);
        let retained_before = state.retained_bytes_total();

        state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
            .expect("attempt");
        assert!(state.settle_attempt(&claimed.context_id, "attempt-1", AttemptOutcome::Completed));
        assert_eq!(
            state.begin_attempt(&claimed.context_id, "row-1", "attempt-2"),
            Err(CaptureContextError::Revoked),
            "completion revokes future use while freeing quota and secrets"
        );
        assert_eq!(
            state.context_count(),
            0,
            "completion must release context quota"
        );
        assert!(
            state.retained_bytes_total() < retained_before,
            "completion must release raw URL and replay-header bytes immediately"
        );
    }

    #[test]
    fn context_storage_is_bounded_by_count_and_bytes() {
        let mut limits = limits_for_tests();
        limits.max_contexts = 1;
        let state = CaptureState::new(limits);
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/b.mp4",
            "video/mp4",
        ));
        claim_first(&state);

        let second_resource_id = state
            .list_summaries()
            .first()
            .expect("second resource must remain listed")
            .resource_id
            .clone();
        let ticket = state
            .prepare_claim(&second_resource_id)
            .expect("resource must exist");
        assert_eq!(
            state.commit_claim(&ticket, &["93.184.216.34".parse().unwrap()]),
            Err(ClaimError::LimitReached)
        );

        let mut byte_limits = limits_for_tests();
        byte_limits.max_context_bytes = 1;
        let byte_state = CaptureState::new(byte_limits);
        let byte_capture = start(&byte_state);
        byte_state.record_observed(observed(
            &byte_capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let byte_resource_id = byte_state
            .list_summaries()
            .first()
            .expect("resource must exist")
            .resource_id
            .clone();
        let ticket = byte_state
            .prepare_claim(&byte_resource_id)
            .expect("resource must exist");
        assert_eq!(
            byte_state.commit_claim(&ticket, &["93.184.216.34".parse().unwrap()]),
            Err(ClaimError::LimitReached)
        );
    }

    #[test]
    fn retained_headers_are_limited_to_the_validated_allowlist() {
        let state = state_with_ids("res");
        let capture = start(&state);

        let mut resource = observed(&capture, "https://cdn.example.com/a.mp4", "video/mp4");
        resource.request_headers = vec![
            (
                "User-Agent".to_string(),
                "Mozilla/5.0 (Windows NT 10.0)".to_string(),
            ),
            (
                "Authorization".to_string(),
                "Bearer super-secret".to_string(),
            ),
            (
                "Referer".to_string(),
                "https://example.com/watch".to_string(),
            ),
            ("X-Weird".to_string(), "value".to_string()),
            ("Accept".to_string(), "*/*".to_string()),
        ];
        state.record_observed(resource);

        let claimed = claim_first(&state);
        let context = state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
            .expect("attempt");

        assert_eq!(context.replay_headers.len(), 2);
        assert!(context
            .replay_headers
            .iter()
            .any(|(name, value)| name == "user-agent" && value.contains("Mozilla")));
        assert!(context
            .replay_headers
            .iter()
            .all(|(name, _)| name != "authorization" && name != "referer" && name != "x-weird"));
    }

    #[test]
    fn oversized_urls_are_rejected_without_truncation() {
        let state = state_with_ids("res");
        let capture = start(&state);

        let long_url = format!(
            "https://cdn.example.com/{}/video.mp4",
            "a".repeat(MAX_URL_BYTES)
        );
        let outcome = state.record_observed(observed(&capture, &long_url, "video/mp4"));
        assert!(matches!(outcome, RecordOutcome::Rejected { .. }));
        assert!(state.list_summaries().is_empty());
    }

    #[test]
    fn records_from_a_finished_session_are_rejected() {
        let state = state_with_ids("res");
        let capture = start(&state);
        state.end_session(&capture);

        let outcome = state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        assert!(matches!(outcome, RecordOutcome::Skipped { .. }));
        assert!(state.list_summaries().is_empty());
    }

    #[test]
    fn thirty_three_claim_complete_cycles_do_not_exhaust_contexts() {
        let state = state_with_ids("res");
        let capture = start(&state);

        for index in 0..33 {
            let url = format!("https://cdn.example.com/cycle-{index}.mp4");
            state.record_observed(observed(&capture, &url, "video/mp4"));
            let claimed = claim_first(&state);
            state
                .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
                .unwrap_or_else(|error| panic!("cycle {index} must start: {error:?}"));
            assert!(
                state.settle_attempt(&claimed.context_id, "attempt-1", AttemptOutcome::Completed),
                "cycle {index} must settle"
            );
        }
    }

    #[test]
    fn production_claim_path_reclaims_expired_contexts() {
        let mut limits = limits_for_tests();
        limits.context_ttl = Duration::from_millis(40);
        limits.max_contexts = 1;
        let state = CaptureState::new(limits);
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);

        sleep(Duration::from_millis(70));

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/b.mp4",
            "video/mp4",
        ));
        let second_resource_id = state
            .list_summaries()
            .first()
            .expect("the second resource must exist")
            .resource_id
            .clone();
        let ticket = state
            .prepare_claim(&second_resource_id)
            .expect("the second resource must exist");
        let second = state
            .commit_claim(&ticket, &["93.184.216.34".parse().expect("public ip")])
            .expect("the production claim path must reclaim expired contexts");
        assert!(state
            .begin_attempt(&second.context_id, "row-2", "attempt-1")
            .is_ok());
        assert!(
            !state.release_context(&claimed.context_id),
            "the expired context must already be gone"
        );
    }

    #[test]
    fn expired_contexts_are_swept_only_when_no_attempt_is_active() {
        let mut limits = limits_for_tests();
        limits.context_ttl = Duration::from_millis(50);
        let state = CaptureState::new(limits);
        let capture = start(&state);

        state.record_observed(observed(
            &capture,
            "https://cdn.example.com/a.mp4",
            "video/mp4",
        ));
        let claimed = claim_first(&state);
        state
            .begin_attempt(&claimed.context_id, "row-1", "attempt-1")
            .expect("active attempt");

        sleep(Duration::from_millis(80));
        assert_eq!(
            state.sweep_expired(),
            0,
            "an active lease is not swept mid-attempt"
        );

        state.settle_attempt(&claimed.context_id, "attempt-1", AttemptOutcome::Failed);
        assert_eq!(state.sweep_expired(), 1);
        assert_eq!(state.context_count(), 0);
    }
}
