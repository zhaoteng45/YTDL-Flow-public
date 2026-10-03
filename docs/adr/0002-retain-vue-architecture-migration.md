# ADR-0002: 保留 Vue 渲染层，增量迁移内部架构

## Status

Accepted — 2026-09-21

### Amendment — 2026-09-24

The core decision remains accepted: Vue stays the target renderer, there is one task-lifecycle authority at a time, and migration uses replace-don't-layer.
The capability inventory in the original Context and Decision 5 is historical. Later user-approved product scope removed Playlist, History/SQLite, embedded media preview, task multi-select, and queue-wide batch lifecycle commands. Multi-URL input remains as an input convenience that creates independent tasks, and downloads execute through a one-slot FIFO queue.
Current product/status authority is `.ai-bridge/STATUS.md`, `PRODUCT.md`, and `CONTEXT.md`; the original wording below is retained to preserve the rationale that led to this ADR.

### Amendment — 2026-10-01

The ordinary-download migration is complete. `CurrentTaskService` is now the production task-row/orchestration owner and `DownloadService` / `DownloadQueue` own the one-slot execution lifecycle. The legacy `src/queue/taskQueue.ts` migration oracle was retired after consumer-map verification and direct current-owner regression coverage. Historical TaskQueue wording below is retained only as decision history.

Completed migration contracts, parity matrices, and React cutover tickets are consolidated in `docs/architecture/MIGRATION_HISTORY.md`. Release hardening remains separately governed by `docs/contracts/YTDL-2.1-RELEASE-HARDENING-CONTRACT.md`.

## Context

YTDL-Flow 已完成一条 opt-in React v2 技术竖切，证明了 `UI → Application → Domain → Tauri Adapter → Rust/yt-dlp` 的分层可以工作。

同时，真实 Vue 产品已经拥有多 URL、播放列表选集、批量任务、Cookies/浏览器认证、格式选择、重试、日志、预览、历史、设置、依赖与更新等成熟能力。当前 React 竖切只覆盖单 URL、两种下载选择、进度与取消。如果直接继续默认 runtime cutover，会在功能等价之前替换成熟产品，与“迁移期间不删除现有功能”的既有目标冲突。

本次用户明确选择路线 A：保留 Vue UI，继续架构重构，不再以 React 替换 Vue 为迁移目标。

## Decision

1. Vue 3 继续作为默认且目标桌面渲染层。
2. React TICKET-010 保留为架构 POC 与验证证据，不作为默认产品切换前置；其 GUI Human Gate 不被标记为通过或失败，而是被新的产品方向取代。
3. 原 TICKET-011 React Runtime Cutover 不再实施；其默认切换目标由本 ADR supersede。
4. 保留已经验证有价值的 `packages/domain`、`packages/application`、`packages/contracts` 及 Tauri adapter 思路，按 Vue 产品真实功能逐步接入。
5. 生产环境任一时刻只能有一个任务生命周期权威。当前仍由 `src/queue/taskQueue.ts` 管理任务；在 v2 Domain/Application 尚未覆盖现有 retry、playlist、batch、format、cancel、terminal/failure 等语义之前，不让两套队列同时管理同一批任务。
6. 迁移顺序采用“外围低风险 seam → 任务核心 → UI 拆分”。优先移除 Vue 组件中的直接 Tauri/系统调用，再迁移任务核心。
7. 迁移采用 replace-don't-layer：新 seam 达到行为覆盖后替换旧路径，不长期叠加第二套 store、event bus、Repository、EngineManager、DI container 或 runtime manager。
8. 用户可见功能默认保持等价；任何功能删除、行为收缩或产品范围变化都需要新的明确授权。
9. React POC 代码当前不删除；后续若要归档或清理，作为独立任务处理。

目标结构：

```text
Vue View
  ↓
Vue presentation / ViewModel
  ↓
Application module
  ↓
Domain (only where domain semantics exist)
  ↓
Tauri adapter
  ↓
Rust / yt-dlp / OS
```

Vue 组件不负责 yt-dlp 参数语义、任务状态机、进程管理或原生命令细节。

## Alternatives Considered

### 1. 继续 React parity-first

可行，但需要重新迁移几乎全部成熟 Vue 功能，成本高，且当前没有足够收益证明必须更换渲染框架。

### 2. 直接把 Vue 切到现有 v2 DownloadQueue

拒绝。当前 v2 竖切没有覆盖现有生产 TaskQueue 的完整产品语义，会造成能力缩水或双状态源。

### 3. 保持现状，不继续架构迁移

拒绝。当前 `appStore.ts`、`taskQueue.ts`、`SettingsPanel.vue` 等仍混合 UI、Application、Tauri/OS 细节，长期维护成本真实存在。

## Consequences

正面：

- 不需要为技术栈替换重新实现成熟功能。
- 可以继续获得 Domain/Application/Adapter 分层的测试与维护收益。
- 迁移过程保持默认产品可用。
- Vue 是否长期保留与核心下载架构不再耦合。

代价：

- 一段时间内 legacy Vue 路径和已存在的 React POC 会同时留在仓库。
- TaskQueue 的最终切换必须等能力矩阵达到要求，不能提前“清理”。
- 部分 Application 模块需要从真实旧功能反向抽取，而不是按 React POC 的窄模型直接扩展。

## Supersedes / Related

- Supersedes the historical TICKET-011 React default runtime cutover; the retired ticket/contract trail is summarized in `docs/architecture/MIGRATION_HISTORY.md`。
- Supersedes `docs/specs/YTDL-Flow-v2-rebuild-spec.md` 中“React 作为目标 renderer”的实现选择；其中 Domain/Application/Adapter 分层目标继续有效。
- 保留 ADR-0001 的 Domain Core Separation 原则，但其 renderer-specific 表述由本 ADR 解释为框架无关的 UI seam。
