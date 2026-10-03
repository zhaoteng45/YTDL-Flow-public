# CodexPro 验收测试（可执行清单）

适用：验证当前 Windows 执行面上的 CodexPro 实例（MCP 工具面 + bash 运行时 + 文件/检索/git 工具）。
执行者：CodexPro 自身——用 `read` 读取本文件，用 `bash` 与其它工具逐条执行，最后按汇总表回报。

本文件必须放在 CodexPro 的 workspace 根目录内（CodexPro 无法读取 workspace 之外的文件，例如父级 vault）。其它 workspace 需要各自放一份。

## 执行规则

1. 每条报告：**命令 + exit code + stdout/stderr 摘要 + 判定**。MCP 工具（read/write/edit/apply_patch/search 等）没有进程级 exit code，记 `N/A`，不要虚构。判定只有三种：`PASS`（预期通过且通过）、`FAIL`（预期通过却失败）、`EXPECTED`（预期就是失败/被拒，且确实如此）。
2. 不得把 `EXPECTED` 记成故障；也不得把失败改写成"通过"。
3. **不要用默认超时跑长命令**：单命令默认超时 30 秒；需要时显式传 `timeout_ms`。**有效上限 600000**（`config.maxBashTimeoutMs` 默认 600000，可用 `CODEXPRO_MAX_BASH_TIMEOUT_MS` 至多抬到 900000；schema 虽声明 `maximum: 900000`，运行时按配置值钳制）。
4. 输出总量超过 **1000000 字节**（本机 `CODEXPRO_MAX_OUTPUT_BYTES`，默认 120000）会被截断**并终止进程树**；重输出命令须自行收窄（`| tail -n 40`、`> file 2>&1`）。
5. 测试文件只允许写**一个**、且必须写在**未被 `.gitignore` 忽略的路径**（见 C 组前置步骤；默认 workspace 根下的 `cx-selftest-hello.md`），结束时必须删除。不得执行 git 写操作，不得修改业务文件。若运行中断，手工删除该文件。
6. 完成度以实际执行为准：未执行的条目一律标注"未执行"，不得推测。
7. **若所在连接器禁止管道、重定向或复合命令**（部分 ChatGPT→CodexPro 连接器如此）：使用各条给出的「单命令等价」写法；无法等价时记 `N/A（连接器限制）`，不计 `FAIL`。

## A. 运行时与解析（防回归核心）

A1 一条命令批量检查名字解析与版本：

```bash
for c in bash python python3 uv bun git rg node cargo; do printf '%s -> %s | %s\n' "$c" "$(command -v $c 2>/dev/null || echo MISSING)" "$($c --version 2>&1 | head -1)"; done
```

预期（2026-09-21 本机基线；路径命中或版本严重偏离均记 `FAIL`）：

| 名字 | 期望路径 | 期望版本 |
| --- | --- | --- |
| bash | `/usr/bin/bash` | 5.x（Git for Windows） |
| python | `/c/Program Files/Python314/python` | 3.14.7 |
| python3 | `/c/Users/zhao/.local/bin/python3` | 3.14.7（**不得**命中 `WindowsApps`） |
| uv | `/c/Users/zhao/.local/bin/uv` | 0.12.17 |
| bun | `/c/Program Files/bun/bun` | 1.4.2 |
| git | `/mingw64/bin/git` | 2.55.0.windows.3 |
| rg | `.../WinGet/Links/rg` | ripgrep 15.2.0 |
| node | `/c/Program Files/nodejs/node` | v24.18.0 |
| cargo | `/c/Users/zhao/.cargo/bin/cargo` | 1.98.1 |

A2 别名回归检查（WSL 已卸载，别名不应存在；逐文件报告，避免管道 exit code 歧义）：

```bash
for f in /c/Users/zhao/AppData/Local/Microsoft/WindowsApps/bash.exe /c/Users/zhao/AppData/Local/Microsoft/WindowsApps/wsl.exe; do if [ -e "$f" ]; then echo "EXISTS(FAIL): $f"; else echo "absent(OK): $f"; fi; done
```

预期：两行都是 `absent(OK)`。若出现 `EXISTS` → `FAIL`（同名程序遮蔽风险回归）。

## B. 执行语义

| # | 命令 / 参数 | 预期 |
| --- | --- | --- |
| B1 | `echo ok` | exit 0，stdout `ok` |
| B2 | `pwd` | 输出等于当前 workspace 根（如 `/c/files/markdown/YTDL-Flow`） |
| B3 | `exit 7` | exitCode = 7 |
| B4 | `echo to-stderr >&2`；单命令等价：`cat /nonexistent-cx-selftest-file` | stderr 含 `to-stderr`（等价写法下为 `No such file or directory`） |
| B5 | `printf '中文 ok\n'; echo "a'b"`；单命令等价：`printf '中文 ok\n'` 与 `echo "a'b"` 分两次 | 中文与引号原样输出，无乱码 |
| B6 | `sleep 35`（**不传** `timeout_ms`） | 约 30s 后 exitCode ≠ 0 且 stderr 含 `Command timed out after 30000 ms` → **EXPECTED**（最慢的一条） |
| B7 | `sleep 5`，`timeout_ms: 20000`（若连接器禁止 `;`，分两次：`sleep 5` 再 `echo done`） | exit 0（显式超时下不被截断） |
| B8 | `seq 1 10000 \| wc -c`；单命令等价：`awk 'BEGIN{for(i=1;i<=10000;i++) s=s i "\n"; print length(s)}'` | exit 0，stdout `48894`（管道内消化不计输出预算） |
| B9 | 慢速持续产出命令（见下方 B9 说明），持续写满阈值 | `truncated: true`、stdoutBytes ≈ 1000000、exitCode 1（进程树被杀） → **EXPECTED** |
| B10 | `seq 1 120000 \| tail -n 3`；单命令等价：`awk 'BEGIN{for(i=119998;i<=120000;i++) print i}'` | exit 0，仅 `119998 / 119999 / 120000`（收窄写法有效） |

**B9 说明**（修订于 2026-09-21，第一次执行时样本量不足导致误判）：样本的**实际字节数必须大于阈值**，否则不会触发截断。

```bash
i=0; while [ $i -lt 200000 ]; do echo "line $i with some padding to grow the output quickly"; i=$((i+1)); done
```

- 该命令会持续产出（远超阈值），预期被截断并终止进程树：`truncated: true`、`stdoutBytes ≈ 1000000`（本机 1000039）、`exitCode 1`。
- **不要用 `seq 1 40000`**：它只有 228894 字节，远低于阈值（本机 1000000），不会触发截断（会得到 `truncated: false`）——先核算样本量再断言截断。
- 快产出命令（如 `seq 1 250000`，1638895 字节）同样会 `truncated: true`，但 `exitCode` 可能是 0 或 1——取决于截断发生时进程是否已结束；两种都算符合预期。

## C. 文件工具往返（只写一个未被忽略的临时文件）

**前置检查**（确认该路径不会被 git 忽略，否则 `show_changes` 看不到它）：

```bash
P="cx-selftest-hello.md"; if git check-ignore -q "$P"; then echo "IGNORED(请换路径): $P"; else echo "writable(OK): $P"; fi
```

预期 `writable(OK)`；若为 `IGNORED`，换一个未被忽略的路径再继续（例如 `<子目录>/cx-selftest-hello.md`）。

1. `write` 该路径，内容 `line-1`。
2. `read` 同一路径 → 内容为 `line-1`。
3. `edit` 把 `line-1` 改为 `line-2` → `read` 验证已变。
4. `apply_patch` 追加一行 `line-3`。**必须使用标准 unified diff**，否则会报 `No valid patches in input`：

   ```diff
   --- a/cx-selftest-hello.md
   +++ b/cx-selftest-hello.md
   @@ -1 +1,2 @@
    line-2
   +line-3
   ```

   → `read` 验证两行都在。
5. `show_changes` → **只看 `changed_files` 是否包含该文件**（不看 diff stats，统计口径由 E1 单独验证）。
6. 清理：`bash` 执行 `rm -f cx-selftest-hello.md`（单命令），再用 `read` 工具读同一路径 → 预期 `ENOENT`（等价于 `No such file`）。

任一步骤报错且与本清单描述不符 → `FAIL`。**不要写在 `.scratch/` 下**：多数项目 `.gitignore` 忽略该目录，`show_changes` 基于 git 视图会看不到，从而误判为失败（2026-09-21 在 lt-sc 实例上即因此失败）。本组已实测：`write` / `read` / `edit` / `apply_patch` / `show_changes`（changed_files）/ 清理全部可用。

## D. 检索与读取

| # | 操作 | 预期 |
| --- | --- | --- |
| D1 | `search` 查询 `yt-dlp`（或在仓库中确实出现的词） | 返回匹配，且后端为 `ripgrep` |
| D2 | `read` `.ai-bridge/PROTOCOL.md` | 成功返回内容（不要传过小的 `max_bytes`：read 的超限是报错而非截断） |
| D3 | `inspect_workspace` 或 `tree` | 返回目录结构，无异常 |

## E. git 视图（只读）

| # | 操作 | 预期 |
| --- | --- | --- |
| E1 | `show_changes`（默认参数） | 返回 git status 与 diff 统计；**不得**产生任何写操作。若返回 `git unavailable or failed: ... ENOBUFS`，记 `FAIL` 并附规模证据：`git status --porcelain \| wc -l`、`git diff \| wc -c`、`git diff --numstat \| wc -c` 与 `server_config.maxOutputBytes` |

**E1 已知缺陷**（2026-09-21 定位，属 CodexPro 上游）：`show_changes` 无论 `include_diff` 取值都会先无条件拉取**完整 diff**（`server.js:2105`），而该 git 调用使用 `maxBuffer = maxOutputBytes`（`gitOps.js:116`）。**完整 diff 超过该阈值时 `spawnSync` 直接抛 `ENOBUFS`**，导致 diff stats 一并失败（status 与 changed_files 仍正常）。实测：lt-sc 的完整 diff 为 435613 字节，在阈值 400000 时 E1 FAIL。**本机已把 `CODEXPRO_MAX_OUTPUT_BYTES` 提到 1000000（2026-09-21），同一 worktree 上 `show_changes` 恢复返回 diff stats（`changed:true`、additions/deletions 正常、无 ENOBUFS）**；超过新阈值仍会触发，根治需上游改为 numstat 或对超限降级处理。注意该阈值同时是 bash 输出预算。

**E1 前置测量（必做，先量化再判断）**：

```bash
printf "status bytes = %s\n" "$(git status --porcelain | wc -c)"; printf "diff bytes   = %s\n" "$(git diff | wc -c)"
```

- 两者都远小于 `maxOutputBytes` → E1 应通过。
- `status` 超限 → 连 `changed_files` 都会失败（status 路径同样受 `maxBuffer` 限制）。
- `diff` 远大于阈值（例如数十 MB）→ **不是 buffer 问题**：工作树里有海量被跟踪的生成物/删除项，须做仓库卫生（取消跟踪生成目录并提交），提高阈值无法解决。

**E1 各 workspace 实测（2026-09-22，阈值 1000000）**：

| workspace | status bytes | diff bytes | E1 判定 |
| --- | ---: | ---: | --- |
| YTDL-Flow（8790） | ~5 KB | 224738 | PASS |
| lt-sc-workstation-setup（8787） | 5177 | 435139 | PASS |
| GoblinVillageDemo（8789） | 小 | 4855 | PASS |
| 1lou-movies（8788） | 12745 | 879485 | **PASS（修复后）**：修复前为 1266781 / 62873464，属**仓库卫生问题**——9120 个被跟踪文件被从工作树删除（`.pnpm-store/v11` 4015 + 原型 `target/` 5073），另有 32 个文档/源码/锁文件删除。2026-09-22 已处理：`9d8d419`（取消跟踪生成目录 + 补 ignore 规则）+ `f99b8ac`（记录其余删除），status/diff 回落至阈值内，`show_changes` 恢复（changed_files 148、diff 879135、无 ENOBUFS） |

## F. 内置自检与配置

| # | 操作 | 预期 |
| --- | --- | --- |
| F1 | `codexpro_self_test` | `failed: 0`；记录 pass/warn 数量 |
| F2 | `server_config` | `bashMode: full`、`writeMode: workspace`、`toolMode: standard`、`bashRuntime: auto`；port 与所连实例一致 |
| F3 | `read_handoff`（仅当 `.ai-bridge/current-plan.md` 存在） | 能读取计划内容；该文件不存在时记 `N/A（条件不成立）`，不计 `FAIL` |

## G. 边界与安全（负面测试）

| # | 操作 | 预期 |
| --- | --- | --- |
| G1 | `read` 路径 `.git/config` | 被拒：`Path is blocked by safety rules` → **EXPECTED** |
| G2 | `write` 路径 `node_modules/cx-selftest.txt` | 被拒：`Path is blocked by safety rules` → **EXPECTED** |
| G3 | `write` 路径 `C:/Windows/Temp/cx-selftest.txt` | 被拒：`Path escapes workspace root` → **EXPECTED** |
| G4 | 事实记录（不是测试）：`bash` 用 `head -c 60 /c/files/markdown/1lou-movies/AGENTS.md` 读取**其它项目**的文件（若连接器禁止 bash 文件读取，记 `N/A`） | 预期**成功** → 记 `FACT`。含义：`bash` 以当前 Windows 用户身份运行，**不是**工作区沙箱；不要把它当作隔离边界。若输出末尾出现 `�`，那是 `head -c` 把中文 UTF-8 字符截在字节中间所致，与权限无关 |

## H. 汇总

执行完填写下表回报（每个实例一份）：

| 组 | 条目数 | PASS | FAIL | EXPECTED | FACT | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| A 运行时解析 | 2 | | | | | |
| B 执行语义 | 10 | | | | | |
| C 文件往返 | 6 | | | | | |
| D 检索读取 | 3 | | | | | |
| E git 视图 | 1 | | | | | |
| F 自检与配置 | 3 | | | | | |
| G 边界安全 | 4 | | | | | |

回报时请附：实例端口、workspace 根、CodexPro 版本、执行时间。

- CodexPro 版本字段**不在** `server_config` / `codexpro_self_test` 的返回里，需用 bash 执行 `codexpro --version` 获取（预期 `0.30.2`）。
- 执行记录（2026-09-21）：
  - 首次执行：23 PASS / 1 FAIL / 4 EXPECTED / 1 FACT。唯一 FAIL 是 B9——当时清单给的样本量不足（`seq 1 40000` 只有 228894 字节 < 400000 阈值），已按上述 B9 说明修订；另据首次执行反馈修订了 A2（去管道歧义）、B8（补实测值）、执行规则（MCP 工具 exit code 记 N/A）与版本字段来源。
  - 第 2 次执行（8790 / YTDL-Flow，修订后）：23 PASS / **0 FAIL** / 5 EXPECTED / 1 FACT → 验收通过（B9 实测 `truncated:true`、`stdoutBytes=400038`、`exitCode=1`；当时阈值为 400000）。
  - 第 3 次执行（8787 / lt-sc-workstation-setup）：21 PASS / 2 FAIL / 5 EXPECTED / 1 FACT。两个 FAIL 均已于 2026-09-21 处理：C5 属清单设计矛盾（`.scratch/` 被 `.gitignore` 忽略 → 已改为未被忽略路径 + `check-ignore` 前置门 + 只断言 `changed_files`）；E1 属上游 ENOBUFS（已定位根因，并把阈值提到 1000000 缓解）。

## 相关

- 实例的运行面与启动配置：`docs/agents/chatgpt-codexpro-collaboration.md`
- 本清单的基线来源（2026-09-21 修复与实测记录）：`C:\Users\zhao\.codexpro\backup\` 下的时间戳目录与父级 vault 的维护日志
- 预跑验证：本清单于 2026-09-21 在 8790 实例（workspace `YTDL-Flow`）上预跑，A/B/C/D/F/G 共 21 项全部符合预期（其中 B6、B9 为慢速或破坏性预期项，预跑时以等价方式验证）
