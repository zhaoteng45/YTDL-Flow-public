# 安装包验证与发布

推送与源码版本一致的 `vX.Y.Z` 标签后，Release Pipeline 自动构建 Windows x64 MSI。源代码、安装、升级、原生下载与上传文件哈希全部通过后，自动公开到 [Releases](https://github.com/zhaoteng45/YTDL-Flow-public/releases/latest)。不需要签名 Secrets，也不需要逐次人工确认。普通代码提交运行 CI，不自动发布新版本。

手动运行 Release Pipeline 默认仅验证并上传测试包；勾选 `publish_release` 可构建并发布当前源码版本。版本标签若已存在，必须指向当前源码提交。已公开版本不会覆盖，修复时增加版本号并推送新标签。

## 自动检查范围

1. 四份版本文件一致性、类型检查、代码规范、前端与工作区测试，以及 Rust 格式、全目标 Clippy 和测试。CI 与 Release 共用主题、语言和布局检查；界面检查失败时，不启动安装包验证或发布。
2. 校验固定版本运行工具的下载哈希，收集 JavaScript、Rust 与运行工具许可证和来源记录；打包 `licenses/`。
3. 安装最终 MSI，逐文件核对安装后的许可证哈希，通过已安装应用和随包工具解析并下载本地视频，校验输出文件哈希。
4. 测试全新安装、卸载及模拟旧版本升级。升级基线采用同一源码构建的旧版本号 MSI，报告标记 `upgradeBaselineKind: synthetic`；不代表所有历史版本的数据迁移都已验证。
5. 所有报告绑定同一个最终 MSI 哈希。安装、下载、文件清单或报告身份校验失败，停止发布。
6. 上传时使用草稿暂存附件，逐个核对 GitHub 返回的 SHA256，齐全且匹配后自动公开。中断时保持草稿；相同源码可重试未公开草稿，已公开版本禁止替换。

## 普通用户下载

从 Releases 下载 `.msi` 并运行安装。安装包未签名，Windows 可能显示“未知发布者”。更新时下载新版本 MSI 覆盖安装。当前隐藏应用内自动更新入口，不生成 `latest.json` 或更新签名；不会让应用安装未经更新签名验证的附件。

每次发行提供 MSI、`SHA256SUMS.txt`、`release-evidence.json`、第三方声明、运行工具版本清单及源码核查记录。发行说明明确自动测试边界。自动化不覆盖真实网站响应、最终 GUI/DPI 人工检查或全部历史版本设置迁移。

普通 CI 的 Windows Install Trust 在版本、前端、Rust 和界面检查通过后，执行真实安装包的生命周期测试，上传 `validation-installer-<提交哈希>`。手动验证模式上传 `validation-installer`。测试附件保留 7 天，沿用既有保存周期。真实 MSI 已覆盖打包检查，不再单独构建模拟工具安装包。

准备新版本时，在干净的仓库根目录运行 `bun run release:prepare X.Y.Z`。脚本检查版本递增和标签冲突，再同步 package.json、Tauri 配置、Cargo.toml 与根包的 Cargo.lock，创建本地提交和标签。准备期间不要并行修改源码或运行构建；Git 步骤失败时检查遗留改动，不自动重置工作区。

Windows 发行中的 Vitest 使用两个 worker，保留现有测试超时。2026-10-06 的云端运行在默认并行度下出现 Git 大文件检查与 PowerShell 子进程超时；限制并行用于减少争用，成功仍以完整测试结果为准。

## 第三方资料

`third-party/runtime-source-review.json` 记录固定运行工具版本的源码与构建资料核查状态。yt-dlp PyInstaller 发行包、Gyan FFmpeg 和 Bun 的部分资料仍未齐全，详见 [固定版本核查](reference/runtime-redistribution-audit-20261004.md)。手动安装发行模式附带这些记录，保留 `runtimeReviewComplete: false`，不会把许可证文本收集与哈希校验宣称为完整许可证验收。签名发行证据校验函数仍要求资料完成。

## 超时与运行隔离

- 本地视频为一秒、96×54、10 fps，沿用已有 Rust 本地下载测试。
- 生成视频最多 30 秒，服务就绪最多 10 秒，适用于该小型文件。
- 原生下载停滞看门狗 180 秒，内部 smoke 240 秒，外部进程 300 秒，为清理留出时间。
- Release Pipeline 最多 60 分钟，容纳 Rust 编译、两份 MSI 构建和生命周期验证。超时视为失败。

每次 smoke 使用独立目录并拒绝复用旧下载目录。测试进程使用 Windows Job Object 约束子进程；父进程退出后仍清理其后代，不按程序名结束其他实例。正常应用启动不启用此测试约束。
