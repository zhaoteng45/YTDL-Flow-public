---
description: 可选 Jev 协作建议；先应用本地硬门禁
---

先遵守当前 AGENTS、STATUS 与 docs/agents/jev-routing.md。

$ARGUMENTS

仅在已有调用许可、当前任务一致且无硬风险时，将已去敏的最小 JSON 通过 stdin 交给 `bun --no-env-file scripts/agent-jev-gate.mjs`；最多一次调用，不重试。需要展示命令时先给 dry-run。不得扫描/上传仓库、读取凭据文件或回显输入。

只报告 helper envelope：status、api_called、authority、decision、confidence、实际 model/usage、reasons/fallback。bypass/fallback 交回 Sol；输出没有实施、Git、Reviewer、Human Gate 或 GPT-6 预算授权。不得据此自动执行后续动作。
