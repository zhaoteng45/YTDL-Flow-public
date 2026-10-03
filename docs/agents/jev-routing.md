# Jev 协作建议接口

Jev 是可选 advisory，不是 writer、Reviewer 或调度器。实现留在本仓，单仓 clone 不依赖父目录。原有产品、native、Human Gate 和模型预算仍有效。

## 调用前

先读取 AGENTS、STATUS 与当前任务，确认调用许可、具体 writer、范围和硬风险。helper 只读取固定 STATUS frontmatter 做保守 bypass，不解析正文批准、不证明会话 writer 身份，也不修改状态。任务不匹配、上下文无效、Human Gate required、Fast writer 占用或硬风险均零 API 返回。空 flags 不证明获准，不能为了调用修改产品 Gate。

共同硬风险：git_write、writer_unconfirmed、human_gate、reviewer_authority、scope_expansion、important_dependency、irreversible_operation、secrets_or_credentials。任何非空或未知 flag 均 bypass。自然语言风险仍由调用者按项目规则识别，helper 不声称穷尽业务授权。

## CLI 与最小输入

```text
bun run agent:jev --mode route --input .scratch/jev/state.json --dry-run
bun run agent:jev --mode evidence --input .scratch/jev/state.json
```

仅支持 route/evidence；没有 root-cause/triage/自动升级 mode。文件限本仓 `.scratch/jev/` 内 JSON；stdin 也接受一个 JSON object。`--state-file` 是相同限制的兼容别名。拒绝绝对路径、反斜杠、`..`、ADS、symlink/junction。无输入时不自动上传 STATUS，不扫描仓库。

```json
{
  "task_id": "必须与当前 STATUS 一致",
  "goal": "低风险文档任务摘要",
  "current_stage": "triage",
  "changed_areas": ["docs"],
  "required_gate": "review",
  "hard_risk_flags": [],
  "evidence": ["必要的短证据摘要"],
  "known_constraints": ["最终复核由 Sol 完成"]
}
```

current_stage：triage / implementation / review；required_gate：none / review / human。evidence 在 evidence 模式必需非空，route 可省略；known_constraints 可选。拒绝未知字段和错误类型。changed_areas 仅是范围提示，不解引用读取文件。只有 goal、stage、areas、evidence、constraints 发送到固定 TypeSafe HTTPS 端点；task_id、权限与 hard flags 留在本地。

## 输出与失败

统一字段：source、authority=advisory_only、mode、status、api_called、model、usage、decision、confidence、reasons、fallback。source 为 jev / local_policy / fallback；status 为 advisory / bypass / fallback / dry_run。reasons 是本地原因码。只有已校验的真实响应填写 model/usage。

route 的 decision 是 sol / fast_a / fast_b 建议；evidence 返回 evidence_readiness 的 Noul 概率，confidence=null。没有 autoContinue、approved 或自动 GPT-6 调用。未引入共同置信度阈值，具体交接和预算由 Sol 决定。

缺 key、HTTP 非 2xx、网络/超时、非法 JSON、不完整/非法答案统一 Sol fallback，exit 0；输入、参数、路径或敏感内容错误 exit 2。所有分支保留 envelope。不重试、不跟随 redirect、不输出 raw error/body，dry-run 也不回显 state。

## 秘密与资源边界

只用进程环境 TYPESAFE_API_KEY；helper 不读 `.env.local`、注册表或其他凭据文件。Bun package 入口使用 `--no-env-file`。旧任意 Markdown state、`--flags-file`、模型/超时环境覆盖和完整 STATUS 自动外发均已移除；旧调用者必须构造最小 JSON。通用 `/typesafe` skill command 仍遵循自己的凭据规则，不能与本 helper 混淆。

输入和响应各限 32768 UTF-8 bytes：沿用 LTSC 32 KiB 输入预算，响应同限因为只有一个小 typed answer。读取上限加一个探测字节；超限报告 limit/actual_bytes（stdin 为已观察值），不截断。概率总和容差 1e-9 仅用于浮点求和，不是路由阈值。超时 3000 ms，保留本仓既有请求预算，覆盖响应体读取。

拒绝可识别 Cookie/Bearer/Token/密码/私钥及当前 key 值。模式检查不是完整 DLP，调用者必须只提供去敏摘要，不传源码、完整日志、AGENTS、用户资产或凭据。路径防护不声称能抵御同机恶意进程持续竞态换链；有并发 writer 时按项目规则停止。

## 项目附加政策

runtime_cutover、native_semantics、rust_cancellation、contract_authorization、state_ownership、sidecar_execution。Rust/v2 application/domain/contracts 路径本地 bypass。TICKET-010 Human Gate、TICKET-011 cutover、可信终态与取消语义均按原规则。

## 验证

```text
bun run agent:jev:test
bun run agent:check
```

离线测试覆盖缺 key、非法/缺失响应、hard bypass、路径、真实 Windows junction、UTF-8 大小边界、secret non-disclosure、HTTP/超时降级。显式 `JEV_LIVE_SMOKE=1` 才运行 live：将本仓 helper/policy 复制到独立临时 fixture，以合成 active task 和进程 key 调用，记录实际 model/usage；不改真实 STATUS，不通过产品 Human Gate。此测试只证明 adapter HTTP 链路。

契约参考：[HTTP API](https://docs.typesafe.ai/api)、[Confidence](https://docs.typesafe.ai/confidence)。无 SDK、父级共享 runtime 或长期后台服务。
