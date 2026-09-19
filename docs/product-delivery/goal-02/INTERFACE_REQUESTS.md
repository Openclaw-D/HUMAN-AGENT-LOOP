# goal-02（产品交付四任务 · 任务二）· INTERFACE_REQUESTS

Writer：任务二路（Back/B、Back/C、Back/Connectors）。本轮以 A v2 现有契约完成主链贯通（无 OPEN 阻塞项）；
以下为联合消费确认项与给 01/03 的对接登记。状态由对应 owner 回填，申请方不代填。

## IR-02-A（→01，联验确认；非新接口）

**① v2 回执对账的归属过滤语义**
- 消费：`GET /api/v2/receipts/:requestId`（按 (tenant, principal) 过滤）。
- 本轮实现：每条 A 操作持久化原调用凭据（a_links.principal_id），对账用原 principal；已按真实内核 e2e 验证
  （G-A1 幂等重入）。
- 请确认：该语义为稳定契约（Gate 回执/analysis-runs/artifacts 三类写命令的 response 均完整存入 v2_idempotency）。

**② customerId ↔ aCustomerId 权威映射**
- 现状：`a_customer_links` 持久表（Connectors 侧）；种子仅可来自显式配置。生产语义=授权客户目录/归集流程（01 的任务书范围）。
- 需求：01 提供"按调用 principal 授权范围列客户"的权威读口后，本路把 `processing.aCustomerLinks` 静态种子降级为
  兼容路径（缺目录时诚实 skip 并留痕的现行行为不变）。
- 影响：未提供前不阻塞——未映射客户=显式 skipped+回执注明，不冒充闭环。

**③ 检查会话问题通道合并裁决（延续上轮登记）**
- 现状：处理链补证问题=Connectors `prepared_questions`（本地面，页面消费）；事实冲突=A `decision_findings`（复核队列）。
- 请 01 裁决：补证问题是否须并入 inspection_sessions 单一事实源。本轮未双写（避免两套状态）。

## IR-02-C（→03，页面消费面清单；C1-C3 接线用）

全部挂 Connectors 服务令牌面（`X-Service-Token`），已由 e2e 覆盖：

| 端点 | 用途 |
|---|---|
| `GET /api/connectors/processing/status?tid&cid` | 传输/解压/解析/事实/分析/提问/A登记 分段进度 + 问题清单 + 暂停态 |
| `GET /api/connectors/processing/tasks/:taskId` | 逐段回执、失败原因、aOps（A 侧逐操作状态：registered/unknown/failed + a_ref） |
| `GET /api/connectors/evidence/preview?tid&eid&cid` | 魔数嗅探格式 + 大小 + previewSafe + 短时签名 downloadUrl（原件预览不过公开目录） |
| `POST /api/connectors/evidence/manual-entry` | 扫描件人工录入 `{facts:[{factKey,value,unit,location}], enteredBy, reason}`；返回冲突；录入=转录≠核验 |
| `POST /api/connectors/evidence/correct-fact` | 更正 `{correctsFactId, fact:{value,...}, reason, correctedBy}`；修订链；A 回写状态随 `aSync` 返回 |
| `POST /api/connectors/questions/answer` / `questions/verify` | 页面问答 / 获准复核（verified 只能由此产生） |
| `POST /api/connectors/processing/pause` | 暂停（零新外发，代际推进） |

错误语义：确定性拒绝 4xx `{ok:false,error}`（页面可直接展示下一动作）；A 结果未知=任务 `blocked_unknown`（不是失败，
页面应展示"对账中"）；扫描件转人工=任务 `needs_followup` + `manual_entry_required` 问题。

## 本轮已消费的 A 面（登记，非请求）

`POST /api/v2/rule-pack-versions/activate`（policy 人类，测试种子）、`POST /api/v2/customers`（业务人类）、
`POST /api/v2/customers/:id/artifacts`（人类+客户范围；客户上传恒 unverified；派生件 provenance 约束）、
`POST /api/v2/customers/:id/analysis-runs/start|finish`（service）、`POST /api/v2/customers/:id/rule-gate-receipts`（service）、
`POST /api/v2/customers/:id/findings`（service 可建）、`GET /api/v2/customers/:id/artifacts`、`GET /api/v2/receipts/:requestId`。

## 状态登记（owner 回填）

| 编号 | 目标域 | 状态 | 落点/说明 |
|---|---|---|---|
| IR-02-A ① | goal-01 | OPEN | |
| IR-02-A ② | goal-01 | OPEN | 生产语义未变：01 提供权威目录读口后，种子降级为兼容路径（本轮已支持 a.customerLinks 兼容形态，见下） |
| IR-02-A ③ | goal-01 | OPEN | |
| IR-02-C 清单 | goal-03 | 已确认可消费（03 路 J1.1–J1.5 已页面化） | 03 路 2026-09-19 回执 |

## IR-03-8 关闭回执（2026-09-19 续轮；02 owner 裁决与落地）

03 路 `goal-03/INTERFACE_REQUESTS.md` IR-03-8 ①②③⑤ 由本轮全部关闭（判据与证据见本目录
TEST_RESULTS/CHANGELOG 续轮节、ROUND-LOG 02 路小节）：

- **① G3 推进（P1）→ 已关闭**：按建议映射落地（register_material→received、parse→parsed、analyze→analyzed、
  人工环节→needs_review、失败→failed）；`runRef=<taskId>:a<attempt>`（重试/恢复=新尝试）；requestId 确定性幂等；
  上报失败不阻断主链。真内核 G-A3 直查 A `artifact_processing` 验收。页面（03）零改动，读 A 获准披露面即可。
- **② 分析快照事实源（P2）→ 已关闭（裁决如下）**：manual-entry/correct-fact 事实并入四域分析输入——
  录入/更正=source_supported；**manual_entry_required 问题获准复核 verified 后该件转录事实升 verified**
  （verified 只由获准复核端点产生）；被人工取代的 parse 值不进快照；人工事实变更自动重入分析
  （新收口 requestId 带 `-<finId>` 作用域，历史回执保留）。效果：人工路线 NEEDS_EVIDENCE→复核→**CLEAR** 可达
  （M3 本地 + G-A3 真内核，CLEAR 回执真实到达 A）——J1.5 正向批准前置成立。
- **③ 判重键（P3）→ 已关闭**：判重收敛客户级（跨客户同字节各自处理，同客户判重保留）；既有绑定后新邀请
  显式 accepted（响应 `invitationAccepted:true`），可正常上传。
- **⑤ a_customer_links 运行时建立（P2，与 01 共担）→ 02 侧已关闭**：start-connectors 现透传 processing 配置
  与种子（`processing.aCustomerLinks` 优先，兼容 `a.customerLinks`）；落 `a_customer_links` 后以表为权威，
  与既有部署直插行（linked_by=goal-03-deploy-seed）兼容。**01 侧（授权客户目录归集）仍 OPEN**——目录读口
  提供后种子降级为兼容路径（IR-02-A ② 同源）。
- **④ kind 命名空间（→01）**：非 02 范围，未动。
