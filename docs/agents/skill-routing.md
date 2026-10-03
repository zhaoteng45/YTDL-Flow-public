# YTDL-Flow Skill Routing & 工作流分发

## 目的

定义任务类型与症状到 Skill Workflow 的强制入口规则，杜绝依赖模型记忆或会话历史猜测可用 Skill。

## 启动流程（Project Initialization Gate）

在进入 YTDL-Flow 执行任何代码编写、调试、设计或重构前：

1. 确认 workspace 根目录处于 `YTDL-Flow`。
2. 读取 `AGENTS.md`。
3. 读取 `skills-lock.json` 与扫描 `.agents/skills/`。
4. 根据当前任务类型查阅本路由表，确定 **主 Skill** 与 **辅助 Skill**。
5. 读取 `.ai-bridge/STATUS.md` 作为唯一当前协作状态入口；主 Workflow 取 STATUS 正文独立的 `Workflow:` 槽位。STATUS 缺失或格式错误时停止并修复当前上下文，不得回退到旧 `.ai-bridge/tasks/active`、controller 或 `current-workflow.md`。
6. 对高频“谁执行 / 是否升级 / 证据是否足够”的语义判断，可运行 `bun run agent:jev`；Jev 只提供概率化建议，`AGENTS.md`、本路由表、STATUS、Single Writer、GPT-6/Human Gate 硬规则始终优先。详见 `docs/agents/jev-routing.md`。未配置 `TYPESAFE_API_KEY` 时安全回退到 Sol，不得因此阻塞本地开发。

---

## 全景任务路由表

| 问题类型 / 现场症状 | 首选 Skill | 辅助 Skill | 严禁行为 |
| :--- | :--- | :--- | :--- |
| **AI 语义判断 / 结构化决策** | **`typesafe-ai`** | `codebase-design` | 按技能读取当前在线文档；保持已授权产品范围 |
| **构建 / 编译失败**<br>（如 `tauri build` 报错、`cargo build` 错误、Vite 打包异常） | **`diagnosing-bugs`** | `ask-matt`, `code-review` | ❌ 严禁继续进行 UI/CSS 调整<br>❌ 严禁盲目修改配置重试 |
| **测试失败 / 类型报错**<br>（如 `vitest` 挂掉、`vue-tsc` 报类型不匹配） | **`diagnosing-bugs`** | `tdd`, `code-review` | ❌ 严禁直接使用 `// @ts-ignore` 或 `any`<br>❌ 严禁跳过测试交付 |
| **运行时 Bug / 状态异常**<br>（如 yt-dlp 4K 降级、进程树泄露、下载卡死） | **`diagnosing-bugs`** | `codebase-design` | ❌ 严禁无复现证据就乱写代码（Vibe Debugging） |
| **架构调整 / 模块重构**<br>（如 IPC 通信改造、多下载引擎抽象、状态库重构） | **`codebase-design`** | `domain-modeling`, `ask-matt` | ❌ 严禁未划定清晰 seam 就进行全局改写 |
| **UI 原型 / 交互设计**<br>（如新抽屉设计、主题系统扩展、动效优化） | **`prototype`** | `ui-ux-pro-max`, `impeccable`, `emil-design-eng` | ❌ 严禁脱离 `DESIGN_LANGUAGE_GUIDE.md` 自由发挥 |
| **代码审核 / 门禁收敛**<br>（如阶段交付、PR 准备、发布前检查） | **`code-review`** | `grill-with-docs` | ❌ 严禁未经单测和真实编译就宣称通过 |
| **需求模糊 / 分支发散**<br>（如用户指令意图不清、功能边界未定） | **`to-spec`** | `to-questionnaire`, `wizard` | ❌ 严禁擅自猜测用户未授权的底层设计 |
| **长会话交接 / 换人协作**<br>（如会话过长上下文压缩、跨环境交接） | **`handoff`** | `wait-what` | ❌ 严禁丢弃历史排查证据和未完成任务 |

---

## 典型故障应对范例

### 场景：`tauri build` 或 CI 构建失败
1. 立即停止任何 UI/样式调整工作；
2. 激活 **`diagnosing-bugs`**；
3. 执行：
   - 提取完整错误日志，定位确切报错行与参数来源（例如寻找未知参数注入）；
   - 建立最小复现实验；
   - 形成根因假设并验证；
   - 实施最小修改；
   - 重新执行完整构建门禁；
4. 切换至 **`code-review`** 校验修改范围，确保没有破坏其他配置。

---

## 验收口径分类

记录与交付结果时，必须明确区分证据等级：

- **VERIFIED**：通过真实终端命令、单测或构建执行直接证明（附命令与退出码）。
- **INFERRED**：有代码逻辑推导支持，但因当前环境限制尚未做最终系统级全链路运行。
- **NOT_VERIFIED**：尚未验证项，必须在交付时披露为残余风险。
