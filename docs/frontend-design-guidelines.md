# YTDL-Flow 前端设计与验收准则

## 1. 适用范围

本准则用于 YTDL-Flow 的高可见前端工作，包括：

- `src/App.vue`
- `src/components/InputSection.vue`
- `src/components/DownloadList.vue`
- `src/components/SettingsPanel.vue`
- 主题、菜单、状态、空状态、错误恢复和桌面交互反馈

YTDL-Flow 是 **Vue 3 + Tauri 2 原生桌面应用**。纯 Web/Vite 只是开发和自动化验收表面，不是最终产品权威。

## 2. Skill 路由

涉及明显视觉重构、页面/面板、主题或交互层级时：

1. 先读取 `AGENTS.md` 和 `docs/agents/skill-routing.md`；
2. 主路由使用 `prototype`；
3. 需要专项审查时可结合：
   - `ui-ux-pro-max`
   - `impeccable`
   - `emil-design-eng`
4. 最终仍由真实仓库代码、自动门禁和 Native Human Gate 裁决。

不要把设计 Skill 当成可以覆盖产品/架构事实的权威。

## 3. 当前设计权威

高可见 UI 修改前至少读取：

- `PRODUCT.md`
- `DESIGN.md`
- `src/constants.ts`
- `src/styles.css`
- 目标 Vue 组件
- `src/locales/zh-CN.json`
- `src/locales/en-US.json`
- `packages/contracts/src/current-task.ts`
- `src/application/taskPresentation.ts`

可参考：

- `docs/reference/refined-neo-brutalism-style-guide.md`（当前已批准的新粗放主义视觉方向与主题迭代方法）
- `docs/reference/fluent-material-system-theme-research.md`（Fluent / Material 官方文档与成熟开源实现依据）
- `docs/reference/工具型UI设计语言参考.md`

不要引用不存在的旧文档作为权威。

## 4. 产品级设计约束

### 4.1 内容优先

任务列表的视觉优先级：

1. 媒体缩略图/音频身份
2. 标题
3. 作者、时长、分辨率/音频格式
4. 任务状态
5. 主操作
6. 日志与其它次级操作

边框、阴影、主题装饰不能比媒体内容更抢眼。

### 4.2 三级 Surface

遵循 `DESIGN.md`：

- Level A：一级容器/任务卡/Modal，可使用强边框和硬阴影；
- Level B：分组/工具栏/Popover，弱化阴影；
- Level C：metadata chip / ghost action，不使用硬阴影。

一个局部区域只允许一个主要 Level A。

### 4.3 状态色必须语义正确

- `analyzing` / `processing` 是 busy，不等于 warning；
- warning/error/success 色只能表达真实状态；
- 视频/音频可使用低强度 soft surface 区分，但不能伪装系统状态。

### 4.4 主题可以改变表现与布局，但不能改变业务语义

多主题体系必须保留。普通配色主题优先只改变：

- semantic tokens
- 字体/阴影/圆角个性
- 非业务性的装饰

对于明确映射成熟外部设计体系的主题（当前为 `fluent` / `material`），允许根据该体系的官方布局模型重构桌面 UI，包括：

- 主内容与 supporting pane / navigation pane 的左右关系
- Settings 的横向 tab 与纵向导航之间切换
- Surface / app bar / modal / card 的组成与几何
- 断点下的 rail / pane / single-column 自适应

即使完全重排视觉层级，也不得通过主题改变：

- action 层级与业务含义
- task state / lifecycle
- action availability
- 数据与命令所有权
- 键盘可达性、44px 点击目标和 Escape 等既有交互合同

主题专属布局应集中在隔离的 theme stylesheet 中，避免 blanket `!important`。任何主题布局特例都必须经过真实组件状态矩阵与 Native Human Gate。

### 4.5 桌面可操作性优先

不得为了视觉效果削弱：

- 信息密度
- 44px 基本点击目标
- 键盘导航
- Escape 关闭 transient UI
- 文件/剪贴板/通知等真实 Tauri 流程

## 5. 状态和动作来源

不得从 UI 自行发明任务状态。

Canonical lifecycle：

- `packages/contracts/src/current-task.ts`

Presentation：

- `src/application/taskPresentation.ts`

UI 应尽量从单一 presentation helper 派生：

- visual state
- primary action
- overflow actions

避免 trigger 和 menu item 各自维护一套重复 boolean 条件。

## 6. UI 自动验收

### 6.1 Unit / Static

Vitest 继续用于：

- helper
- application contract
- narrow source/static invariants

但源码 regex 测试不能作为唯一视觉证据。

### 6.2 Real Component State Matrix

高可见 `DownloadList` 修改必须运行：

```powershell
bun run test:ui-matrix
```

该门禁真实挂载生产 `DownloadList.vue`，当前要求覆盖：

- zh-CN / en-US
- `src/constants.ts` 中全部主题
- 360 / 519 / 719 / 960 / 1280
- analyzing
- analyzed
- queued
- pending
- downloading
- processing
- completed
- analysis error
- download error
- cancelled error
- video / audio
- long metadata
- zero / one / multiple overflow actions
- logs open / closed
- format menu keyboard/Escape
- overflow 与横向布局

如果新增新的生产状态/主要交互，需要同步扩展这个矩阵。

### 6.3 Full Gate

相关实现完成后至少运行：

```powershell
bun run test:ui-matrix
bun run test
bun run typecheck
bun run build:web
bun run lint
bun run agent:check
git diff --check
```

Rust 未修改时不需要仅为 UI 改动重复全量 Rust。

## 7. Native Human Gate

以下改动即使 Web QA 全部通过，也必须在 `bun run tauri:dev` 下看真实窗口：

- 高可见任务卡/输入区/设置面板
- 菜单/Popover
- 主题视觉
- Native WebView 下的 CSS cascade
- 文件、剪贴板、通知等 Tauri 相关交互

建议在结构改动后的第一轮就进行 Native spot-check，不要等所有 Web 主题矩阵做完后才首次看真实窗口。

Human Gate 与自动门禁分开记录。

## 8. 动效

动效只用于反馈。

- 优先明确写 `background-color / transform / box-shadow / opacity` 等具体属性；
- 避免 `transition: all`；
- 常见交互约 100–180ms；
- 无限动画仅用于真实活跃状态；
- `prefers-reduced-motion: reduce` 下必须停用非必要连续动画。

## 9. 调用模板

```md
请基于 YTDL-Flow 当前真实前端优化 <目标组件>。

先读取：
- PRODUCT.md
- DESIGN.md
- 目标组件
- src/constants.ts
- src/styles.css
- zh-CN/en-US locale
- packages/contracts/src/current-task.ts
- src/application/taskPresentation.ts

约束：
- 这是 Vue 3 + Tauri 2 桌面应用，不是营销页。
- 内容优先，避免卡套卡和等权重硬阴影。
- 保留全部主题和双语。
- 状态色必须对应真实语义。
- Theme 不得改变 action/state 语义。
- 不恢复已退役的 batch/playlist UI。
- 不碰 Resource Capture，除非任务明确要求。

验收：
- bun run test:ui-matrix
- bun run test
- bun run typecheck
- bun run build:web
- bun run lint
- Native Tauri Human Gate
```

## 10. 禁止事项

- 不要以 Web mock 代替 Native Human Gate。
- 不要只靠源码 regex 证明布局正确。
- 不要为了“Neo”让每层都成为重阴影卡片。
- 不要渲染空菜单/空 Popover。
- 不要让主题 CSS 静默覆盖组件语义 variant。
- 不要自行回流已废弃的批量、playlist、旧状态术语。
