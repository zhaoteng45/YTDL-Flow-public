# YTDL-Flow v2 UI Prototype

> Historical / Archived：React POC 界面实验，保留原始设计，不作为当前产品/UI 实施权威。当前架构见 `docs/adr/0002-retain-vue-architecture-migration.md`，当前任务只读 `.ai-bridge/STATUS.md`。

## Purpose

验证 React 19 + shadcn/ui + Tailwind v4 桌面下载器的信息架构，不直接进入生产实现。

## Design Goals

- 首次使用用户可以快速完成 URL 到下载。
- 高级用户可以访问完整下载控制能力。
- UI 不直接依赖 yt-dlp 参数和 Rust IPC。
- 下载状态由 Domain Model 驱动。

## Main Navigation

- Home
- Downloads
- History
- Profiles
- Settings

## Home

Primary flow:

URL Input → Analyze → Preview → Download

Content:

- URL 输入框
- 分析按钮
- 最近下载记录

## Media Preview

展示：

- Thumbnail
- Title
- Channel
- Duration
- Available profiles

操作：

- Download
- Change profile

## Downloads

核心任务列表：

- Task title
- Progress
- Speed
- Status
- Actions

Supported states:

- Analyzing
- Ready
- Queued
- Downloading
- Processing
- Completed
- Failed
- Cancelled

## Profiles

替代直接暴露 ExtraArgs。

Examples:

### Default

- Best quality
- Standard format

### Music

- Audio focused
- Metadata enabled

### Archive

- Thumbnail
- Info JSON
- Subtitle

## Settings

Basic:

- Download folder
- Theme
- Notifications

Advanced:

- Network
- Cookies
- Extractor
- Post processing
- Debug

## Architecture Constraint

UI component should not call Tauri commands directly.

Expected flow:

Component → Application API → Domain → Adapter → Rust Engine

## Validation Gate

Prototype must pass:

1. New user understands first action.
2. Download queue remains clear with multiple tasks.
3. Advanced options do not overwhelm default flow.
4. Domain model can support UI without framework-specific coupling.
