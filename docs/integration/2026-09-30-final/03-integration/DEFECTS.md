# V0.5 收尾轮 · 03-integration 跨 writer 缺陷清单

状态图例：`OPEN` 待原 writer 处理 · `FIXED-待复验` 原 writer 已修待 03 复验 · `CLOSED-已复验` 03 复验通过。

---

## DEF-03-06 · OPEN · 交 01（Front）· 目录卡"当前阶段/下一动作"未消费 A 权威清单的 checkpoint/nextActions

- **现象（v05 栈 48431 实测，2026-09-30）**：`GET /api/jw/v2/arrow-cases`（A 权威）每例已携带
  `checkpoint:{type,label,detail,evidence}`（对象）与 `nextActions:[{action,label,hint,factKeys?}]`（数组），
  但目录卡"当前阶段"显示缺省文案"尚未开始办理"、"下一动作"显示"进入案例按页面提示办理"。
- **根因**：`Front/site-mirror/lib/workbench/arrow-cases.ts` 的 `pickText(c,['checkpoint',...])` 只找
  **字符串字段**，而 02 CONTRACT_DELTA 定稿形状是对象/数组。这正是 01 DELIVERY §7 预留的
  "定稿后加候选名"兼容点。
- **建议修法（01 一处）**：
  `checkpoint: typeof c.checkpoint==='object'&&c.checkpoint ? (c.checkpoint.label ?? c.checkpoint.type) : pickText(c,['checkpoint','checkpointText',...])`
  ；`nextAction: Array.isArray(c.nextActions)&&c.nextActions[0] ? (c.nextActions[0].label ?? c.nextActions[0].action) : pickText(c,['nextAction',...])`。
- **复验**：01 重建 dist 后 03 在 v05 重载目录，十卡应显示各例 checkpoint.label
  （如 case-06"材料/分析已就绪：收入·主体·权属人工核验待办"）与 nextActions[0].label。

## DEF-03-07 · OPEN · 交 01 · 角色入口无法到达五专业协调身份，种子里程碑历史在页内不可见

- **现象**：01 任务4 的自动直进/选择器只覆盖"只含本角色"的单角色身份；`adv1`（五专业协调员，
  v05 检查点批次的流程 principal）从角色入口不可达。以 biz1 进入 checkpoint 批次案例时，
  看板/格子显示本人进程（未开始）——种子里程碑（case-02 已核验+409 留痕、case-07 已采用后补证等）
  在页内不可见（A 目录侧 checkpoint 摘要可见）。
- **影响**：00_SCOPE"进入案例看到已发生的流程"对协调员批次不完全成立；单角色办理流
  （01 设计主路径）不受影响（材料事实客户级共享，差例自行推进同样命中硬门/红线）。
- **建议（01 裁量）**：身份选择器增加"跨专业协调员"形态（如"评审协调员（五专业·演示）"手动选择，
  不自动直进）；或文档明确单角色演示流为正式口径。02 种子侧无需变更（principal 归属为既有设计）。

## DEF-03-08 · OPEN · 交 01 · 周期面板回执登记后不进入"可结清"分支（状态名映射差异）

- **现象（v05 实测）**：面板登记模拟回执成功（服务端 `external_receipt` jsonb 落库、Edge 200），
  但重开面板仍显示回执表单，不出现"回执已登记，可结清/结清"按钮。
- **根因**：01 `cycles-panel.tsx` 的 `STATE_LABEL/canSettle` 期望状态名
  `external_receipt_recorded/ready_to_settle`；02 A 实际状态机（cycles.ts:147）登记回执后
  **state 保持 `awaiting_external_receipt`**，回执在 `external_receipt` 字段（cycleView 已返回）。
  01 DELIVERY §7/NEEDS §3 已预留此对接点。
- **建议修法（01 一处归一化）**：读面 `state` 归一
  `const s = c.external_receipt && c.state==='awaiting_external_receipt' ? 'ready_to_settle' : c.state;`
  （登记后分支：显示回执摘要 ref/source/recordedBy + 结清按钮；结清仍走服务端 409 双保险）。
- **03 已用 API 完成结清证据**（与面板同接口，见 RESULTS case-09）；01 修复后 03 页面复验。

## DEF-03-09 · OPEN · 交 01 · 主"提交材料并分析"按钮在 v05 栈 plan 可用时不发 POST

- **现象（v05 栈，case-04=cust-munl4891，2026-09-30）**：选中信审列以 cred1（有 credit 角色）点击
  顶栏"提交材料并分析"：客户端发出 `GET advance-plan`（200，`available:true`）后**未发送
  `POST advance-rounds`**（Edge 日志零 [proxy] advance），页面无错误提示，状态不变。
  biz1 在商机列同按钮正常（case-06 已复现成功）；case-06 核验组件的 registerArtifact→advance 链也正常。
- **复现**：v05 栈 → case-04 → 切信审角色 → 信审列 → 点"提交材料并分析"；Edge 日志只有
  advance-plan GET。API 直连同会话 `advance-plan` 返回 available:true roundNo:1。
- **怀疑点（01 排查）**：column-advance 主按钮 plan→POST 之间的守卫（pending/localStorage 键、
  allowedActions 检查、异常吞没）在 registry 批次客户上提前 return；无任何用户可见反馈属次级问题
  （与 01 任务5"错误分清原因"一致，建议补提示）。
- **影响**：分析事件在 v05 的 UI 闭环被阻（补件/核验/采用组件链不受影响）；03 已用授权 API 完成
  case-04 补件证据（见 RESULTS），01 修复后 03 页面复验。
