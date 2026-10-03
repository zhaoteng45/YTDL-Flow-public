# GitHub Release Template

> 用于创建 GitHub Release 时的参考内容

---

## Version: v0.1.0

### Release Title
```
YTDL-Flow v0.1.0 - First Public Release
```

---

## Release Notes (English)

```markdown
## 🎉 First Public Release

YTDL-Flow is a sleek, Neo-Brutalism styled video downloader built with Tauri 2 + Vue 3 + Rust. Simple, fast, and beautiful.

### ✨ Features

- **Simple 3-Step Download**: Paste URL → Select Format → Download
- **Multi-Platform Support**: YouTube, Bilibili, and 1000+ sites via yt-dlp
- **Real-time Progress**: Live download progress with speed and ETA
- **Multiple URLs, Serial Queue**: Add independent video URLs and download them one at a time in FIFO order
- **Smart Format Selection**: Choose quality from available formats
- **11 Beautiful Themes**: Neo-Brutalism default + 10 additional themes
- **System Notifications**: Get notified when downloads complete
- **Lightweight**: Native desktop app, no browser bloat

### 🚀 Getting Started

1. Download the installer for your platform from Assets below
2. Run the installer (Windows: `.msi`, macOS: `.dmg`, Linux: `.AppImage`)
3. Launch YTDL-Flow and start downloading!

### 📋 System Requirements

- **Windows**: Windows 10/11 (64-bit)
- **macOS**: macOS 11+ (Apple Silicon & Intel)
- **Linux**: Ubuntu 20.04+ or equivalent

### 📦 Assets

| File | Platform | Description |
|------|----------|-------------|
| `YTDL-Flow_0.1.0_x64_en-US.msi` | Windows x64 | Windows Installer |
| `YTDL-Flow_0.1.0_aarch64.dmg` | macOS Apple Silicon | macOS Disk Image |
| `YTDL-Flow_0.1.0_x64.dmg` | macOS Intel | macOS Disk Image |
| `YTDL-Flow_0.1.0_amd64.AppImage` | Linux x64 | Linux AppImage |

### 🛠️ Tech Stack

- **Frontend**: Vue 3 + TypeScript + Vite
- **Backend**: Rust + Tauri 2
- **Download Engine**: yt-dlp
- **Styling**: Neo-Brutalism CSS

### 🐛 Known Issues

- First launch may take longer as yt-dlp binary is extracted
- Some antivirus software may flag the app initially (false positive)

### 🔒 Security

This release has been cleaned of all sensitive data. The repository is now safe for public access.

---

**Full Changelog**: https://github.com/zhaoteng45/YTDL-Flow-public/commits/v0.1.0
```

---

## Release Notes (中文)

```markdown
## 🎉 首次公开发布

YTDL-Flow 是一款基于 Tauri 2 + Vue 3 + Rust 构建的新粗野主义风格视频下载器。简单、快速、美观。

### ✨ 功能特性

- **三步下载**：粘贴链接 → 选择格式 → 下载完成
- **多平台支持**：YouTube、Bilibili 及 1000+ 网站（通过 yt-dlp）
- **实时进度**：实时显示下载进度、速度和预计时间
- **多链接串行队列**：添加多个独立视频链接，按 FIFO 顺序一次下载一个
- **智能格式选择**：从可用格式中选择最佳质量
- **11 种精美主题**：新粗野主义默认主题 + 10 种额外主题
- **系统通知**：下载完成后接收通知
- **轻量级**：原生桌面应用，无浏览器臃肿

### 🚀 快速开始

1. 从下方 Assets 下载适合你平台的安装包
2. 运行安装程序（Windows: `.msi`，macOS: `.dmg`，Linux: `.AppImage`)
3. 启动 YTDL-Flow 开始下载！

### 📋 系统要求

- **Windows**: Windows 10/11 (64位)
- **macOS**: macOS 11+ (Apple Silicon 和 Intel)
- **Linux**: Ubuntu 20.04+ 或同等发行版

### 📦 安装包

| 文件 | 平台 | 说明 |
|------|------|------|
| `YTDL-Flow_0.1.0_x64_en-US.msi` | Windows x64 | Windows 安装包 |
| `YTDL-Flow_0.1.0_aarch64.dmg` | macOS Apple Silicon | macOS 磁盘镜像 |
| `YTDL-Flow_0.1.0_x64.dmg` | macOS Intel | macOS 磁盘镜像 |
| `YTDL-Flow_0.1.0_amd64.AppImage` | Linux x64 | Linux AppImage |

### 🛠️ 技术栈

- **前端**: Vue 3 + TypeScript + Vite
- **后端**: Rust + Tauri 2
- **下载引擎**: yt-dlp
- **样式**: 新粗野主义 CSS

### 🐛 已知问题

- 首次启动可能较慢，因为需要解压 yt-dlp 二进制文件
- 部分杀毒软件可能会误报（误报）

### 🔒 安全说明

此版本已清理所有敏感数据。仓库现在可以安全地公开访问。

---

**完整更新日志**: https://github.com/zhaoteng45/YTDL-Flow-public/commits/v0.1.0
```

---

## GitHub Repository Metadata

### Description
```
A sleek video downloader built with Tauri 2 + Vue 3 + Rust. Powered by yt-dlp, supporting 1000+ video sites, multi-URL input, real-time progress, and a serial download queue.
```

### Website
```
https://github.com/zhaoteng45/YTDL-Flow-public
```

### Topics (separate with spaces)
```
video-downloader youtube-downloader bilibili-downloader yt-dlp tauri vue rust desktop-app media-downloader neobrutalism
```

---

## Release Settings Checklist

在 GitHub Release 页面建议勾选：

- [ ] Set as the latest release (首次发布推荐勾选)
- [ ] Create a discussion for this release (可选，用于收集反馈)
- [ ] Save draft (保存草稿以便后续编辑)

---

## 更新日志模板

### 如何更新此模板

1. 更新版本号（标题和文件名中的版本）
2. 更新 Features 列表（添加新功能）
3. 更新 Known Issues（修复或新增问题）
4. 更新 Assets 表格（新平台的安装包）
5. 更新 Full Changelog URL

### 版本号格式

- 主版本: v1.0.0 (重大功能更新)
- 次版本: v0.2.0 (新功能添加)
- 补丁版本: v0.1.1 (bug 修复)

---

*最后更新：2026-04-09*