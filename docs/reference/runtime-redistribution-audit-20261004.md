# 固定运行工具再分发资料核查

核查日期：2026-10-04。范围以 `src-tauri/toolchain-manifest.json` 为准；不修改 `runtime-source-review.json`，不作法律认证。

## yt-dlp 2026.08.19

**VERIFIED：**[发行资产](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19)包含 `yt-dlp.tar.gz`；[第三方声明](https://github.com/yt-dlp/yt-dlp/blob/3a08beaf031ab68f966401ead017ac81fe8486cf/THIRD_PARTY_LICENSES.txt)覆盖独立 EXE 内组件，并提供无法取得源码时的维护者联系渠道。

[构建流程](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/.github/workflows/build.yml)使用 Windows x64、Python 3.10；[锁定清单](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/bundle/requirements/win-x64-pyinstaller.txt)指定 PyInstaller 6.22.0 与 wheel 哈希；其[发行页](https://github.com/yt-dlp/Pyinstaller-Builds/releases/tag/2026.08.19.215425)提供源码包，绑定 `70fc17210920bce17f4ab09bbf8104b0dbd45338`。[运行依赖](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/bundle/requirements/curl-cffi.txt)固定 curl-cffi 0.16.0 等版本。

**待做：**保存这些小文本及校验值；按 Windows 条件筛选实际依赖，收集源码和声明。Python 清单只固定 3.10，补丁版本及 wheel 内原生库需从该次日志/包内核对；源码资产存在不等于交付已经齐全。

## Gyan FFmpeg 9.0.2 essentials

**VERIFIED：**[官方页](https://www.gyan.dev/ffmpeg/builds/)确认静态 GPLv3；[该版发行页](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2)指向 FFmpeg `946fcce07b`，API 附件只有二进制。本次已读固定 ZIP 提取的 `.scratch/runtime-redistribution/ffmpeg-9.0.2-README.txt`：包含配置与外库版本，例如 x264 `v0.165.3223`、x265 `4.3-45-g116b875`。

**BLOCKED_EVIDENCE：**版本表未覆盖已列入构建的 gnutls、gmp、bzlib、iconv、fontconfig、libxml2、lzma、zlib；未取得对应补丁和完整构建脚本。动作：先保存 README、`-buildconf`、ZIP 哈希，再逐库锁定源码；缺项向 Gyan 请求。主项目源码链接不能替代静态外库资料。[FFmpeg 官方说明](https://ffmpeg.org/legal.html)强调源码须对应实际二进制。

## Bun 1.4.2

**VERIFIED：**[固定版 LICENSE.md](https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md)声明 Bun 本体 MIT，同时静态链接 LGPL2 JavaScriptCore/WebKit，另列 tinycc LGPL2.1、其他库及嵌入 polyfill；不能只收 MIT 声明。[构建配置](https://github.com/oven-sh/bun/blob/bun-v1.4.2/scripts/build/deps/webkit.ts)固定 WebKit `2e2aa2290fac856d6f451ceacb58f7f5b44dd057`。

**待做：**按固定源码构建依赖收集各组件完整版权/许可证；核对 Windows 实际包含项，验证官方给出的重链接步骤及所需材料。当前未完成此核对。

## 最小完成路径

先收集可取得资料并建立“二进制哈希→组件版本→源码/补丁→声明”清单；缺项存在时完整许可证验收保持未完成。资料齐备后补入随包内容、源码下载交付，再重跑最终 MSI 验收。不捆绑相关工具、改为官方单独下载是备选范围变更，需另行授权并评估 sidecar/resources 和普通用户体验；本次不实施。
