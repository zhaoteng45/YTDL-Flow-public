# Product

<!-- impeccable:product-schema 1 -->

## Platform

Native desktop application built with Tauri 2, Rust, and a Vue 3 WebView frontend. Web/Vite rendering is an implementation and test surface; the product authority is the real desktop window.

## Users

Primary users are everyday digital content consumers and casual media archivers who want to save videos and audio from the web without technical hassle. They encounter media on platforms like Bilibili, YouTube, TikTok/Douyin, and Twitter/X, and need a reliable, clean, zero-configuration local desktop tool that delivers immediate results without requiring terminal knowledge, command-line arguments, or web-scraper subscriptions.

Secondary users include media enthusiasts who appreciate underlying format robustness, resume capability, and local-first download workflows, but prefer an interface that stays clean, predictable, and free of cognitive clutter.

## Product Purpose

YTDL-Flow exists to eliminate the friction, privacy invasiveness, and complexity of online media saving. It provides a modern, high-contrast, industrial desktop experience that turns any media link into an accurately downloaded and merged file in one click, while keeping credential material on the local desktop path rather than in a hosted service; task history remains runtime-scoped instead of a persistent local archive.

Success means:
1. Paste-and-download takes fewer than 3 seconds to initiate with automated smart format selection.
2. The user never encounters raw command-line stack traces or unhandled error dialogs.
3. Complex parameters (PO Tokens, browser cookies, custom user agents) remain tucked away under progressive disclosure, automatically working where possible.
4. The local queue remains rock-solid, crash-resilient, and non-destructive.

## Positioning

"Zero-BS, lightweight local media downloader with industrial-grade reliability."
Unlike ad-infested web downloader services, paywalled third-party scrapers, or intimidating terminal wrappers, YTDL-Flow pairs the full power of modern local subprocess orchestration (yt-dlp, FFmpeg, Bun) with a punchy, tactile Neo-Brutalist interface designed for effortless everyday use.

## Operating Context

- Desktop operating environments across Windows, macOS, and Linux (powered by Tauri 2 webview shell).
- Typical daily workflow: the user pastes one or more independent video URLs, YTDL-Flow validates and deduplicates them into normal tasks, then the user verifies metadata and starts downloads.
- Local serial queue: users can add multiple video tasks, but only one download runs at a time; later tasks wait in order while the active task finishes.

## Capabilities and Constraints

### Confirmed Capabilities
- Universal URL detection and deep analysis for major platforms (Bilibili, YouTube, Douyin/TikTok, Tencent, Meta/Instagram, Twitter/X).
- Progressive download configurations: smart auto-selection (best video + best audio merged to MP4) with progressive disclosure for resolution/audio codec overrides.
- Automated browser cookie borrowing (Chrome, Edge, Firefox, Brave, Vivaldi, Opera, Chromium) and Bilibili QR code fast-login.
- YouTube PO Token (Proof-of-Origin) support with the bundled rustypipe BotGuard provider and optional manual token override.
- Multi-item serial queue with search filtering, status pills, per-task controls, a 4-second non-blocking single-task undo buffer, and desktop keyboard shortcuts (J/K/Space/Del//).
- Completed downloads can be opened with the system default media application or revealed in their containing folder.

### Technical Constraints
- Runs as a native desktop application with a lightweight Rust/Tauri 2 core and a Vue 3 frontend.
- Subprocesses (yt-dlp, ffmpeg) are managed locally with sandboxed argument construction and zombie process protection.
- High accessibility standards: Full keyboard focus trapping in dialogs, `:inert` backdrop isolation, and compliance with `prefers-reduced-motion`.

## Brand Commitments

- **Name**: YTDL-Flow
- **Voice**: Direct, honest, tactile, and reassuring. Technical status is transparently translated into plain language; errors offer actionable remedies rather than technical blame.
- **Visual Identity**: Neo-Brutalist industrial utility with a tiered surface hierarchy — strong high-contrast framing is reserved for primary containers/actions, while secondary groups and metadata use lighter borders or theme-derived soft fills. No system emoji clutter in core controls; use the unified geometric vector iconography (`NeoIcon.vue`).

## Evidence on Hand

- Fully functional codebase in `src/` (Vue 3, Pinia) and `src-tauri/` (Rust commands and download services).
- Comprehensive automated suites cover application/runtime contracts, accessibility, focus behavior, sidecar contracts, updater wiring, and UI layout contracts.
- The main DownloadList also has a real-browser semantic state matrix that mounts the production component across both locales, all current themes, and representative desktop/compact widths. Native Tauri Human Gate evidence remains separate from Web QA.

## Product Principles

1. **One-Click Simplicity Over Technical Pedantry**: Default workflows must "just work" for non-technical users. Advanced knobs (PO Tokens, custom UAs) must never block or complicate the primary path.
2. **Local Privacy & Absolute Sovereignty**: No telemetry, no external analytical pings, and no cloud dependency. User cookies, credentials, and downloaded assets remain exclusively on the user's physical drive.
3. **Engine Robustness & Safe Defaults**: Leverage yt-dlp and FFmpeg to their fullest potential with aggressive error recovery, resume-on-disconnect, and a non-destructive 4-second undo buffer for per-task removal.
4. **Tactile Clarity & Predictable Feedback**: Every action has immediate, proportional visual feedback. Media content and task state outrank decorative chrome; avoid nested equal-weight cards and misleading status colors. Motion should be brief, purposeful, and reduced-motion safe.

## Accessibility & Inclusion

- WCAG 2.2 AA compliant across all theme palettes with >= 4.5:1 text contrast.
- Complete keyboard navigability: J/K/Space/Del shortcuts for queue management, full Tab cycle and Escape dismissal in all modal dialogs.
- Reduced-motion safe: All continuous animations, pulsing effects, and progress hazard stripes gracefully disable when `prefers-reduced-motion: reduce` is active.
