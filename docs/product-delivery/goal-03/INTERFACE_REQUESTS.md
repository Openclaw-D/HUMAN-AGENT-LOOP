# goal-03 INTERFACE_REQUESTS（2026-09-19 续轮更新）

本路（03：Front/Edge）对上游的接口需求与提供面回执。状态由对应 owner 回填，申请方不代填。

## 状态更新（2026-09-19 续轮）

- **IR-03-1 客户目录：已满足**（上轮接线 A G1，本轮浏览器复测通过）。
- **IR-03-2 受限邀请：已满足**——A G2 两步流（code 明文一次 + redeem 返回 cit_* 凭据）。本路页面：业务创建/撤销 + 客户兑换即绑定 Edge 会话。**IR-03-2 原提案（一步流凭据/DELETE 撤销/403 语义）撤销，以 A v2.4 冻结为准。**
- **IR-03-3 原件预览：通道件已接**——02 路 `evidence/preview` 短时签名 URL 经 Edge 只读代理（`/api/jw/v2/connectors/evidence/preview`）已在材料页接线；**A 档案信封件（envelope v0）预览仍待 A 单件读端点（正式需求 a/b 维持）**。
- **IR-03-4 评估/申请权威清单：开放（维持）**——UI 维持"事件窗口非权威"标注。
- **IR-03-6 检查会话问题明细列表：开放（维持+扩展）**——扩展：G2 cit_* 客户身份不在 v1 会话名册，客户无法在检查线程内直接回答（当前经门户消息+补材料承接）。请 01 路裁决：名册角色绑定 cit_* 身份或提供客户侧只读/回答端点。
- **IR-03-7 页面化撤权：已关闭**——Edge 动作代理新增 DELETE 方法（CSRF 同 POST 管辖），A `DELETE /api/v2/customers/:id/grants/:principalId` 已页面化（受限邀请页 admin 对已兑换邀请「撤权客户身份」，级联停用 cit_* 身份）。

## IR-03-8（新，2026-09-19 续轮登记）

- **① G3 处理状态推进（→02，P1）**：`POST /api/v2/customers/:id/artifacts/:artifactId/processing`（A §11 G3，service 身份）至今无人调用——门户 my/materials 的 stage 恒为 registered。请 02 路在 a_bridge 增加阶段上报（建议映射：register_material→received、parse→parsed、analyze→analyzed、人工环节→needs_review、失败→failed；runRef=task_id+attempt）。
- **② 分析快照事实源（→02，P2）**：B 分析快照取自 `parse_results.declaredFacts`，`evidence/manual-entry` 落库的人工转录事实不进入四域分析输入——规则前置（requiredFacts minLevel=source_supported）因此无法被人工路线满足，Gate 恒 NEEDS_EVIDENCE（本轮真实链复现）。请 02 路裁决快照是否纳入人工录入/更正事实（含等级）。
- **③ 通道邀请判重键（→02，P3）**：intake 判重按 tenant+sha256（不含 customerId），跨客户同字节判 duplicate；且既有绑定使后续邀请无法转为 accepted（幂等空转）。请 02 路确认语义或按客户收敛。
- **④ kind 命名空间（→01，P2，呼应 DEF-G04N-02）**：检查会话材料前置按裸 kind（purchase_contract）匹配，通道登记件为 `material.purchase_contract`——页面侧以 A 档案直传（裸 kind）绕开；请 01 路在会话前置检查侧剥前缀。
- **⑤ a_customer_links 运行时建立（→01/02，P2）**：02 路确认"映射落表后以表为准"，但 start-connectors 不透传 `processing.aCustomerLinks` 种子（本轮以部署初始化直插权威表绕开）。生产语义=授权客户目录归集（01 任务书范围），请 01/02 排期。

## 本路新增提供面（→04 验收参考）

- Edge：`/api/jw/v2/connectors/**`（读）与 `/api/jw/v2/actions/connectors/**`（写）——处理通道 IR-02-C 消费面，服务令牌仅存 Edge 服务端；`/api/jw/v2/customers/:id/decision-status|domain-exemptions`（读）；`DELETE .../grants/:principalId`、`POST .../domain-exemptions`（写）。
- 页面：依据包冻结/详情（四域意见）/域意见登记/包绑定提案/候选登记/检查会话收口按钮/通道卡（邀请-绑定-上传-分段-A 留痕-预览）。

## goal-03e 状态更新（2026-09-19 下午）

- **IR-03-3 原件预览：三口并进**——①通道件：Connectors 签名 URL 归一代理已修复接线（`/api/jw/v2/connectors/objects/:ref` 原始字节透传），面内内联预览浏览器实证通过；②A 档案信封件：路B已冻结 CONTRACT §11.2 单件读回 `GET /api/v2/customers/:id/artifacts/:artifactId/content`，Edge 只读代理与页面「预览」已就绪并实测透传，**待 A 运行实例部署该路由后即亮（诚实 404 中）**；③正式 a/b（对象存储归宿）维持待上游。
- **IR-03-9（新登记，→无上游依赖，本路面内已交付）**：页内消息线程读面 `GET /api/jw/v2/customers/:id/messages`（DEF-G04N-05 修复面）。Edge 本地存储，受众边界服务端强制（customer-only 不可读 internal，403）；requestId 幂等重放不二次入栈；`?after` 增量游标。对 01/02 无诉求；如未来 A 提供权威消息面可平移替换。

## 本路新增提供面（→04 验收参考，goal-03e 增补）

- Edge：`GET /api/jw/v2/customers/:id/messages`（线程读，见 IR-03-9）；`GET /api/jw/v2/customers/:id/artifacts/:artifactId/content`（A §11.2 只读代理）；`GET /api/jw/v2/connectors/objects/:ref`（通道签名 URL 归一、raw 字节透传）。
- 页面：沟通栏/门户双向消息（轮询+sender 归属+送达态）；材料行「预览」+通道任务回执内「原件预览」面内渲染（图/文本内联、其余下载）。
