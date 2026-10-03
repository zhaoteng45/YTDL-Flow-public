# External Downloader Patterns & Release Audit — 2026-09-30

## Scope

只审：发布/更新/sidecar/版本一致性、二进制来源完整性、ExtraArgs 优先级、取消/重试/退出生命周期、Cookie 临时材料异常退出残留。

不审：UI、已暂停的 Resource Capture、订阅/daemon、多下载引擎扩展、持久化历史实现。

外部一手参考：Open Video Downloader、imsyy/yt-dlp-gui、MeTube、Media Downloader、Pinchflat、albenq/yt-dlp-ui。YTDL-Flow 为 MIT；copyleft 项目仅借鉴架构/行为，不复制代码。

## 外部成熟模式

- Open Video Downloader：二进制管理、更新签名/公钥、signed-manifest 方向。
  - https://github.com/jely2002/youtube-dl-gui
- imsyy/yt-dlp-gui：显式 target release matrix、updater metadata、SQLite migration。
  - https://github.com/imsyy/yt-dlp-gui
- MeTube：global → preset → per-download override；retry 再应用 gate；取消进程生命周期。
  - https://github.com/alexta69/metube
- Media Downloader：下载引擎 adapter/plugin seam。
  - https://github.com/mhogomchungu/media-downloader
- Pinchflat：durable workers/concurrency/recovery。
  - https://github.com/GhostMaintainers/Pinchflat

## Finding A — Sidecar 供应链 / 可复现输入

本地证据：`scripts/prepare-release-sidecars.mjs` 会从 mutable `latest` URL 拉取 yt-dlp 与 Bun，并拉取 Gyan.dev 当前 FFmpeg archive。它计算 SHA-256，但只打印，不与受信任 checksum/signature 比对。

风险：
- 同一 YTDL-Flow tag 在不同时间重跑可能打包不同 sidecar bytes；
- “计算 hash”不是“验证 hash”；
- Tauri app updater 签名不等于对构建前网络下载的 sidecar 做完整性认证。

已有强项保留：target triple gate、rustypipe-botguard 固定版本 + `--locked`、tool mutation guard、FFmpeg/Bun atomic replace。

裁决：ADAPT NOW。

候选 Ticket A（P2）：Trusted Binary Manifest & Reproducible Sidecar Inputs
- 明确版本/URL/可信 checksum 或 signature；
- release 按 manifest 获取，不直接依赖匿名 latest；
- mismatch fail closed；
- release evidence 记录版本 + digest。

## Finding B — Release provenance gate

当前：
`bun scripts/check-versions.mjs` PASS：package/Tauri/Cargo 均为 2.0.1。

但 `.github/workflows/release.yml`：
- 接受任意 `v*` tag；
- 未执行 `scripts/check-versions.mjs`；
- 未验证 tag == `v<package.version>`；
- releaseName 仍是字面量 `YTDL-Flow v__VERSION__`。

裁决：ADOPT NOW。

候选 Ticket B（P2）：Release Provenance Gate
- release job 强制 version check；
- tag 与 package version 必须一致；
- releaseName 从已验证 tag/version 派生；
- 加 mismatch contract tests；
- 保留显式 Windows x64 target 与 Tauri updater signing。

## Finding C — Cookie crash residue

`TempCookieMaterial` 正常生命周期是强项：
- JSON→Netscape 临时文件由 guard 所有；
- Drop 时删除；
- 用户原生 .txt 永不删除；
- 普通下载主路径先解析 material，再将受控 cookie path 传入参数构建。

维护脚本 `scripts/cleanup.mjs` 能删 `ytdl_flow_cookies_*.txt`，对应测试 PASS。

残余：生产启动没有 stale cleanup。硬崩溃/断电可跳过 Drop，使 plaintext cookie temp file 留在 OS temp，直到人工/开发 cleanup。

兼容 helper `resolve_cookies_arg()` 会 forget guard，但普通下载主路径不是依赖它的无 guard fallback，因此不判为“正常任务必泄漏”。

裁决：ADAPT NOW。

候选 Ticket C（P2）：Crash-Safe Stale Cookie Cleanup
- production startup 做 bounded cleanup；
- 利用 PID/timestamp/age/dead-process 条件保守删除；
- 永不删除用户 cookie 文件；
- 增加 startup cleanup regression tests。

## 已经成熟，不要重构

### ExtraArgs precedence

`packages/application/src/current-download-service.ts`：
globalExtraArgs → taskOverrideArgs → format-derived audioCodec。

`tests/application/currentDownloadDifferentialParity.test.ts` 与 `currentLifecycleDifferentialParity.test.ts` 已覆盖 precedence、retry、稳定 row identity、stale attempt isolation。

裁决：KEEP / NO TICKET。

### Cancel / Retry / Exit

已有：
- child attach 前就注册 execution control；
- cancel intent 与 confirmed cancel 分离；
- Windows `taskkill /F /T` process-tree cleanup；
- late-child race handling；
- cleanup failure observable；
- Tauri ExitRequested → kill_all；
- pending-start deferred settlement；
- cleanup slot held until trusted terminal；
- retry 新 attempt identity；
- stale terminal ignored。

MeTube 的 SIGINT→SIGKILL 是有价值的参考，但没有证据说明 Windows 当前 tree-kill 方案需要替换。

裁决：KEEP / NO REDESIGN。

## 暂缓/拒绝

- SQLite task/history：DEFER。
- restart recovery：DEFER。
- multi-engine product expansion：REJECT NOW。
- subscription/daemon：REJECT NOW。

## Verification

- `bun scripts/check-versions.mjs` → PASS，2.0.1 / 2.0.1 / 2.0.1。
- focused Vitest：5 files / 26 tests PASS。
- `cargo test --manifest-path src-tauri/Cargo.toml update_atomic_tests` → 2/2 PASS。
- Release compile：单次后台 wrapper 捕获到 Vite 164 modules built、Rust release profile finished、Tauri 输出新 exe：
  `src-tauri/target/x86_64-pc-windows-msvc/release/yt-dlp-cool.exe`
  时间 2026-09-30 23:43:48，大小 20,017,664 bytes。
- wrapper 的 numeric exit-code file 为空，因此只记录“compiler/Tauri success output VERIFIED”，精确 exit code 为 NOT_VERIFIED。

## Multi-model evidence

已启动 GPT-6.1 Sol medium、Gemini 3.8 Flash High、DeepSeek v4.1 Flash 的独立只读 session。三者均进行了 repo reads，但 OpenCode 返回链多次停在 tool-call phase，没有完整 final handback。

因此：
- 不把模型扫描冒充独立 verdict；
- 三个模型 final verdict 均记为 NOT_VERIFIED；
- 本文结论由 ChatGPT-Sol 重新读取真实 workspace、测试和构建证据后裁决。

## Final matrix

| 模式 | 裁决 |
| --- | --- |
| Trusted/pinned binary manifest | ADAPT NOW |
| Release tag/version/provenance gate | ADOPT NOW |
| Production stale temp-cookie cleanup | ADAPT NOW |
| Global → task → format precedence | KEEP |
| Cancel/retry/process-tree lifecycle | KEEP |
| SQLite persistence | DEFER |
| Multi-engine | REJECT NOW |
| Subscription/daemon | REJECT NOW |

下一步（如果继续无 PC 工作）：只做 Ticket A–C 的 release-hardening tranche，走 RED-first；不要重开 UI 或任务状态架构。
