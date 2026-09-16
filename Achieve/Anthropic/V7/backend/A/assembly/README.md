# assembly/README｜A 组合层（CONTRACT §6）

职责：把 B/C 发布产物与 A 业务 API 组装为可运行整体，固定版本/hash，交 D 独立黑盒测试。**不复制、不修改其他路原件。**

## 接入点（当前 → 目标）

| 缝位 | 当前（A 预建占位） | B/C 交付后 |
| --- | --- | --- |
| 模型候选意见 | `sim-round.mjs` provider=`simulation`（诚实占位） | B 编排器经 `POST /api/v7/runs/:id/opinions`（provider=`real_http`+requestReceipt）或直连 `service.addOpinion` 接入 |
| 升级/未知 | demo 内 `POST /runs/:id/state` | B 的补证等待/人工中断/恢复走同一命令（幂等+版本门由 A 保证） |
| 规则包 | `sim-round.mjs` 种子规则 | C 规则/提示词包按 `RuleVersion` 形状经 `POST /api/v7/rules` 发布（版本不可变） |
| 计算工具 | demo 占位 calculation 记录 | C `calculation-tool` 输出按 `calculation` 形状经 `POST /runs/:id/calculation` 落库（toolVersion/inputHash/assumptions 必填） |
| 案例与预期 | `test/` 内合成断言 | C 案例数据 + 预期 → D 断言素材 |

## 组合产物固定方法

1. B/C 交付时各带 RESULT + 文件 hash；assembly 在本目录写 `MANIFEST.md`：来源路径+hash+组装方式（不复制原件，运行时以模块路径引用或其自带依赖目录）。
2. 组合后由 A 重跑：`node --test test/` 全套 + `scripts/demo.mjs`（against assembly 入口）+ D 黑盒（D 自有目录/端口）。
3. 任何接口不符 → B/C 走 `interface-change-request.md` → A 升 CONTRACT 版本，不改他路原件。

## 已验证

- `sim-round.mjs` 实测（2026-09-15）：完整回路 pending→candidate_ready→人工 return_for_evidence→pending，formalOutcome 正确，见本文件同目录运行记录（STATUS 时间线）。
