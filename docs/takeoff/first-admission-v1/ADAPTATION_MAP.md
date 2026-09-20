# 适配映射 · 2026-09-20

基线 TAKEOFF-FA-1.0.0；本地/远端HEAD均8c6d3b0。下表是源码核对，不是运行通过。

| 分类 / 页面动作 | 当前落点与证据 | 最小适配 / 验收 |
|---|---|---|
| 复用：客户与本次评估 | Back/A/src/http/server.ts 的 customers/:customerId/assessments 创建/列表及 assessments/:assessmentId 读取；credit_assessments | 复用客户授权；首次回租需求归评估，不创建融资申请；T09/T12 |
| 复用：一次上传、看原件 | Front/site-mirror/app/workbench/originals-panel.tsx → ChannelCard；Connectors 处理/a_bridge → A artifacts | 维持唯一上传、可信客户绑定、原件引用与回执；绑定恢复仍需运行核对；T02/T05/T11 |
| 复用：补证、事实纠正、核验 | 工作本既有 verify/qa 面板，Connectors evidence 与处理协调器 | 逐动作核对授权/来源/回执；资产不被商务整列锁住；T03/T06/T12 |
| 补齐：同版候选方案 | credit.ts submitCandidate 当前白名单仅 tendency/supportableAmountMinor/currency/conditions/rationale/producedBy/warnings，未声明字段拒绝 | 扩展期限、价格与口径、修订号、输入/证据/规则/运行引用；保存历史，不拼字段；T04/T08 |
| 补齐：预评估人工确认 | credit.ts:764 decideAssessment 只接 reject_assessment/withdraw_assessment；http/server.ts:167，Edge proxy.mjs:86 | 新增独立语义命令及确认读回；不调用 facility.approve；T09/T10/T11/T12 |
| 补齐：二十格与六助手 | customer-workbench.tsx 仍为七阶段、六事项卡、右栏与底部沟通；现有消息可复用 | 按02替换布局；格子只读投影，点击打开真实动作；助手共享客户/评估/引用/草稿；T01/T03/T13/T14 |
| 补齐：模型到业务登记 | B transport 已有预算门；当前HTTP完整读取响应，未见流式消费 | 定向连接分析输出到候选/证据；无授权不出站；真实费用未知不记零；T07/T08/T14 |
| 停用：正式额度及用信入口 | proposal-panel.tsx:468 存在 facility.approve 按钮；Edge仍有设施/融资命令代理 | 从本轮默认页面和调用路径移除，保留兼容底层；不得仅隐藏结果继续调用；T01/T09 |
| 待删：旧展示分支和冗余资料 | 需先做实际引用/构建/数据依赖检查 | 无引用且可恢复才删除；本轮接手未新增删除 |

## 最小接口契约交接（拟新增，尚未实施）

A为唯一业务写入者。建议新增 POST /api/v2/assessments/:assessmentId/confirm-preassessment；Edge对应 /api/jw/v2/actions/assessments/:assessmentId/confirm-preassessment。不得改变旧decide/approve语义。A实施者先在Back/CONTRACT.md发布兼容增量后，其余路消费冻结字段。

请求绑定requestId、assessmentVersion、candidateVersion、inputVersion、basisRefs/快照标识、ruleVersion、outcome、rationale；客户与人类身份从权威评估/认证上下文确定，拒绝跨客户或自报角色。outcome须区分支持、附条件支持、不支持；撤回单独行政语义。不可豁免硬门按结果校验，负面结论不要求无价值工作刷绿。权限复用现有目录和权限机制，不擅自把业务角色升为信审；开发采用明确合成授权。

事务内重查权限、版本、依据当前性、冻结/冲突和结果所需条件；同号同载荷单效果，异载荷冲突；失败零部分写入。复用决定/事件/审计设施，必要加法迁移承载独立预评估状态；返回confirmationId、版本引用及scope=preassessment_only，GET评估可重读。后续证据改变仅标需复核，不覆盖旧确认。

必须前后只读比对credit_facilities、financing_requests、exposure_entries：此命令不新增/改变任何业务行。候选修订需保留历史，当前字段不够时作兼容增量，不另建平台。二十格只从有来源的必要事项计算；分母未知为null，未闭合最多75%，不得计时推进。

---

## 实施落点补记（2026-09-20 集成收口；上表"拟新增"各项均已落地，运行证据见 TEST_RESULTS.md）

| 分类 | 实际落点（真实接口与持久化映射） |
|---|---|
| 预评估确认（拟新增→已实施） | A：`POST /api/v2/assessments/:id/confirm-preassessment`（credit.ts confirmPreassessment；门序=幂等→行锁/scope→人类+credit 角色→严格 Schema→版本门→stale/快照工件/候选 inputVersion→**客户最新 Gate 回执硬门（非 CLEAR→409 GATE_BLOCKED；CLEAR 但换版→STALE_BASIS）**→assertNoBlockingFindings('preassessment.confirm')→快照内同键事实冲突 REVIEW_REQUIRED→同事务写确认/决定/审计/事件，零部分写入）。持久化：`preassessment_confirmations`（scope='preassessment_only'）+credit_assessments.status='preassessment_confirmed'+migration 012。账本三表零变化=机器断言（PA-12+链 #54+页面确认后复验）。Edge 代理白名单：`/api/jw/v2/actions/assessments/:id/confirm-preassessment`（actor/凭据服务端派生）。 |
| 候选方案 v2（补齐→已实施） | credit.ts submitCandidate 加法扩展：期限/参考价格+单位+口径/修订引用/输入版本/依据与运行引用；历史表 `credit_assessment_candidates`（§13.2）；stale 拒绝迟到覆盖（STALE_BASIS）。03 侧候选 v2（analysis_finalizations.amount_candidate）经字段映射进入（PROTOCOL §5.1）。 |
| 需求登记 §13.5（新） | migration 014：credit_assessments.admission_request jsonb+revision；命令 `POST /api/v2/assessments/:id/admission-request`（Edge 同白名单）；绝不写 financing_requests；读回 assessment.request+requestedAmountMinor 镜像；Edge admission 投影零改动透传；前端顶栏/商机格消费（未登记=待录入）。 |
| 五域词表（OBS-03-01→已闭合） | migration 013 四表 domain CHECK 重建五域；decision-support DOMAINS 扩 business；Connectors 装配 `aRegisterDomains` 加 'business' 后分析运行全量登记 A（配置位 takeoff-runtime.json）。 |
| 二十格权威投影 | Edge `admission-projection.mjs`（snapshot.admission，契约 §7：分母未知=null、不产生 100% 绿、霜冻仅投影）为规范业务投影；Front `takeoff-projection.ts` 纯展示转换并消费 admission（02 二轮起），双实现由"前端只消费不改判"纪律约束；页面格点击→takeoff-detail 五段抽屉（同源记录，无第二套状态）。 |
| 六助手受控动作 | 消息线程=既有 messages 面（服务端权威）；「受控简报」=服务端读面（finalization+admission+assessment）确定性组答（takeoff-assistant-brief.ts，真实模型 NOT_RUN 占位明确）；受控动作=上传补证（统一提交链）+questions/verify（获准复核）；聊天文本无业务写权限；同收口按助手去重。 |
| 租户权威归一（新，INT-01） | 装配 auth 条目携 tenantId→Edge 会话透出；wb-client 命令帧以会话租户为准（不再硬编码）；读面（finalization/status/preview/objects）tid 由 channel-authz 以 A 权威租户归一（kernel-store.checkCustomer 顺带返回），页面自报 tid 不采信。 |
| 人工事实 verified 唯一来源 | `POST /api/jw/v2/actions/connectors/evidence/manual-entry`（转录，source_supported；录入人服务端派生）+`questions/verify`（获准复核→verified+重入分析）；needs_human 件经 q-manual-<evidenceId> 迁移 material_received 后可核验。 |
| 停用：正式额度入口 | proposal-panel 已移除 facility/fr 入口（02 CLEANUP §D）；本轮默认路径无 facility.approve 调用；Edge 设施代理保留为底层兼容（非默认路径）。 |
