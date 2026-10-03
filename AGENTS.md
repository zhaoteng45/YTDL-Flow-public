# YTDL-Flow Agent 协作规范

> **技术栈**: Tauri 2 + Vue 3 + TypeScript + Rust + yt-dlp
> **包管理器**: Bun (JavaScript) / cargo (Rust)
> **平台**: Windows 11

---

## 作用域与权威

- 本文件适用于整个仓库；子目录中的 `AGENTS.md` 可对其目录范围补充或覆盖本文件。
- 系统、开发者及执行平台的强制约束始终优先；用户当前明确要求与仍有效授权在这些约束内确定目标与操作范围。更深层 `AGENTS.md` 按目录作用域适用；Task / Spec / ADR 的职责与冲突裁决遵循项目权威，通用协作方案不得覆盖这些约束。
- 运行时事实（状态名、事件名、IPC 载荷）以 `src/types.ts`、`src/stores/appStore.ts`、`src-tauri/src/models.rs`、`src-tauri/src/lib.rs` 为准；不要复用旧文档中的废弃状态名或事件名。

## Communication

- 默认简体中文，除非用户明确要求其他语言；技术原文按需保留。仅解释影响理解且当前对话尚未明确的缩写或术语。
- 借鉴 ASD-STE100 的清晰写作思想：短句、具体名词、明确主体与因果；不声明正式合规或不可验证的合规比例。结论优先，按问题复杂度组织，不机械套模板。
- 区分事实、推断、未验证和环境无法取证；审查、验收、执行报告按需用 VERIFIED / INFERRED / NOT_VERIFIED / BLOCKED_EVIDENCE，不替代项目状态。自动测试、构建或预览不能冒充真实 GUI/native 验收。
- 清晰度优先于极端简化；保留技术条件、Scope、Do Not Touch、风险、限制、失败路径、测试证据、验收条件和未验证状态。
- 不重复询问已明确的信息或请求已有授权。项目术语、架构、安全和验收规则优先；修改约束须有当前任务明确要求或当前任务上下文中仍有效的明确授权，仅限授权范围，专项门禁仍适用。
- 生成面向人阅读的文件时，遵循简体中文阅读习惯及项目格式、字体、命名和兼容要求，检查成品中文显示与版面并披露未验证项。图片是否含字及文字语言服从任务；表达简洁不限制必要视觉细节。

## 仓库与路由

目录、脚本与依赖从实际文件读取；运行时事实入口见「作用域与权威」，跨层不变量见「运行时契约」与「编码规范」。

- 设计语言与主题：以 [DESIGN_LANGUAGE_GUIDE.md](DESIGN_LANGUAGE_GUIDE.md) 为权威；运行时支持主题以 `src/constants.ts` 的 `THEMES` / `THEME_OPTIONS` 为唯一清单。样式按 `styles.css`（共享 + 蓝宝石 / 石墨）→ `styles-system-themes.css`（Fluent / Material 基础）→ `styles-theme-experience.css`（最终体验）加载。
- 当前产品与规划：以 [PRODUCT.md](PRODUCT.md) + [CONTEXT.md](CONTEXT.md) + `.ai-bridge/STATUS.md` 为权威；历史架构迁移见 `docs/architecture/MIGRATION_HISTORY.md`，版本历史见 [CHANGELOG.md](CHANGELOG.md)。
- **固定四模型池（强制）**：只允许当前 ChatGPT / GPT-5.6 Sol High、`cliproxy/gpt-6.1-sol#medium`、`cliproxy/gemini-3.8-flash-high`、`opencode-go/deepseek-v4.1-flash`。ChatGPT 负责控制面与最终 Review；GPT-6.1 Sol medium 是优先主实现，额度紧张时只保留给关键推理/实现，额度耗尽时由 Gemini 临时承担普通主实现、DeepSeek 承担第二实现/测试/扫描。两个 Fast 用于高吞吐批量实现、矩阵、扫描、测试和 evidence。不得自动调用或 fallback 到其他模型。每次委派必须显式说明执行框架、模型、推理档、角色、任务、选择理由、额度策略、失败降级和最终 Reviewer；详细规则以 [docs/agents/chatgpt-codexpro-collaboration.md](docs/agents/chatgpt-codexpro-collaboration.md) 为权威。Jev / TypeSafe 不是执行模型，只做低风险 advisory。当前协作状态唯一入口是 `.ai-bridge/STATUS.md`。

## 流程与风险

| 规则 | 说明 |
| :--- | :--- |
| **Plan First** | 复杂任务先规划后执行，禁止直接 Vibe Coding；非简单改动先检查现状，明确目标与非目标，定义少量可观察验收标准，确定最小可验证竖切 |
| **阶段解耦** | 研究 → 规划 → 实现，每个阶段使用独立会话 |
| **契约化交付** | 预计跨越 5 次以上问答的复杂功能开发：创建 `docs/contracts/{TASK}_CONTRACT.md`，包含验收测试、行为校验、完成定义 |
| **HANDOFF** | 长任务需要开新会话时：使用 `.ai-bridge/STATUS.md` + `.ai-bridge/current-plan.md` 记录当前进度、已验证/失败方法、下一步与相关路径；完成后清理临时 handoff，不在仓库根常驻历史快照 |
| **高风险清单** | 迁移、删除、公开接口或兼容性、权限、敏感数据、不可逆变更：实施前明确目标与验收、承重假设、修改边界和验证方案；承重假设被证伪且会改变已确认边界时，停止工作并报告证据与影响 |
| **Skill 封装** | 同一操作重复 2 次以上：封装为 Skill（见「Skill 机制」） |

## 测试策略（强制）

- **行为优先 RED-first**：凡会改变用户可观察行为、公共 seam、状态机、协议、错误恢复或高风险边界的实现，必须先写或修改一个能在旧实现上失败的自动化测试/验收，再写生产代码。文档、纯配置、生成物、一次性 POC，或确实没有合理自动化 seam 的改动可例外，但交付时必须说明原因；不得把“实现已经写完”作为事后补单元测试的默认流程。
- **Failure-first**：必须隔离测试某个系统/模块时，先列出与当前范围相关的失败模式、承重不变量和恢复条件，再实现；优先把最高风险、最可证伪的失败模式编码成 RED。禁止声称已经穷举“所有可能失败方式”。
- **开发期验证**：迭代期间优先运行最窄的 unit / contract / component / integration / targeted smoke；除非当前任务本身就是 E2E harness，否则开发期间不反复运行全套 E2E。
- **阶段结束 E2E Gate**：复杂跨层功能在 tranche / release / cutover 收尾时必须至少跑一次真实 E2E / acceptance / native flow；full E2E 默认只在阶段结束或明确 Gate 时运行。E2E 必须产出可重复验证的 artifact（按场景选择机器可读报告、日志、输出文件、截图/录屏等），并记录命令、关键环境、exit code 与判定。
- **证据不互相替代**：E2E 不是 sole testing mechanism；unit/contract/integration 用于快速定位与不变量证明，native/真实 GUI/Human Gate 仍按项目门禁单独记录，一类证据不得冒充另一类。

## 运行时契约

- 下载与 sidecar 调用保持 Tauri sidecar/resources 模式，不假设用户系统 PATH 中存在运行时依赖。
- 取消与退出逻辑必须继续清理整棵进程树；实现位于 `src-tauri/src/state.rs`。
- 前端监听事件：`download-progress`、`download-debug`、`download-log`、`analysis-log`；状态机取值见 `src/types.ts`。
- 若修改 IPC 载荷，必须同步更新 `src/types.ts` 与 `src-tauri/src/models.rs`。

## 工具链

- **现代高性能工具优先（强制）**：在不违反仓库既有兼容目标和项目原生工具链的前提下，Agent/本机开发默认优先使用当前已安装且受支持的现代工具；不要因为习惯性或示例文档而退回旧工具。只有仓库明确锁定、兼容性验证、上游工具限制、用户明确要求，或已确认现代工具存在真实不兼容时才回退，并记录原因。
- **Bun 是唯一**受支持的 JavaScript 包管理器与脚本运行时：安装/脚本/测试/构建使用 `bun`，临时 CLI 使用 `bunx`；`bun.lock` 是唯一允许提交的 JavaScript 锁文件；禁止引入 pnpm/npm/yarn 流程，不使用 `npx` 替代 `bunx`。Rust 使用 `cargo add xxx` / `cargo build`。
- **PowerShell**：Agent/开发自动化默认使用 PowerShell 7 的 `pwsh`；仅在验证 Windows PowerShell 5.1 兼容性、脚本明确以 5.1 为目标运行时，或已确认 `pwsh` 不兼容时使用 `powershell.exe`。CI 使用 `pwsh` 时本地优先复现同一执行面。
- **Python**：环境、依赖、工具安装与一次性 CLI 优先使用 `uv` / `uvx`；仅在项目脚本本身要求解释器调用时直接使用 `python`。不默认使用 `pip` / `python -m venv`。
- 文件/文本搜索优先使用 `rg` / `rg --files`；Windows 软件管理优先使用 `winget`。这些是执行工具优先级，不授权新增运行时依赖，也不覆盖项目脚本和 CI 的事实来源。
- 常用开发命令以 `package.json` 的 `scripts` 为准（dev、lint、typecheck、test、tauri:dev、build、update-bins 等），此处不重复罗列；`update-bins` 负责更新 yt-dlp/ffmpeg 二进制并同步 sidecar 副本。
- 版本发布：`bun run release:prepare <新版本号>` 只处理本地版本更新、提交与 tag 准备；远程发布由 GitHub tag 触发的 workflow 负责。
- CI / release 中运行 sidecar 脚本时必须显式传入 `--target`；host fallback 仅用于本地开发/维护；当前发布工作流收敛为 Windows host -> Windows target 路径，不宣称跨目标 sidecar 打包支持。
- **CodexPro `bash`（full 模式）执行约定**：长任务显式传 `timeout_ms`（默认仅 30 秒）；重输出使用安静模式或写日志后读摘要，超预算会截断并终止进程树。执行前读取本项目 `docs/agents/codexpro-acceptance-tests.md`「执行规则」中的阈值、依据与连接器限制；不依赖父级 workspace 加载，不把被截杀当作普通命令失败。
- **CodexPro 执行面验收**：需要验证 MCP 工具面与 bash 运行时是否正常时，读取 `docs/agents/codexpro-acceptance-tests.md` 并按其逐条执行与回报。
- **CodexPro 多仓连接/恢复**：连接健康与故障恢复规则见 `docs/agents/codexpro-connectivity.md`；以 `cx status` 的四层 READY 为准，不以单纯端口/PID 为准。

## 编码规范

### Rust 后端

| 规范 | 说明 |
| :--- | :--- |
| 无 `.unwrap()` | 使用 `thiserror` + `Result<T, AppError>` 处理所有错误 |
| 异步安全 | `tokio::sync::Mutex`（await 环境）vs `std::sync::Mutex`（阻塞环境） |
| CPU 密集任务 | 使用 `spawn_blocking` 避免阻塞异步运行时 |
| IPC 命名 | 后端 `snake_case` 通过 `serde rename_all="camelCase"` 映射到前端 |

### Vue 前端

| 规范 | 说明 |
| :--- | :--- |
| Script Setup | 必须使用 `<script setup>` + 类型式 `defineProps`/`defineEmits`；`defineModel` 用于双向绑定 |
| 响应式解构 | 允许 Vue 3.5 响应式 `const { x } = defineProps<...>()`（顶层解构、禁止重赋值）；旧 `toRefs(props)` 写法不再强制 |
| 类型对齐 | `src/types.ts` 必须严格对应 `src-tauri/src/models.rs` |
| IPC 错误处理 | 所有 `invoke` 调用必须 `try/catch`，区分 Network Error 与 Business Error |
| 内存防漏 | `onUnmounted` 中必须解除 `listen()` 事件监听 |

### CSS / 设计系统

| 规范 | 说明 |
| :--- | :--- |
| CSS 变量优先 | 严禁硬编码 Hex 颜色值，使用 `var(--color-xxx)` |
| 主题隔离 | 所有样式通过 `[data-theme="..."]` 选择器隔离 |
| 多主题验证 | 修改组件后必须在 `THEME_OPTIONS` 定义的全部正式主题下验证 |
| 布局稳定性 | 空状态图标等区域使用固定尺寸容器，防止切换主题时跳动 |

> 设计系统更多细节（token、主题变体、对比度规则、三主题布局）见 [DESIGN_LANGUAGE_GUIDE.md](DESIGN_LANGUAGE_GUIDE.md)。

## 致命坑位速查

| 坑位 | 防御方案 |
| :--- | :--- |
| yt-dlp 参数错误（下载失败/格式不对） | 先执行 `yt-dlp --help` 确认参数 |
| Tauri 路径问题（文件操作失败） | 使用 `tauri-plugin-fs` API，避免硬编码路径 |
| Vue 响应式丢失（数据更新不渲染） | `ref`/`reactive` 正确声明，避免直接替换整个对象 |
| Rust 所有权（编译报错） | 使用 `clone()` 或引用，避免 move 后使用 |
| CSS 变量未定义（主题切换失效） | 检查 `[data-theme="xxx"]` 是否定义所有核心变量 |
| i18n 键缺失（显示 key 而非文本） | 同时在 `src/locales/zh-CN.json` 和 `src/locales/en-US.json` 添加 |

## 设计上下文

- **目标用户**：普通用户（非技术背景）。核心路径：粘贴 URL → 选择格式 → 下载完成，三步搞定；要求清晰进度反馈和友好错误提示，无需配置即可工作。
- **品牌关键词**：极简、高效、可靠——让用户感到"顺手"，减少认知负担，专注下载任务本身。
- **视觉风格**：蓝宝石、酒红、石墨采用独立配色与克制的表面层次；细节以 [DESIGN_LANGUAGE_GUIDE.md](DESIGN_LANGUAGE_GUIDE.md) 为权威，主题清单以 `src/constants.ts` 为准。
- **设计原则**：少即是多（默认隐藏高级选项）、清晰反馈（每步操作有明确视觉反馈）、渐进披露（高级功能如 Extra Args 默认折叠）、稳定可靠（布局稳定、状态切换无跳动）、高效直达（减少点击，核心操作触手可及）。
- **可访问性**：WCAG 2.1 AA（对比度 ≥4.5:1）、触摸目标 ≥44px、键盘导航支持、`prefers-reduced-motion` 支持。

## Skill Loading Gate（项目入口要求）

进入 YTDL-Flow 执行任何规划、实现、调试、审核或交付任务前，必须先完成 Skill Discovery：

1. 确认当前 workspace 根目录。
2. 可执行 `bun run agent:check` 快速校验环境与 Skill 库存。
3. 读取本文件、`skills-lock.json` 与 `docs/agents/skill-routing.md`。
4. 扫描 `.agents/skills/<name>/SKILL.md`，确认当前可用 Skill。
5. 读取 `.ai-bridge/STATUS.md` 获取当前 Task / Status / Writer / Human Gate，并从正文 `Workflow:` 槽位获取主 Skill；STATUS 是唯一当前协作状态入口。旧 AI-Bridge 3.0 runtime 已清理；STATUS 缺失或无效时停止并修复当前上下文，不得根据历史对话或旧文件猜测当前授权。

完成 Discovery 后按 [docs/agents/skill-routing.md](docs/agents/skill-routing.md) 选择主 Skill 与必要的辅助 Skill；先读取被选中的 `SKILL.md`，支持材料按其中的任务条件加载。

禁止：

- 未执行 Skill Discovery 前声称项目不存在某 Skill。
- 构建、测试或类型报错时擅自留在 UI/CSS workflow 盲目重试。
- 仅根据当前会话已出现的 Skill 判断项目 Skill 全量。

## Skill 机制

- 项目 Skill 位于 `.agents/skills/<name>/SKILL.md`（ID 取目录名；OpenCode V2 标准发现路径，优先级高于兼容路径 `.claude/skills`）。**OpenCode V2（`opencode2`）**自动发现并注册为交互式斜杠命令 `/name`；V1（`opencode`）仅对模型可见、不注册斜杠命令。
- frontmatter 必须包含 `name` 与 `description`，否则不暴露给模型；`slash: false` 可隐藏命令；V2 用 `metadata.opencode/autoinvoke: false` 从模型发现中移除模型自动调用（V1 对应字段为 `disable-model-invocation`）。
- ⚠️ 严禁在 `.agents/skills/` 根目录放置散落 `.md` 文件——会被误注册为假 skill 或与同名目录产生 ID 冲突。
- 新增/修改 skill 后需重启 TUI 会话生效。
- 当前已安装 Matt Pocock 工程 skill 包、设计类 skill（impeccable、ui-ux-pro-max）及输出风格 skill（i-have-adhd），统一安装于 `.agents/skills/`，记录见 `skills-lock.json`；技能文件与 lock 均入库，不再忽略 `.agents/`。
- 推荐封装：`download-test`（测试下载流程）、`theme-add`（添加新主题）、`bin-update`（更新 yt-dlp/ffmpeg 二进制）。

## Agent skills

### Issue tracker

Issues 与规格以 markdown 文件形式存放于 `.scratch/<feature-slug>/`。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个标准 triage 角色标签，与默认字符串一致（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：仓库根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

## 文件修改与交付

| 操作 | 工具 |
| :--- | :--- |
| 读取文件 | Read |
| 修改文件 | Edit（优先）/ Write（重写） |
| 创建文件 | Write |
| 搜索代码 | Grep / Glob |
| 系统命令 | Shell |

- 代码引用格式：`[文件名:行号](路径#L 行号)`，如 [`App.vue:42`](src/App.vue#L42)；路径使用正斜杠 `/`。
- 完成度以实际运行、测试和最终交付物为准；交付时报告已执行检查、覆盖范围、结果、未验证项和残余风险；未满足验收标准时继续处理任务范围内的问题并重新验证。
- 不得新增未经用户提供或确认的凭据，也不得把完整凭据复制到回复、日志、截图、测试产物或新文档。
- OpenCode V1/V2 与不同客户端是不同执行面；涉及配置、登录态、模型、MCP、插件、命令、权限或 UI 而用户未指明执行面时，先确认目标。

---

*最后更新：2026-09-30 - 运行时主题以 src/constants.ts 的 THEMES / THEME_OPTIONS 为准；样式按 shared + 蓝宝石 / 石墨、Fluent / Material foundations、final theme experience 三层组织。*
