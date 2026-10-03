# YTDL-Flow v2 Rebuild Specification

> Historical / Superseded：历史 React 架构实验，保留正文供追溯，不作为当前实施授权或架构权威。当前架构见 `docs/adr/0002-retain-vue-architecture-migration.md`，当前任务只读 `.ai-bridge/STATUS.md`。

> Renderer decision superseded on 2026-09-21 by `docs/adr/0002-retain-vue-architecture-migration.md`. Domain/Application/Adapter separation remains valid；React/Zustand/Tailwind/shadcn 作为默认产品目标的选择不再是当前实施方向。

## Problem Statement

YTDL-Flow 当前已经具备 yt-dlp 集成、Rust 后端、任务队列、媒体分析和桌面应用能力，但前端、状态管理和领域逻辑存在较强耦合。长期演进需要建立清晰的领域边界，使 UI、下载核心和基础设施可以独立演进。

## Solution

重构 YTDL-Flow v2 架构，采用 Tauri 2 + React 19 + TypeScript + Zustand + Tailwind v4 + shadcn/ui 作为新的桌面应用技术栈，同时保留并强化 Rust 下载核心。

核心目标：

- 将下载领域模型从 UI 框架中分离。
- 保留 yt-dlp / ffmpeg / Rust 相关能力。
- 建立可测试的 Download Domain。
- 支持未来 UI 技术替换。

## User Stories

1. As a user, I want to paste a media URL, so that I can quickly start a download.
2. As a user, I want to preview media metadata before downloading, so that I can confirm the content.
3. As a user, I want to manage multiple download tasks, so that I can control my download workflow.
4. As a user, I want to see real-time progress, so that I know the current download state.
5. As a user, I want failed downloads to provide useful recovery actions, so that I can retry or fix problems.
6. As an advanced user, I want configurable download profiles, so that I can control format, quality, cookies and advanced options.
7. As a developer, I want the download domain independent from UI frameworks, so that frontend technology can evolve safely.

## Implementation Decisions

- Adopt React 19 + TypeScript for the new desktop renderer.
- Adopt Zustand for frontend UI state management.
- Adopt Tailwind v4 and shadcn/ui for the design system.
- Keep Rust as the download execution core.
- Separate Domain, Application Service, Adapter and UI layers.
- Introduce DownloadTask as the canonical domain entity.
- Introduce DownloadQueue as a framework-independent service.
- Introduce DownloadEngine abstraction around yt-dlp and ffmpeg execution.
- Introduce DownloadRepository for task persistence and history recovery.
- Introduce Domain Events for download lifecycle communication.
- Introduce EngineManager for dependency and sidecar lifecycle management.

Target architecture:

UI → View Model → Application Service → Domain → Infrastructure Adapter → Rust Engine

## Testing Decisions

Testing should focus on external behavior rather than implementation details.

Primary test seams:

1. Download Domain Service
   - Task creation
   - State transitions
   - Queue behavior
   - Cancellation and retry behavior

2. Rust Engine Adapter
   - Command generation
   - Parameter mapping
   - Error conversion

3. UI Adapter
   - User interactions
   - Task display behavior
   - Filtering and state presentation

End-to-end tests should be limited to critical release verification paths.

## Out of Scope

- Immediate full rewrite of existing production code.
- Replacing Rust download capabilities.
- Introducing unrelated desktop frameworks.
- Removing existing features during migration.

## Further Notes

Migration strategy should use incremental replacement rather than a big-bang rewrite:

1. Extract domain boundaries.
2. Stabilize contracts.
3. Build React prototype.
4. Gradually migrate features.
5. Remove old UI only after parity verification.
