# 见微 V3 历史参考材料

更新：2026-08-29

## 用途

本目录保存从旧版见微 / JW 中精选出的本地参考副本，用于 V3 产品方向、信息架构、材料链路与证据治理设计。

这些文件是 **reference only（仅供参考）**，不是 V3 的产品契约、运行时数据或业务权威。V3 的当前方向只由根目录的 `V3_DIRECTION_HANDOFF.md` 与用户逐项确认后的 `V3_DIRECTION_FREEZE.md` 决定。

## 保留原则

- 只复制，不移动；旧 Archive 原件保持原位。
- 只带入可复用的方法、数据契约和一个可人工浏览的样本，不复制约 611 MiB 的全部旧图片。
- 旧 `projectId`、旧角色、旧流程、旧风险结论和旧 mock 行为不得直接成为 V3 语义。
- 后续 V3 仍以 `FinancingLeasingCase` / `caseId` 为唯一业务事项权威。
- 若参考文件与 V3 冻结稿冲突，以 V3 冻结稿为准。

## 目录说明

### `01-product-loop/`

- `WEIJIAN_V0.2_PRODUCT_PIVOT_CODEX_HANDOFF.md`：旧版人机共同判断产品中心，重点参考 `Observe -> Evidence -> Update -> Verify -> Rejudge`。

### `02-material-evidence-contract/`

- `P5-NATIVE-MATERIAL-PACKS.md`：合成材料包、SHA-256、导入限制与人工确认边界。
- `P5-DATAPACK-MAPPING.md`：原始材料到 `MaterialVersion`、候选结果、人工确认、`FactVersion` 和风险重投影的链路。
- `P02-INTEGRATION.md`：项目隔离、材料读取、证据定位、修正和前后端集成边界。

### `03-multi-case-ui-reference/`

- `projectSelection.ts`：旧版多项目视图与分组维度契约。
- `ProjectSelection.tsx`：旧版多项目选择页实现，仅供交互与信息架构参考。
- `见微-前端展示页.html`：旧版静态展示页，可直接在本地浏览器打开。

### `04-raw-material-sample/project-01/`

一组 22 张去标识化合成图片样本，覆盖证照、身份、厂房现场、生产过程、设备、铭牌、原料与成品等。它用于理解“原材料如何进入 Case”，不代表 V3 Golden Case 的最终输入包。

## 未复制的完整历史材料

完整旧图片库仍位于：

`C:\Users\22673\Desktop\Archive\Compare-Material-Archive-20260814\p5-materials`

当前核对结果：565 个 PNG，约 611 MiB。只有当 V3 Golden Case 的 input/output contract（输入输出契约）冻结后，才从中二次筛选或重新生成融资租赁专用材料，避免先复制大量最终不会使用的资产。

## 当前可复用与不可直接继承

可复用：材料版本化、来源追踪、证据定位、候选结果、人工确认、不可变事实版本、按 Case 隔离、错误关闭与可回放流程。

不可直接继承：旧项目叙事、旧页面命名、旧风险口径、旧审批路径、旧硬编码数据，以及“多个卡片点击后进入同一个项目”的演示捷径。
