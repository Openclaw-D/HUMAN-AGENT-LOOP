# 02路 清理记录 · 2026-09-20（writer：ZCode 02路）

范围：`Front/**`（本路独占 ownership）。原则：先断开 → 逐文件反向引用核验 → 构建验证 → 备份校验 → 删除 → 本登记。不把失败预期改绿；退休测试由新 TAKEOFF 测试接替覆盖。

## 一、已删除（26 个文件；备份+SHA256 见同目录 `retired-backup/`，清单 `retired-backup/SHA256SUMS.txt`）

### A. 训练/模拟分支（01 §4「不做」：旧训练入口不混入真实办理）

| 文件 | 删除理由（引用核验结论） | 恢复方式 |
|---|---|---|
| `site-mirror/app/v5-preview/home-overview.tsx` | 训练根。唯一外部 importer=root-app（已断开） | 复制回原路径，或 `git checkout HEAD -- <路径>`（删除前均被跟踪） |
| `v5-preview/home-header.tsx` / `home-role-bar.tsx` / `home-role-view.tsx` / `home-chat.tsx` / `home-contract.ts` / `story-strip.tsx` / `todo-row.tsx` / `lifecycle-strip.tsx` | 仅被 home-overview 簇内部引用 | 同上 |
| `v5-preview/role-cases.ts` / `role-contract.ts` / `role-mock-adapter.ts` | 训练 mock；唯一外部引用=其测试（一并退休） | 同上 |
| `v5-preview/api-client.ts` | 仅被 home-contract/story-strip（训练簇）引用 | 同上 |
| `v5-preview/edge-panels.tsx` | 仅被 home-overview/home-role-view 引用 | 同上 |
| `lib/v5-preview/edge/use-edge-live.ts` | 仅被训练簇引用；use-workbench 仅注释提及（注释已改写）。工作本连接纪律在 use-workbench 内自持 | 同上 |
| `lib/v5-preview/edge/edge-panels.css` | 仅被 edge-panels.tsx 引用 | 同上 |
| `preview/test/role-mock-adapter.test.mjs` | 测试对象已退休；由 `preview/test/takeoff-projection.test.mjs` + `preview/test/behavior/takeoff-board.behavior.test.mjs` 接替覆盖 | 同上 |

### B. 旧看板展示（被 TAKEOFF 主屏替代；01 §5「必须替代的旧设计」）

| 文件 | 删除理由 | 恢复方式 |
|---|---|---|
| `site-mirror/app/workbench/customer-workbench.tsx` | 事项卡+阶段概览条+底部沟通+敞口合计的旧工作本壳，被 `app/takeoff/takeoff-screen.tsx` 替代；唯一 importer=root-app（已改挂新屏）。其复用的 DomainGrid 仅余 v5-preview 内部引用（见 C） | 同上 |
| `v5-preview/domain-grid.tsx` | 唯一外部 importer=customer-workbench（已删）。新二十格为 `takeoff/takeoff-cell.tsx`（扇区/霜/角标语义与四段格子不同，非复制替代） | 同上 |
| `v5-preview/rows-logic.ts` / `se-icons.tsx` / `home-icons.tsx` / `home-overview.module.css` | 仅被 A/B 簇文件引用（逐文件 grep 核验） | 同上 |
| `lib/v5-preview/shared-types.ts` | 仅被 A/B 簇引用。**勘误**：本路 INVENTORY §1 曾记其位于 `lib/v5-preview/edge/` 下，实际在 `lib/v5-preview/shared-types.ts`，以本条与备份路径为准 | 同上 |
| `preview/demo-data.ts` | 全库无 importer（孤儿样例） | 同上 |
| `preview/test/behavior/board.behavior.test.mjs` | 断言旧事项卡/阶段概览（本轮明确移除的展示）；由 `takeoff-board.behavior.test.mjs` 接替（含 T01 反例断言） | 同上 |

### C. 保留的 v5-preview 资产（禁止整目录盲删的兑现）

- `lib/v5-preview/edge/edge-client.ts`、`edge-logic.ts`：工作本 HTTP/SSE 层与纯逻辑层，wb-client/use-workbench/面板持续复用；`edge-logic.test.mjs` 继续生效。
- `lib/workbench/` 全部面板（originals/verify/qa/proposal/result/invitations/portal/directory/login/channel-card/wb-parts）继续被 TAKEOFF 主屏复用。
- 行为测试 harness 及 directory/portal-upload/originals-unified-upload/proposal-panel/workbench-hook/result-reconcile 六个行为测试全部保留且绿。

### D. 代码内退役（不删文件，改内容）

- `site-mirror/app/workbench/root-app.tsx`：删除训练分支（HomeOverview 导入/TrainingBanner/landing 训练卡）；默认唯一入口=首次预评估办理。
- `site-mirror/app/workbench/proposal-panel.tsx`：移除正式额度/融资操作入口（facility.propose/approve/activate/suspend、fr.create/reserve/commit/release/disburse 的按钮与表单态 amountMinor/months/frAmount/frType、isApprover/isBusiness/facility 变量）；保留评估候选、冻结依据包、域意见登记、decision-status 展示；冻结按钮角色口径不变（credit/business/admin）。底层兼容能力在 A/Edge，未动。
- `site-mirror/lib/workbench/wb-logic.ts`：删除 deriveLifecycleStages/deriveBoardSummary（全生命周期投影）及其测试用例；其余函数保留。
- `preview/tsconfig.json`：include 增 `app/takeoff/**`；`preview/index.html` 标题更新。
- `lib/workbench/use-workbench.ts`：仅改写第 2 行注释（原提及已删除的 use-edge-live），逻辑零改动。

## 二、未删除的边界项（为什么保留）

- facilities/financingRequests 相关底层代码（A/Edge/读模型）：历史数据与既有测试依赖，本轮只停用默认入口，不删兼容层（04 §7）。
- `wb-logic.ts` 其余通道/线程/预览投影：当前主屏与面板在用。
- docs/archive/Achieve/Anthropic/ 历史快照：不在本路 ownership，且按根部纪律只读。

## 三、引用核验与构建证据

- 逐文件反向引用 grep（site-mirror/preview/package.json 全量）+ 删除后 `typecheck` 绿 + `build` 绿 + 70/70 测试绿（详见 DELIVERY.md §3），证明无悬空引用。
- 备份完整性：`retired-backup/SHA256SUMS.txt` 26 行，与删除前工作区逐文件一致（sha256sum 校验）。
- 未 commit/push/切分支/worktree；删除均为工作区改动，可随时经备份或 git HEAD 恢复。
