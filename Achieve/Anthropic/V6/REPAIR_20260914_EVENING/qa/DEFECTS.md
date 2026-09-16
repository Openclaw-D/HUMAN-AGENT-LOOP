# D路 DEFECTS —— 首轮（REPAIR_20260914_EVENING）

> 归组规则：首轮缺陷**一次性**归组给原 owner（后续复测只验关闭，不改组）。
> 严重度口径：高=演示主线阻断；中=演示误导/功能缺陷；低=接口符合性/呈现级。

## E-01（低｜owner=A）shared-state 响应缺 `projectId` 字段（接口符合性）

- **复现**：`GET /api/v5-preview/demo/shared-state`。
- **期望**：INTERFACE.md §3 冻结形状含 `"projectId": "JW-2026-018"`。
- **实际**：`{ok, demoSessionId, sessionStatus, facts, pendingReview, evidenceCount, reviewCount}`——无 projectId。
- **证据**：`qa/logs/shared-state-r1.json`（SS-01b FAIL 项）。
- **风险**：消费方（B/C 候选按契约取值）取 projectId 得 undefined；当前页面未使用该字段，故无功能故障。
- **建议方向**：响应补 projectId 或在 INTERFACE v1.1 中明确移除该字段（二选一，以实际契约为准）。
- **owner**：A。**状态**：待 R1 修复/澄清。

## E-02（低｜owner=A）reset 后 sharedDemo 指针未按契约置 null（接口符合性）

- **复现**：`POST /api/v5-preview/demo/reset` 后 `GET /demo/shared-state`。
- **期望**：INTERFACE.md §1"重开清除为 null 并清除该会话及其证据/标注/复核/核算记录"。
- **实际**：指针保持固定值 `rs-demo-run` 不变；会话壳保留、其证据/标注/复核**记录确已清空**（SS-11g PASS），懒建复用同 ID。行为效果与设计意图一致（无业务事实残留、重试安全），但与冻结文本不符。
- **证据**：`qa/logs/shared-state-r1.json`（SS-11c FAIL+SS-11g PASS）；remote-session 列表仍含 `rs-demo-run`（空记录）。
- **风险**：低——无业务事实泄漏；跨轮复用固定会话 ID 反而利于演示一致性。属"实现优于/异于文档"的文档-实现漂移。
- **建议方向**：更新 INTERFACE §1 措辞（"指针保持稳定、记录清空、懒建复用"）或改为置 null；以实际选择为准。
- **owner**：A。**状态**：待 R1 澄清（改文档或改行为，二者其一即闭环）。

## E-03（低｜owner=A）尽调页客户端导航首入出现"尚无访谈会话"空态闪现

- **复现**：首页点击「远程尽调访谈」链接（客户端导航，非整页刷新）→ 页面先渲染"尚无访谈会话"空态（含创建按钮），数秒后自行变为已选专属会话的完整界面；整页 reload 无此问题（直接进入完整界面）。
- **期望**：会话存在期间不显示事实错误的"尚无访谈会话"（应为 loading 态或骨架）。
- **实际**：空态文案与事实不符（`GET /remote-session` 实际有 5 个会话含专属演示会话）。
- **证据**：D 实测快照（导航后 5s 空态 → reload 后 9s 完整界面）；无截图（首入窗口短，reload 复现路径稳定）。
- **风险**：演示者误以为数据丢失而重复创建会话；呈现级，不损数据。
- **建议方向**：C 组件已有 loading/error/empty/simulation/pending-human 五态——把"尚未取得 demoSessionId/会话列表"映射到 loading 态而非 empty 态（empty 仅在确认无任何会话时使用）。
- **owner**：A（集成接线；C 组件本身有 loading 态，属 page 层状态映射）。**状态**：待 R1 修复。

## 观察项（非缺陷，随 R1 一并裁量；不改组）

- **O-1（信息｜工具）**：IAB fullPage 截图对固定元素产生拼接重复（`r04-dd-1920-full.png` 双列假象）；视口级截图与 scrollWidth 断言均正常——**截图工具伪影，非产品缺陷**，本轮以视口截图为准。
- **O-2（信息｜A）**：A 未填 `messageExtras.origin`，来源标注由 B 契约的保守推导承担，实际标注正确（人工/预设/共享尽调）；如需"模型（演示）"精确标注需 A 后续供数。
- **O-3（信息｜遗留呈现差异）**：s09 叙事"四项并行补充已完成"而机制为固定顺序自动链（s05/s10/s16 hold 各附一证）——上轮 O-3 延续；本轮共享状态机制落地后，该文案与机制的差异仍如实存在，不做粉饰。
- **O-4（信息｜A 自报）**：A 未独立复测缩放（ADOPTION §R-08 如实声明），本轮由 D 以视口近似完成独立实测。
- **O-5（信息｜C）**：C 组件 1 条 lint warning（未用 props），A 保持 C hash 不变留 R1——未在本轮产生运行故障。

## 防回退抽查结论（非新缺陷）

- 上轮 D-01（幽灵条）/D-02（首点失败）/D-04（草稿丢失）对应面：新 DD 页数据接线层保留修复语义（A INTEGRATION_LOG 声明）；本轮中断恢复/发送/草稿实测无复发。
- 上轮 D-06/D-07（s12/s17 提示与选项矛盾）：本轮退回分支实测 s12 仅 confirm/correct、s17 仅 confirm，提示与行为一致——保持关闭。
