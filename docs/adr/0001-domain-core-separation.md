# ADR-0001: YTDL-Flow v2 Domain Core Separation

## Status

Accepted

## Context

YTDL-Flow 当前已经具备稳定的下载能力，包括 yt-dlp 集成、Rust 后端、任务队列、媒体分析和桌面 UI。但现有架构中，领域逻辑与前端状态管理存在耦合。

未来需要支持更复杂的下载任务管理、历史恢复、高级配置和 UI 演进，因此需要明确核心业务边界。

## Decision

YTDL-Flow v2 采用 Domain Core Separation 架构。

核心原则：

- Rust 继续作为下载执行核心。
- 下载领域模型独立于 UI 框架。
- React UI 不直接调用底层引擎。
- 通过 Application Service 和 Adapter 连接 UI 与基础设施。

目标结构：

UI → View Model → Application Service → Domain → Infrastructure Adapter → Rust Engine

## Alternatives Considered

### 1. 直接 Vue 替换为 React

拒绝。

原因：

只替换 UI 无法解决领域逻辑和状态管理耦合问题。

### 2. 完全重写 Rust 与前端

拒绝。

原因：

当前 Rust 下载核心、任务队列和 yt-dlp 集成已经具备价值，重新实现会增加风险。

### 3. GPUI 原生 Rust UI

拒绝作为当前方案。

原因：

虽然性能优秀，但当前桌面 UI 生态和开发效率不足以支持快速演进。

## Consequences

正面：

- UI 技术可以独立演进。
- 下载核心可复用。
- 测试边界更加清晰。
- 支持未来 CLI 或其他客户端。

代价：

- 初期需要抽离 Domain。
- 需要维护 API Contract。
- 迁移过程需要双架构并存。

## Related Concepts

- DownloadTask
- DownloadQueue
- DownloadProfile
- DownloadRepository
- Domain Events
- EngineManager
