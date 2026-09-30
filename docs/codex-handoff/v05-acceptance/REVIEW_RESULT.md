# V0.5 三路 ZCode 独立验收

2026-09-30，Codex。结论：**整改，整体未通过，不进入 V0.5 发布/标签环节**。本报告不改写执行者原始报告；用户视觉与业务验收仍未完成。

范围：docs/integration/2026-09-30-final/00_SCOPE.md 的三路冻结交付。用户最新要求：只看 PC、响应式布局，以 1920×1080 为主，不考虑手机。本轮没有修改产品代码，没有 commit/push/tag，没有接管其他 writer。

## 独立通过的检查

- 当前 Front 测试 164/164，typecheck 退出 0。日志 `.local/v05-independent/front-tests.log` 与同目录类型检查日志。未另跑一次 build；直接校验交付 dist 指纹。
- Back/A/test/ten-cases.test.mjs 在独立 jw-integ-back2-pg 测试库执行 11/11；日志 `.local/v05-independent/back-ten-cases.log`。只启动了已知隔离测试容器，没有重置 v05 展示库。
- dist 的 index.html SHA256 为 `30d30cac98bee093c89bcb66f481e8d0844f1490421a7361f1bc6d27ecdf90e1`；index-Bs_MNrNz.js 为 `ebfa9c281374db8d882e123a77add8fee47433d722b89241dbd787921345a914`，与 01 冻结交付相符。
- 48431 受控角色登录、A 权威十案例清单可读。后端存在真实作业、依据及周期门；不可把这项解释为十条页面路径全部通过。

## 阻断与证据

| 编号 | 判断/影响 | 证据与归属 |
|---|---|---|
| ACC-01 | **FAIL**：目录没有显示真实检查点和下一动作，差/中/好标签也退回“案例”。已走流程被显示成“尚未开始办理”，用户无法知道从哪一步继续。 | PC 浏览器独立复现；directory-ax.txt、directory.png；Front/site-mirror/lib/workbench/arrow-cases.ts:50-57 只读取 scenarioLabel、字符串 checkpoint、单 nextAction；A 实际返回 category、checkpoint 对象、nextActions 数组。01 writer。 |
| ACC-02 | **FAIL**：已准备的五区检查点属于协调身份，角色入口优先进入单专业身份且没有协调身份的可达入口；原检查点流程不在当前专业页内呈现。 | 独立 API：biz1 在 case-04 的 history receipts=0，而 adv1 有 5 条；cred1 为另一个局部流程。role-entry.tsx 单角色 auto 分支绕过协调身份选择。页面 case-02 可见业务材料/分析完成，其余区未开始，不能据此宣称已展示种子资产核验/拒绝轨迹。01 writer；需消费已授权客户轨迹或显式选择已有协调身份，不可偷偷借权。 |
| ACC-03 | **FAIL**：回执登记后不能从页面结清，返单成功新周期也未被证明。 | cycles-panel.tsx canSettle 只认 external_receipt_recorded/ready_to_settle；A cycles.ts 实际保持 awaiting_external_receipt，读面为 **externalReceipt**（数据库列才叫 external_receipt），并返回 reorderOfCycleId。03 报告以 API 完成 case-09 结清；case-10 的 409 REORDER_REQUIRES_FRESH_CASE 仅证明安全拒绝，不能证明返单成功。01 writer。 |
| ACC-04 | **FAIL**：人工核验表单要求“依据写入留痕”，实际请求没有提交 basis。 | human-verification.tsx:63/74 收集并展示 basis，但 :87-95 registerArtifact 的 content/materialMeta 均不带它；现有 02 契约已经支持 content.note。应保存原件引用、核验说明并可回读，不得只保留对话框文案。01 writer。 |
| ACC-05 | **FAIL**：Start-JW 宣称部分恢复/强制初始化，实际已有服务时失败。 | 独立执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-JW.ps1 -Init -NoBrowser`，已有 v05 服务时退出 2，报 48491 端口占用；未停止任何服务或修改案例。Start-JW.ps1 同一分支用于不完整就绪，integration-up.mjs:123-125 任何占用即失败，未实现已登记本栈的部分复用。日志 start-init.log。03 writer。 |

DEF-03-09（分析按钮不发 POST）：**执行者已报告，独立复现待补**。当前 case-04 已被运行检查改变；cred1 的 plan 已返回 HUMAN_SELECTION_REQUIRED，不能用当前状态冒充原 available=true 的复现。原 writer 应用独立新测试批次记录 plan→确认→POST 或明确拒绝提示。

## 验收口径纠正

03 RESULTS.json 的十例 PASS 混合后端检查点、部分页面操作、API 代办及安全拒绝；与 00_SCOPE/ACCEPTANCE.md 的十例实际页面闭环不一致。病例 09 API 结清、10 返单被拒必须分别记录页面未通过和正向返单 NOT_RUN/未通过。后端安全门拒绝可单独 PASS。

展示批次已被测试改变：独立读取时 case-06 为 conflict_review，case-09 为 closed_reorderable；它们不是指定的“待核验/履约待回执”首次展示状态。复验使用独立新批次，验后另准备未被操作的展示批次；保留所有旧历史。

## PC 布局观察与限制

独立浏览器按用户要求设为 1920×1080；保留原浏览器缩放。CDP 实测 zoom=1.46，CSS 可视区域约 1315×739。因此截图只能证明该 PC 环境的观察，**不能冒充 1920×1080、100% CSS 视口验收**。当前工作台及助手可见，专业确认浮层覆盖部分矩阵；目录横向导航存在，但真实状态展示错误仍阻断可用性。窄 PC 的四页、表单、弹窗和助手完整响应式验收尚未完成；手机不在范围。

页面证据：`.local/v05-independent/workbench-pc.png`、`workbench-ax.txt`。测试日志/截图仅本地，未上传含会话的原始浏览器 profile 或运行配置。

## 下一步

原 01 writer 完成 FRONT_REMEDIATION.md；原 03 writer 完成 RUNTIME_REMEDIATION.md 并等待 01 冻结后逐例页面复验。更改契约涉及 Back/A/B/C 时先交回 Codex 明确归属，不跨 writer 私改。必要项通过后再做用户演示与版本封存；发布另按用户授权执行。
