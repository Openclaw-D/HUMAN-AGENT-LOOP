# B0_BASELINE_MANIFEST｜V5-B1 前代码基线清单（只列清单，不 commit/tag）

生成：2026-09-06，ZCode B0。Git 快照原始输出见 `evidence/B0/git-snapshot-20260906.txt`（HEAD `63c41c3db138215d40470098d80c405f2a6fd679`，branch main，porcelain 79 条）。

## 1｜基线现状定性

- HEAD 仍是 **V3 archive 快照 commit**（`63c41c3 archive: preserve Jianwei V3 snapshot`）；工作区相对 HEAD 有 54 个 untracked（多数为整个 V4 目录）、12 个已删除、13 个已修改的 tracked 条目——**不是已冻结的 V5 代码基线**。任务书所述"333 文件快照"指 `archive/20260905-V4-before-V5-RISK` 的 SHA256 清单（文件系统快照），**不等于 Git commit/tag**。
- B0 未做任何 git 操作（无 add/commit/stash/checkout/clean），未还原或搬移任何用户改动。

## 2｜拟基线文件分类（供 B1 baseline commit 范围讨论）

### A. V4→V5 继承候选（untracked，构成当前全部可运行后端与工作面）

| 路径（site/ 下） | 内容 | B0 实测状态 |
| --- | --- | --- |
| `lib/v4life/**`（types/engine/seed/event-log/file-event-log/command-journal/replay/http/runtime） | 事件溯源内核、P1 candidate 隔离、durable journal | 全量测试绿（见 B0_REPORT §2） |
| `app/api/v4life/**`（cases 路由 7 个 + demo/reset + events/stream + verification） | HTTP 边界（含 ENG01 verification） | 27/27 quality 进程内绿 |
| `app/work/**`（WorkShell/VerificationPanel/verification-pending-store/模型/各域组件） | 五角色工作面 + 未决恢复 | 随全量测试绿 |
| `test/v4life-*.test.mjs`、`test/v4-*.test.mjs`、`scripts/v4life-*.mjs`、`scripts/run-localhost.ps1` | 612 测试 + 门禁脚本 | 612/612 |
| `docs/v4/**`、`docs/archive/**`、`app/api/v4/**`、`lib/v4/**`、`app/evolve/**`、`app/v4-surface-nav.*`、`standalone`（部分 D） | V4 文档与 legacy 第二实现（canonical 已降级为 legacy Candidate） | 只读保留 |
| `app/page.tsx`、`app/jw-front.tsx/css`（M） | 管理导航面 | 构建绿 |

### B. 用户改动归属待确认项（M/D 条目，B0 未触碰、归属默认=用户既有工作）

- M：`AGENTS.md`、`CHANGELOG.md`、`README.md`、`STACK.md`、`package.json`、`package-lock.json`、`app/jw-front.css/ts`、`app/page.tsx`、`scripts/run-localhost.ps1`、`test/backend-authority-integration.test.mjs`、`test/jw-front.test.mjs`、`test/v3-p2-integration-contract.test.mjs`
- D：`DECISIONS.md`、`ROADMAP.md`、`SITE_CONTRACT.md`、`docs/v3-archive/**`（5 文件）、`standalone/jianwei-v2.html`
- 归属判断：package/lockfile 的改动属历史授权安装/脚本接线（STACK 记录的 vinext 栈），其余为 V4 轮次与用户文档维护的累积结果。**归属最终由用户确认**；baseline commit 应把这些 M/D 显式包含或显式排除（二选一，不能静默）。

### C. 非 Git 数据边界（不进 commit、需另行备份策略）

1. `Anthropic/archive/20260905-V4-before-V5-RISK/`（333 文件 SHA256 快照，版本切换前保护）
2. `Anthropic/archive/工程基线/20260905-ENG01/` 与 `20260905-ENG01-R1/`（manifest.json 逐文件 SHA）
3. `Anthropic/V4/**`、`Anthropic/V5/**`（治理文档，工作区根部、不在 site 仓库内）
4. 运行时数据：共享 3100/3101 服务按 STACK/run-localhost 约定为进程内内存态（`V4LIFE_DATA_DIR` 仅 opt-in）——**B0 未连接运行服务核实实际配置，此项系按默认代码约定推断，标注"未核实"**（审查修订：不能仅凭默认约定断言运行现状）；`~/.zcode` 记忆目录（ZCode 自身）
5. `materials/`、`.codex-remote-attachments/`（workspace 规则：只读、不整理）

## 3｜恢复方案（B1 放行前置动作清单，均须用户对应授权）

1. **baseline commit**：由用户/Control 圈定 A+B 全集（或 A + 显式排除清单）后，在 site 仓库执行一次显式提交（信息建议 `baseline: V5-RISK B1 pre-code baseline (V4 inherit + ENG01 surface)`）——**须用户授权，B0 未执行**。
2. **annotated tag**：如 `v5-risk-b1-baseline`，指向该 commit——须用户授权。
3. 文件系统兜底：现有两个 SHA256 快照目录可作 commit 之外的恢复源；若 commit 前发生意外，按 manifest 逐文件 SHA 恢复后重验 612 测试。
4. 提交后以 `git status --porcelain` 应为空（或仅剩显式排除项）作为基线验收；B0 已留存 gate-time 快照供比对。

## 4｜B0 期间对基线的影响声明（Rev1 修订）

原文两处问题已按 B0_CODEX_REVIEW 文档质量补充更正：原"新增 5 个文件"与所列目自相矛盾（列目即 3 文档 + evidence）；"site 仓库零写入"无逐文件哈希证据。更正后：

- **文件数量（截至本次修订）**：ZCode B0 交付物共 **10 个文件**——`V5/backend/` 下 3 份文档（本文件、B0_REPORT、B0_INTERFACE_CANDIDATE）+ `evidence/B0/` 7 份证据（原 6 份 + 本次新增 rev1 复核快照）。`B0_CODEX_REVIEW.md` 为 Codex 所有，不计入 ZCode 交付物。
- **site 仓库零写入 = 自报**（无逐文件 before/after 哈希证据）。时点佐证：本次修订新增 `evidence/B0/git-snapshot-20260906-rev1.txt`（HEAD + porcelain 全量），与 gate-time 快照 `git-snapshot-20260906.txt` 排序比对 **79 条 porcelain 条目逐条一致、HEAD 相同**（63c41c3）。此为时点抽查，不等同逐文件哈希证明。
- `/tmp` 下 gate 日志已复制入 evidence；未动 3100/3101 进程；B0 全程无 add/commit/stash/checkout/clean。
