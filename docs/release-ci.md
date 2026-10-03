# 安装包验证与发布

普通 CI 的 Windows Install Trust 和 Release Pipeline 都检查安装后的文件及许可证，并使用安装后的应用解析和下载一段本地生成的视频。该测试调用生产 Rust 下载服务，使用随包工具，不依赖外部网站或 Cookies。它不覆盖前端点击操作、真实 YouTube 下载或人工视觉检查。

## 自动检查

1. 固定版本、SHA256 校验过的 cargo-about 收集 Rust 许可证。JavaScript 依赖按实际安装路径遍历，包括 Bun 隔离安装的间接依赖。
2. 收集运行时声明、FFmpeg 构建配置和来源记录，生成许可证文件哈希清单。打包时包含 `licenses/`。
3. 安装最终 MSI，对安装后的许可证逐文件验哈希，运行应用的 `--release-smoke request.json`。测试只接受 `127.0.0.1` 上的固定视频路径，检查解析结果及下载文件 SHA256，结束后清理进程。
4. 先测试当前 MSI 的全新安装和卸载，再使用同一源码、旧版本号的 MSI 测试升级和卸载。报告明确标记 `upgradeBaselineKind: synthetic`，不代表历史版本数据迁移。
5. 发布流程验证 MSI 和已安装 EXE 的 Windows 签名，以及 MSI 更新签名是否与应用中的公钥匹配。
6. 所有报告绑定同一个最终 MSI 哈希。许可证来源核查未完成、签名失败、安装或下载失败时，不创建带安装包的 Release。

默认手动运行 Release Pipeline 只执行检查。勾选 `prepare_release` 或推送匹配源码版本的 `v*` 标签，才会尝试创建草稿 Release。草稿不会自动公开；确认界面和真实下载后再发布。

## 签名配置

仓库 Actions Secrets：

| 名称 | 内容 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 与 `tauri.conf.json` 公钥匹配的 Tauri 更新私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 更新私钥密码；未加密时留空 |
| `WINDOWS_SIGNING_PFX_BASE64` | Windows 代码签名 PFX 文件的 Base64 内容 |
| `WINDOWS_SIGNING_PASSWORD` | PFX 文件密码 |

Windows 证书只导入一次性 runner 的用户证书存储，临时 PFX 文件会删除。证书须包含私钥、未过期且具有代码签名用途。签名步骤不会输出密钥或密码。

更新签名使用 [Tauri 更新机制](https://v2.tauri.app/plugin/updater/)；Windows 发布者签名使用 [Tauri Windows 代码签名配置](https://v2.tauri.app/distribute/sign/windows/)。两者分别验证。

## 第三方资料

`third-party/runtime-source-review.json` 记录固定运行时版本的对应源码与声明核查状态。当前 yt-dlp PyInstaller 发行包、Gyan FFmpeg 及 Bun 的部分资料仍未齐全，发布检查会明确阻止上传安装包。不得仅因许可证文本收集成功而将这些项目标为完成。

yt-dlp 的独立 EXE 与源码采用不同许可证，见 [上游发行包说明](https://github.com/yt-dlp/yt-dlp#licensing)。FFmpeg 的许可证和对应源码要求见 [上游说明](https://ffmpeg.org/legal.html)。补齐实际发行版本的资料后，更新核查记录和随包内容，再运行发布检查。

## 超时

- 本地视频为一秒、96×54、10 fps，沿用已有 Rust 本地下载测试。
- 生成视频最多 30 秒，服务就绪最多 10 秒，均适用于小型本地测试文件。
- 原生下载停滞看门狗为 180 秒；内部 smoke 最多 240 秒，为清理留出时间；外部进程最多 300 秒。
- CI Release Pipeline 最多 60 分钟，容纳首次 Rust 编译、两份 MSI 构建和两次生命周期验证。超时视为失败，不报告跳过或通过。

每次 smoke 使用独立目录并拒绝复用旧下载目录。只清理本次启动的进程树，不按程序名结束其他实例。

## 发布测试的进程与报告

显式 `--release-smoke` 测试使用 Windows Job Object 约束解析和下载子进程。即使父进程退出，系统也会结束该作业中的子进程。正常启动不启用此测试约束。

全新安装和升级测试分别保存 `native-fresh.json`、`native-upgrade.json`。报告包含最终 MSI SHA256、产品版本和测试阶段，发布脚本校验两份报告并保留在最终发行证据中。
