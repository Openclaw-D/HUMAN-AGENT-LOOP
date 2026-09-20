# 02路盘点 · 2026-09-20（writer：ZCode 02路）

任务：TAKEOFF-FA-1.0.0 真实前端（02_FRONTEND_SPEC 为视觉/交互依据）。本文件是本路依赖盘点与施工底账，只记录实测。

> **收尾状态（同日）**：本盘点结论已执行完毕——TAKEOFF 主屏/六助手/纯投影/清理/测试/构建/截图全部交付，见同目录 `DELIVERY.md` 与 `CLEANUP.md`；勘误：shared-types.ts 实际位于 `lib/v5-preview/`（非 edge/ 子目录），已随备份路径为准。01 契约仍未冻结（confirm-preassessment 缺口与撤回接线状态见 DELIVERY §4）。

## 0. 契约状态

- `Back/CONTRACT.md` 最新登记 **§12 / v2.5（2026-09-19 任务03）**；01路的 `confirm-preassessment` 兼容增量**尚未出现**。
- 结论：当前阶段只做①布局与视觉壳②旧展示清理③接**既有**Edge面的真实读投影（decision-status/artifacts/processing/channel/session/assessments/messages）；确认/撤回命令在01冻结前**只做入口+未接入态**，不猜业务字段、不造第二套状态机。投影层集中在单一模块，01冻结后只改该模块。

## 1. 源码布局（实测）

- `Front/preview/` = vite 根（`vite.config.mjs`：dev/build 端口3617、outDir=../dist；`tsconfig.json`、`vendor-types.d.ts`）。`main.tsx` → `site-mirror/app/workbench/root-app.tsx`。
- `Front/site-mirror/app/workbench/` = 真实办理工作本（root-app、customer-workbench、originals-panel+channel-card、verify-panel、qa-panel、proposal-panel、result-panel、invitations-panel、customer-portal、customer-directory、login-page、wb-parts+wb.css）。
- `Front/site-mirror/app/v5-preview/` = 旧训练分支（home-overview 六角色模拟）+ **被工作本复用**的文件（见§3）。
- `Front/site-mirror/lib/workbench/` = use-workbench.ts（会话/客户/快照/事件流）、wb-client.ts（Edge 面）、wb-logic.ts（纯投影，零 import 可单测）、recent-store.ts。
- `Front/site-mirror/lib/v5-preview/edge/` = edge-client、edge-logic、use-edge-live、edge-panels.css、shared-types。
- `Front/preview/demo-data.ts` = **孤儿**（全库无 importer）。

## 2. 依赖图关键边（grep 实测）

- `root-app.tsx` → `v5-preview/home-overview`（训练分支，待断开）；→ workbench 三屏（登录/目录/工作本）。
- `customer-workbench.tsx` → `v5-preview/domain-grid`（**复用，保留**）；→ edge-logic 的 derive* 系。
- `wb-client.ts` / `use-workbench.ts` → `lib/v5-preview/edge/edge-client`、`edge-logic`（**复用，保留**）。
- `domain-grid.tsx` → `rows-logic.ts`、`se-icons.tsx`、`home-icons.tsx`、`home-overview.module.css`（**保留**）。
- `home-overview.tsx`（唯一训练根）→ home-header/home-role-bar/home-role-view/lifecycle-strip/home-chat/role-cases/role-mock-adapter/role-contract/use-edge-live/edge-panels/edge-logic。
- `preview/test/role-mock-adapter.test.mjs` 只测训练 mock；`edge-logic.test.mjs`/`wb-logic.test.mjs` 测复用逻辑（保留并扩展）。
- behavior 测试（7个）+ `harness.mjs`（jsdom+RTL+tsx-loader）。

## 3. 保留 / 退休分类

**保留（被真实工作本复用或为安全/逻辑测试）**：domain-grid.tsx、rows-logic.ts、se-icons.tsx、home-icons.tsx、home-overview.module.css（domain-grid 依赖）、lib/v5-preview/edge 全部、workbench 全部面板、wb-logic/edge-logic 及其测试、behavior harness 与真实办理相关 behavior 测试。

**待退休（断开 root-app 导入后逐文件反向引用核验，备份校验后删）**：home-overview.tsx、home-header/home-role-bar/home-role-view.tsx、lifecycle-strip.tsx、story-strip.tsx、todo-row.tsx、home-chat.tsx、home-contract.ts、role-cases.ts、role-contract.ts、role-mock-adapter.ts、api-client.ts、use-edge-live.ts（若仅训练用）、edge-panels.tsx（若仅训练用）、preview/demo-data.ts（孤儿）、preview/test/role-mock-adapter.test.mjs（测试对象退休）。
新 TAKEOFF 行为测试接替其覆盖位置（不是把失败预期改绿）。

## 4. 必须从默认入口移除（T01 反例项）

- customer-workbench：阶段概览条（deriveLifecycleStages 全生命周期投影）、boardSummary 底部摘要行、BottomChat 收起条里的"敞口合计"额度口径、底部页脚旧描述 → 由 TAKEOFF 主屏替换。
- proposal-panel：`facility.approve/activate/suspend`、`fr.create/fr.reserve`（预占）等正式额度/融资操作按钮（L453-507）→ 本轮默认路径移除；方案面板保留域结果/依据包（受控动作）+ 预评估确认（01冻结后接线）。
- 顶部不显示总进度/额度使用率；不显示合作历程。

## 5. 运行入口与资源边界

- dev/build/preview/typecheck/test 见 Front/package.json；dist 由 build 产出（用户要求的发布文件）。
- 接手时已监听：3617/3618/48110/48190/48200/48210/15442（PID 快照见 CURRENT_STATE.md）——**不属于本路，不停不占**。本路自验一律用独立端口（如 3632 dev / 3633 preview），截图用独立测试上下文。
- Edge 默认地址（dev 3617/3618 下）= http://127.0.0.1:17935（root-app defaultEdgeBase）。

## 6. 风险与顺序

1. 先断训练分支（root-app 去导入）→ 引用核验 → build 绿 → 再删文件。
2. TAKEOFF 主屏新组件放 `site-mirror/app/takeoff/`（新目录，不与 workbench 混写）；workbench 面板按需改造复用。
3. 二十格数据源=既有 Edge 读面投影（takeoff-projection 纯函数模块，wb-logic 同纪律：零 React、可单测）；displayBucket 只从服务端字段计算，分母未知=null。
4. 01 冻结后：加 confirm-preassessment 命令面（wb-client 增方法 + 结束对话框接线）。
