# 第三方声明

根目录 [LICENSE](LICENSE) 适用于 YTDL-Flow 原创源码，不替代第三方作品的许可证。第三方文件的原有版权声明、许可证和 NOTICE 应随再分发保留。

## 随包工具

版本、下载源及下载校验以 [toolchain-manifest.json](src-tauri/toolchain-manifest.json) 为准。

| 组件 | 已确认的许可证依据 | 交付要求 |
| --- | --- | --- |
| yt-dlp Windows 独立 EXE | 上游明确区分源码 Unlicense 与 PyInstaller 发行包 GPLv3+，见 [Licensing](https://github.com/yt-dlp/yt-dlp#licensing) | 保留发行包第三方声明，并核验对应源码与构建依赖；不能仅使用源码的 Unlicense 描述 EXE |
| FFmpeg / FFprobe | 本地 9.0.2 Gyan essentials 构建启用 `--enable-gpl --enable-version3`；`ffmpeg -L` 声明 GPLv3-or-later，见 [上游说明](https://ffmpeg.org/legal.html) | 随包保留 GPL 文本、版权声明，并提供与实际构建对应的源码及构建信息 |
| Bun | 上游运行时及内含组件有不同许可证，见 [LICENSE.md](https://github.com/oven-sh/bun/blob/main/LICENSE.md) | 按所用发行版本保留主许可证及内含组件声明 |
| rustypipe-botguard 0.1.2 | crates.io 本地缓存的 Cargo.toml 与 LICENSE 均声明 MIT | [LICENSE](third-party/licenses/rustypipe-botguard-0.1.2-LICENSE)；依赖声明仍需按发行版本核查 |
| Python PO Token provider 0.2.0 | 已与上游提交 `f235ebc1ae89d0fa2c103ca705ff1a312b9be673` 核对，规范化换行后内容一致，采用上游 MIT 许可证 | [LICENSE](src-tauri/plugins/rustypipe/LICENSE)、[来源记录](src-tauri/plugins/rustypipe/provenance.json) |

## 发布验收边界

许可证文件收集及安装后的逐文件校验已接入 CI，流程见 [安装包验证与发布](docs/release-ci.md)。收集成功不等于对应源码和发行包声明已全部核对；未齐全的运行时资料见 [核查记录](third-party/runtime-source-review.json) 和 [固定版本核查](docs/reference/runtime-redistribution-audit-20261004.md)。未签名手动安装包附带该记录，核查状态保持未完成。

本文件是来源与声明清单，不是完整许可证验收结果。待补齐的内容包括：

- 前端、Rust 和二进制内含依赖的声明核查。
- 随包许可证、对应源码和构建资料的收集与实际打包。
- 从最终安装包解包，验证第三方声明确实随产品交付。

未完成上述检查时，不宣称安装包已完成第三方许可证验收。
