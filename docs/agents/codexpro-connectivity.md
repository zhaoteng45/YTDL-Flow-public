# CodexPro Connectivity（本仓入口）

本仓使用全局 CodexPro Connectivity infrastructure：固定端口 + Cloudflare Named Tunnel + 四层健康判定 + 无人值守自愈。

Canonical 文档（人工查看用；CodexPro workspace 无法直读 workspace 外路径，实测 `Path escapes workspace root`，故本文件保留最小自足摘要）：
- 通用设计 / Runbook：`C:\Users\zhao\.codexpro\docs\connectivity-hardening.md`
- 本机部署清单：`C:\Users\zhao\.codexpro\docs\connectivity-local.md`
- 行为权威（脚本；文档与脚本冲突时以脚本为准）：`C:\Users\zhao\.codexpro\bin\Start-CodexPro.ps1`

## 本仓映射

| 项 | 值 |
| --- | --- |
| Repository | YTDL-Flow |
| Key | `ytdl` |
| Port | 8790 |
| 公网域名 | `ytdl.zhaoxiaofeng.site` |

## 四层 READY（最小模型）

`READY` = 四层全部通过 **且** 恢复状态可信：

1. **Profile**：Profile 存在且 root/port 与本仓映射一致（不匹配会被拒绝，不会自动覆盖）；
2. **本地 MCP**：真实 MCP 调用（含 bash）通过——不是"端口在监听"；
3. **Cloudflare 隧道**：服务 Running **且** HA connections ≥ 1；
4. **公网路由**：对公网域名 `POST /mcp` 带 token 得 200（未带 token 的 401 不算通过）。

状态损坏或熔断 → `DEGRADED`（exit 30），需人工 `cx repair` / `cx restart` 恢复。

## 命令

- PowerShell：`cx status` / `cx status -v` / `cx status --json` / `cx repair` / `cx restart` / `cx <key>`
- Git Bash（CodexPro bash 运行时）：加 `cmd //c` 前缀，例如 `cmd //c cx status`

## 异常分层（exit code）

`0` READY；`10` PROFILE_FAIL；`11` PORT_CONFLICT；`12` LOCAL_MCP_FAIL；`20` CLOUDFLARED_SERVICE_FAIL；`21` EDGE_CONNECTION_FAIL；`22` EXTERNAL_ROUTE_FAIL；`30` CIRCUIT_OPEN；`99` UNKNOWN_INTERNAL_ERROR。

## 规则

- 不在本仓复制或维护 cx 实现；
- 不自行修改全局 port/profile/tunnel 规则；
- 遇到连接问题先运行 `cx status`；
- Edge / 公网路由异常使用 `cx repair`；
- 完整冷恢复才使用 `cx restart`；
- 不以单纯 port listening 判断 MCP READY。

## 连接恢复后：项目上下文恢复

连接恢复与任务恢复是两件事。`cx status` 只证明 CodexPro/MCP transport READY，不代表当前任务、writer 或授权已经恢复。

新 ChatGPT 会话、OpenCode 会话、工具超时后重连时，按以下顺序恢复：

1. 确认真实 workspace 是本仓，不凭会话记忆猜路径。
2. 读取 `AGENTS.md`。
3. 读取 `.ai-bridge/STATUS.md`；它是唯一 current authority。
4. 运行 `bun run agent:check`，确认 Task / Workflow / Status / Writer / Human Gate 可读。
5. 按 STATUS 的 Workflow 加载 `docs/agents/skill-routing.md` 与需要的 Skill；需要模型交接、Single Writer、Human Gate、Evidence 时读取 `docs/agents/chatgpt-codexpro-collaboration.md`。
6. 复读当前 dirty worktree、相关 diff/tests/logs；旧 review、agent-status、execution-log 只作为历史证据。
7. 若 STATUS 显示已有 writer，先确认该具体会话/子进程是否仍在写盘；未确认前不得抢占或重复启动同一长任务。
8. OpenCode/CodexPro 调用超时不等于进程已停止；先查真实进程/产物/状态，再决定继续、等待或重启，禁止直接复制启动第二份。
9. `.ai-bridge/current-plan.md` 只有在明确的新 handoff 中才可作为执行计划；若标记 `No Active Local-Agent Handoff`，不得从历史 receipt 恢复旧任务。
10. STATUS 缺失、格式无效或与真实 workspace 冲突时停止执行并修复上下文；不得从 current-plan、agent-status、聊天记录或旧 handoff 猜当前授权。

恢复完成的最低条件：transport READY + workspace 正确 + STATUS 有效 + context checker PASS + writer/side-effect 边界明确。
