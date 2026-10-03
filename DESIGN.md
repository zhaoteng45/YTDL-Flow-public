---
name: YTDL-Flow
description: Mature desktop media downloader with three independent theme palettes
colors:
  primary: "#2457A7"
  primary-hover: "#1C468B"
  secondary: "#E6ECF5"
  secondary-hover: "#DCE7F8"
  accent: "#16386E"
  surface: "#F6F8FC"
  background: "#E2E8F1"
  border: "#CED7E5"
  shadow: "rgba(32, 33, 36, 0.12)"
  text: "#243047"
  text-muted: "#58667B"
  success: "#166534"
  warning: "#854D0E"
  error: "#B4232C"
typography:
  display:
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: 1.8rem
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: 1.4rem
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: 1.1rem
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: 0.95rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace"
    fontSize: 0.85rem
    fontWeight: 600
    lineHeight: 1.4
  scale:
    hero: 3.4rem
    brand: 2.25rem
    display: 1.8rem
    icon-lg: 1.6rem
    heading-lg: 1.5rem
    headline: 1.4rem
    highlight: 1.3rem
    subtitle: 1.2rem
    title: 1.1rem
    base: 1.0rem
    body: 0.95rem
    body-sm: 0.9rem
    label: 0.85rem
    caption: 0.8rem
    micro: 0.72rem
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
  card-base:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 16px
  input-base:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
---

# YTDL-Flow 设计入口

[DESIGN_LANGUAGE_GUIDE.md](DESIGN_LANGUAGE_GUIDE.md) 是当前视觉与交互规则的唯一权威。本文保留设计工具需要的默认主题元数据，不再维护第二套布局、动效和组件规范；元数据不覆盖生产 CSS 或正式主题指南。

- 正式主题、中文名称及持久化 ID：`src/constants.ts` 的 `THEMES` / `THEME_OPTIONS`。
- Token、构图、密度、任务详情、Settings、日志、动效与无障碍要求：直接读取设计指南对应章节。
- 任务状态与动作：`packages/contracts/src/current-task.ts`、`src/application/taskPresentation.ts`、`src/components/downloadList.helpers.ts`，不得从旧设计示例推导业务状态。
- 产品范围：`PRODUCT.md` / `CONTEXT.md`；不因历史原型新增已退休的批量、历史库或播放列表功能。

## 验证入口

组件变化验证所有正式主题与两种语言，运行 `bun run test:ui-matrix`；格式、片段和诊断交互另运行 `bun run test:ui-download-list` 对应矩阵及 `bun scripts/run-download-list-quality.mjs`。重要视觉变化检查真实组件截图。Windows/Tauri 原生交互与 Human Gate 单独记录，浏览器或自动测试不能替代。
