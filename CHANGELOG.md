# 📝 Changelog

All notable changes to this project will be documented in this file.

## [3.1.11] - 2026-10-09

- YouTube 使用单一首选浏览器或 Cookies 文件，移除备用文件入口和自动回退，保留历史任务及用户原文件。
- 拒绝无效、过期或错域的 Cookies 文件时保留现有有效首选，失败提示不暴露原始异常或凭证内容。
- 任务展示实际凭证来源与失败原因；新设置不改变已有任务冻结的来源。
- 排队下载前检查被冻结的 Cookies 文件，失效时阻止启动并引导重新解析。
- 收紧构建清理范围，避免影响无关临时凭证和进程。

## [3.1.10] - 2026-10-05

- 首页增加 YouTube 浏览器登录状态、Cookies 文件导入和哔哩哔哩扫码登录入口。
- 分别显示网站连接状态，长文件名省略，悬停或键盘聚焦显示完整路径。
- 网站入口使用各自的官方品牌色，适配三个主题与窄窗口。
- 区分文件占用、权限不足和解密失败，通用复制失败不再误报为浏览器使用中。
- 简化首页和登录设置文案；保存凭证不再表述为已验证账号登录。
- 压缩短窗口首页留白，修复登录入口超出首屏的问题。
- 精简公开仓库中的内部设计与协作资料，增加首页连接和浏览器状态的 CI 界面检查。

## [3.1.8] - 2026-10-04

- 石墨改为完整深色界面，采用炭灰层次和低饱和雾蓝强调；保留已保存的主题偏好。
- 主题按钮与菜单名称独立居中，修复石墨选择按钮的颜色配对。
- 精简常驻键盘提示、搜索和解析按钮文案，保留快捷键行为。
- 强化视频尺寸标签，统一打开文件夹与下载按钮的主题主色，改善开关选中标记对比度。
- 核对处理日志并记录重复请求等提速机会，本次未改下载流程。

## [3.1.7] - 2026-10-04

- 推送版本标签后自动构建、测试并公开 Windows MSI 安装包，无需签名证书或逐次人工确认。
- 安装、升级、下载或附件哈希检查失败时停止发布；已公开版本不覆盖。
- 修正发行流程误调用本地代理状态检查的问题，保留全部产品源码检查。
- 修复原生发行测试与启动工具健康检查的资源竞争，测试开始前预留工具使用权并保持至结束。
- 修正草稿查询接口，完整上传并核对附件后自动公开，支持继续未完成的草稿上传。
- 未签名安装包使用手动更新，隐藏应用内自动更新入口；发行页提供校验值、测试记录和第三方资料核查进度。

## [3.1.3] - 2026-10-04

- 最佳画质下优先选择分辨率，再考虑编码偏好，修复保存的编码设置可能导致选择低分辨率格式的问题。
- 下载日志显示实际格式排序，便于核对画质选择。
- CI 验收通过后提供测试安装包下载；正式发布保留签名、第三方资料和人工验收门槛。

## [3.1.2] - 2026-10-04

- 统一三个主题的操作栏位置，调整大窗口布局，并压缩短窗口的辅助说明区。
- 放大首页 Logo，居中显示主题名称；Cookies 标题、状态和文件名分行展示。
- 将粘贴和清空按钮移至链接编辑区下方，修复输入空间被按钮挤占的问题。
- 减轻任务卡片边框；竖屏视频使用完整尺寸显示检测结果。

## [3.1.1] - 2026-10-03

- 任务卡片默认精简展示；来源格式、下载片段与尝试诊断集中在独立任务详情，日志可单独展开。
- 蓝宝石、酒红、石墨加强画布与内容面的层次，保留独立主色与中文主题名称。
- 三主题同步收紧卡片间距，弱化元数据胶囊，保留错误恢复和下载操作。

## [3.1.0] - 2026-10-03

- 下载失败按原因提供凭证、目录、重新分析或重试操作；请求限流和 DRM 提供明确说明。
- Cookies 文件检查结构、有效期和站点范围，区分已导入与登录已验证。
- 详细日志提供单次尝试的实际客户端、凭证方式、格式、退出码和脱敏失败原因。
- 音视频分流分别记录传输阶段，合并与转换单独显示；完成前检查实际非空文件。
- 可选字幕失败后尝试继续下载媒体，保留客户端与任务选项，并显示字幕未交付提示。
- 每个普通任务支持实际来源格式选择和起止时间；保留不同帧率、编码及音轨语言。

## [3.0.4] - 2026-10-03

- 修复原生分析结果转换丢失 SMART 客户端决策，下载与重试正确沿用分析客户端及 Cookie 策略。
- 下载在启动前或运行后失败时，详细日志显示脱敏终态错误，即使后端没有输出日志事件。

## [3.0.3] - 2026-10-03

- 首页主题选择器与下拉菜单直接显示中文名称：蓝宝石、酒红、石墨。

## [3.0.2] - 2026-10-03

- Fluent Wine 替换旧朱橙配色：深酒红主色、暖象牙画布与深炭灰文字。
- 保留 `fluent` 持久化 ID；已有 Fluent 偏好在升级后使用新配色，无需清空配置。

## [3.0.1] - 2026-10-03

- 三主题采用独立配色：Clean Sapphire 蓝宝石与瓷白、Fluent Vermilion 朱橙与象牙白、Graphite Ink 石墨深色顶栏与清蓝选择态。
- 调整画布、内容表面和辅助文字，降低泛白感；保留主题 ID、已有偏好与共用状态语义。

## [3.0.0] - Unreleased

- SMART 改为顺序客户端能力扫描，返回可用格式 inventory、检测上限与客户端决定；下载和重试沿用 winner。
- 按 client 处理 YouTube Cookie；失效 Cookie 可匿名重析，需要登录的内容明确要求刷新 Cookie。
- Bun-first 保持不变；版本 warning 不触发运行时 fallback，实际 challenge failure 单独归类。
- 新配置最佳画质默认使用自动编码；保留旧编码设置并提供显式切回自动的入口。
- 系统健康检查区分正常工具占用和真实检查失败；Material 主题采用白底、石墨和清紫蓝。
- 日志导出脱敏 Cookie 临时路径和用户 profile；分辨率提示区分当前检测能力与源上限。

发布仍需完成最终自动验证、MSI/install-trust/process smoke、独立审核及 Native Human Gate。

## [2.0.1] - 2026-09-09

### 🚀 全栈依赖升级（Upgrade）

- **Rust / Tauri**: `tauri` 2.10.3 → 2.11.5，`tauri-build` 2.6.3，`wry` 0.55.1，`tao` 0.35.3，`tokio` 1.53.1；dialog / fs / notification / shell 插件同步升级
- **前端**: `vite` 6.4.2 → **8.2.2**（Rolldown 引擎，生产构建 < 1s），`@vitejs/plugin-vue` 6.0.8，`vitest` 4.1.11，`pinia` 4.0.3，`vue` 3.5.42，`vue-i18n` 11.4.10，`@vueuse/core` 14.4.0，`@tauri-apps/api` 2.11.1，`typescript` 5.8.3
- Vite 8 手动分包：`vendor`（vue/pinia/vue-i18n/@vueuse）与 `qrcode` 独立 chunk

### ✨ 新功能（Features）

- **Windows 任务栏原生进度条**：多任务加权聚合（100ms 节流），支持正常/不确定/错误三种状态，退出自动清除
- **音频格式下载**：新增 MP3 / FLAC / M4A / Opus 提取，任务卡显示音频格式徽章
- **浏览器 Cookies 一键接入**：`check_browser_and_pot` 同时校验浏览器登录态与 PO Token 引擎（rustypipe-botguard + 插件目录自动发现，随安装包分发）
- **JSON Cookies 自动转换**：识别 JSON Cookie 文件并转换为 Netscape 格式，按内容哈希命名临时文件，避免并发任务相互覆盖
- **媒体库归档选项**：`--write-thumbnail`（自动转通用 jpg 封面）与 `--write-info-json`（完整元数据）
- **Dark 主题**：新增暗色主题，并在未手动选择过主题时自动跟随系统 `prefers-color-scheme`
- **下载列表大改版**：状态分组（进行中/等待/失败/完成）、即时搜索、状态筛选、批量选择/批量下载/批量删除、误删撤销（4 秒缓冲）、键盘导航（`J`/`K`/`Space`/`/`）、队列摘要与并发占用显示
- **智能模式扩展**：YouTube 客户端竞速扩展至 web/android/ios/mweb/tv，失败时聚合各客户端错误详情

### 🔧 改进（Improvements）

- 排队任务支持 `overrideArgs` 与 `selectedFormat` 覆盖，批量格式切换不覆盖单独定制的任务
- 设置面板新增媒体归档区、下载历史统计（bun:sqlite）、Cookies/PO Token 状态展示
- 历史脚本与流媒体脚本类型收紧（去除 `any`），`streamer.ts` 改用 `Bun.file`

### 🎨 界面与可访问性（UI / A11y）

- 全部弹窗升级焦点陷阱 + `aria-modal` + 背景惰性化（inert），关闭后焦点归还触发按钮
- 语义色 token 化：新增 `--color-on-warning` 等 token，13 个主题文字对比度满足 WCAG AA
- 图标统一为矢量 `NeoIcon` 组件，移除结构性 emoji
- 补齐 25+ 组缺失的 i18n 键（zh-CN / en-US 完全同步），修复界面直接显示 key 的问题
- 新增动效全面支持 `prefers-reduced-motion`

### 🐛 修复（Fixes）

- 修复 Cookies 临时文件固定文件名导致的并发下载相互覆盖
- 修复暗色主题下危险/警告按钮文字对比度不足（3.9:1 / 2.2:1 → 达标）
- 修复 `Space` 全局快捷键与已聚焦按钮的双触发
- 修复筛选状态条误用 tab 语义（无 tabpanel），改为标准切换按钮（`aria-pressed`）

## [2.0.0] - 2026-04-18

### 🚀 Major: Bun Toolchain Migration (工具链重大升级)

- **Package Manager**: 从 `pnpm` 迁移到 `Bun 1.3.12` 作为唯一包管理器与脚本运行时
- **Lockfile**: 删除 `pnpm-lock.yaml` / `package-lock.json`，新增 `bun.lock`
- **Scripts**: 所有 `node scripts/*.mjs` 改为 `bun scripts/*.mjs`
- **CI/Release**: GitHub Actions 全面迁移到 Bun，显式 sidecar target contract

### 🔧 Command Surface (命令界面重构)

- **New Commands**:
  - `bun run dev` — 前端开发
  - `bun run tauri:dev` — Tauri 开发（含 dev-port）
  - `bun run tauri:build` — Tauri 打包（不含 dev-port）
  - `bun run build:web` — 前端构建
  - `bun run release:prepare <version>` — 本地版本准备
- **Removed**: `pnpm tauri`, `pnpm release` 等旧命令

### 📦 Dependencies Update (依赖更新)

- `vue` → 3.5.32
- `vue-i18n` → 11.3.2
- `vite` → 6.4.2
- `typescript-eslint` → 8.58.2
- `@types/node` → 25.6.0

### 🛠️ Sidecar (二进制更新)

- `deno` → 2.7.12 (2.7.7 → 2.7.12)
- `yt-dlp` → 2026.03.17 (stable)
- `ffmpeg/ffprobe` → 8.0.1

### 🔍 TypeScript Improvements (类型改进)

- Pinia 访问模式优化：`toRefs(store)` → `computed(() => unref(store.xxx))`
- 消除 `any` 类型：`audio.ts`, `tauri.ts`, `main.ts`
- 新增验证测试：toolchain hooks, sidecar contract

### 📚 Documentation (文档更新)

- `AGENTS.md`, `README.md`, `frontend-design-guidelines.md` 全面更新为 Bun 命令

## [1.5.3] - 2026-02-26

### 🐛 Fixes (修复)

- **Critical: Metadata Error Handling (元数据错误处理)**:
  - 修复了 `download.rs` 中 `!status.code.unwrap_or(1) == 0` 的逻辑 Bug。按位取反导致错误处理分支永远不执行，`LOGIN_REQUIRED` 等错误在 `Terminated` 事件中被静默忽略。
- **Theme Constants (主题常量)**:
  - 补全了 `constants.ts` 中缺失的 `NATURAL_TAUPE` 和 `NATURAL_OLIVE` 主题常量。此前 CSS / ThemeSelector / App.vue 均已使用，但 THEMES 对象遗漏导致 `THEME_OPTIONS` 中 `value` 为 `undefined`。
- **Memory Leak (内存泄漏)**:
  - 修复了 `SettingsPanel.vue` 中 B 站二维码轮询定时器 (`setInterval`) 在组件销毁时未清理的问题，添加了 `onUnmounted` 钩子。

### 🔧 Project Rules (项目规则优化)

- 将 `app_rules.md` 和 `DESIGN_SYSTEM.md` 同步至 `.agents/rules/` 目录，确保 AI Agent 自动加载领域约束。
- 新增 `role_switch_protocol.md`，从 41KB 的角色方法论中蒸馏出可执行的触发时机与自审问句。
- 在可控执行协议中新增 **阶段 2.5（Judge）**：修复前先判断"规则要求"是否真的优于"当前实现"，防止机械性合规修改。

## [1.5.2] - 2026-02-11

### 🐛 Fixes & Improvements (修复与优化)
- **Input Workflow (输入流程)**:
  - 修复了文件导入 (`Import`) 绕过自动解析的问题，现在导入包含链接的文本文件会直接添加到任务列表。
- **Layout Stability (布局稳定性)**:
  - 修复了空状态图标 (`.empty-icon`) 在不同主题切换时的像素级跳动问题，增强了视觉稳定性。
- **UX Polish (体验优化)**:
  - 新增任务列表自动滚动功能：当添加新任务时，列表会自动滚动到顶部，确保最新任务可见。

## [1.5.1] - 2026-02-04

### 🎨 Visual & Layout (视觉与布局)
- **Layout Stability (布局稳定性)**:
  - 彻底修复了切换主题时的界面跳动问题。
  - 为所有 9 个主题（包括 Light, Codex, Morandi, Deep Cyber, Fluent, Material, Pokemon, Ping Pong, Paper Plane）的空状态图标添加了固定容器和绝对定位约束。
- **Theme Consistency (一致性)**:
  - **Pokemon Theme**: 移除了按钮的强制高度限制，使其与其他主题尺寸保持一致。
  - **Operation Panel**: 统一了各主题操作面板按钮的视觉规范。

## [1.5.0] - 2026-02-02

### 🎨 Theme Deep Optimization (主题深度进化)
- **Pokemon Theme (Gotta Catch 'Em All!)**:
  - **Pokedex Sidebar**: 侧边栏重构为红白机图鉴风格，增加蓝色玻璃镜头（Lens）装饰。
  - **GameBoy Inputs**: 输入框采用复古液晶屏（LCD）样式，绿色背光 + 像素字体。
  - **HP Bar Progress**: 进度条模拟游戏血条（HP Bar），随进度从红变绿。
- **Ping Pong Theme (Pro Match)**:
  - **Scoreboard Sidebar**: 侧边栏模拟记分牌材质，增加 LED 风格头部装饰。
  - **3D Floating Buttons**: 按钮采用径向渐变模拟真实乒乓球立体感，增加悬浮交互。
  - **Table Surface Inputs**: 输入框模拟球台蓝底白线设计。
  - **Visibility Fix**: 修复了版本号 Badge 在蓝色背景下的对比度问题。
- **Paper Plane Theme**:
  - 完善了主题名称本地化 ("纸飞机") 和空状态文案 ("蓝天已净空，准备起飞")。

### 🌍 Localization (国际化)
- **Theme Selector**: 修复了主题选择器中显示硬编码英文的问题，现在正确显示本地化名称。

## [1.4.0] - 2026-02-01

### 🎨 Visual & Theme (视觉与主题)
- **Ping Pong Pro Match Theme**:
  - 新增 **"专业赛场 (Pro Match)"** 乒乓球主题，采用国际赛场标准配色（台面蓝 #1A3A5F + 竞技橙 #FF8200）。
  - **球台隐喻**: 输入框背景增加“球台中线”设计，顶部导航栏增加“球网”分割线。
  - **拟物化交互**: 开关模拟乒乓球拨动效果，进度条模拟球桌纹理。
  - **专属图标系统**: 定制了 SVG 运动包（保存位置）、白色乒乓球（解析按钮）、能量棒（Cookies）和致敬徽章。
  - **动感反馈**: 按钮增加点击回弹效果，输入框增加呼吸灯光效。

### 🔧 Design System (设计系统)
- **Theme Definition of Done**: 建立了严格的主题验收标准，涵盖语义完整性、隐喻一致性和视觉可用性（AA级对比度）。
- **Project Rules**: 优化了 `.trae/rules` 规范，强化了 UI/UX 负责人的设计隐喻职责。

## [1.3.2] - 2026-01-31

### 🎨 UX Improvements (体验优化)
- **Pokemon Theme Polish**:
  - 深度优化了 Pokemon 主题的视觉体验，修复了图标重复问题。
  - 为设置面板的 Toggle 开关和 Checkbox 增加了 Neo-Brutalism 风格样式。
  - 增强了文件名预览框的视觉效果（Pokedex 风格）。
  - 为 Cookies 选项添加了专属的 **Eevee (伊布)** 图标。
- **Settings Panel**:
  - 优化了 "字幕语言" 选项的布局，避免换行问题。
  - 提升了模板输入框的文字对比度和可读性。

### 🧹 Maintenance (维护)
- **Resource Cleanup**:
  - 清理了未使用的 SVG 资源文件（logo.svg, vue.svg 等）和冗余素材目录，减小了项目体积。

## [1.3.1] - 2026-01-30

### 🚀 Features (功能特性)
- **Theme System 2.0**:
  - 新增 **6 套深度定制主题**：Neo-Brutalism (默认砖红), Codex (古籍), Morandi (莫兰迪), Cyber (赛博), Fluent (Win11), Material (M3)。
  - 每个主题拥有独立的边框纹理、光影效果和交互反馈。
- **Smart Download Defaults**:
  - 默认输出格式调整为 **MKV**，支持无损封装视频流、音频流、字幕和封面。
  - 自动开启 **Embed Subtitles** 和 **Embed Thumbnail**，输出单文件。
- **Internationalization**:
  - 完善了中文路径支持，修复了 Windows 下 GBK/UTF-8 编码导致的日志乱码问题。

### 🎨 UX Improvements (体验优化)
- **Visual Overhaul**:
  - 全新设计的 "Brick Red" (砖红) 默认主题，采用新粗野主义设计语言。
  - 重构了所有核心组件 (`InputSection`, `DownloadList`, `SettingsPanel`) 以完美继承主题样式。
- **Performance**:
  - 优化了日志系统的渲染性能，使用等宽字体并移除了多余的空状态占位符。

---

## [1.2.0] - 2026-01-20

### 🚀 Features (功能特性)
- **YouTube Login Redesign**: 
  - 采用了与 Bilibili 一致的模态框交互设计，统一了用户体验。
  - 新增 **"⚡ 自动匹配"** 功能，一键扫描所有已安装浏览器，自动验证 YouTube Cookies 有效性。
  - 移除了繁琐的手动浏览器选择下拉框，改为智能检测。
- **In-App Guides**:
  - 在设置面板中集成了 Cookies 获取的图文步骤指南（Get cookies.txt LOCALLY），无需跳转外部文档。

### 🐛 Fixes (修复与优化)
- **Error Handling**: 
  - 针对 Windows DPAPI 加密错误（`Failed to decrypt`）增加了友好的中文提示和解决方案。
  - 针对浏览器文件锁定（`database is locked`）增加了具体的“关闭浏览器”引导。
- **System**:
  - 修复了 `yt-dlp` 命令在某些环境下因缺少 URL 参数报错的问题（增加了 `--simulate` 和 Dummy URL）。
  - 优化了版本号检查脚本。

### 🧹 Chores (杂项)
- 升级项目版本号至 `1.2.0`。
- 清理了设置面板中未使用的变量。

---

## [1.1.2] - Previous Release
- Initial stable release with basic YouTube and Bilibili support.
