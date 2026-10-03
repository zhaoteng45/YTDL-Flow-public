//! Tauri command surface for Resource Capture Phase 1.
//!
//! Capture discovers resources and hands out opaque context handles. It never
//! starts, queues, retries, cancels or completes a task.

use crate::error::{AppError, AppResult};
use crate::models::{CaptureClaimOutcome, CaptureSessionInfo, CapturedResourceSummary};
use crate::services::capture::session::{
    CaptureEndCallback, CaptureEndReason, CaptureRuntime, CaptureSessionStatus,
    CaptureUpdateCallback,
};
use crate::services::capture::{CaptureState, ClaimError};
use std::net::IpAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use url::Url;

/// Sanitized discovery list updates.
pub const CAPTURE_RESOURCES_EVENT: &str = "capture-resources";
/// Capture session started/stopped updates.
pub const CAPTURE_SESSION_EVENT: &str = "capture-session";

#[tauri::command]
pub async fn capture_start(
    app: AppHandle,
    runtime: State<'_, CaptureRuntime>,
    open_url: Option<String>,
) -> AppResult<CaptureSessionInfo> {
    if runtime.is_active() {
        return Err(AppError::Validation(
            "a capture session is already active".to_string(),
        ));
    }

    let state = runtime.state();
    let resources_app = app.clone();
    let on_resources: CaptureUpdateCallback = Arc::new(move |state: &CaptureState| {
        let _ = resources_app.emit(CAPTURE_RESOURCES_EVENT, state.list_summaries());
    });

    let end_app = app.clone();
    let on_session_end: CaptureEndCallback = Arc::new(move |reason: CaptureEndReason| {
        let _ = end_app.emit(
            CAPTURE_SESSION_EVENT,
            CaptureSessionStatus {
                active: false,
                capture_id: None,
                browser_name: None,
                reason: Some(reason.as_str().to_string()),
            },
        );
    });

    let session = runtime
        .start(open_url, on_resources, on_session_end)
        .await
        .map_err(AppError::ExternalCommand)?;

    let _ = app.emit(
        CAPTURE_SESSION_EVENT,
        CaptureSessionStatus {
            active: true,
            capture_id: Some(session.capture_id.clone()),
            browser_name: Some(session.browser_name.clone()),
            reason: None,
        },
    );
    let _ = app.emit(CAPTURE_RESOURCES_EVENT, state.list_summaries());

    Ok(session)
}

#[tauri::command]
pub async fn capture_stop(app: AppHandle, runtime: State<'_, CaptureRuntime>) -> AppResult<()> {
    if let Some(result) = runtime.stop().await {
        let _ = app.emit(
            CAPTURE_SESSION_EVENT,
            CaptureSessionStatus {
                active: false,
                capture_id: Some(result.capture_id.clone()),
                browser_name: Some(result.browser_name.clone()),
                reason: Some(result.reason.as_str().to_string()),
            },
        );
    }
    let _ = app.emit(CAPTURE_RESOURCES_EVENT, runtime.state().list_summaries());
    Ok(())
}

#[tauri::command]
pub fn capture_list(runtime: State<'_, CaptureRuntime>) -> Vec<CapturedResourceSummary> {
    runtime.state().list_summaries()
}

/// Promote one discovered resource into an opaque capture context.
///
/// The destination policy runs here (textual check, then every DNS-resolved
/// address) and again at execution time. A rejection is a typed outcome, never
/// a silent fallback to an unauthenticated URL.
#[tauri::command]
pub async fn capture_claim(
    runtime: State<'_, CaptureRuntime>,
    resource_id: String,
) -> AppResult<CaptureClaimOutcome> {
    let state = runtime.state();

    let ticket = match state.prepare_claim(&resource_id) {
        Ok(ticket) => ticket,
        Err(error) => return Ok(error.into_outcome()),
    };

    let resolved = resolve_destination_addresses(&ticket.raw_url).await;
    let claimed = match resolved {
        Ok(addresses) => state.commit_claim(&ticket, &addresses),
        Err(error) => Err(error),
    };

    match claimed {
        Ok(claimed) => Ok(CaptureClaimOutcome::Claimed {
            context_id: claimed.context_id,
            resource: claimed.summary,
        }),
        Err(error) => Ok(error.into_outcome()),
    }
}

/// Release a claimed context after a failed import (no attempt holds it).
#[tauri::command]
pub fn capture_release(runtime: State<'_, CaptureRuntime>, context_id: String) -> bool {
    runtime.state().release_context(&context_id)
}

/// Revoke a claimed context (task removal, terminal settlement, dispose).
#[tauri::command]
pub fn capture_revoke(runtime: State<'_, CaptureRuntime>, context_id: String) -> bool {
    runtime.state().revoke_context(&context_id)
}

/// App-session boundary: release every claimed context and captured secret.
#[tauri::command]
pub fn capture_dispose(runtime: State<'_, CaptureRuntime>) -> usize {
    runtime.state().dispose()
}

/// Resolve every address the host currently maps to. Phase 1 fails closed when
/// DNS cannot be resolved at claim time; execution still re-runs preflight.
async fn resolve_destination_addresses(raw_url: &str) -> Result<Vec<IpAddr>, ClaimError> {
    let parsed = Url::parse(raw_url).map_err(|_| ClaimError::UnsupportedScheme)?;
    let host = match parsed.host_str() {
        Some(host) => host.to_string(),
        None => return Err(ClaimError::NotFound),
    };
    let port = parsed.port_or_known_default().unwrap_or(443);

    match tokio::net::lookup_host((host, port)).await {
        Ok(addresses) => Ok(addresses.map(|address| address.ip()).collect()),
        Err(_) => Err(ClaimError::ForbiddenDestination("dns-unresolved")),
    }
}
