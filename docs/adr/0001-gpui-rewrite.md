# 采用 GPUI 重写前端基座（学习载体定位）

评估结论原本是「暂不替换」：GPUI 在 Windows 存在未修复的中文 IME 崩溃 bug、pre-1.0 API 漂移、打包方案真空（原证据路径 `.scratch/gpui-eval/research/gpui-windows-readiness.md` 已移除，2026-08；现存迁移记录见 [MIGRATION_HISTORY.md](../architecture/MIGRATION_HISTORY.md)）。但项目定位被维护者确认为**作品集 / 学习载体**（探索本身即目的），权衡后裁决立项：以独立仓库垂直切片起步，将应用从 Tauri 2 + Vue 3 整壳替换为纯 Rust + GPUI。本文记录这一「逆评估结论而行」的决定及其依据。

## Status

abandoned · 2026-09-03（子项目 ytdl-flow-gpui 试验已被用户明确废弃并物理删除，主线回归 Tauri 2 + Vue 3）

## Considered Options

1. **维持现状**（评估推荐）——产品侧最优，但学习载体定位下探索收益权重更高，否决。
2. **远期愿景 + 重访触发条件**（原推荐路径）——被「仍要立项」裁决取代。
3. **立项重写**（采纳）——明知用户侧成本（功能冻结、回归窗口、IME 风险），换取单语言 Rust 栈与 GPU 渲染上限。

关键事实输入：核心五步功能中四步纯点击、URL 输入以粘贴为主（IME 暴露面窄）；产品核心复杂度在任务队列状态机与进程树管理，与渲染层无关。

## Consequences

- **无渐进路径**：webview 应用无法逐组件换 GPUI，采取大爆炸切换；Tauri 主线在切片期间只收关键 bugfix（含 yt-dlp 非零退出误报成功的修复），冻结新功能。
- **IME 风险降格为受控风险**：#56149 / #56327 / #59882 未修复不再是阻塞项，转为切片必测的 IME 行为矩阵（纯粘贴 / 拼音模式手改 URL / 模板中文输入 / 中文标题选中复制）。
- **API 漂移对策**：锁定 gpui 具体版本/commit，跟随其发布节奏迁移。
- **TaskQueue 迁移采用行为锁定的直译**：先将被 Vitest 锁定的行为规格移植为 Rust 测试（红），再 tokio 实现（绿）；杀树语义不可削弱。
- **queue-viz-retry 决策图继续走完**：其错误上报形状、瞬时信号清单、退避参数等决议同时充当 Rust 版任务队列的行为规格（双消费者）。
- **完成定义收窄**：v0 = 核心三步路径对等（粘贴→选格式→下载完成），主题先 1 套、i18n 先 zh-CN；13 主题 / 双语 / WCAG AA 映射为 M2/M3 后续里程碑。
- 分发链（安装器/签名/自动更新）在 M2 前悬置，v0 以开发态运行。
- 该试验已结束；简化后的迁移脉络见 [`docs/architecture/MIGRATION_HISTORY.md`](../architecture/MIGRATION_HISTORY.md)。
