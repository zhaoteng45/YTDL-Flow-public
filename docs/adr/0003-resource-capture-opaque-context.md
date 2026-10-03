---
status: accepted
date: 2026-09-27
---

# ADR-0003: Resource Capture 使用 Opaque Capture Context 接入现有任务链

YTDL-Flow 2.1 的 Resource Capture 拟采用 Opaque Capture Context：Capture 只负责发现资源，真实 URL、Cookie、Authorization 与请求 Headers 保留在 Rust 原生内存中，前端只接收不可执行的脱敏资源摘要与 opaque context 引用；被用户选中的资源仍通过现有 CurrentTaskService → CurrentDownloadService → yt-dlp 生命周期执行，从而保持单一 task owner，并避免引入 res-downloader 式第二套下载器。

## Considered Options

- 直接把 URL/Headers/Cookies 传入 CurrentTask：拒绝，敏感数据会跨 IPC 并扩散到前端状态、日志和调试面。
- Opaque Capture Context：推荐，敏感上下文保持 native，CurrentTaskService 继续拥有分析、重试、取消和终态语义。
- 本地 Replay Proxy URL：暂缓；它会代替下载器重放 URL/Headers，并额外引入 SSRF、Range、redirect、token 与服务生命周期问题。Phase 1 后续采用的 Capture Egress Guard 不属于 Replay Proxy：它只作为 captured yt-dlp 的 loopback SOCKS5h 出站策略隧道，不缓存/重写媒体、不拥有下载重试/Range/任务终态。
- Direct HTTP DownloadEngine：暂缓，会复制 yt-dlp 已有的下载/重试/协议语义并扩大测试面。

## Consequences

Phase 1 不自动修改 Windows 全局代理，不启用机器级静默 CA 信任，不允许通用 Cookie/Authorization replay，也不新增第二个下载引擎。G1 captured execution 仅开放 direct video/audio，并为每次 captured yt-dlp invocation 启动一个仅绑定 loopback 的 SOCKS5h Capture Egress Guard：Guard 在每个新上游连接上执行 hostname/DNS/IP policy，检查全部 DNS answers，并直接连接已验证 SocketAddr；TLS 仍端到端发生在 yt-dlp 与目标站点之间，不做 MITM。HLS/DASH/stream 仍可发现但不执行，直到其 child/key/subresource 证据单独通过。Opaque Context、固定 TTL、默认拒绝 Header replay、native 输出脱敏和有界 CaptureState 继续保持。
