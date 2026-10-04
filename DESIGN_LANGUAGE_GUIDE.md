# YTDL-Flow Design Language System

## 主题与权威

正式主题仅三套：默认 蓝宝石（兼容 ID material）、酒红（fluent）、石墨（兼容 ID cobalt-butter）。运行时清单唯一出处是 src/constants.ts 的 THEMES / THEME_OPTIONS。已有合法持久化 ID 必须保留；无合法偏好时回退 material。三者共享业务状态、动作与设置模型，样式不得改变下载、凭据或任务语义。

样式加载层：src/styles.css 负责默认 Sapphire、Graphite 配色与共享语义 token；src/styles-system-themes.css 负责 Fluent Wine 配色与 Fluent / Clean 兼容别名；src/styles-theme-experience.css 负责最终组件角色映射、密度与 Empty / Active 构图。组件引用变量，不重复定义品牌/状态字面颜色。

## 品牌与构图

Header 使用 src-tauri/icons/source/ytdl-flow-primary.svg 正式 play / flow / download 图形。Logo 为品牌中心，产品名是小型 wordmark，版本是 metadata；禁止巨型品牌 Banner、emoji 或临时占位图。

Empty 围绕 Compose / Start，Active 围绕任务管理。data-workspace-state 由 canonical row count 投影，不能靠 CSS 推断业务状态。默认 Empty 桌面首屏完整展示输入、解析、保存位置、Cookies 和流程区；通过真实排版控制高度，禁止用 overflow clipping 掩盖内容。

| 主题 | Empty | Active | 材料与字形 |
| --- | --- | --- | --- |
| 石墨 | 左 Composer + 右流程说明；窄屏堆叠 | 350px 左操作栏 + 主任务区 | 深色中性石墨、雾蓝动作强调、分隔线与字重优先；完整工作表面随主题变暗 |
| 酒红 | 左 Composer + 右流程说明；窄屏堆叠 | 350px 左操作栏 + 主任务区 | opaque 中性层、Windows 密度、小/中圆角、精确边框；无壁纸渐变 |
| 蓝宝石 | 左 Composer + 右流程说明；窄屏堆叠 | 350px 左操作栏 + 主任务区 | 柔和圆角、普通标题为正文色；CTA 承载品牌强调 |

## 逻辑窗口与 DPI

物理分辨率不是 CSS viewport：3840×2160 @300% 约为 1280×720 逻辑桌面，还需扣除 Windows 标题栏与任务栏。布局以实际内容区 CSS px 为准，不根据 DPR 成比例缩放控件。

- Compact ≤980px：Empty 的 Composer 在前、辅助流程 ribbon 在后；Active 采用浅命令条 + 主任务区，任务区独立滚动。
- Medium 981–1439px：三主题共用 Composer 在左、说明在右的起始构图。Active 保留左操作栏与右任务区，切换主题不移动操作位置。
- Wide ≥1440px：Empty 有界，Active 使用余下空间承载任务；不把宽屏空态拉成巨型空白卡。
- Short ≤740px：减少面板 padding、textarea 高度和辅助信息占用；保留 44px 目标与 Logo。≤620px Clean 的辅助说明收起，但流程与核心控件保留。
- Regular 741–899px：常规排版预算。Tall ≥900px 且 Wide：增加顶部呼吸空间，不放大控件。

首页宽度上限为 1680 CSS px，外层工作区上限为 1800px；以 1920×1080 和 2560×1440 逻辑窗口回归验证，避免旧 1060–1240px 上限造成内容过度收窄。Header Logo 常规 56px，短窗口 44px。活动区预留 104px：Header 64px、容器上下 padding 24px、顶部间隔 12px 与边框余量 4px。链接按钮位于编辑区下方，保持 44px 点击目标；Cookies 标题、状态和文件名分行。短且窄的空首页收起说明区重复粘贴按钮，编辑区粘贴操作始终保留。
- Settings 导航始终可用，内容局部滚动；Logs ≤min(340px, 38dvh)，长日志不拖长页面。禁止以整页 overflow:hidden 裁控件。

三套主题采用独立配色。Sapphire primary / hover / pressed 为 #2457A7 / #1C468B / #16386E，selected #DCE7F8。Wine 为 #843D4B / #71313E / #5E2633，selected #EBD4D9。Ink 为 #B8CCE8 / #D0DEF0 / #A4BCDC，selected #28384B 与 #D0DEF0 文字，进度 #B8CCE8；深色顶栏 #202328、控件 #292D33、前景 #EDF0F4、焦点 #B8CCE8。Ink 主按钮前景 #172537，其他主题为 #FFFFFF。品牌 Logo 保留正式原始颜色，不随主题变色。placeholder 不通过 opacity 降低 AA 对比度。

## Token 与层次

主题级字面颜色集中在 :root[data-theme] token 定义。组件只引用语义变量：--color-*、--md-sys-color-*、--theme-*。背景、线条、正文、危险动作和 console 使用各自角色，禁止在组件规则散落 Hex。主 CTA、focus 和真实状态有明确语义；保存位置次级，Cookies 三级。

普通产品表面只有 Canvas / Surface / Surface Subtle 三个语义角色。Sapphire：#E2E8F1 / #F6F8FC / #E6ECF5；Wine：#E7E0D8 / #FAF7F2 / #EAE3DD；Ink：#17191D / #202328 / #292D33。各主题正文、辅助文字和边界来自对应 neutral token，避免共享纯白背景抹掉主题差异。

正文、辅助文字、placeholder 对比度至少 4.5:1，大号文字至少 3:1。交互边界若承担可识别控件的唯一作用须满足 3:1；装饰分隔线不能冒充交互边界。普通持久卡片无或极轻阴影，瞬态菜单/模态可提升。主 Pane 不使用 backdrop blur，不按 DOM 嵌套增加灰度。

语义状态只定义一次（bg / border / text / strong）：Success #EFFAF3 / #B7DEC5 / #166534 / #1F7A45；Warning #FFF8E6 / #E5C76B / #854D0E / #A15C00；Danger #FFF1F2 / #EAB9BF / #B4232C / #C93636；Info #EFF6FF / #BDD3F0 / #245493 / #2563B8。Busy 有独立名称但引用 Info，不能作为 Warning/Error。Disabled #F2F3F5 / #D7DBE1 / #606A7A。状态保留文字/图标，不仅靠颜色。

字体层级分 Display / Title / Section / Body / Caption。以 Segoe UI / system 保持桌面可读性；技术值与日志才使用 monospace，进度与时间使用 tabular numerals。按钮不强制全大写。

## 控件与 Settings

使用既有 Vue / NeoIcon / .neo-* 组件；44px 最小交互目标、可见键盘 focus、原生惯用输入行为。主题切换只调用 store，不直接绕过持久化策略。

Settings 保留 General / Format / Advanced / Tools；宽窗口使用导航 rail 和两列分组，窄容器恢复导航与单列。Modal、导航与内容使用主题 Surface；普通 setting group 透明，以标题、间距和分隔线分组；tool row 同表面，仅 helper/status 区用 Surface Subtle 或语义底色。禁止灰盒套灰盒。Clean 普通 section heading 不用品牌紫；Empty Composer 不用大块薰衣草色。高级选项渐进披露，字段与 backend 参数保持现有契约。

普通 secondary button 使用主题 Surface / 正文 / Strong Border 配对；hover 与 pressed 使用 Surface Subtle。通过组件 foreground/background token 修复对比度，不全局替换 body text。

## 任务详情与密度

任务默认展示媒体信息、状态、进度与主要动作。来源格式和片段时间放在独立任务详情区，默认收起；尝试诊断使用同一区域切换展示。日志保留直接入口，并且与任务详情独立开合。运行中或已完成的任务只展示可用诊断，不呈现可编辑下载设置。详情采用 Surface Subtle 与任务 Surface 区分，不增加浮层或模态。桌面卡片收紧 padding 与信息分组，窄容器沿用既有堆叠布局与 44px 控件目标。

## 日志

Dark console 与普通任务卡有明确差别，局部滚动且文本可选。时间戳、级别、正文分层；copy、command reveal、admin mode 与敏感信息脱敏保持现有语义。避免实时日志上的大面积 blur、阴影或布局动画。

## Motion 与性能

fast 110ms / standard 160ms / spatial 220ms，沿用既有 ease token。只有操作触发 motion：focus、CTA 按压、popover、Settings、logs、modal；真实任务进度可呈现状态动画。禁止持续装饰 floating / breathing / pulse、全屏 theme fade、transition: all、width / height / top / left / margin 动画。减少动态效果时移除空间运动。

不增加 JS animation library 或大图片。CSS / Vite bundle 与上一轮基线比较；浏览器 layout / paint containment 不等于 Native 帧率已验证。

## 验收

所有正式主题运行相同 Input / DownloadList / Settings 语义矩阵；Empty / Active 在关键桌面宽高组合验真实 geometry 和截图。自动、浏览器、Windows/Tauri Native Human Gate 分开报告，前两者不能代替 Native acceptance。

## 普通用户界面精简

快捷键保留行为，不常驻展示 J/K/Space/Del 说明；解析按钮与搜索框不嵌入快捷键文案。主题按钮和选项采用等宽首尾图标列，文字以控件实际中心居中，不能仅以 text-align 代替几何验收。打开文件夹与下载均为当前主动作，使用主题 Primary；Success 只用于完成状态和进度。视频尺寸标签显示“视频 · 尺寸”，使用 Selected 配对；不能把检测尺寸宣称为最终文件尺寸。设置开关的已选滑块使用 on-primary，避免深色滑块在品牌色底上不明显。石墨参考 Radix 中性灰角色、低饱和雾蓝强调；兼容主题 ID 不变，未新增依赖。
