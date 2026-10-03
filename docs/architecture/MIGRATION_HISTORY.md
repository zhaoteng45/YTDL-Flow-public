# Architecture Migration History

This file preserves the durable rationale from YTDL-Flow's completed architecture experiments and migrations. It is historical context, not a current task tracker.

Current product and runtime authority:
- `PRODUCT.md` — current product scope and supported behavior.
- `CONTEXT.md` — current domain vocabulary, runtime owners, and invariants.
- `DESIGN.md` / `DESIGN_LANGUAGE_GUIDE.md` — current presentation rules.
- `packages/contracts/src/`, `packages/application/src/`, `packages/domain/src/`, `src/`, and `src-tauri/src/` — executable truth.
- `docs/contracts/YTDL-2.1-RELEASE-HARDENING-CONTRACT.md` — current release-hardening contract while its remaining external gates are open.

## 2026-08 — Legacy queue deepening

The original Vue/Pinia product concentrated task lifecycle behavior in `src/queue/taskQueue.ts`. The architecture-deepening work centralized FIFO scheduling, cancellation, retry, failure classification, watchdog behavior, ExtraArgs mapping, and Rust process cleanup. This was an important intermediate step, but the file later became a migration oracle rather than a production owner.

Durable lessons retained:
- one lifecycle owner at a time;
- cancellation must settle from trusted native facts rather than display strings;
- process-tree cleanup is a hard invariant;
- IPC types and Rust/frontend schemas evolve together;
- download settings must have a single typed mapping into yt-dlp arguments.

## 2026-08 to 2026-09 — GPUI experiment

A pure-Rust GPUI rewrite was explored as a learning/portfolio direction. Windows IME maturity, pre-1.0 API churn, packaging gaps, and the absence of a practical incremental migration path made it unsuitable for the product mainline. The experiment was explicitly abandoned and the mainline returned to Tauri 2 + Vue 3.

The rationale remains in `docs/adr/0001-gpui-rewrite.md`; the old implementation contract is no longer a current obligation.

## 2026-09 — Domain/Application separation and React proof of concept

The v2 work extracted reusable Domain/Application/Contracts seams and validated a real Tauri/Rust execution path. TICKET-008 and TICKET-009 established trusted terminal results, truthful cancellation, and a single Application lifecycle writer.

A React product slice then proved that the application seams could drive another renderer. The proposed React default-runtime cutover was later rejected: replacing the mature Vue renderer added migration cost without enough product benefit.

Durable lessons retained:
- renderer choice is independent from download-domain ownership;
- UI code should consume application-level read models and commands rather than native execution details;
- replace-don't-layer: a new owner replaces an old owner after parity, rather than creating permanent dual state.

The decision to keep Vue is recorded in `docs/adr/0002-retain-vue-architecture-migration.md`.

## 2026-09 to 2026-10 — Vue internal migration and owner cutover

The useful v2 seams were integrated into the Vue product. The production task owner is now `CurrentTaskService`; download execution and the single FIFO slot are owned by `DownloadService` / `DownloadQueue`. The Vue presentation layer consumes the current task projection.

After consumer-map verification and direct current-owner regression coverage, the legacy `src/queue/taskQueue.ts` migration oracle and its differential-only tests were retired. Historical parity matrices and intermediate migration contracts were removed because they described completed transitions rather than current architecture.

Current invariants are documented in `CONTEXT.md` and protected by direct tests of the current owner.

## Historical evidence policy

Keep ADRs when they explain why a rejected architecture should not be accidentally revived. Keep current security/release contracts while their gates remain open. Intermediate ticket plans, parity matrices, model transcripts, screenshots, PID/log files, and implementation handoffs are disposable once their durable result is represented by current code, tests, an ADR, or a final review.

Automated tests, Native runtime evidence, and Human Gate evidence remain distinct evidence classes.
