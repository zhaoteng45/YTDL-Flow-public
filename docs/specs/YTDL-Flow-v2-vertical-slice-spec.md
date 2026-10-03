# YTDL-Flow v2 Vertical Slice Specification

> Historical / Archived：已结束的 React POC 竖切记录，不进入正式 workspace、build 或 CI，不作为当前实施授权。当前架构见 `docs/adr/0002-retain-vue-architecture-migration.md`，当前任务只读 `.ai-bridge/STATUS.md`。

## Purpose

验证 YTDL-Flow v2 分层架构是否可行。该阶段不是完整产品实现，而是验证从 UI 到 Domain 再到 Engine Adapter 的最小闭环。

## Scope

实现一条最小用户流程：

User URL Input
→ Create DownloadTask
→ Queue
→ Mock Engine
→ Progress Events
→ UI Update

## Included

- React 页面基础结构
- URL 输入组件
- Application Service 调用
- DownloadTask 创建
- DownloadQueue 基础行为
- Mock DownloadEngine
- Progress Event 展示
- 基础测试

## Excluded

- 真实 yt-dlp 调用
- ffmpeg 集成
- Cookies
- Proxy
- 高级下载 Profile
- 完整设置系统
- 发布流程

## Domain Requirements

DownloadTask 必须支持：

- 创建
- 状态迁移
- 进度更新
- 完成
- 失败
- 取消

状态：

Created
→ Queued
→ Downloading
→ Completed

异常：

Failed
Cancelled

## Architecture Boundary

Frontend:

- 页面
- 用户交互
- View Model

Application:

- 用户意图转换
- 调用 Domain

Domain:

- Task
- Queue
- Events

Adapter:

- Engine 接口

Mock Engine:

- 模拟进度
- 模拟完成

## Acceptance Criteria

1. 用户输入 URL 后可以创建任务。
2. 任务可以进入队列。
3. UI 可以显示状态变化。
4. Domain 测试不依赖 React 或 Tauri。
5. Engine Adapter 可以替换为真实实现。

## Next Step

Vertical Slice 通过后，再接入真实 yt-dlp Engine。
