# YTDL-Flow v2 Tickets

> Historical / Archived：React POC 阶段工单，保留供追溯，不作为当前实施计划。当前架构以 [ADR-0002](../adr/0002-retain-vue-architecture-migration.md) 与 [迁移历史](../architecture/MIGRATION_HISTORY.md) 为准。

> Historical / Superseded：历史 React 架构工单合集，正文 Scope/Acceptance/Blocked by 不代表当前待办或实施授权。当前架构见 `docs/adr/0002-retain-vue-architecture-migration.md`，当前任务只读 `.ai-bridge/STATUS.md`。

## Purpose

将架构方案拆解为可验证的小任务，避免大规模一次性重构。

---

## TICKET-001: Domain Package

### Scope

创建纯业务 Domain 层。

### Includes

- DownloadTask
- DownloadStatus
- DownloadQueue
- DomainEvent

### Acceptance Criteria

- 状态迁移有单元测试
- Queue 行为有测试
- 不依赖 UI/Tauri/Engine

### Blocked by

None

---

## TICKET-002: Contracts Package

### Scope

建立跨边界数据结构。

### Includes

- TaskPayload
- ProgressEvent
- ErrorPayload

### Acceptance Criteria

- 类型定义稳定
- 可被 Application 和 Adapter 使用

### Blocked by

TICKET-001

---

## TICKET-003: Application Service

### Scope

建立应用协调层。

### Includes

- DownloadService
- TaskQueryService

### Acceptance Criteria

- 可以创建任务
- 可以协调 Queue 和 Engine Interface

### Blocked by

TICKET-001
TICKET-002

---

## TICKET-004: Mock Engine

### Scope

验证 Engine 边界。

### Includes

- start
- cancel
- progress events

### Acceptance Criteria

- 可以模拟完整下载生命周期
- 不依赖 yt-dlp

### Blocked by

TICKET-003

---

## TICKET-005: Vertical Slice Test

### Scope

验证完整闭环。

### Flow

URL
→ Task
→ Queue
→ Mock Engine
→ Progress Event

### Acceptance Criteria

- Application 流程测试通过
- UI 不参与业务验证

### Blocked by

TICKET-004

---

## TICKET-006: React Shell

### Scope

建立前端展示层。

### Includes

- React App
- View Model
- Downloads Page

### Acceptance Criteria

- 可以展示任务状态
- 不直接调用 Engine

### Blocked by

TICKET-005

---

## TICKET-007: Application API Adapter

### Scope

建立 React 前端与 Application Layer 之间的可替换读取 seam。

### Includes

- TaskApplicationApi interface
- TaskQueryApplicationAdapter
- dev/static adapter
- real TaskQueryService compatibility test

### Acceptance Criteria

- 同一 TaskApplicationApi interface 至少有两个 adapter
- TaskQueryApplicationAdapter 可读取真实 TaskQueryService 的 TaskPayload[]
- dev fixture 通过同一 interface 暴露任务
- UI Components 不新增 Domain/Application/Tauri/Engine 依赖
- 不接真实 yt-dlp，不新增下载控制

### Blocked by

TICKET-006

---

## Current Rule

Ticket 完成不代表整体完成。
每个 Ticket 需要独立验证后进入下一阶段。
