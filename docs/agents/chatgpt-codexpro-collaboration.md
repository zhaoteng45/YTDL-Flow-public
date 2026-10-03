# YTDL-Flow 轻量分层模型协作规则

## 1. 目标

本项目使用“轻量协作状态 + Handoff / Review 记录 + 人工约定”。

它不是 workflow engine，不维护 Delivery 序列、runtime lease、ACK parser、Markdown Decision parser、Human Gate source parser 或 frozen-hash review loop。

当前协作状态唯一入口：

`.ai-bridge/STATUS.md`

旧 `.ai-bridge/tasks/**`、lifecycle controller、projection writer/verifier、`current-workflow.md` 及迁移期 conformance/review runtime 已完成 Phase B 清理；不得恢复为当前权威。

## 2. 固定四模型池、职责与额度路由

本项目只允许以下四个执行模型；除非用户再次明确授权，不得自动调用、推荐为 fallback 或写入新的默认流程中的其他模型。

- **主协调 / 最终 Reviewer — 当前 ChatGPT / GPT-5.6 Sol High**：负责真实 workspace 调查、方案、Scope / Do Not Touch、任务拆分、验收标准、调度、关键 diff/tests 复核和最终 Standards + Spec Review。它可以直接做必要调查与小范围修复，但不承担大批量机械实现；所有本地 Worker 结果都必须由它重新读取真实 workspace 后最终裁决。
- **主实现 — `cliproxy/gpt-6.1-sol#medium`**：默认最高能力的本地 implementation 模型，优先承担复杂跨文件实现、架构落地、难 Debug、跨模块状态逻辑、重要 UI/Runtime 重构和高价值技术判断。只使用 `medium` 推理档，除非用户以后明确修改。
- **Fast A — `cliproxy/gemini-3.8-flash-high`**：高吞吐执行层，优先承担批量修改、长上下文阅读、UI/视觉/多模态分析、测试矩阵、扫描、证据整理、普通实现和 GPT-6.1 Sol 方案后的大面积机械落地。
- **Fast B — `opencode-go/deepseek-v4.1-flash`**：第二高吞吐执行层，优先承担独立扫描、测试、静态检查、批量 QA、机械实现、第二意见和对 Fast A / 主实现结果的交叉检查。固定使用这个基础 alias，不附加其他 variant。
- **Jev / TypeSafe（若项目仍保留）**：不是第五个执行模型，只可做低风险 route / risk / evidence advisory；不得成为 writer、Reviewer authority、Human Gate 或模型切换授权者。

固定模型池：

```text
ChatGPT / GPT-5.6 Sol High
cliproxy/gpt-6.1-sol#medium
cliproxy/gemini-3.8-flash-high
opencode-go/deepseek-v4.1-flash
```

默认任务路由：

```text
方案 / Scope / 验收 / 最终 Review
→ ChatGPT / GPT-5.6 Sol High

复杂主实现 / 跨模块重构 / 难 Debug / 高价值技术判断
→ cliproxy/gpt-6.1-sol#medium

批量实现 / 长上下文 / UI/视觉 / 测试矩阵 / 证据整理
→ cliproxy/gemini-3.8-flash-high

独立扫描 / 测试 / QA / 机械实现 / 第二路交叉检查
→ opencode-go/deepseek-v4.1-flash
```

### 额度与降级策略

- **GPT-6.1 Sol 额度充足**：优先把真正需要推理的关键切片交给 GPT-6.1 Sol；批量、机械、测试和证据工作仍优先交给两个 Fast，避免浪费稀缺额度。
- **GPT-6.1 Sol 额度开始紧张**：只保留给架构落地、关键实现、疑难 Debug 和高风险邻域；普通实现转给 Gemini，DeepSeek 负责扫描、测试、QA 和交叉检查。
- **GPT-6.1 Sol 额度耗尽或暂时不可用**：Gemini 临时成为普通任务主实现，DeepSeek 作为第二实现/测试/扫描通道；ChatGPT 继续负责最终 Review。不得自动切换到四模型池之外的任何模型。
- **任一 Fast 通道失败**：先判断 provider、OpenCode、权限、环境、工具链或测试基础设施是否故障；属于执行面问题时先修执行面，或由另一 Fast 接手，不因环境故障消耗 GPT-6.1 Sol。
- **两个 Fast 都可用**：可以并行做互不写同一 shared worktree 的读取、扫描、测试和证据工作；涉及写盘时仍严格遵守 Single Writer。
- 相同根因连续失败且方法未改变时停止重试，改变方法后再继续。

### 执行面选择

- **默认假设用户当前不方便操作 PC**：ChatGPT 应尽量直接通过 CodexPro + OpenCode 调用本地模型完成可自动执行的工作，不把本可自动完成的任务转成用户手动操作。
- 用户明确说明当前可以操作 PC 时，ChatGPT 可改为提供一份执行器无关、可直接粘贴到 Codex 或 OpenCode 的完整 Prompt；执行完成后仍由 ChatGPT 重新读取真实 workspace、diff、tests 和 evidence 做最终 Review。
- ChatGPT 直接调度 PC 模型时统一使用 OpenCode：GPT-6.1 Sol、Fast A、Fast B 均通过 `opencode run --model ...` 或等价 OpenCode 执行面调用；不要假设 Codex CLI 在 CodexPro 的 PATH 中可用。
- Codex 主要作为用户手动下发时的备用/可视执行器；OpenCode 是 ChatGPT 侧默认本地 agent harness。
- Codex 与 OpenCode 是不同 agent harness；即使底层模型相同，也不能把一边的测试、权限或运行结果冒充另一边的证据。

### 本机工具选择

- 委派 Prompt 必须继承仓库 `AGENTS.md` 的工具优先级；模型不得按自身习惯擅自降级工具链。
- JavaScript / TypeScript：仓库支持 Bun 时优先 `bun` / `bunx`，不默认使用 npm / pnpm / yarn / npx。
- PowerShell：Agent/开发自动化默认使用 PowerShell 7 的 `pwsh`；只有明确的 Windows PowerShell 5.1 兼容 Gate、目标脚本要求或真实不兼容时才使用 `powershell.exe`。
- Python：环境、依赖和一次性 CLI 优先 `uv` / `uvx`；直接 `python` 仅用于项目脚本本身；不默认使用 `pip` / `python -m venv`。
- Rust 使用 `cargo` / `rustc`；搜索优先 `rg` / `rg --files`；Windows 软件管理优先 `winget`。
- 以上是执行工具优先级，不授权新增运行时依赖，也不能覆盖仓库已有 CI、兼容目标或专用工具链。

### 每次委派必须显式说明

在启动任何本地模型任务前，必须先记录或向用户说明：

```text
执行框架：
模型：
推理档位：
角色：
任务：
选择理由：
额度策略：
失败降级：
最终 Reviewer：当前 ChatGPT / GPT-5.6 Sol High
```

本机 provider/model alias 以 `opencode models` 和最小 smoke test 的实时结果为准。公开 benchmark 只作为能力/速度分层的参考快照，不作为永久分数或 SLA；当前固定路由的原则是：GPT-6.1 Sol 负责最高价值推理，Gemini/DeepSeek 以更高吞吐和更充足额度吸收大部分执行量，ChatGPT 保持控制面与最终 Review。

CodexPro 是真实 workspace 执行面，不是额外模型角色。Single Writer、Git 边界、Human Gate 与最终 Review 不因模型切换而改变。

ChatGPT 自己实施后的检查属于 self-review，不称独立审核。

## 3. STATUS

结构化字段只保留：

```yaml
---
task: <task-id>
status: idle | active | review | blocked | done
writer: sol | principal | fast | none
human_gate: not_required | required | passed
updated_at: <timestamp>
---
```

正文至少包含：

- Goal
- Workflow
- Scope（allow / deny / side effects）
- Current result
- Current approval
- Next
- Blockers

`Workflow:` 使用固定槽位，供启动检查读取；它不是审批字段。

空闲状态使用：

```text
task: none
status: idle
writer: none
human_gate: not_required
Workflow:
none
```

切换新任务时必须同时重写 Goal、Scope、Current result、Current approval、Next 和 Blockers，不能沿用旧批准。

## 4. Single writer：具体执行会话

同一 shared worktree 同一时间只能有一个被指定的具体 implementation writer。

`writer: sol|principal|fast` 只描述当前角色，不代表所有同角色会话都有写权。`principal` 只代表当前明确交接的 GPT-6.1 Principal Implementation Owner 会话，不代表任意 GPT-6.1/Codex/OpenCode 会话自动取得写权。

### Sol 开工

开始写入前：

1. 读取 STATUS；
2. 确认真实 workspace；
3. 确认当前没有另一个写盘执行者或仍会写盘的 build/test 子进程；
4. 确认本会话是当前被指定的 Sol 协调会话；
5. 无法确认旧会话是否停止时，不自动接管。

未获当前写权的新会话只能在回复中报告阻塞，不自行修改 STATUS。由当前被指定的 Sol 在确认记录可安全更新后记录 `blocked`。

### Sol → Fast

Sol 委派 Fast 前：

1. 停止自己的 implementation write；
2. 确认相关写盘子进程停止；
3. 复读 partial diff / dirty state；
4. 写明确 Handoff；
5. 把 STATUS 设置为 `active / writer: fast`；
6. 把 Handoff 的准确路径交给本次 Fast 实例。

Fast 开工前必须核对 workspace、task、handoff、allow/deny、side effects，并确认自己就是本次指定实例。

不使用 ACK token/parser。

### Fast → Sol

Fast 交回时：

1. 停止 implementation write 和相关写盘子进程；
2. 完成 Handoff Result；
3. 最后一次回写 STATUS，通常为 `review / writer: none`，Next 指向当前 Sol；
4. 写完后才通知 Sol 接收。

交回后 Fast 不得再修改任何 shared file，包括已交出的 handoff/report。遗漏信息只在原会话回复中提供给 Sol；确需继续写入时重新明确交接。

## 5. 记录写入职责

- STATUS 日常维护者是当前被指定的 Sol 协调会话。
- Fast 持有 implementation 写权期间，Sol 不同时编辑 STATUS 和本次 Handoff。
- Fast 只可按 Handoff 完成实现、Result，以及交回/阻塞所需的状态回写；不得改变 Goal、Scope、Gate 或宣布 done。
- `writer: none` 表示没有 implementation writer；已经指定的 Sol 仍可维护协作记录。
- 指定 Reviewer 只写本次授权的 review 文件；Sol 在 Reviewer 完成前不编辑同一文件。
- Reviewer 不修改 STATUS、handoff 或实现。

## 6. Handoff

只有真实 writer 交接时才创建。

建议内容：

```text
Task
From / To
Workspace
Receiver entry
Goal
Allowed Scope
Do Not Touch
Current Context
Required Verification
Result
Next Actor
```

Result 至少记录：

- files changed
- commands + exit codes
- tests
- remaining risks
- unverified
- scope violations
- Git writes

Handoff 是人读工作记录，不需要 ACK、hash、Delivery ID 或 parser。

## 7. Review

普通任务：

```text
implementation
→ tests
→ Sol rereads real workspace
→ Standards Review
→ Spec Review
→ done / rework
```

Fast 自报 PASS 只证明 Fast 报告了 PASS；Sol 必须重新读取真实 workspace 和关键证据。

需要独立交叉检查时，只能从固定四模型池中选择未参与该实现的本地模型；若 GPT-6.1 Sol 是主实现，优先由 Gemini 或 DeepSeek 做异构/第二路检查，最终批准仍由当前 ChatGPT 读取真实 workspace 后决定。

Jev `evidence` 模式可以作为 Reviewer 前的快速证据完整性筛查，但不能把 implementing agent 的自报 PASS 转换成批准；低置信度、证据不足、可能越 Scope 时必须回到 Sol。

Review 是记录，不是 machine gate。Machine 不解析 Decision。

## 8. 批准新鲜度

取消 Delivery ID 不代表批准可以永久复用。

STATUS 的 Current result / Current approval 必须人读说明当前被审核或验收的可识别成果。

规则：

> 会影响已批准成果的修改，使对应 Review / Human Gate 失效。

例如：

- GUI 批准后相关布局被修改 → Human Gate 重新 required；
- 安装器批准后相关构建内容改变 → 重新验收；
- 仅补充无关审核文字 → 不机械重置产品验收；
- 新任务不得继承上一任务的 passed。

不要求 hash、URL、消息 ID 或 source parser。

## 9. done

只有全部满足才可以 `status: done`：

1. Sol 已重新读取当前真实成果；
2. 当前 Scope 要求的自动验证已完成；
3. Standards Review 无未解决阻塞；
4. Spec Review 无未解决阻塞；
5. 若任务明确要求独立 Reviewer，该审核已经实际完成、仍对当前成果有效，且无未关闭阻塞；
6. Human Gate 为 `not_required`，或对当前成果仍有效的 `passed`；
7. NOT_VERIFIED / BLOCKED_EVIDENCE 没有被冒充 VERIFIED；
8. 没有未授权 Git 写；
9. implementation writer 已停止，`writer: none`。

Reviewer 额度用尽不等于通过。

## 10. 模型额度 / Stop-Loss

额度调度以第 2 节固定四模型池为准：

- GPT-6.1 Sol 有额度时优先承担高价值推理与关键实现，不用它做无信息增益的批量机械工作。
- GPT-6.1 Sol 额度紧张时，把普通实现、矩阵、扫描、测试和 evidence 下放给 Gemini / DeepSeek。
- GPT-6.1 Sol 额度耗尽时，Gemini 临时承担普通主实现，DeepSeek 负责第二实现/测试/扫描；ChatGPT 保持最终 Review。
- 不允许为了“有模型可用”自动启用四模型池之外的模型。
- 第一次 CHANGES_REQUIRED 后先定位根因并扩大真实影响矩阵；同根因第二次失败且方法未改变时停止重试，改变方法后再继续。

## 11. Human Gate

Human Gate 只用于真实需要用户判断的目标，如 GUI、安装器、下载链路、动画和产品体验。

- automated PASS ≠ Human Gate；
- 任一模型或 Reviewer 的 APPROVED ≠ Human Gate；
- “继续”不自动等于通过；
- 用户表达明确时不机械重复询问；
- 模糊时针对当前成果询问；
- 相关成果改变后旧 passed 失效。

不做自然语言、URL、message/source 自动审批 parser。

## 12. Evidence

统一使用：

- VERIFIED
- INFERRED
- NOT_VERIFIED
- BLOCKED_EVIDENCE

自动测试 PASS 只证明对应自动检查。

真实 GUI、下载、安装器、Windows 原生行为等在任务要求时仍需真实环境证据。

## 13. Scope / side effects / Git

Task/STATUS 必须说明 allow、deny 和 side-effect boundary。

测试命令同样受副作用边界约束。

dirty worktree 是用户资产。未经用户明确授权，不执行任何 Git 写操作，包括 add / commit / push / merge / rebase / reset / restore / checkout 覆盖 / clean / stash / branch/tag 写入。

## 14. Legacy boundary

Phase B 已按用户授权完成。旧 AI-Bridge 3.0 runtime（tasks/controller/projection/VERSION/current-workflow、迁移期 conformance 与迁移专用 review/proposal）已从工作区清理。

旧产品 review/handoff 若仍有独立业务证据价值可保留；它们不构成当前协作状态权威。

新工作只从 `.ai-bridge/STATUS.md` 启动，不得重建旧 runtime 作为并行 authority。

## 用户可见回复格式

对于执行、审核、项目状态、验收、排障和交接类回复，ChatGPT / Sol 默认使用固定的工程回报结构；简单事实问答不强制套模板。

默认顺序必须是：

1. **结论**：第一段直接说明完成 / 未完成 / 阻塞 / 需要 Human Gate，不先复述背景。
2. **本轮完成**：只写本轮实际执行、修改、调用或确认的内容；不重复整个项目历史。
3. **验证证据**：有两个及以上 Gate 时优先用紧凑表格，记录关键命令/检查及 PASS / FAIL / NOT_VERIFIED；单一检查用短句即可。自动测试、Native/GUI 证据、Human Gate 必须分开，不得互相冒充。
4. **边界 / 风险**：只记录本轮真实存在的 Do Not Touch、未验证项、环境风险、Git/资产边界；没有实质内容时省略，不写空章节。
5. **下一步**：默认只给一个最高优先级下一步。若无需用户决策，ChatGPT 直接继续执行；只有产品范围、架构方向、风险取舍、重要依赖、平台范围、Scope 扩大、Git 写或真正 Human Gate 需要用户决定时才给选择。

模型参与说明保持短小：只有实际调用本地模型时才说明“执行：模型 / harness → 职责；Final Review：GPT-5.6 Sol”。不得罗列未参与模型，也不要把每条命令都重复标注模型。

长任务中间更新保持 1–2 句：优先报告已取得的部分结果、当前阻塞或下一执行阶段；不要逐条播报低层命令。用户未说明可操作 PC 时，不把可自动完成的步骤转成手工 Prompt。

阻塞回复固定为：**结论 → 根因 → 已确认/已尝试 → 需要的唯一解锁条件**。环境失败与产品/代码失败必须区分。

Human Gate 回复必须明确标记机器已验证、Native/GUI 已验证和 HUMAN_VERIFIED / NOT_VERIFIED；不得把截图、DOM、process smoke、agent APPROVED 或“继续”解释为人工通过。

措辞要求：短、可扫描、证据优先；避免重复背景、过度解释、多个并列“建议下一步”。除用户明确要求详细展开外，最终回复以最少信息完整交代当前状态。
