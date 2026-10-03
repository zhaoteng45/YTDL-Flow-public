# YTDL-Flow Refined Neo-Brutalism 视觉规范

> Status: approved direction
> Scope: YTDL-Flow desktop UI themes and high-visibility components
> Source of truth: `src/styles.css` semantic tokens + `docs/frontend-design-guidelines.md` interaction rules
> Native validation: required

## 1. 定位

YTDL-Flow 的主视觉采用一套“收敛后的新粗放主义（Refined Neo-Brutalism）”。

它保留 Neo-Brutalism 的结构辨识度与物理反馈：

- 明确边框；
- 零模糊硬阴影；
- 清晰层级；
- 强操作反馈；
- 直接、诚实的数字材料感。

同时主动削弱传统粗放主义容易出现的视觉噪音：

- 不依赖高饱和紫色、亮蓝色或大面积黄色制造“潮流感”；
- 不让硬阴影成为第二个主色块；
- 不把每一个控件都做成强边框 + 强阴影；
- 不用状态色承担纯装饰职责；
- 不用过量纹理、渐变、光晕破坏桌面工具的信息效率。

目标关键词：

**个性 / 柔和 / 现代 / 高级 / 耐看 / 桌面工具感**

## 2. 已批准的基准主题：Petrol Sage H3

当前视觉基准由原内部主题 ID `cobalt-butter` 承载。保留旧 ID 仅为了兼容已有本地主题偏好；用户可见名称为 **Petrol Sage / 深青柔灰**。

### 2.1 核心色板

| Token | 值 | 角色 |
| --- | --- | --- |
| `--color-bg` | `#EEF2F2` | 中性雾灰背景，无明显黄调 |
| `--color-surface` | `#FBFCFC` | 主卡片/面板表面 |
| `--color-bg-alt` | `#E2E9E8` | 次级表面 |
| `--color-text` | `#172322` | 深墨青正文/结构色 |
| `--color-text-muted` | `#666F6B` | 辅助文本；相对 `#EEF2F2` / `#FBFCFC` 均满足 4.5:1 AA 基线 |
| `--color-primary` | `#176B75` | Petrol 主色 |
| `--color-primary-hover` | `#125761` | 主操作 Hover |
| `--color-secondary` | `#8C9B95` | 柔灰绿次级色 |
| `--color-accent` | `#667871` | H3 柔灰绿硬阴影/重点装饰 |
| `--color-border` | `#172322` | 结构边框 |
| `--color-shadow` | `#172322` | 普通结构硬阴影 |
| `--color-success` | `#4F7C6A` | 成功语义 |
| `--color-error` | `#B9554D` | 错误语义 |

### 2.2 H3 的关键决定

Petrol 主按钮与 CTA 的颜色保持 `#176B75`，但 CTA 的强化硬阴影使用 `#667871`。

这是“V1 的稳重 + V4 的柔和”的最终收敛：

- 比纯墨灰更柔；
- 比浅灰绿更有结构；
- 与 Petrol 同属于低饱和冷中性色家族；
- 避免奶黄/土黄在大面积按钮下方形成脏色；
- 不抢主按钮本身的视觉焦点。

## 3. 结构语言

### 3.1 Surface 层级

继续遵循三级 Surface，不因主题改变业务层级：

- **Level A**：应用主要容器、任务卡、Modal。允许 2–3px 结构边框和明显硬阴影。
- **Level B**：工具栏、分组、Popover。边框保留，阴影弱化。
- **Level C**：metadata、chip、ghost action。原则上无硬阴影。

一个局部区域只允许一个主要 Level A。

### 3.2 硬阴影

硬阴影是结构，不是彩色装饰。

规则：

- Blur 固定为 `0`；
- 方向统一右下；
- 普通结构优先使用 `--color-shadow`；
- 仅主 CTA 可使用主题 `--color-accent` 作为强化硬阴影；
- Hover 可增加 1–2px 位移/阴影距离；
- Active 向右下压回，模拟物理按压；
- 禁止再使用高饱和黄、亮蓝、亮粉作为大面积 CTA 阴影，除非该主题的专项设计明确通过 Human Gate。

### 3.3 边框

边框承担信息分区。

- Level A：2–3px；
- Level B：1.5–2px；
- Level C：1–1.5px 或无边框；
- 默认不使用纯黑，优先深墨色；
- 状态完成卡不应整卡变成成功绿边框，成功状态由 badge / icon / progress 等语义元素表达。

### 3.4 圆角

新粗放主义不是“所有东西必须直角”。

Petrol Sage 基线：

- small: 6px；
- medium: 11px；
- large: 15px。

原则：圆角用于降低视觉攻击性；结构感仍由边框与硬阴影提供。

## 4. 色彩原则

### 4.1 主色

主色必须能承担：

- 主 CTA；
- 进度；
- Focus/Caret；
- 当前选中状态；
- 少量品牌识别。

不要求每个主题都使用蓝色。优先低饱和、有灰度、适合长时间观看的颜色。

### 4.2 背景

默认避免：

- 明显奶黄；
- 大面积纯白；
- 强冷青灰；
- 彩度高的整页背景。

推荐：

- 雾灰；
- 石灰；
- 灰绿；
- 暖中性灰。

### 4.3 Accent

Accent 的面积必须小于 Primary。

Accent 可用于：

- CTA 硬阴影；
- 小型选择状态；
- 少量图形；
- 局部品牌强调。

Accent 不应用于：

- 整卡边框；
- 所有滚动条、所有按钮、所有输入框同时着色；
- success/error/warning 的业务语义替代。

## 5. 纹理与装饰

背景纹理只负责“近看有质感，远看像纯色”。

要求：

- 低对比度；
- 低不透明度；
- 不与文字形成摩尔纹；
- 不影响 Native WebView 下的可读性；
- 不把主题身份建立在纹理本身上。

Petrol Sage 使用极淡 Petrol + Sage 网格，而不是黄蓝双色纹理。

## 6. 品牌图标与主题的关系

App Icon 的**形状固定，颜色可适配**。

系统级位置：

- Windows 标题栏；
- 任务栏；
- 开始菜单；
- 安装器；
- 桌面快捷方式；

使用固定品牌主图标，不随主题频繁变更。

应用内可提供同形异色变体，但不得改变核心图形几何。

## 7. 其他主题的迭代方法

其他主题可以按同一方向进行一轮升级，但“同一方向”指统一设计原则，不是把所有主题都变成 Petrol。

每个主题依次检查五个轴：

1. **Hue Identity**：主题仍然是谁，保留其独有色相身份。
2. **Background Temperature**：去掉脏黄、刺眼白、过冷底色。
3. **Shadow Discipline**：硬阴影改为低饱和同族色或深墨色。
4. **Surface Hierarchy**：Level A/B/C 拉开，不让所有组件同样抢眼。
5. **Semantic Integrity**：success/error/warning 与装饰色严格分离。

## 8. 推荐迭代分组

### 第一组：现代主力主题

优先处理：

- `light`
- `blue-coral`
- `teal-butter`
- `dark`

目标：统一为 Refined Neo-Brutalism 的主力家族。

建议方向：

| 当前主题 | 迭代方向 | 核心目标 |
| --- | --- | --- |
| light | Stone / Graphite Neo | 去紫、去亮黄，建立中性默认基线 |
| cobalt-butter | Petrol Sage H3 | 已批准并实施 |
| blue-coral | Coral Slate | 保留珊瑚个性，降低电蓝比重 |
| teal-butter | Eucalyptus Mist | 保留青绿，但去大面积奶黄 |
| dark | Graphite Petrol | 深石墨 + Petrol，避免霓虹化 |

### 第二组：柔和自然主题

- `morandi`
- `natural_taupe`
- `natural_olive`

目标：进一步提升柔和、自然、长期使用舒适度，但仍保留清晰结构。

### 第三组：强身份主题

- `codex`
- `cyber`
- `pokemon`
- `pingpong`
- `paper-plane`

这些主题不应被“Petrol 化”。只统一：

- 信息层级；
- 对比度；
- CTA 语义；
- 阴影纪律；
- 圆角/间距一致性。

视觉身份本身保留。

### 第四组：设计体系映射主题

- `fluent`
- `material`

它们本质上是在 YTDL-Flow 中映射成熟外部设计体系，因此**不受 Refined Neo 的几何约束**。允许根据 Microsoft Fluent / Windows 与 Google Material 3 的官方布局模型进行主题专属 UI 重排甚至完整视觉重构，例如 Navigation Pane、Supporting Pane、Top App Bar、纵向 Settings Navigation 和断点自适应。

约束只有一条：外观与布局可以不同，业务语义不能分叉。任务生命周期、action availability、数据所有权、键盘/可访问性交互继续共用同一套产品合同。实现应隔离在系统主题 stylesheet，并同时参考官方设计文档与成熟开源实现，而不是把通用 Neo DOM 的每个盒子机械换色。

## 9. 迭代验收

每次主题迭代必须至少验证：

- zh-CN / en-US；
- 所有主要任务状态；
- 360 / 519 / 719 / 960 / 1280 宽度；
- primary/default + hover 的 WCAG AA 对比；
- keyboard focus；
- dropdown/menu；
- InputSection；
- DownloadList；
- SettingsPanel；
- App Shell；
- Native Tauri 窗口。

自动门禁与 Native Human Gate 分开记录。

## 10. Do / Don't

### Do

- 用低饱和颜色建立高级感；
- 用深墨色而不是纯黑作为结构色；
- 用硬阴影表达物理层级；
- 用少量 Accent 建立个性；
- 让内容比装饰更重要；
- 保留每个主题自己的色相故事。

### Don't

- 不再默认依赖紫 + 黄、蓝 + 黄组合；
- 不使用“土黄”作为主按钮的大面积硬阴影；
- 不把所有主题改成同一套青绿色；
- 不用主题 CSS 改变任务语义或操作可用性；
- 不为了视觉效果降低信息密度或可访问性；
- 不以 Web 截图替代 Native Human Gate。

## 11. 当前正式基线

截至 2026-09-29：

- Refined Neo-Brutalism 方向已获用户批准；
- Petrol Sage H3 为首个正式基准色板；
- `cobalt-butter` 仅作为兼容旧存储值的内部主题 ID；
- 其他主题可按本文档的“五轴迭代法”逐组升级；
- 每组先原型/对比，再进入生产主题，避免一次性重绘 15 个主题导致视觉判断失焦。
