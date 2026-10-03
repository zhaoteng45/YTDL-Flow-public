# YTDL-Flow 2.1 Resource Capture Specification

Status: PAUSED
Historical phase status: ready-for-agent
Current authorization: Capture = PAUSED；保留规格与证据，不恢复功能；当前任务以 `.ai-bridge/STATUS.md` 为准。
Architecture: ADR-0003 — Opaque Capture Context
Phase: 1 — Isolated Browser Resource Discovery
Implementation authorization: not implied by this document; implementation must follow the TDD gates below.

## Problem Statement

YTDL-Flow 当前要求用户先拥有可交给 yt-dlp 的页面 URL 或媒体 URL。对于网页播放器、CDN 直链、HLS/DASH 资源，以及 yt-dlp 尚未直接支持的站点，用户往往不知道真实媒体请求，因此无法进入现有“解析 → 选择格式 → 下载”流程。

目标不是重新实现下载器，而是增加一个可选的 Resource Capture 输入能力：让用户在一个隔离浏览器会话中打开目标页面，YTDL-Flow 发现真实媒体资源，并将用户选择的资源安全地导入现有 CurrentTask 生命周期。

资源发现必须严格保持现有任务架构：CurrentTaskService 继续拥有任务行、解析编排、重试/取消入口与终态投影；CurrentDownloadService / DownloadService / DownloadQueue 继续拥有下载执行和唯一 FIFO 槽位。Capture 不得成为第二个 task owner 或第二个 downloader。

## Solution

Phase 1 采用 Opaque Capture Context + 隔离 Chromium/Edge DevTools Protocol（CDP）方案。

用户显式启动“资源嗅探”后，应用启动一个独立 user-data profile 的 Chromium/Edge 捕获实例，并仅通过 DevTools Protocol 的 Network 事件观察该隔离实例的网络请求/响应。Phase 1 不修改 Windows 全局代理、不安装 MITM CA、不修改网页响应，也不接管其他应用流量。

Native Capture 模块从 Network 事件中识别 video/audio/HLS/DASH/FLV 等候选资源，保存原始 URL、必要请求上下文及生命周期信息，但只向前端暴露脱敏后的 CapturedResourceSummary。用户选择一个资源后，Native CaptureState 将其 claim 为短生命周期 Opaque Capture Context；CurrentTaskService 通过一个明确的 captured-input seam 将该 context 接入现有解析/下载生命周期。

原始捕获 URL 不进入普通 Vue 状态、日志或 debug command。对于 yt-dlp 执行，Phase 1 使用 stdin URL 输入 seam，而不是把原始/签名 URL放入普通命令行参数。Phase 1 不重放 Cookie 或 Authorization；需要这类认证信息才能下载的候选资源被识别为“需要认证重放”，但不进入 Phase 1 下载执行。

## User Stories

1. As a user, I want to explicitly start a Resource Capture session, so that resource discovery never runs unexpectedly in the background.
2. As a user, I want Resource Capture to launch an isolated browser profile, so that my normal browser profile and its persistent state are not modified.
3. As a user, I want to browse a target page normally inside the capture browser, so that media requests can be discovered without requiring me to inspect developer tools.
4. As a user, I want video, audio, HLS, DASH and other supported media candidates to appear as they are discovered, so that I can identify downloadable resources.
5. As a user, I want duplicate network requests to collapse into a single logical resource entry, so that adaptive streaming does not flood the list with repeated candidates.
6. As a user, I want each discovered resource to show useful non-sensitive information such as site identity, media kind, MIME type, approximate size and sanitized filename, so that I can choose the correct resource.
7. As a user, I do not want signed query strings, credentials, cookies or Authorization values displayed in the UI, so that capture does not expose authentication material.
8. As a user, I want the display label to be clearly distinct from an executable URL, so that a sanitized label can never accidentally become a fallback download address.
9. As a user, I want to select a discovered resource and import it into the normal task list, so that I can use the same download UI I already understand.
10. As a user, I want imported captured resources to follow the same one-slot FIFO behavior as pasted URLs, so that Resource Capture does not create hidden parallel downloads.
11. As a user, I want the same cancel behavior for captured resources as normal tasks, so that process-tree cleanup semantics remain consistent.
12. As a user, I want the same retry behavior for captured resources while their capture context remains valid, so that transient download failures can be retried normally.
13. As a user, I want an expired capture context to fail explicitly rather than silently fall back to a stripped or unauthenticated URL, so that failures are predictable.
14. As a user, I want stopping the Capture session to stop new discovery without immediately invalidating a resource I already imported, so that I can close the browser and finish the selected download.
15. As a user, I want removing or retiring a captured task to revoke its native capture context, so that sensitive data is not kept indefinitely.
16. As a user, I want Capture state to be bounded, so that leaving a busy page open cannot consume unbounded memory.
17. As a user, I want sites requiring Cookie or Authorization replay to be reported clearly as unsupported by Phase 1 rather than failing mysteriously.
18. As a user, I want my existing URL paste workflow to remain unchanged, so that Resource Capture is additive rather than disruptive.
19. As a user, I do not want Resource Capture to change my Windows system proxy, so that a crash cannot strand the machine behind a stale proxy.
20. As a user, I do not want Resource Capture to install a machine-wide root certificate, so that Phase 1 does not expand trust on my system.
21. As a user, I want HTTPS certificate validation to remain the browser's normal validation, so that Resource Capture does not bypass certificate errors or pinning.
22. As a user, I want capture to reject localhost/private/link-local/cloud-metadata destinations from being promoted to executable download contexts, so that a malicious page cannot turn Resource Capture into an SSRF primitive.
23. As a user, I want redirects and adaptive-stream child resources to be revalidated, so that an initially safe URL cannot redirect execution into a forbidden network range.
24. As a user, I want resource discovery to work without maintaining a second HTTP Range downloader, so that downloads still benefit from yt-dlp/FFmpeg's mature behavior.
25. As a maintainer, I want Capture to expose a small high-level interface, so that browser/CDP details can change without affecting CurrentTask callers.
26. As a maintainer, I want raw capture data to remain native-only, so that Vue components, snapshots and presentation tests never need secret-aware logic.
27. As a maintainer, I want CaptureState to manage only resource/context leases, so that it cannot start, retry, cancel or complete a CurrentTask.
28. As a maintainer, I want a captured task to carry only an opaque context reference through Application contracts, so that secret-bearing request data does not spread through the codebase.
29. As a maintainer, I want the same DownloadService and DownloadQueue to schedule both normal and captured downloads, so that the one-slot invariant remains singular.
30. As a maintainer, I want stale attempt events and stale capture leases to be rejected deterministically, so that retry cannot revive an old context.
31. As a maintainer, I want every Capture boundary to be testable without launching a real browser, so that most behavior can be proven with deterministic fixtures.
32. As a maintainer, I want one small native E2E gate with a real isolated Edge/Chromium instance, so that the CDP adapter itself is verified separately from pure logic.
33. As a maintainer, I want capture candidates that require unsupported authentication replay to be classified before download dispatch where possible, so that the normal task engine is not polluted by known-unsupported execution.
34. As a maintainer, I want all native diagnostics generated by Capture and yt-dlp to pass through the existing redaction/projection policy before IPC, so that Capture cannot reopen previously closed log leakage bugs.
35. As a maintainer, I want resource eviction and context expiry to be observable through typed outcomes, so that UI behavior does not depend on matching error strings.
36. As a maintainer, I want Phase 1 to avoid platform-specific script rewriting, so that the initial feature is robust against site JavaScript bundle churn.

## Implementation Decisions

1. Architecture follows ADR-0003: Opaque Capture Context is the only supported Resource Capture handoff model.

2. Phase 1 Capture transport is an isolated Chromium/Edge browser controlled through the Chromium DevTools Protocol Network domain. The browser uses a dedicated capture profile. Phase 1 does not modify the Windows global proxy and does not perform HTTPS MITM.

3. Because Phase 1 uses browser-native HTTPS and CDP observation, it has no Capture CA, no Capture CA private key, no trust-store installation and no trust-store cleanup responsibility. MITM/CA design is explicitly deferred to a future external-application capture phase.

4. Capture is a deep native module with four conceptual entry points:
   - start a capture session;
   - stop a capture session;
   - subscribe/list sanitized resource summaries;
   - claim a discovered resource for CurrentTask import.
   Browser launch, CDP sessions, Network event normalization, dedupe, classification, secret retention, bounds and lease cleanup remain hidden behind this interface.

5. A CapturedResourceSummary is frontend-safe data only. It may contain:
   - opaque capture identifier;
   - generated resource number;
   - reviewed site/domain label;
   - media kind;
   - MIME type;
   - optional normalized size;
   - optional sanitized filename/resolution metadata.
   It must not contain raw captured URL, userinfo, query string, fragment, Cookie, Authorization, complete Referer, or arbitrary request headers.

6. A display label is not a URL type and is never accepted by analysis/download code as an execution fallback. If the opaque context cannot be resolved, execution fails with a typed capture-context outcome.

7. Claiming a resource creates an Opaque Capture Context stored only in native memory. The context is bound to:
   - the current application session;
   - exactly one CurrentTask row;
   - the current valid analysis/download attempt lineage.
   It cannot be rebound to an unrelated row.

8. Capture context uses a fixed, non-sliding absolute TTL. A known signed-URL expiry can shorten but never extend that TTL. A currently active execution may hold a bounded lease until terminal settlement; expiry prevents creation of a new attempt.

9. CurrentTaskService remains the task lifecycle authority. CaptureState must not:
   - create download queue slots;
   - schedule retries;
   - cancel a task;
   - mark a task completed/failed;
   - emit task progress;
   - perform task notification/effects.

10. CurrentTask gains one captured-input seam at the highest useful level. Normal pasted URL behavior remains unchanged. The captured path carries an opaque capture context reference; it does not add a second task type/state machine.

11. Analysis and download request contracts may carry an optional opaque capture context reference. The reference itself is not secret-bearing and is not a substitute for an execution URL.

12. The raw captured URL is resolved only inside the native execution adapter. For Phase 1 yt-dlp invocation, raw/signed URLs are supplied through yt-dlp stdin using its stdin batch-file capability rather than placed in the ordinary process command line.

13. Phase 1 does not replay Cookie or Authorization to yt-dlp. A resource whose successful execution requires Cookie or Authorization replay is classified as authenticated-replay-required and is not dispatched for download in Phase 1.

14. Missing captured authentication identity must never be filled from global browser-cookie configuration, global Cookie values, Authorization values, PO tokens, visitor data, or other account identity. Capture identity is a closed set; absence means absence.

15. ExtraArgs cannot override or weaken Capture security policy. Existing non-network preferences such as output directory, selected format, codec/resolution preferences, filename template and metadata preferences continue to use the existing precedence model. Network identity fields from ExtraArgs are ignored/rejected for captured execution where they would conflict with Capture policy.

16. Header replay is default-deny. Phase 1 may replay only explicitly validated non-secret headers needed for compatibility:
   - User-Agent;
   - Accept;
   - Accept-Language.
   Referer and Origin require a separately tested same-site/origin policy and are omitted unless that policy explicitly allows them.

17. Phase 1 must never replay:
   - Cookie;
   - Authorization;
   - Host;
   - Content-Length;
   - Transfer-Encoding;
   - hop-by-hop headers;
   - Connection-selected fields;
   - Proxy-*;
   - Forwarded / X-Forwarded-*;
   - any value containing CR, LF or NUL.
   Range and transport-generated headers remain owned by the network executor.

18. The capture adapter may observe sensitive request headers internally, but raw values never cross IPC. Child-process stdout/stderr/results are projected and redacted natively before they can reach CurrentTask logs, UI, copied logs or debug command surfaces.

19. The native execution destination policy applies before promotion to executable context and at every new captured yt-dlp upstream connection through the loopback-only Capture Egress Guard. The Guard performs no MITM: it receives a SOCKS5h destination, validates hostname/DNS/IP policy, then connects the exact validated SocketAddr and transparently tunnels bytes. It rejects loopback, private/LAN, link-local, cloud metadata, reserved/transition ranges and the application's own local endpoints by default, across IPv4 and IPv6.

20. DNS resolution for captured execution is owned by the Capture Egress Guard. Every resolved address must pass policy; mixed allowed+forbidden answer sets fail closed; connection is made to a validated SocketAddr rather than re-resolving the hostname. Redirects or later HTTP(S) requests that create a new upstream connection therefore pass through policy again. The supported guarantee is connection-level destination control, not HTTPS payload inspection.

21. Phase 1 accepts HTTP(S) resource execution only. Unsupported schemes are rejected before task dispatch. Captured yt-dlp execution is forced through a generated loopback SOCKS5h proxy, ignores user/system config and proxy environment overrides, disables user plugin/JS-runtime identity expansion, and fails closed when the Guard is unavailable.

22. Resource discovery/classification may identify:
   - direct video;
   - direct audio;
   - HLS manifests;
   - DASH manifests;
   - FLV/stream-like resources.
   G1 execution is intentionally narrower: only direct video/audio may be promoted to captured execution. HLS/DASH/stream resources remain visible but non-executable until separate child/key/subresource evidence is approved. Classification uses Network response metadata/MIME and conservative URL hints; it does not require response-body caching.

23. Dedupe occurs natively before summaries are emitted. Dedupe identity must be defined from raw resource identity, not the sanitized display label.

24. CaptureState is bounded. The implementation must define explicit limits for:
   - unclaimed resources per session;
   - claimed contexts;
   - URL length;
   - individual/aggregate retained header bytes;
   - concurrent CDP targets/connections;
   - total retained context bytes.
   On limit breach, behavior is deterministic eviction or rejection with typed diagnostics; memory growth may not be unbounded.

25. Stop Capture:
   - stops new browser/CDP discovery;
   - tears down the isolated capture browser/session;
   - clears all unclaimed resources;
   - does not invalidate already-claimed task contexts solely because discovery stopped.

26. Context cleanup rules:
   - claim/import failure releases immediately;
   - successful completion revokes new use and releases after in-flight users exit;
   - remove/dispose/app shutdown revoke new use and release after in-flight users exit;
   - failed/cancelled rows may retain a context only until its fixed TTL if CurrentTaskService still allows retry;
   - an old attempt cannot release or mutate a context lease already transferred to a newer valid attempt.

27. Context expiry is a typed failure. It must not silently retry with the display label, raw naked URL without context, global credentials, or a newly inferred identity.

28. Native browser/CDP integration is an adapter. A future Firefox/proxy/external-app capture adapter may replace or coexist behind the same high-level Capture seam without changing CurrentTask lifecycle ownership.

29. No persistent capture history is created in Phase 1. Raw resource context is memory-only. Any non-secret user preference about whether the feature is enabled is separate from captured data.

30. The existing URL paste/analyze/download path remains behaviorally unchanged when no capture context is present.

## Testing Decisions

1. Tests follow RED-first TDD. The feature is not implemented by first adding browser/proxy code and then writing tests.

2. The highest behavioral seam is preferred. Most tests should use fake Capture/CDP adapters and real Application services rather than testing browser protocol message parsing in Vue components.

3. Discovery contract tests must prove:
   - supported media responses produce sanitized summaries;
   - unsupported responses do not;
   - duplicate raw resources dedupe;
   - response bodies are not retained just to classify;
   - bounds produce deterministic eviction/rejection.

4. Secret isolation contract tests must seed fixtures containing:
   - signed query parameters;
   - URL userinfo;
   - Cookie;
   - Authorization;
   - sensitive Referer;
   - CR/LF injection attempts.
   Frontend events, CurrentTask rows, logs, copied logs, debug commands and serialized settings must contain none of those raw values.

5. CurrentTask import tests must prove a claimed resource creates/uses a normal task row and preserves existing analyze/start/retry/cancel/remove action semantics without a parallel task state machine.

6. FIFO tests must prove captured and pasted tasks share the same single execution slot and ordering rules.

7. Context lifecycle tests must cover:
   - claim then import failure;
   - CaptureSession stop after claim;
   - TTL expiry before analysis;
   - TTL expiry before retry;
   - TTL expiry during an already-active attempt;
   - cancel then retry within TTL;
   - remove during active execution;
   - app/runtime dispose;
   - stale old-attempt cleanup after a newer attempt exists.

8. Identity-isolation tests must prove a captured context missing Cookie/Authorization never inherits global Cookie/browser-cookie/Authorization-like identity and ExtraArgs cannot force such inheritance.

9. Header-policy tests must prove allowlisted values are normalized and forbidden/hop-by-hop/proxy/forwarding/CRLF/NUL values are rejected.

10. Destination-policy tests for the G1 direct-media path must cover textual and resolved:
    - 127.0.0.0/8 and ::1;
    - RFC1918/private, link-local, CGNAT and cloud metadata targets;
    - IPv4-mapped and fail-closed IPv6 transition/tunneling ranges;
    - empty and mixed DNS answers;
    - DNS rebinding/TOCTOU by proving connect uses the exact validated SocketAddr;
    - real yt-dlp redirect proxy adherence and no direct-connect fallback when the Guard is unavailable/rejecting.
    HLS/DASH child/key targets remain a separate future execution gate because HLS/DASH are not executable in G1.

11. Native yt-dlp invocation tests must prove:
    - native code writes a minimal direct-media InfoJSON descriptor containing the raw/signed URL to stdin via `--load-info-json -`;
    - raw URL is absent from ordinary argv and captured execution does not run a yt-dlp extractor;
    - Cookie/Authorization are absent from Phase 1 invocation;
    - diagnostics presented to upper layers remain redacted.

12. Regression tests must prove ordinary pasted URL execution keeps its current argument construction and behavior when no capture context exists.

13. One bounded native E2E gate must launch an isolated Edge/Chromium profile with DevTools Protocol enabled, load a controlled test page with known media requests and verify that the expected sanitized candidate appears.

14. The native browser E2E gate is separate from Application/Domain automated tests and separate from Human Gate evidence.

15. Human Gate for Phase 1 must verify:
    - explicit start/stop capture controls;
    - isolated browser launch is understandable to the user;
    - candidate list does not reveal signed URLs or credentials;
    - import creates the expected normal task row;
    - unsupported authenticated-replay resources are explained clearly;
    - closing/stopping capture does not damage normal URL downloads.

16. Security Gate before implementation approval must demonstrate that all former Astra P1 conditions are closed by executable tests, not only comments:
    - no MITM CA/system proxy exists in Phase 1;
    - protected raw URL does not appear in normal argv/logs/IPC;
    - Cookie/Authorization are not replayed or inherited;
    - context lease/TTL owner rules are deterministic.

## Acceptance Criteria

1. Resource Capture can be started and stopped explicitly without modifying Windows global proxy settings.
2. Phase 1 installs no root CA and performs no HTTPS MITM.
3. An isolated Chromium/Edge profile can produce sanitized video/audio/HLS/DASH resource summaries from DevTools Network events.
4. Raw captured URLs and sensitive request headers never appear in ordinary frontend state, user-visible logs, copied logs, debug command strings or persistent settings.
5. A selected captured resource becomes a normal CurrentTask row and uses the existing single-slot FIFO download execution path.
6. Raw/signed resource URL is supplied to yt-dlp without being placed in ordinary command-line argv.
7. Phase 1 never replays or inherits Cookie/Authorization for captured tasks.
8. Unsupported authenticated-replay resources fail/classify explicitly and do not silently downgrade to naked URL execution.
9. Retry is allowed only while the bound context lease is valid; expiry yields a typed capture-context-expired outcome.
10. Stop Capture clears unclaimed discovery state while preserving already claimed contexts until their normal task cleanup/TTL.
11. Remove/completion/dispose/shutdown reliably revoke capture context usage.
12. CaptureState memory/resource limits are enforced and tested.
13. For the supported G1 direct video/audio captured path, every new yt-dlp HTTP(S) upstream connection is forced through the loopback Capture Egress Guard; hostname/DNS/IP policy prevents connection to forbidden local/private/link-local/metadata/reserved targets, including redirect-created connections, without HTTPS MITM. HLS/DASH/stream execution is not covered by this criterion and remains disabled.
14. Ordinary non-capture URL behavior remains regression-green.
15. Application/Domain automated gates, native CDP E2E gate and Human Gate are recorded separately.
16. No second downloader, second task scheduler or second task lifecycle authority is introduced.

## Out of Scope

- Windows system-wide proxy capture.
- HTTPS MITM proxying.
- Root CA generation, installation or machine/browser trust management.
- Capturing traffic from arbitrary external desktop applications.
- Cookie replay for captured resources.
- Authorization replay for captured resources.
- Generic authenticated session replay.
- WeChat/WeChat Channels JavaScript response injection.
- WeChat media decryption.
- Xiaohongshu or other site-specific script rewriting.
- A local replay-proxy download architecture.
- A second direct HTTP/Range DownloadEngine.
- Image/document resource download UI.
- Persistent Capture history/database.
- Background always-on capture.
- Automatic capture at application startup.
- Playlist restoration or queue-wide batch lifecycle features.
- Changes to the existing one-slot FIFO product contract.

## Further Notes

- This spec intentionally narrows the first tranche compared with res-downloader. The borrowed idea is resource discovery and classification, not its Wails stack, global proxy model or custom Range downloader.
- The reason Phase 1 uses CDP is architectural risk reduction: Chromium/Edge already owns TLS, cookies and browser networking, so YTDL-Flow can observe network metadata without creating a new machine trust anchor or modifying global proxy settings.
- Microsoft documents that Edge's DevTools Protocol matches the Chrome DevTools Protocol and can be run with a distinct user-data directory. Chrome DevTools Protocol exposes Network request/response events and header/response metadata.
- G1 captured direct-media execution uses yt-dlp's `--load-info-json -` stdin seam with a native minimal descriptor, keeping the raw URL out of argv and bypassing extractors entirely.
- A later Phase 2 may investigate authenticated replay or external-application capture, but that work requires a new security review and must not be smuggled into Phase 1.
- ADR-0003 is the architectural authority for Opaque Capture Context. Existing ADR-0002's single-lifecycle-authority and replace-don't-layer principles remain in force.
