# YTDL-Flow 2.1 Release Hardening Contract

Date: 2026-09-30

Authority:
- `.ai-bridge/STATUS.md`
- `.scratch/external-cross-review/evidence-packet.md`
- existing ordinary-download architecture and tests
- current user decision: continue non-Native review work while Native Human Gate remains pending

This contract deliberately contains exactly three tickets. It does not expand product scope.

## Shared constraints

- Windows x64 remains the only release platform in scope.
- Resource Capture remains paused.
- CurrentTaskService / CurrentDownloadService remain the only task-lifecycle owners.
- Do not restore the retired TaskQueue/appStore ownership path.
- Do not change download format semantics, FIFO semantics, cancel/retry semantics, themes, or product UI.
- No subscriptions, multi-engine support, new platforms, queue redesign, or history/persistence work.
- No Git write operations.
- Automated/build evidence and Native Human Gate evidence remain separate.

---

## TICKET-012 — Trusted Tool Provenance

Priority: P1 release hardening

### Goal

Make tool acquisition fail closed: a downloaded Bun / FFmpeg / yt-dlp release artifact must be tied to trusted provenance before it can be bundled or installed.

### Seams

1. Release sidecar preparation seam:
   - tool metadata selects an exact artifact URL/version;
   - downloaded bytes are verified against an expected SHA-256;
   - mismatch aborts before the binary is copied into `src-tauri/bin`.

2. Runtime Bun / FFmpeg update seam:
   - downloaded archive is verified against upstream checksum metadata before extraction / `atomic_replace_files`;
   - mismatch aborts and preserves the existing installed tool.

These are the only TDD seams for this ticket.

### Required behavior

- Release builds must not use mutable `latest/download` or equivalent current aliases for Bun / yt-dlp / FFmpeg without resolving them into explicit version + expected digest first.
- A checked-in manifest or equivalent small module must record the exact release artifact identity used by release preparation.
- SHA-256 verification must compare against trusted expected metadata; merely calculating/logging a digest is insufficient.
- Bun and FFmpeg runtime updates must verify upstream checksum metadata before replacement.
- Existing atomic replacement behavior remains unchanged after verification succeeds.
- `update_ytdlp` may remain delegated to bundled yt-dlp `-U`; do not redesign that path unless evidence proves it bypasses required trust guarantees.
- Current sidecar target-triple naming remains unchanged.

### Required automated coverage

RED-first tests must prove at least:
- matching digest permits a release-sidecar artifact;
- mismatching digest rejects it before destination replacement;
- release tool metadata does not use a mutable `latest/download` URL;
- Bun runtime checksum mismatch cannot reach replacement;
- FFmpeg runtime checksum mismatch cannot reach replacement;
- existing atomic replacement tests remain green;
- current release/toolchain contract tests remain green.

### Do not touch

- CurrentTaskService / CurrentDownloadService
- download queue/cancel/retry semantics
- UI
- Resource Capture
- updater signing for the application itself (already a separate Tauri signed-updater path)
- platform expansion

### Completion gate

- focused RED evidence recorded;
- GREEN focused tests;
- Rust tests for updater safety;
- release/toolchain tests;
- typecheck/lint;
- exact-version/checksum source is documented;
- no Git writes.

---

## TICKET-013 — Stale Generated Cookie Cleanup

Priority: P2 privacy hardening

### Goal

Extend the existing cleanup baseline safely: `scripts/cleanup.mjs` already removes `ytdl_flow_cookies_*` during explicit cleanup, while `TempCookieMaterial` handles normal-path RAII cleanup. This ticket adds bounded startup stale cleanup for abnormal-termination leftovers without treating every matching fresh file as stale.

### Seam

App startup / download-subsystem initialization cleanup of files matching the exact app-owned generated-cookie naming contract.

### Required behavior

- Only files matching `ytdl_flow_cookies_*` created by the app are candidates.
- User-supplied cookie files are never deleted.
- Cleanup is best-effort and cannot block app startup.
- A bounded age rule must prevent deleting a temp file plausibly owned by another still-running instance.
- Existing RAII cleanup remains the primary normal-path cleanup.

### Required automated coverage

- stale generated file removed;
- fresh generated file preserved;
- unrelated/user file preserved;
- cleanup failure is non-fatal;
- existing TempCookieMaterial lifecycle test remains green.

### Do not touch

- cookie parsing/import UX
- browser-cookie extraction
- Resource Capture
- download state machine

### Completion gate

Rust tests + existing cookie tests green; no Native claim required.

---

## TICKET-014 — Windows Install Trust Gate

Priority: P2 release evidence

### Goal

Make the CI job named `windows-install-trust` actually prove an installable Windows package, or rename it if the repository intentionally does not want that guarantee.

### Required behavior

Preferred implementation:
- build the x64 MSI using release-equivalent bundle inputs;
- install silently into an isolated CI context;
- verify installed application executable and required bundled tools/resources exist;
- launch only if deterministic/headless-safe;
- uninstall cleanly.

At minimum, if actual install is intentionally deferred:
- rename the job so it does not claim install trust;
- keep packaging smoke separately named and documented.

### Required automated coverage

- CI syntax/contract test verifies the chosen behavior;
- packaging smoke remains separate from install-trust semantics;
- no Native Human Gate result is inferred from CI.

### Do not touch

- release platform matrix expansion
- application UI
- update/channel product features

### Completion gate

CI contract tests green plus one clean Windows CI execution when infrastructure is available. Local CodexPro wrapper timeouts must be recorded as execution-evidence debt rather than product failure.
