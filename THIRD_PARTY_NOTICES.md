# 第三方声明

根目录 [LICENSE](LICENSE) 适用于 YTDL-Flow 原创源码，不替代第三方作品的许可证。第三方文件的原有版权声明、许可证和 NOTICE 应随再分发保留。

## 仓库内的开发技能

具体技能与来源以 [skills-lock.json](skills-lock.json) 为准。本次补充的上游许可证保存在 `third-party/licenses/`；[provenance.json](third-party/licenses/provenance.json) 记录取件提交、URL 与 SHA256。该记录标识许可证文本的来源，不表示已验证所有技能文件与当前上游逐字相同。

| 来源 | 许可证 | 本地声明 |
| --- | --- | --- |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT | [LICENSE](third-party/licenses/emilkowalski-skills-LICENSE) |
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | [LICENSE](third-party/licenses/mattpocock-skills-LICENSE) |
| [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) | MIT | [LICENSE](third-party/licenses/i-have-adhd-LICENSE) |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache-2.0 | [LICENSE](third-party/licenses/impeccable-LICENSE)、[NOTICE](third-party/licenses/impeccable-NOTICE.md)；本地描述与配置有适配 |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT | [LICENSE](third-party/licenses/ui-ux-pro-max-LICENSE) |
| [typesafe-ai/skills](https://github.com/typesafe-ai/skills) | MIT | [LICENSE](.agents/skills/typesafe-ai/LICENSE) |
| [tt-a1i/simplify-codebase](https://github.com/tt-a1i/simplify-codebase) | MIT；附带作品另有声明 | [LICENSE](.agents/skills/simplify-codebase/LICENSE)、[visualization/NOTICE](.agents/skills/simplify-codebase/visualization/NOTICE.md) |

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

本文件是来源与声明清单，不是安装包许可证验收结果。正式发布前仍需完成：

- 前端、Rust 和二进制内含依赖的声明核查。
- 随包许可证、对应源码和构建资料的收集与实际打包。
- 从最终安装包解包，验证第三方声明确实随产品交付。

未完成上述检查时，不宣称安装包已完成第三方许可证验收。
