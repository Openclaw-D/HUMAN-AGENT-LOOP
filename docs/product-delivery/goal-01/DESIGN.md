# goal-01 A1｜最小消费契约冻结（v2.4 增量，2026-09-18）

状态：**FROZEN v1**（实现期发现契约错误只做加法修订并在此登记；消费者为 02/03/04 各自 writer）。
基线：`v02-goal1234-delivery@e4ed7a5`；契约主文档 Back/CONTRACT.md（本设计为 §11 登记的草案来源）。

## 1｜现有边界与实际消费者（A1 核对结论，不重搬）

| 边界 | 已有实现（本分支已核实） | 实际消费者 |
|---|---|---|
| 通用核心 | v1 内核：templates/projects/goals/evidence(≤v1)/claim/complete/accept/decide、outbox、幂等(v1/v2/检查会话三处)、审计、principal 校验 | B worker、Connectors a_register、Edge /api/jw 代理 |
| 租赁业务模块 | v2：customers/grants/relationships/artifacts/assessments/candidates/submit-review/decide、facilities、financing-requests/reserve..settle、decision-packages/findings/reports、检查会话、Gate 回执/分析运行/必需域政策/台账/提额/豁免 | Edge BFF、Connectors 协调器、测试 |
| 应用服务组合 | credit.ts `buildCreditCommands` + analysis.ts + inspection.ts 组合进 server.ts 单进程 | 同上 |

本轮**不做**边界大迁移（任务书：不全仓搬家）；增量按下述四组缺口。

## 2｜缺口与冻结契约（v2.4）

### G1 客户目录（权威分页查询；J1.1）

- `GET /api/v2/customers?search=&limit=&cursor=`：已验证**内部** principal 专用（roles 含 customer 一类客户联系人身份 → 403）；按 `principal_customer_grants` 服务器端过滤（customers='all' 的合成身份维持旧行为），越权不可见即不存在（不泄露）。
- 返回：`{ok, customers:[{customerId,name,status,createdAt,createdBy}], nextCursor|null}`；`search` 对 name 不区分大小写前缀/包含匹配；`limit` 默认 20 上限 100；游标=稳定排序键（created_at, customer_id）。
- 不聚合重计算（待办/下一步由消费方按需调 decision-status/findings 等既有读口）。

### G2 受限邀请与客户联系人身份（J1.1/J1.2；"新客户不依赖固定种子"）

迁移 `009_customer_invitations.sql`（只新增对象，回退=保留对象停用入口）：

- `customer_invitations`：invitation_id、tenant_id、customer_id、role（`customer-owner|customer-finance|customer-plant`）、allowed_kinds jsonb（材料种类白名单数组，非空）、subject_ref?、note?、code_sha256 UNIQUE、expires_at、status(`active|used|revoked`)、created_by、created_at、used_at?、used_principal_id?。
- `customer_identities`：principal_id、tenant_id、customer_id、role、allowed_kinds jsonb、display_name?、credential_sha256、status(`active|disabled`)、created_invitation_id、created_at。principal_id 形如 `ci-<id>`；客户联系人 kind=human、customers='grant'（授权走既有 grants 表+本表行，双行一致才有效）。

API（全部 v2；除 redeem 外要求已验证内部 human，且对客户有 scope）：

- `POST /api/v2/customers/:customerId/invitations`：body `{role, allowedKinds[], subjectRef?, expiresInHours?, note?}` → `{ok, invitation:{invitationId, code(明文仅此一次), expiresAt, role, allowedKinds}}`。code=32+ 随机 URL 安全字符，服务端仅存 sha256。expiresInHours 缺省 168（7 天），上限 720。
- `GET /api/v2/customers/:customerId/invitations` → 列表（不含 code；含 status/expiresAt/usedAt/usedPrincipalId）。
- `POST /api/v2/invitations/:invitationId/revoke`：即刻生效（active→revoked；used/revoked → 409）。
- `POST /api/v2/invitations/redeem`：**唯一匿名 v2 写口**；body `{code}` → 校验 sha256 命中 active 且未过期 → 单事务：建 customer_identities 行 + principal_customer_grants 行 + 置 used → 返回 `{ok, credential(明文仅此一次), principalId, customerId, role, allowedKinds, customerName}`。重复兑换同一 code：已 used → 409 `INVITATION_ALREADY_USED`；并发双兑由 `UPDATE ... WHERE status='active'` 行级竞争保证恰一次。过期 → 410 `INVITATION_EXPIRED`；已撤销 → 410 `INVITATION_REVOKED`；未知 code → 404 `INVITATION_NOT_FOUND`（统一文案，不泄露存在性细节之外的任何信息）。
- **校验链扩展**：`authenticate` 在进程内合成目录未命中时，查 `customer_identities`（credential sha256、status='active'）——客户联系人成为一等 DB 身份；`Auth.principal.roles=['customer', <role>]`、customers='grant'。撤权级联：admin 经既有 `DELETE /customers/:id/grants/:principalId` 撤 grants 时，若目标为 customer_identities 成员则同步置 disabled（校验链立即拒绝）；重放同样拒绝（鉴权先于幂等缓存回放，既有 v2 门序不变）。
- **邀请范围强制**：客户联系人身份调 `registerArtifact` 时，`kind` 必须 ∈ 其 allowed_kinds（服务器端，非前端约定）；grade 恒不可提升（既有 K04 规则已覆盖，加断言测试）。内部身份不受 allowed_kinds 约束。
- 业务主体/客户联系人/内部审批身份分离：customer_identities 仅可能获得单客户 grant，目录（G1）与内部读口对其关闭或按获准披露裁剪。

### G3 材料/批次处理状态：服务身份回执制 + 获准披露（J1.2/J1.3；02 产物进 A 的权威投影）

- 写口（kind=service 专用，逐条审计）：`POST /api/v2/customers/:customerId/artifacts/:artifactId/processing`
  body `{stages:[{stage, runRef, detail?, failureReason?, nextAction?, occurredAt?}]}` 或单段 `{stage,...}`；
  stage 受控序列 `received → parsed → analyzed → needs_review | failed`（needs_review/failed 为当前段，可被后续新 runRef 推进到更后段；**严禁回退**——收到更早段 → 409 `PROCESSING_STAGE_REGRESSION`）。runRef 在 (artifact, runRef) 幂等（重放原样返回）；artifact 必须存在且属于该客户（404 统一无存在性泄漏）。每段落库 `artifact_processing`（迁移 009 内，含 input digest 可空列），当前段=序列号最大行。
- 读口（内部已验证+scope）：`GET /api/v2/customers/:customerId/artifacts/:artifactId/processing` → `{current, history[]}`。
- **客户侧获准披露**（修补 B13 与 J1.2 的边界）：`GET /api/v2/my/materials`（仅客户联系人身份）→ 本客户工件的 `{artifactId, kind, createdAt, currentStage, failureReason?, nextAction?}` 白名单投影——**不含** grade/fact 值/provenance/内部摘要；客户自己的上传进度可见，内部证据元数据不外泄。listArtifacts 行为不变（客户角色仍 403）。
- 事件：写口成功发 outbox `ARTIFACT_PROCESSING_UPDATED`（customer 维度，Edge 可订阅；有限 seq 回查语义照旧）。
- 02 的 Connectors 协调器是预期生产者：桥接仍经 HTTP+服务身份+确定性 requestId（同 a_register 纪律），不得直写 A 表。01 不修改 Connectors 任何文件。

### G4 既有面（本raf轮零改动，仅登记消费关系）

决定链（assessments→candidates→submit-review→decide；facilities approve/activate）、依据包/发现/Gate/分析运行/必需域/台账/提额/豁免、检查会话全套——均已在 §8–§10 冻结。本v2.4 无破坏性变更；全向后兼容。

## 3｜正确性硬门映射（任务书 §4 逐条落点）

- 授权先于回执重放：redeem 之外全部走既有 withCommandV2 门序；customer_identities 校验在 authenticate 层，撤权即时影响重放（测试覆盖）。
- 邀请即授权面：role×subject×kinds 三元在**服务端**执行（registerArtifact kind 白名单）；过期/撤销在兑换口拒绝并有明确错误码。
- 权限不靠 all 掩盖：G1 目录按 grants 过滤；客户联系人只见 my/materials 白名单。
- 处理状态不许伪造完成：写口仅 kind=service；阶段单调；runRef 幂等；failed/needs_review 如实展示给客户并给 nextAction——页面"绿色=指定事项完成≠授信通过"由消费方按 stage 映射。
- 无第二套授信事实：processing 状态不承载任何金额/授信语义；金额/价格字段禁入（沿用 §3.1 口径，载荷白名单校验）。

## 4｜A2/A3 实施序与测试计划

- A2（实现）：迁移 009 → identity 校验链扩展 → invitations/identities 模块 → G1/G3 → 路由注册 → 测试。
- 新测试 `test/invitations-directory.test.mjs`（编号 V1..）：V1 目录分页/搜索/grant 过滤/客户身份 403；V2 邀请创建-兑换-过期-撤销-重复兑换恰一次；V3 撤权级联禁用身份+重放拒绝；V4 allowed_kinds 服务端强制；V5 my/materials 白名单与内部字段零泄漏；V6 处理状态服务身份强制/单调/幂等/客户可见。
- A3：全量回归（基线 114/114 + 新增）；目录/列表查询 EXPLAIN 复核（游标键索引）；无新增热点路径。
- 联调点（INTERFACE_REQUESTS.md）：→03 Edge 兑换页/会话绑定/目录消费；→02 协调器接 G3 写口。

## 5｜交付物

迁移 009、`src/domain/identity.ts`、server.ts 路由、CONTRACT §11 登记、TEST_RESULTS.md、HANDOFF.md、本目录证据。

## 6｜冻结后修订登记（实现期，均为加法或缺陷修复；契约正文已同步 CONTRACT §11）

| # | 修订 | 理由 |
|---|---|---|
| R1 | G3 单调性细化为**runRef 内**严格递增；新 runRef=新处理尝试可从任意 stage 重开 | 绝对单调会阻断"failed 后重解析"的合法恢复；按尝试序留痕同样满足"不冒充自动成功" |
| R2 | 目录键集游标仅用 `customer_id` | `created_at` 为 PG 微秒精度，经 JS 毫秒 ISO 编码截断会导致边界行跨页重复（实测复现） |
| R3 | 客户联系人 Principal.roles=`['customer']`，受邀角色仅存 DB | 双角色会使 B13 的 `every(r=>'customer')` 拦截失效（测试抓到的真实越权缺陷），且受邀角色不参与任何内部授权判定 |
| R4 | `listArtifacts` 客户角色拦截 `every`→`some` 加固 | 同 R3，防御纵深；存量身份无混合角色，行为不变 |
| R5 | 撤 grants 时同事务级联 `customer_identities.status='disabled'` | DESIGN §G2 原有意图（撤权即刻生效+重放拒绝），实现补齐；V3 测试锁定 |
| R6 | redeem 支持 `requestId` 对账（重放返回既成事实、不重发凭据明文） | "数据已提交而响应丢失"反例的合法恢复路线（旅程反例 9 口径） |
| R7 | G2 授予面比对按剥离 `material.` 前缀后的原始种类执行，落库保持调用方原样（CONTRACT §11 同步） | 04 路 DEF-G04N-02 接口对齐：02 coordinator 以 `material.<kind>` 命名空间登记；两侧任一收敛均安全。**代码+类型检查完成，运行时验证待 Docker 引擎恢复后跑 V4 扩展用例（kind=material.license→200 / material.site-photo→403）** |

## 7｜续轮追加（2026-09-19 路B=任务01：④⑥⑦⑧；契约=CONTRACT §11.1/§11.2 + §11 追加段）

受理 goal-03/04 四项接口需求，全部为加法交付；形状冻结见 CONTRACT §11.1/§11.2 与 ROUND-LOG 本轮小节。

| 项 | 来源 | 交付 |
|---|---|---|
| ④ kind 双形态匹配 | IR-03-8④（呼应 DEF-G04N-02） | inspection 域材料比对四处（start 前置/核验项推导/next-actions 缺口/晚到重开）改为剥 `material.` 前缀按裸名匹配；落库/展示保持调用方原样 |
| ⑥ 客户线程内应答 | IR-03-6 扩展 | 裁决=名册绑定：名册含 `{roleKey:'customer',kind:'human'}` 时 cit_*（§11 G2 链）隐式持有该角色；会话读对纯客户身份出**客户线程投影**（仅 audience=customer 问题+关联核验项）；回答/提问限 customer 受众；next-actions 403；小结强制 customer 受众；presence 可用。会话访问授权对纯客户身份跳过项目轴（其边界=租户+客户grant+名册；v1 项目资源不受影响） |
| ⑦ 交付运行时服务身份 | DEF-G04N-04 A 侧 | 迁移 `010_service_identities.sql` + 身份链第三级（合成目录→customer_identities→service_identities）+ admin 三口（`POST /api/v2/service-identities`、`GET ...`、`POST .../:id/disable`）。凭据仅存 sha256、明文一次；禁用即刻不可认证。既有 service 三口与 createPackage 门语义零变更 |
| ⑧ 单件读回 | IR-03-3 | `GET /api/v2/customers/:customerId/artifacts/:artifactId/content`：内部专用（客户角色 403）；信封 v0 `materialFile` 原样投影，非信封件 content 原样；只读回不落对象存储；被取代/重复件可读 |

新增测试：`test/service-identity-artifact-content.test.mjs`（W1–W3/C1–C4，7 项）、
`test/inspection-kind-customer-thread.test.mjs`（M1–M5，5 项）。
