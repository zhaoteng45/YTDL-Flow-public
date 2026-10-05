# CONTEXT.md — YTDL-Flow 领域词汇

> 单一权威出处：运行时事实以 `packages/contracts/src/`、`packages/application/src/current-task-service.ts`、`packages/application/src/download-service.ts`、`packages/domain/src/`、`src-tauri/src/models.rs` 与 `src-tauri/src/lib.rs` 为准。
> 当前架构脉络见 `docs/architecture/MIGRATION_HISTORY.md`；仍有约束力的设计决定见 `docs/adr/`。

## 项目一句话

面向普通用户的桌面视频下载器（Tauri 2 + Vue 3 + Rust + yt-dlp sidecar）：粘贴 URL → 选择格式 → 下载完成。

## 核心概念

| 术语 | 含义 |
| :--- | :--- |
| **多 URL 输入（Multi-URL input）** | 纯输入便利层：对多行文本做 trim / HTTP(S) 校验 / 精确字符串去重，按首次出现顺序输出独立 URL；不创建 Batch 实体，不改变任务生命周期。 |
| **任务行（Task row）** | 用户视角的一行下载条目，由稳定的 `rowId` 标识。删除/重试/取消都作用于行。 |
| **尝试（attempt）** | 行的一次实际执行，由 `id`（attempt id）标识。重试或重新解析会铸造新 attempt id，旧 attempt 的迟到 IPC 事件按 id 找不到行而被自然丢弃。 |
| **解析（Analysis）** | 用 `get_video_metadata` 拉取视频元数据的阶段。行状态 `analyzing → analyzed / error`。 |
| **CurrentTaskService** | 当前生产任务 owner：拥有任务行 identity/order、解析目录与解析→下载的编排；下载执行状态由 `DownloadService` / `DownloadQueue` 提供并投影回同一任务行。旧 `src/queue/taskQueue.ts` 不再是 production owner。 |
| **槽位（slot）** | `DownloadService` / `DownloadQueue` 的下载执行预算固定为 1：可排队多个视频，但任一时刻只有一个执行 attempt 占用真实下载槽。 |
| **失败分类（FailureKind）** | 终态行的归因：`analysis / download / cancelled / unknown`。决定 UI 提供重析还是重下。分类是粘性的：一旦写入不再被覆盖。 |
| **取消协议** | 取消 = 先置 `cancelRequested` 标志位 → （活任务）请求后端杀进程树。标志位存在期间到达的一切事件在摄取层被忽略——终态不靠字符串比较识别。 |
| **看门狗（watchdog）** | 双端职责收敛分工：运行期（downloading/processing）180s 数据流停滞与杀树由 Rust 下载服务负责；Application `DownloadService` 仅兜底 pending 启动超时，并在 native 清理确认前保持 cleanup slot。 |
| **processing** | 后处理阶段状态（合并音视频/封装/提取音频）。由后端解析 yt-dlp 输出中的 `[Merger]`/`[ExtractAudio]` 等日志行驱动发出。 |
| **任务级覆盖（overrideArgs）** | 任务行持有的局部参数覆盖（`Partial<ExtraArgs>`）。下载尝试时与全局 ExtraArgs 浅合并后透传，不污染全局持久化设置。 |

## 凭证术语

- **凭证来源**：用户为某个平台指定的浏览器或 Cookies 文件；来源存在或可读取不等于账号已经登录。
- **备用凭证文件**：用户为某个平台指定、并允许在浏览器读取失败时使用的 Cookies 文件。它与浏览器来源可以属于不同账号。
- **自动加载**：复用用户已经指定的凭证来源，不代表自动获取或刷新新的有效 Cookies。
- **文件引用**：应用保存用户指定文件的位置，凭证内容仍在原文件中；区别于导入后另存一份凭证。
- **首选凭证来源**：用户指定优先使用的凭证来源；设置备用文件不改变首选来源。
- **实际凭证来源**：某次解析或下载尝试实际使用的浏览器、文件或匿名方式；它可能因已授权的回退而不同于首选来源。

## 状态机

```
analyzing ─→ analyzed ─→ queued ─→ pending ─→ downloading ⇄ processing
    │            │          │         │           │             │
    └── error ◄──┴──────────┴─────────┴────────────┴─────────────┘
                                                    completed
```

- 状态写入按层分工且保持单一 owner：解析行与编排由 `CurrentTaskService` 管理；下载执行状态由 `DownloadService` / `DownloadQueue` 管理；Tauri 事件经当前 runtime adapter 摄取后投影为同一任务行。
- `error` 行的语义由 `failureKind` + `errorMsg` 共同表达；`已取消` 是 errorMsg 文案，不是判定依据。

## ExtraArgs 契约

- schema 在 `src/types.ts` 与 `src-tauri/src/models.rs` 中字段一一对应；前端**整包透传**，不过滤。
- `build_extra_flags`（download.rs）是设置 → yt-dlp 参数的**唯一适配器**，每个建模字段必须被消费或在注释中声明为前端专属（当前仅 `admin_mode`）。
- `player_client: "smart"` 触发顺序客户端 capability scan；完整 format inventory 决定 winner，typed `smartDecision` 贯穿真实下载与重试，不在下载阶段重新选择 mweb。observed max 只表示当前环境的检测结果，不确认 source max。
- 分辨率/编码偏好用 `-S` 格式排序表达（不用 `-f` 硬过滤：格式缺失时优雅回退）。
- 媒体库归档字段：`write_thumbnail: true` 必须伴随 `--convert-thumbnails jpg` 以确保跨平台图片兼容性；`write_info_json: true` 导出完整元数据 JSON。

## 模块地图（加深后的形状）

| 模块 | interface | 说明 |
| :--- | :--- | :--- |
| `packages/application/src/current-task-service.ts` | analyze/analyzeMany/start/retry/cancel/remove/ingestLog | 当前 production task owner：统一任务行 identity/order、解析目录、下载执行投影与生命周期入口 |
| `packages/application/src/download-service.ts` + `packages/domain/src/` | create/retry/cancel/remove + FIFO execution state | 下载执行与唯一槽位；不拥有解析目录或 UI presentation identity |
| `src/utils/storage.ts` | appStorage (get / getString / set / remove) | 统一持久化存储门面：Key 常量、JSON 自动序列化、默认值回退与 SSR 防御 |
| `src/components/downloadList.helpers.ts` | buildQueueViewModel/getTaskActions/classifyTaskFailure/getQueueSummary | 视图纯函数（有测试锁定） |
| `src-tauri/src/services/download.rs` | get_metadata / download_video(request)→Outcome | yt-dlp sidecar 封装；自登记子进程；终态发射与停滞看门狗收拢于此 |
| `src-tauri/src/state.rs` | register/is_cancelled/kill_by_id/kill_all | 子进程登记表 + 取消标志位 + Windows 树杀 |
| `src-tauri/src/notification` | notify_outcome / notify_cancelled / get_settings / update_settings | 通知深模块：内聚设置状态，自闭环过滤、去抖、格式化与 OS 发射 |
| `src-tauri/src/commands/system.rs` | get_binaries_info / set_taskbar_progress | 系统与窗口增强：依赖版本探测 + Windows 任务栏原生进度条（Normal/Indeterminate/Error/None） |

## 不变量（改动前必读）

1. 取消与退出必须清理整棵进程树（state.rs 树杀语义不可削弱）。
2. `src/types.ts` ↔ `src-tauri/src/models.rs` 字段严格对应；改 IPC 载荷两侧同步。
3. 事件词表：后端只发 `analysis-log` 与 `download-progress`（status: downloading/processing/completed/error）。
4. 运行时依赖走 Tauri sidecar/resources，不假设用户 PATH 存在 yt-dlp/ffmpeg/bun。
5. Bun 能力调用均保持按需执行（On-demand execution），不引入常驻守护进程、后台轮询或系统特权。
