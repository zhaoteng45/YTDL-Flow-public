# YTDL-Flow

把视频链接保存为本地视频或音频文件。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/zhaoteng45/YTDL-Flow-public/actions/workflows/ci.yml/badge.svg)](https://github.com/zhaoteng45/YTDL-Flow-public/actions/workflows/ci.yml)

[下载与更新](https://github.com/zhaoteng45/YTDL-Flow-public/releases) · [English](#english)

YTDL-Flow 为 yt-dlp 和 FFmpeg 提供桌面界面。粘贴链接，选择格式和保存位置，然后开始下载。

## 功能

- 下载视频或提取音频，支持 MP4、WebM、MP3 等格式。
- 一次添加多个链接，任务按顺序下载。
- 选择来源格式、分辨率和音轨，或只下载指定时间段。
- 查看下载进度、合并和转换状态，以及每次尝试的详细日志。
- 导入 Cookies，设置代理和保存目录；下载失败时可查看原因并重试。
- 蓝宝石、酒红、石墨三种主题，支持简体中文和英文。

网站支持取决于 yt-dlp、网站限制和当前登录状态，具体见 [yt-dlp 支持列表](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)。

## 下载

在 [Releases 最新版本](https://github.com/zhaoteng45/YTDL-Flow-public/releases/latest) 下载 Windows x64 的 `.msi` 安装包，运行即可安装。更新时下载新版本安装包覆盖安装。

安装包未使用代码签名，Windows 可能显示“未知发布者”提示。当前不提供应用内自动更新；发行页附有文件校验值和测试记录。随包运行工具的源码资料核查进度见 [第三方声明](THIRD_PARTY_NOTICES.md)。

当前在 Windows 11 x64 上开发和测试。Windows 10、macOS 和 Linux 尚未验证。

## 使用

1. 粘贴一个或多个视频链接。
2. 点击“解析并添加”。
3. 选择格式，确认保存位置，开始下载。
4. 完成后打开文件或所在文件夹。

多个链接会分别创建任务，依次下载。目前不支持整份播放列表下载。

下载失败时，先查看任务中的错误和详细日志。需要登录的内容可尝试重新导出 Cookies；也可以检查网络、代理、保存目录和 yt-dlp 版本。

## 本地开发

前端使用 Vue 3、TypeScript 和 Pinia，后端使用 Rust 与 Tauri 2。需要 Bun 1.4.2、Node.js 22、Rust 稳定版，以及 Windows Tauri 构建环境。

```bash
git clone https://github.com/zhaoteng45/YTDL-Flow-public.git
cd YTDL-Flow-public
bun install --frozen-lockfile

# 完整桌面应用
bun run tauri:dev

# 仅启动前端
bun run dev
```

检查和构建：

```bash
bun run lint
bun run typecheck
bun run typecheck:ui
bun run check:repository
bun run test
bun run test:packages
bun run build:web
bun run tauri:build
```

使用 Bun 管理 JavaScript 依赖，保留 `bun.lock`。`bun run update-bins` 更新随包工具。CI 中调用 sidecar 脚本需显式传入 `--target`；目前安装包构建仅支持在 Windows 上构建 Windows 版本。

`bun run release:prepare <version>` 准备本地版本、提交和标签，远程发布由版本标签触发的 GitHub Actions 执行。

## 项目目录

| 目录 | 内容 |
| --- | --- |
| `src/` | 前端界面和桌面接口 |
| `packages/` | 任务编排、领域模型和接口定义 |
| `src-tauri/` | Rust 后端和打包配置 |
| `scripts/` | 开发、检查和构建脚本 |
| `tests/` | 自动化测试 |
| `docs/` | 开发文档 |

主题修改见 [设计说明](DESIGN_LANGUAGE_GUIDE.md)，贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

YTDL-Flow 原创源码采用 [MIT](LICENSE) 许可证。第三方源码和随包工具使用各自的许可证，见 [第三方声明](THIRD_PARTY_NOTICES.md)。

---

## English

YTDL-Flow is a desktop interface for yt-dlp and FFmpeg. Paste a video URL, choose a format and destination, and download the video or audio to your computer.

- Add multiple URLs and download them one at a time.
- Choose source formats, resolution, audio tracks, or a time range.
- View download progress, merging and conversion status, and detailed logs.
- Import cookies and configure a proxy or download directory.
- Choose Sapphire, Wine, or Graphite themes, with Chinese and English interfaces.

Website availability depends on yt-dlp, site restrictions, and your login state. See the [supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md). Full playlist downloads are not supported.

### Downloads

Download the Windows x64 `.msi` from the [latest Release](https://github.com/zhaoteng45/YTDL-Flow-public/releases/latest). Install a newer MSI to update. Installers are unsigned and Windows may show an unknown publisher prompt. In-app updates are disabled. Each release includes checksums and automated test records; runtime source review remains incomplete, as described in [third-party notices](THIRD_PARTY_NOTICES.md). Development and testing currently use Windows 11 x64; Windows 10, macOS, and Linux have not been verified.

### Development

Use Bun 1.4.2, Node.js 22, stable Rust, and the Windows Tauri build prerequisites.

```bash
git clone https://github.com/zhaoteng45/YTDL-Flow-public.git
cd YTDL-Flow-public
bun install --frozen-lockfile
bun run tauri:dev
```

Use `bun run dev` for the frontend, `bun run test` and `bun run test:packages` for tests, and `bun run tauri:build` to build the desktop app. Keep `bun.lock` as the JavaScript lockfile. CI sidecar scripts require an explicit `--target`; installer builds currently support Windows hosts and targets only.

Original source is licensed under [MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for other components.
