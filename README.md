# YTDL-Flow

> 当前公开仓库提供 3.1.1 源码预览，以新的初始提交开始。尚未提供本仓库的正式安装包；安装包许可证、签名及原生验收仍待完成。

<div align="center">

**简洁、高效、可靠的视频下载工具**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-blue)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3-green)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-stable-orange)](https://rust-lang.org)

[English](#english) · [简体中文](#简体中文)

</div>

---

## 简体中文

### 📖 简介

YTDL-Flow 是一款面向普通用户的视频下载工具，让你只需三步即可下载喜欢的视频：

1. **粘贴 URL** → 2. **选择格式** → 3. **下载完成**

基于 `yt-dlp` 和 `ffmpeg` 构建，提供直观的图形界面，无需理解复杂的命令行参数。

### ✨ 特性

- **极简操作** - 粘贴链接即可自动解析，无需手动配置
- **多格式支持** - 支持 MP4、WebM、MP3 等多种格式
- **多平台下载** - 支持 YouTube、Bilibili 等主流视频网站
- **实时进度** - 清晰的下载进度和状态反馈
- **串行任务队列** - 可加入多个任务，按 FIFO 顺序执行；任一时刻只运行 1 个下载
- **独立主题配色** - 克制的表面层次、清晰的操作与状态反馈
- **三主题支持** - 蓝宝石、酒红、石墨；首页直接显示中文名称
- **i18n 国际化** - 支持简体中文和英文界面

### 🚀 快速开始

#### 系统要求

| 系统 | 要求 |
|------|------|
| Windows | 当前验证环境为 Windows 11 x64；Windows 10 尚未完成验证 |
| macOS / Linux | 尚未验证；当前发布工具链仅支持 Windows host → Windows target |

#### 安装

1. 查看 [Releases](https://github.com/zhaoteng45/YTDL-Flow-public/releases) 中实际发布的版本及说明；源码版本不等于已发布安装包版本
2. 当前源码为 3.1.1，仍处于测试阶段；真实安装、升级、卸载及原生下载验收尚未全部完成
3. 仅安装已核对版本与来源的 Windows 安装包；macOS / Linux 暂不提供支持承诺

#### 使用示例

```
1. 复制视频链接 (如 https://www.youtube.com/watch?v=...)
2. 粘贴到输入框
3. 选择视频质量（1080p / 720p / 仅音频等）
4. 点击「下载」
5. 等待完成，点击「打开文件夹」查看
```

### 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Pinia |
| UI | 自定义多主题设计系统 |
| 后端 | Rust + Tauri 2 |
| 核心 | yt-dlp + ffmpeg |
| 构建 | Bun + Cargo |

### 📦 开发指南

#### 环境准备

```bash
# 安装 Bun 1.4.2（packageManager 锁定版本）
# 安装 Rust (最新稳定版)
```

#### 克隆项目

```bash
git clone https://github.com/zhaoteng45/YTDL-Flow-public.git
cd YTDL-Flow
bun install --frozen-lockfile
```

#### 开发模式

```bash
# 安装依赖
bun install --frozen-lockfile

# 前端开发
bun run dev

# 前端构建
bun run build:web

# 代码检查
bun run lint
bun run typecheck
bun run test

# Tauri 开发模式（完整应用）
bun run tauri:dev
```

#### 构建发布

```bash
# 完整本地构建校验
bun run build

# 直接打包 Tauri 应用
bun run tauri:build

# 更新依赖二进制 (yt-dlp/ffmpeg)
bun run update-bins

# 本地版本号/标签准备辅助命令
bun run release:prepare <version>
```

#### 工具链约定

- Bun 是唯一受支持的 JavaScript 包管理器与脚本运行时
- `bun.lock` 是唯一提交到仓库的 JavaScript 锁文件
- `release:prepare` 只用于本地版本号、提交与标签准备；远程发布由 GitHub 的 tag 工作流执行
- CI 和 release 中调用 sidecar 脚本时必须显式传入 `--target`；仅本地开发或维护场景才允许 host fallback
- 当前 sidecar 打包支持保持保守策略，不宣称跨目标打包；当前受支持的发布路径是 Windows host -> Windows target

#### 常用命令清单

```bash
bun install --frozen-lockfile
bun run dev
bun run build
bun run build:web
bun run lint
bun run typecheck
bun run test
bun run tauri:dev
bun run tauri:build
bun run release:prepare <version>
bun run update-bins
```

#### 添加新主题

1. 在 `src/constants.ts` 的 `THEMES` 对象中添加新主题
2. 在 `src/styles.css` 中添加对应的 CSS 变量
3. 重启应用即可在设置中看到新主题

### 📁 项目结构

```
YTDL-Flow/
├── src/                    # Vue 3 前端
│   ├── components/         # 可复用组件
│   ├── stores/             # Pinia 状态管理
│   ├── locales/            # i18n 翻译
│   ├── utils/              # 工具函数
│   ├── App.vue             # 主应用
│   └── styles.css          # 全局样式
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── commands/       # Tauri 命令
│   │   ├── services/       # 业务逻辑
│   │   ├── notification/   # 通知系统
│   │   ├── lib.rs          # 模块导出
│   │   └── main.rs         # 入口
│   └── tauri.conf.json     # Tauri 配置
├── docs/                   # 项目文档
├── scripts/                # 构建脚本
└── package.json
```

### 🔧 配置说明

#### 下载设置

| 选项 | 说明 |
|------|------|
| 分片并发 | 单个下载内的并发分片数（默认：4）；任务队列仍为单槽 FIFO |
| 下载路径 | 视频保存位置 |
| 格式偏好 | 默认视频/音频格式选择 |
| 代理设置 | 配置 HTTP/HTTPS 代理 |

### ❓ 常见问题

#### 下载失败怎么办？

1. 检查网络连接
2. 确认 URL 格式正确
3. 尝试更新 yt-dlp（设置 → 更新依赖）
4. 查看详细错误信息

#### 支持播放列表/批量生命周期吗？

当前不提供播放列表实体或批量生命周期。多行输入只会把每个有效 HTTP(S) URL 去重后创建为独立任务，并进入同一单槽 FIFO 队列。

#### 支持哪些网站？

基于 yt-dlp，支持 [数百个网站](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)，包括：
- YouTube
- Bilibili
- Twitter/X
- Instagram
- TikTok
- 等

### 🤝 贡献

欢迎贡献代码！请参阅 [贡献指南](CONTRIBUTING.md) 了解更多。

### 📄 许可证

项目原创源码采用 MIT License，详见 [LICENSE](LICENSE)。第三方源码、开发技能及随包工具保留各自许可证，见 [第三方声明](THIRD_PARTY_NOTICES.md)。

---

## English

### 📖 Introduction

YTDL-Flow is a user-friendly video download tool that lets you download videos in just three steps:

1. **Paste URL** → 2. **Select Format** → 3. **Download Done**

Built on `yt-dlp` and `ffmpeg`, it provides an intuitive GUI without requiring knowledge of complex command-line arguments.

### ✨ Features

- **Simple Operation** - Auto-parsing on paste, no manual configuration needed
- **Multiple Formats** - MP4, WebM, MP3, and more
- **Multi-Platform** - YouTube, Bilibili, and other major video sites
- **Real-time Progress** - Clear download progress and status feedback
- **Serial Task Queue** - Add multiple tasks; one download runs at a time in FIFO order
- **Distinct Palettes** - Restrained surfaces with clear actions and status feedback
- **Three Themes** - 蓝宝石 (Sapphire), 酒红 (Wine), 石墨 (Graphite); the selector displays Chinese names
- **i18n Internationalization** - Chinese and English interface

### 🚀 Quick Start

#### System Requirements

| System | Requirements |
|--------|--------------|
| Windows | Validated environment: Windows 11 x64; Windows 10 remains unverified |
| macOS / Linux | Unverified; the release toolchain currently supports Windows host → Windows target only |

#### Installation

1. Check the versions and notes actually available in [Releases](https://github.com/zhaoteng45/YTDL-Flow-public/releases); the source version is not necessarily a published installer version
2. Source version 3.1.1 is in testing; real installation, upgrade, uninstall and native download acceptance are not all complete
3. Verify the version and source of Windows installers; macOS and Linux support is not currently promised

### 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue 3 + TypeScript + Pinia |
| UI | Custom Multi-Theme Design System |
| Backend | Rust + Tauri 2 |
| Core | yt-dlp + ffmpeg |
| Build | Bun + Cargo |

### 📦 Development

#### Prerequisites

```bash
# Install Bun 1.4.2 (the packageManager-pinned version)
# Install Rust (latest stable)
```

#### Clone

```bash
git clone https://github.com/zhaoteng45/YTDL-Flow-public.git
cd YTDL-Flow
bun install --frozen-lockfile
```

#### Development Mode

```bash
# Install dependencies
bun install --frozen-lockfile

# Frontend development
bun run dev

# Frontend build
bun run build:web

# Verification
bun run lint
bun run typecheck
bun run test

# Tauri development (full app)
bun run tauri:dev
```

#### Build Release

```bash
# Full local build verification
bun run build

# Direct Tauri packaging
bun run tauri:build

# Update bundled binaries
bun run update-bins

# Local-only version/tag preparation helper
bun run release:prepare <version>
```

#### Toolchain Contract

- Bun is the only supported JavaScript package manager and runtime.
- `bun.lock` is the only committed JavaScript lockfile.
- `release:prepare` only prepares local version bumps, commit, and tag creation; remote publishing is handled by the GitHub tagged workflow.
- CI and release jobs must pass an explicit `--target` to sidecar scripts; host fallback is only for local development or maintenance.
- Sidecar packaging support remains conservative and host-only today; the supported release path is Windows host -> Windows target.

#### Common Commands

```bash
bun install --frozen-lockfile
bun run dev
bun run build
bun run build:web
bun run lint
bun run typecheck
bun run test
bun run tauri:dev
bun run tauri:build
bun run release:prepare <version>
bun run update-bins
```

### 📄 License

Original project source is licensed under MIT; see [LICENSE](LICENSE). Third-party source, development skills and bundled tools retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).

---

<div align="center">

**Made with ❤️ by zhaoteng45**

</div>
