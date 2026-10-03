# Fluent / Material 系统主题研究与重构依据

> Date: 2026-09-29
> Scope: YTDL-Flow `fluent` / `material` themes
> Decision: 允许主题专属重新布局与完整视觉重构，但业务语义、任务生命周期、action availability 与可访问性合同不分叉。

## 1. Microsoft Fluent / Windows

### 官方依据

- Fluent 2 Layout: https://fluent2.microsoft.design/layout
  - 用 spacing/proximity 建立信息关系和层级，而不是依赖大量分割线。
  - elevation 应克制并表达明确层级。
- Fluent 2 Color: https://fluent2.microsoft.design/color
  - neutral / shared / brand 各自承担不同角色；大面积 surface 以 neutral 为主，品牌色有选择地用于交互重点。
- Fluent 2 Typography: https://fluent2.microsoft.design/typography
  - Windows / Fluent 使用系统字体层级；标准正文需要满足 WCAG 对比。
- Microsoft Learn NavigationView: https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview
  - NavigationView 是自适应 top-level shell；支持 Left / LeftCompact / LeftMinimal / Top，并随窗口宽度变化。
- Microsoft Learn modern WinUI 3 app structure: https://learn.microsoft.com/en-us/windows/apps/develop/ui/windows-app-sdk-app-structure
  - 推荐 TitleBar + NavigationView 的现代桌面 app silhouette，避免在页面内容内重复 app identity。

### 成熟开源实现

- Microsoft WinUI Gallery:
  https://github.com/microsoft/WinUI-Gallery/blob/main/WinUIGallery/MainWindow.xaml
  - 实际使用 MicaBackdrop、集成 TitleBar + search、NavigationView + Frame。
  - 借鉴：集成式 shell、左侧 pane 与内容区的连续关系、克制的 surface/elevation。
- Files:
  https://github.com/files-community/Files/blob/main/src/Files.App/Views/MainPage.xaml
  - 成熟 WinUI 文件管理器；TabBar、NavigationToolbar、adaptive SidebarView 与内容区域组成统一桌面 shell。
  - 借鉴：工具型桌面应用的 sidebar 不是独立浮动卡片，而是 app silhouette 的结构部分。

### YTDL-Flow Fluent 重构选择

- 左侧 Input/Operations 改为 integrated navigation/operation pane。
- 右侧任务列表成为主 content surface。
- Header 收敛为 titlebar / command surface，移除 Neo 的 4px 分割与硬阴影。
- Settings 在宽窗口改成左侧纵向导航 + 右侧内容，窄窗口回退横向 tabs。
- 使用 YTDL-Flow Petrol 作为 brand accent，而不是机械复制 Windows 默认蓝色。
- 移除自定义箭头 cursor、过量 bloom 和所有控件统一硬阴影。

## 2. Google Material 3

### 官方依据

- Material 3 in Compose:
  https://developer.android.com/develop/ui/compose/designsystems/material3
  - Material 3 明确提供 large-screen / adaptive guidance。
- Adaptive apps:
  https://developer.android.com/develop/adaptive-apps/guides/get-started-with-adaptive-apps
  - NavigationSuiteScaffold 根据窗口 size class 改变 navigation 形态。
  - SupportingPaneScaffold 在 expanded 窗口并排显示主内容与 supporting pane，在更小窗口收敛为单 pane。
- Adaptive navigation:
  https://developer.android.com/develop/adaptive-apps/guides/build-adaptive-navigation
  - navigation bar / rail / drawer 应依据窗口条件切换，而非固定一种几何。
- Supporting pane:
  https://developer.android.com/develop/adaptive-apps/guides/build-a-supporting-pane-layout
  - 主内容优先，辅助内容在大窗口作为 supporting pane 并排出现。

### 成熟开源实现

- Now in Android:
  https://github.com/android/nowinandroid/blob/main/core/designsystem/src/main/kotlin/com/google/samples/apps/nowinandroid/core/designsystem/component/Navigation.kt
  https://github.com/android/nowinandroid/blob/main/app/src/main/kotlin/com/google/samples/apps/nowinandroid/ui/NiaApp.kt
  - 使用 NavigationSuiteScaffold 与 adaptive window info 选择 nav geometry。
  - Scaffold / navigation container 保持低噪声，top app bar 只在适当层级出现。
  - 借鉴：同一业务导航合同对应不同窗口布局，而不是复制多套业务逻辑。
- Vuetify:
  https://github.com/vuetifyjs/vuetify/blob/master/packages/docs/src/examples/v-navigation-drawer/misc-combined.vue
  - 成熟 Vue Material 实现展示 rail + drawer + main content 的明确分区。
  - 借鉴：在 Vue 桌面/WebView 环境下，Material 的 navigation/surface 几何可以通过 CSS/DOM composition 实现，而不要求 Android 技术栈。

### YTDL-Flow Material 重构选择

- 任务列表作为主 content pane。
- URL/Input 操作区作为右侧 supporting pane；宽窗口并排，较窄窗口自动移到主内容前。
- 颜色从旧的 stock violet Material demo palette 改为基于 YTDL-Flow Petrol 的 Material 3 semantic roles。
- 使用 surface-container 层级、tonal container、圆角与 state layer，而不是 Neo hard shadow。
- Settings 在宽窗口使用左侧 vertical navigation，active item 使用 primary-container；窄窗口回退横向 tabs。
- 移除装饰性自定义 cursor 与持续 floating empty-state 动画。

## 3. 明确不照搬的内容

这些主题参考“布局模型与组件原则”，不复制具体应用 UI：

- 不复制 WinUI Gallery 的导航分类或搜索业务；
- 不复制 Files 的文件管理器 tab/address bar 业务；
- 不复制 Now in Android 的 Feed/Bookmarks/Interests 信息架构；
- 不复制 Vuetify demo 的 avatar/drawer 内容；
- 不引入与 YTDL-Flow 无关的页面或状态。

YTDL-Flow 继续只保留真实下载产品语义：解析、格式、队列、进度、终态、重试、取消、打开文件/目录和设置。

## 4. 实现边界

- System-theme layout overrides 独立放在 `src/styles-system-themes.css`，并在 `src/styles.css` 后载入。
- 不使用 blanket `!important`。
- 不复制任务状态机或 command handling。
- 所有主题仍渲染同一生产 Vue components。
- Fluent / Material 可改变 DOM 在视觉上的 placement，但不能改变事件绑定和 action availability。
- 必须通过现有 locale/theme/width/state browser matrices。
- 最终必须通过真实 Tauri Native Human Gate。
