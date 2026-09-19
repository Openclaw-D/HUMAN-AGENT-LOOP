# 任务01（board-round-02）· INTERFACE_REQUESTS

登记人：任务01（前端）。日期：2026-09-20。
状态标记：OPEN（待 owner 裁量）/ CLOSED（已确认交付）/ OBSERVATION（仅声明，不需动作）。
依约：本路只在本文件登记；Back/CONTRACT.md 由任务03 维护，未交叉写入。

## IR-T01-5（CLOSED · 观测确认）通道回执按 requestId 的页面面路由

- 上一轮 IR-T01-3 请求的页面面对账口，本轮在合流栈实测已交付：`GET /api/jw/v2/connectors/processing/receipts/:requestId?tid=…`（Edge CONNECTORS_READ_ROUTES，ownership 预检；a_links 对账簿只读投影 `{ok, found, requestId, receipt}`）。
- 前端已接线消费：结果面板「查询通道对账回执」（found 渲染收据/未命中如实指引编号来源/404·503 如实显示不可用）；404/503 分支为前瞻防御，当前实测未触发。
- 感谢任务04；无遗留请求。

## IR-T01-6（OPEN · nice-to-have）客户门户重绑定体验

- 现状：通道邀请令牌一次性（intake/accept 换绑定）。客户门户会话失效（登出/会话过期/Edge 重启）后，门户无绑定查询面，需向办理人重新索取令牌再绑定一次。
- 影响：诚实阻断工作正常（页面禁用提交并引导），但合流栈重启或多日办理场景下客户侧有一次重复操作。
- 请求：任务02 评估——是否提供"凭有效客户会话查询本客户在册绑定/邀请"的只读面（或绑定令牌可重复使用语义）。若不提供，维持现状（页面文案已如实）。

## IR-T01-7（OPEN · nice-to-have）采购金额权威字段

- 现状：A 无"项目采购金额"权威字段（financing-requests 仅 amountMinor=融资金额；评估 candidate=supportableAmount）。看板顶部摘要按任务书要求将采购金额与融资金额分列，采购金额一行如实标注"以合同/发票原件登记为准（系统未单列采购金额字段，不用授信额度冒充）"。
- 请求：任务03/后续后台轮评估在融资申请或客户项目上登记采购金额（来源=合同/发票工件引用）的权威字段与版本化方式；字段就绪后前端改为直出服务端字段。

## OBSERVATION-1 材料种类词表

- 通道词表（CHANNEL_KINDS：bank_statement/purchase_contract/ledger_book/entity_register/device_photo/site_photo/invoice/document_sample）与 A 档案 kinds（含 equipment_list/financial_statement）不一致；门户/内部上传已统一按通道词表呈现，实际范围以邀请 allowedEvidenceKinds 为准（服务端强制，越界如实报错）。
- 无需本轮动作；若任务02 后续统一词表，请回传，前端同步下拉（不改数据流）。

## OBSERVATION-2 逐任务 note 字段

- 处理状态接口任务行含 `note`（如"A 客户映射未配置：预审结果仅存本侧"）。当前页面在任务回执阶段留痕呈现细节；任务行本身仅显示 status/cursor/bridge 列。若希望任务行直接透出 note，请确认该字段为页面契约的一部分（当前未在 CONTRACT 中看到其冻结描述），前端再加列。

## 本任务不请求、仅声明（沿上一轮，仍然有效）

- 前端固定 requestId（wb-cup/wb-chinv/wb-chacc/wb-cbind/wb-up 等）随载荷提交；服务端幂等表"同号重发吸收"语义是"不换号重试"纪律的前提。
- 通道对账编号体系：aBridge 登记动作用确定性编号（ptx-<taskId>-<op>），与页面提交编号（wb-*）分属两层；页面已在结果面板分别指路（A 回执口/通道对账口）。
