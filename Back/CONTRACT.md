# V7 backend-next CONTRACT v1.3（A 路独占 writer；2026-09-16；按 03:05 监督纠偏实现 DEF-01 语义候选）

状态：`v1.3`（v1.2 及之前为 FROZEN 文字；**v1.3 新增部分为 CANDIDATE——语义 PENDING-USER-RULING**，反例分析与候选说明见 `A/DEF01-analysis.md`）。本合同是 backend-next 四路唯一共享接口；B/C/D 只读，接口变更只能在各自目录写 `interface-change-request.md`，A 裁量后升版本号发布（新增可选字段=小版本；破坏性=v1.x+迁移说明）。上一轮 `V7/backend/CONTRACT.md`（JSON 存储 v0.2）被本合同取代：业务事实已迁入 PostgreSQL 事务存储（真实本机容器，非内存桩）。

**v1.2 → v1.3 变更（DEF-01 语义候选，监督纠偏 03:05；待用户裁决）**：
反例：三代链 intake→assess→recommendation（recommendation 不直接绑定证据）全部推进到 accepted/candidate 后取代 facts——v1.2 下 recommendation 完全不受影响，可被无提示验收/决定，依据链根部已被推翻而下游不可见。
候选语义（历史永不改写的前提下，"无提示继续"结构性不可能）：
1. **staleness 改为读时计算的传递投影**：`stale(goal)=自身输入引用已被取代 OR 任一传递依赖 stale`（GET goal/project 响应字段；accepted/decided 同样携带）。v1.2 的"级联在 accepted/decided 停止"仅指**状态迁移**停止；可见性经读投影继续向全部下游传播。
2. **accept/decide 人工复核门（fail-closed）**：目标 stale 时 accept/decide → 409 `UPSTREAM_STALE`（响应含 `staleRoots`，失效根因 goalId/goalKey 列表）；请求携带 `staleReviewAck:{note}`（验收/决定人类角色）→ 放行并写审计 `stale_review_acknowledged`。
3. **执行不受门影响**：claim/complete 照常（候选本就 authority=none；正式性时刻才设门）。
4. **清除路径**：invalidated 目标重绑新鲜输入回 ready → 该目标 stale 计算自然为 false；accepted 的 stale 清除与"重开 accepted"属制度问题，**本候选不提供机制**；decided 永不重开（stale 仅读标记）。
5. 错误码表新增 409 `UPSTREAM_STALE`；accept/decide 请求体新增可选 `staleReviewAck`。
6. **requestId 长度上限 64 → 128**（放宽；B worker 周期化 requestId（workerId:goalId:周期:步骤）实测可达 ~70 字符，64 上限过紧。幂等表 text 键无成本）。

**v1.1 → v1.2 变更（D 路 D-19 反证；其中"级联停止"的状态迁移部分仍有效，可见性部分被 v1.3 取代）**：
- 命中目标 status ∈ 非 accepted/decided → `invalidated`，并继续沿依赖边向其下游级联；
- 命中目标 status = accepted → 仅置 `stale:true` 读投影，**保持 accepted，其下游不级联**（人工验收在其时点有效，下游继续消费已验收产出；如需重做由人显式 takeover/resume 或新建实例）；
- 命中目标 status = decided → 仅审计留痕（`evidence_superseded_after_decision`），不改写决定，级联停止。

**v1.0 → v1.1 变更（B 路观察 OBS-1..4，全部采纳）**：
1. `GET /api/v1/projects/:projectId/human-requests` 响应统一驼峰投影（此前该端点泄漏蛇形列名，系实现缺陷非契约放宽；getProject 的 humanRequests 已是驼峰）。
2. GoalInstance 投影补 `projectId` 字段（加法；非事件路径消费方可直接取用）。
3. §4 澄清：human-requests 创建体 `requestedRole` 必填（1..64 string，见 §2 HumanRequest）。
4. §3.4 澄清：**无独立续租端点**（by design——租约时长 A 侧配置，到期可被任意合格执行者重领，fencing 递增保护原 worker）。消费方（B worker）软超时应配置为小于 A 的 lease TTL。

**v0.1 → v1.0 变更（全部为实现期钉死的澄清，无接口破坏）**：
1. §2 Project 增加 `inputVersion:int`（项目级单调，证据提交/取代 +1；证据命令 `expectedVersion` 指向它）；GoalInstance 增加 `inputEvidenceKinds/stale/formalDecision/receiptCount` 投影；所有 API 响应字段驼峰（数据库列名蛇形不外泄）。
2. §3.4 写命令门序钉死：complete/fail = **终态门 → fencing 门 → 状态门 → 版本门 → 载荷校验**（旧 worker 确定性拿 `STALE_FENCING_TOKEN/LEASE_EXPIRED`，不会被 VERSION_CONFLICT 掩盖）；claim = 授权 → 版本门 → 项目门 → 状态/租约门；**过期租约可被 claim 重领**（token 递增，恢复语义——lease 到期≠API未执行，也不冻结任务）。
3. §3.6 失效语义钉死：取代命中目标 → `invalidated` 并**立即重算重绑新证据版本回 ready**（所需 kind 新证据已存在时）；下游沿依赖边级联为 `invalidated`（不自动回 ready，等上游重新验收）；accepted → 仅置 `stale:true` 读投影不重开；decided → 审计留痕不改写。失效目标重做=重新 claim→complete（旧候选不再被信任）。
4. 错误码映射：`DEPENDENCY_CYCLE`=**400**（构造期校验，非冲突）。响应统一 `{ok:false,error,message,...}`。
5. outbox：每 subscription 独立投递簿（`outbox_deliveries`），**订阅只接收注册之后产生的事件**；dispatcher 对失败投递指数重试，超上限置 `dead`；pull 通道（`GET /api/v1/events`）不受影响。仍为至少一次，消费方按 `eventId` 幂等去重，不宣称 exactly-once。
6. 敏感写最终清单（§3.8）：templates(创建,admin)、claim、complete、fail、accept、decide、goal-pause/resume、takeover、project-pause/resume(admin)、supersede、human-respond/cancel、subscriptions。非敏感（匿名可写但可审计）：submitEvidence、createGoalInstance、createHumanRequest。实现内置 10 个合成测试 principal（`scripts/start-kernel.mjs` 注释，凭据仅存 sha256）。

## 0｜产品与边界

目标驱动协作内核：目标（Goal）是一等公民，角色/人/Agent 分离，行业只是模板配置（非租赁反例模板已在同一内核跑通，核心无行业硬编码）。模型/Agent 输出恒为候选（`authority=none`）；**执行成功 ≠ 候选就绪 ≠ 验收通过 ≠ 正式人工决定**；目标不能自报完成——complete 最多 `candidate_ready`，accept/decide 仅人类验收/决定角色 principal（kind=human）且执行者≠验收者。本轮不做：前端/site、真实客户数据、真实模型调用（GLM-5.2 只预留 transport，0 调用）、公开部署。

## 1｜基础设施（A 独占；其他 lane 只读连接信息）

- **实际采用**：Docker `postgres:16` 容器 `v7next-a-pg`，`127.0.0.1:15432`，数据卷 `v7next_a_pgdata`，库 `v7next_a`，用户/密码 `v7next/v7next`（仅 loopback 合成环境）。与既有 Dify 容器/数据完全隔离，未触碰。
- HTTP API：`127.0.0.1:48080`（标准实例，`node scripts/start-kernel.mjs` 启动，含 outbox dispatcher + 10 合成 principal）。测试实例由测试工具随机端口+独立库。
- 依赖：A 包 `package.json`+`package-lock.json`（运行时唯一依赖 `pg`，dev：typescript/@types）。启动/停止/恢复见 `A/README.md`。

## 2｜实体（v1.2，API 投影为驼峰）

```jsonc
GoalTemplate { templateId, version:int, name, industry:null|string,      // 落库后不可变，改版=新建
  roles:[{roleKey, title, isHumanRole:boolean}],
  goals:[{ goalKey, title, description, responsibleRole,   // 必须∈roles
           executorKind:"agent"|"human",                    // executorType human_led/human_only→human；agent_tool/agent_candidate→agent
           acceptanceRole, decisionRole,                    // 必须为 isHumanRole 角色（验收/决定权威）
           inputEvidenceKinds:[string], dependsOn:[goalKey], params:object }],
  createdBy, createdAt }                                    // dependsOn 实例化时查环 → 400 DEPENDENCY_CYCLE
Project { projectId, templateId, templateVersion, name,
  status:"active"|"paused"|"closed", inputVersion:int(单调;证据命令 expectedVersion), createdBy, createdAt, updatedAt }
GoalInstance {
  goalId, projectId, goalKey, title, responsibleRole, executorKind, acceptanceRole, decisionRole,
  params, dependsOn:[goalId], inputEvidenceKinds,
  inputEvidence:[{evidenceId, version}],                    // ready 时绑定的当前证据链
  inputHash,                                                // sha256(规范化 goalKey|params|inputs|deps)
  status, version:int(乐观锁,每次写+1), stale:boolean,
  result:null|{ provider:"simulation"|"real_http"|"calculation", output, evidenceRefs:[string], notes, at },
  formalDecision:null|{decision:"approved"|"rejected"|"withdrawn", note, by, basedOnGoalVersion, at},
  receiptCount, assignedTo, createdAt, updatedAt }
// status ∈ blocked|ready|leased|waiting_human|candidate_ready|accepted|decided|invalidated|paused|failed；终态 decided
Evidence { evidenceId, projectId, version:1, kind, content, sha256,
  supersedes:null, supersededBy:null, inputVersion, createdAt, current:投影 }   // 取代=新实体；历史永不删
TaskAssignment { goalId, assignee, kind, leaseUntil, fencingToken:int(单调递增), claimedAt }
HumanRequest { hrequestId, projectId, goalId:null, kind:"missing_evidence"|"decision"|"clarification",
  question, requestedRole, requiredEvidenceKinds, status:"open"|"answered"|"cancelled", answer, createdBy, createdAt }
ExecutionReceipt（只追加）{ receiptId, goalId, kind:"claimed"|"execution_completed"|"execution_failed",
  actorPrincipalId, fencingToken, output, note, at }        // 验收/决定走 audit+事件，不写执行回执
AuditEvent（只追加）{ seq, at, actorPrincipalId, action, targetType, targetId, projectId, summary, payloadSha256 }
OutboxEvent（只追加+投递状态）{ seq, eventId:uuid, at, eventType, projectId, goalId, payload, dispatchState, attempts }
```

## 3｜不变量与机制

1. **权威分离（结构层强制）**：`result.output`/模板与目标 `params` 嵌套禁用键扫描 `approv|decision|quota|price|rate|reject` → 400 `FORBIDDEN_KEY`（证据 content 是业务输入事实，不套用此规则——报价单含价格合法）。角色/验收权/决定权全部来自模板+身份源；请求载荷不含授权字段。
2. **乐观版本**：目标写命令带 `expectedVersion`（当前版本见 GET）；不符 → 409 `VERSION_CONFLICT{serverVersion}`。
3. **幂等**：所有写命令带 `requestId`(1..64)，全局幂等表与业务写同事务；同载荷重放原响应 `replayed:true`；异载荷 409 `REQUEST_MISMATCH`。`GET /api/v1/receipts/:requestId` 查询。
4. **租约与 fencing**：claim 返回 `{status:"leased", fencingToken, leaseUntil, goalVersion}`；门序见 v1.0 变更 2。token 不符 → 409 `STALE_FENCING_TOKEN`；租约到期 → 409 `LEASE_EXPIRED`（可重领）；assignee 不符 → 403。takeover/pause 释放租约并 token+1——过期 worker 写回被结构性拒绝。**不笼统宣称外部 exactly-once**。
5. **Outbox 同事务**：状态迁移/证据变更与 OutboxEvent 同一 PostgreSQL 事务（成功或一起回滚）。事件类型：TEMPLATE_CREATED/PROJECT_CREATED/GOAL_CREATED/GOAL_READY/GOAL_CLAIMED/GOAL_CANDIDATE_READY/GOAL_ACCEPTED/GOAL_DECIDED/GOAL_FAILED/GOAL_PAUSED/GOAL_RESUMED/GOAL_TAKEOVER/GOAL_STALE/GOAL_INVALIDATED/GOAL_WAITING_HUMAN/EVIDENCE_SUBMITTED/EVIDENCE_SUPERSEDED/HUMAN_REQUEST_CREATED/HUMAN_REQUEST_ANSWERED/PROJECT_PAUSED/PROJECT_RESUMED。
6. **依赖释放与验收原子一致**：accept/decide 同事务重算下游 blocked|invalidated → ready（绑定当前证据版本+inputHash）；证据提交/取代同事务触发定向失效（v1.0 变更 3；级联停止规则见 v1.2 变更）。失效只命中引用映射命中的目标，无关目标逐字节不变（测试已断言）。
7. **环检测**：模板 dependsOn 实例化时 DFS 查环 → 400 `DEPENDENCY_CYCLE`；运行期不可加边。依赖 goalKey 在实例化顺序上可先于依赖目标（`unresolved:` 前缀，后续实例化自动回填）。
8. **可信鉴权（可注入异步验证器）**：`principalVerifier(credential) → Promise<{principalId, kind:"human"|"agent", roles, projects:"all"|[]}>`。未注入=敏感写 403 `PRINCIPAL_UNTRUSTED` 失败关闭；验证器异常不回显凭据。角色/项目授权由验证器目录给出，载荷声明无效。
9. **模型接口预留**：`result.provider="real_http"` 在 transport 未配置时 409 `MODEL_NOT_CONFIGURED`（health 恒显 `model:"not_configured"`）；不静默 mock 成功。载荷/结果上限：body 1MB、output 64KB。

## 4｜HTTP API（`127.0.0.1:48080`，前缀 `/api/v1`；身份头 `X-Principal-Credential`，body `principalCredential` 同义）

```
GET  /healthz 等价 GET /api/v1/health
POST /api/v1/templates                                 {requestId, name, industry?, roles[], goals[]} (sensitive, admin)
GET  /api/v1/templates/:templateId
POST /api/v1/projects                                  {requestId, templateId, name} (sensitive; 模板角色或 admin)
GET  /api/v1/projects/:projectId                       → project(+projectInputVersion)+goals+evidence(+current)+humanRequests
POST /api/v1/projects/:projectId/goals                 {requestId, goalKey, params?}    // 409 GOAL_EXISTS 幂等防重
POST /api/v1/projects/:projectId/evidence              {requestId, expectedVersion:projectInputVersion, kind, content}
POST /api/v1/projects/:projectId/evidence/:eid/supersede {requestId, expectedVersion:projectInputVersion, content} (sensitive)
GET  /api/v1/goals/:goalId                             → goal+receipts+assignment
POST /api/v1/goals/:goalId/claim                       {requestId, expectedVersion}  (sensitive; 角色+执行者类型匹配)
POST /api/v1/goals/:goalId/complete                    {requestId, expectedVersion, fencingToken, result:{provider,output,evidenceRefs?,notes?}}
POST /api/v1/goals/:goalId/fail                        {requestId, expectedVersion, fencingToken, note}
POST /api/v1/goals/:goalId/accept                      {requestId, expectedVersion}  (acceptanceRole human; ≠执行完成者)
POST /api/v1/goals/:goalId/decide                      {requestId, expectedVersion, decision, note?}  (decisionRole human; 仅 accepted 可决定)
POST /api/v1/goals/:goalId/pause | /resume             (human responsibleRole; resume 后重算)
POST /api/v1/goals/:goalId/takeover                    (human responsibleRole; 释放租约+token+1)
POST /api/v1/projects/:projectId/pause | /resume       (admin human)
POST /api/v1/projects/:projectId/human-requests        {requestId, goalId?, kind, question, requestedRole(必填), requiredEvidenceKinds?}
POST /api/v1/human-requests/:hrequestId/respond        {requestId, answer:{text, evidenceRefs?[{evidenceId,version}]}}  (requestedRole human)
POST /api/v1/human-requests/:hrequestId/cancel
GET  /api/v1/projects/:projectId/human-requests
GET  /api/v1/events?after=<seq>&limit=≤500             → outbox pull
POST /api/v1/subscriptions                             {requestId, name, url:loopback}  (admin; 订阅只收注册后事件)
GET  /api/v1/receipts/:requestId
```

错误码：400 `INVALID_INPUT|FORBIDDEN_KEY|DEPENDENCY_CYCLE` / 403 `PRINCIPAL_UNTRUSTED|ROLE_FORBIDDEN|PROJECT_FORBIDDEN` / 404 `NOT_FOUND` / 409 `VERSION_CONFLICT|REQUEST_MISMATCH|GOAL_EXISTS|NOT_READY|LEASE_EXPIRED|STALE_FENCING_TOKEN|PROJECT_PAUSED|EVIDENCE_SUPERSEDED|HUMAN_REQUEST_CLOSED|MODEL_NOT_CONFIGURED|UPSTREAM_STALE|TERMINAL_STATE` / 500 `INTERNAL`。响应 `Cache-Control: no-store`。

## 5｜状态机（GoalInstance.status）

```
blocked ──(deps accepted+输入kind当前证据齐备)──▶ ready ──claim──▶ leased ──complete──▶ candidate_ready
   ▲                                                ▲                 │ │fail                 │ accept(验收角色human)
   │      invalidated ◀──证据取代命中/级联── ready/leased/candidate_ready/failed  │ │                    ▼
   │            │（新证据齐备→重绑回ready）        (过期租约可重领)                 ▼ ▼                 accepted ──decide(approved)──▶ decided
   └────────── 重算 ◀── resume(人工,paused|failed→)                    waiting_human / paused
```

规则：decided 终态不可改写（重做=新实例）；accepted 被取代 → stale 投影；waiting_human 仅由 blocked/ready/invalidated 挂起（不打断 leased/candidate_ready），respond 后重算；complete 永远到不了 accepted——验收必须由独立人类 principal 作出。

## 6｜对其他路的接口点（当前组合状态，如实）

- **C（已组合 ✅）**：C 的两个模板（商业融资租赁 v1 + 非租赁反例）经 A assembly adapter 落库；C 的 8 份预生成计划（`C/scenarios/plans/*.plan.json`）全部在 A 内核执行通过（submitEvidence/supersedeEvidence/createHumanRequest 全链）；L1 fact_intake 走完 claim→complete→accept。映射规则与结果见 `A/assembly/run-c-plans.mjs`+`c-plans-result.json`。C 自有集成脚本可打 48080 常驻实例。
- **B（接口就绪，待接入）**：claim/complete/fail/fencing/幂等/恢复语义即 B 的消费面（§3.4 门序专为 B 的 unknown 区分设计：STALE_FENCING_TOKEN/LEASE_EXPIRED=未执行可安全重试路径，VERSION_CONFLICT=协调冲突）。B worker 就绪后以 48080 常驻实例对接即可，无需 A 改动。
- **D（可开测）**：启动入口 `A/README.md`；命令+版本以此 v1.0 为准；manifest 在 `A/assembly/manifest.json`（传递源+lockfile，D-11 教训落实）。

## 7｜基线门

全部产物在 `V7/backend-next/**`；未触碰 `V7/backend/**`、site/V6/home/3607/3467、既有 Dify 容器与数据；无 Git 操作；无真实密钥/付费调用（GLM-5.2 0 调用）。测试库 `v7next_a_test_*` 由测试自动建删，与业务库隔离。

## 8｜v2 增量契约登记（2026-09-17，本轮任务02 集成 writer）

- **v2.1 决策闭环**（任务02；客户授信之上的交付收口）：差异复核（decision_findings）、评估依据包（decision_packages/package_domain_results，冻结修订+逐域当前性）、会后授权视图（report_views，internal/customer 分受众）、对象显式重关联（object_relinks）、提额冷却（credit_facilities.cooling_until，`--credit-cooling-seconds` 显式配置才启用）。API/事件/语义见 `A/docs/DECISION_LOOP_V1.md`；错误码新增 REVIEW_REQUIRED / REVIEW_EVIDENCE_REQUIRED / GATE_BLOCKED / COOLING_ACTIVE（errors.ts）。迁移 004 号位归任务02；003 号位为任务一 `003_inspection_sessions.sql`。v1（§0–§7）语义不变。
- **检查会话域**（任务一）：设计见 `A/docs/INSPECTION_SESSION_V1.md`（错误码 PLAN_CHANGED 等 11 项已在 errors.ts 登记）。
- 本节为登记性指针，不改变 §0–§7 已冻结文字的效力。

## 9｜v2.2 增量契约登记（2026-09-17，PR#3 审核修复轮·任务01 集成 writer）

来源：`JW_PR3_independent_audit_and_four_tasks` 任务01（审核 F01/F02/F03/F04/F06/F10/F12；范围 Back/A/**、共享契约与迁移）。审核基线 870e149。v1（§0–§7）语义除下述显式修订外不变。

**A1 权限与幂等（F01；迁移 005）**
- 身份模型新增 `kind:"service"`（获准服务身份）与 `Principal.customers:'all'|'grant'`；`grant` 模式的可见客户以 `principal_customer_grants` 登记表为准（admin 经 `POST/DELETE /api/v2/customers/:id/grants` 管理），撤销即刻生效。
- **幂等回执归属**：v1 `idempotency` 表新增 `principal_id/op` 列；鉴权先于任何缓存查询；同主体同载荷重放返回原回执，跨主体同 requestId 一律 409 `REQUEST_MISMATCH`（legacy 无主行仅 admin 可读）。v2 `withCommandV2` 外层命中不再直接返回——落回事务经该命令全部授权门后由锁内 `replayed` 出口返回（撤权后重放不得借缓存）。幂等载荷哈希绑定 principal。
- **读口授权**：v1 项目/目标/待办/模板/事件/回执 GET 一律要求已验证身份并按项目/租户/客户授权；`GET /api/v1/events` 按 principal 的项目+租户+客户授权过滤（客户事件按 grants），全局事件（无 project/customer）对已验证主体可见。检查会话 GET/next-actions/summary 要求 verified + 项目/租户/客户授权 + 名册角色或 admin；匿名 403、越权统一 404（不泄露存在性）。
- **客户级授权**：v2 全部读/写路径在租户校验之上增加客户校验（`scopeByRow` 增第四参 customerId；create 型命令 `requireCustomerScope`）；越权统一 NOT_FOUND。
- 检查会话命令幂等键绑定主体；重放前按当前授权状态重验（owner/名册/客户授权）。`recordDomainResult` 要求对应域目录角色（policy/credit/commerce/asset）；证据核验等级提升仅限获准核验角色，客户申报恒为 unverified。

**A2 可信依据（F02/F03/F06；迁移 006）**
- **Gate 只来自可信回执**：新表 `rule_gate_receipts`；仅 kind=service 身份可登记（`POST /api/v2/customers/:id/rule-gate-receipts`），`rulesetVersion` 必须是当前激活版本；`createPackage/revisePackage/recordGateResult` 拒绝自由 JSON gate（400），只接受 `gateReceiptId`。规则版本激活：`POST /api/v2/rule-pack-versions/activate`（policy 或 admin 人类），同一时刻至多一个 active（`rule_pack_versions`）。
- **分析运行登记**：新表 `analysis_runs`；service 身份 `POST .../analysis-runs/start`（A 按声明依赖对当时 DB 盖章 input_digest）→ `finish`；域结果登记只接受已登记且 `completed` 的运行（failed/timeout/not_configured → 409 `ANALYSIS_RUN_NOT_COMPLETED`，不产生 opinionVersion）；域水位=运行开始盖章摘要，晚到材料 → 该域读时判 `changed/deps_changed`，不重新盖章 current。
- **必需域政策**：`--required-domains-policy <version>` 指向 `domain_requirement_policies`；未配置 → 冻结一律 409 `POLICY_PENDING`（fail-closed）；政策必需域不由调用者关闭，确不适用须显式 `exemptions[{domain,reason,approvedBy,scope}]` 入包可审计。收口引用只收 `inspectionRevision.sessionId`，修订/状态由服务端解析（假会话 404）。
- **HOLD_FOR_REVIEW 是缺口不是通过**（修订 DECISION_LOOP_V1 §2.3 旧表述）：evaluateReadiness 对 HOLD 产出 `GATE_HOLD_FOR_REVIEW` 缺口；Gate 规则版本 ≠ 激活版本 → `GATE_STALE_RULES`（域级 reason `rule_version_changed`）；两者在提交点分别映射 GATE_BLOCKED / STALE_BASIS。换版后允许在同一包上按"当前激活版本"重登记该域结果（域状态随结果推进版本）。
- **正式路径必须绑定依据包**：`proposeFacility` 无 `packageId` → 409 `BASIS_PACKAGE_REQUIRED`；存量无包 basis 的批准/激活/用信默认阻断（旧行只读保留），显式 `--allow-legacy-basis` 兼容核才放行（走评估复查路径）。派生工件冻结时上游缺失/被取代 → 拒绝并给出 `upstream_missing/upstream_superseded` 具体缺口；`GET .../artifacts` 返回 `derivationGaps` 逐件可见。

**A3 台账与提额（F04/F10/F12；迁移 007）**
- 用信命令（reserve/release/commit/disburse/settle/confirm-external）在客户锁/设施锁之后强制重读申请行（FOR UPDATE）；`exposure_entries` 新增部分唯一索引 `(fr_id, entry_type)`（同一申请同一业务迁移至多一条账目，第二层去重）。
- commit/disburse 提交点机械复查：设施硬状态（暂停/过期/超限/依据失效，`FACILITY_NOT_ACTIVE`/`STALE_BASIS`）→ 客户级未决差异（REVIEW_REQUIRED）→ 依据包当前性（commit 及 reserve；**disburse 为已承诺敞口的执行，不重复当前性门**——新承诺已在 commit 拦截，后来不利信息不追溯冻结既有负债）。
- **冷却口径收窄（修订 B11 旧表述）**：`cooling_active` 仅如实展示并硬阻断"激活/恢复"与"客户级向上提额申请"；不再冻结既有合法用信的可用额、不再阻断 reserve（无说明扩大被移除）。既有合同不被自动改写；负面核验与差异复核不受冷却阻挡。
- **客户级提额（再评估）请求**（新表 `credit_limit_requests`）：`POST /api/v2/customers/:id/limit-increase-requests`（human business/credit）——冷却内不受理（COOLING_ACTIVE）、在途唯一（`LIMIT_INCREASE_IN_FLIGHT`）、再申请间隔与次数窗口（`LIMIT_INCREASE_WINDOW`+`nextEligibleAt`，`--limit-increase-retry-hours/-window-days/-max-per-window` 显式配置）、实质新证据（引用本客户历史请求未用过的现行工件，否则 `LIMIT_INCREASE_NO_NEW_EVIDENCE`）；`POST /api/v2/limit-increase-requests/:requestId/resolve`（credit/approver 人类）处置并写 next_eligible_at；限制客户级持久、跨渠道/业务员不可绕行、重试经 requestId 幂等不重复计数、非法载荷零写入。
- 账目聚合遇超安全整数 → 500 INTERNAL 显式失败（不静默舍入）；检查会话提问/回答沿用会话乐观版本语义（提问 +1）。

**旧测试适配（语义保留）**：decision-loop B01–B14 经新机器重放（Gate 回执+服务身份运行登记+政策必需域+真实收口会话，域结果由持域角色/服务身份登记）；customer-credit/ledger-property 等 legacy 用信流加 `--allow-legacy-basis`；A22 迁移清单更新为 001–007。新增测试：`trust-gates-a1/a2`（K01–K11）、`ledger-races-a3`（K12–K18，真实 PG 客户锁屏障并发）。全量回归 102 项：101 pass / 0 fail / 1 skip（crash 容器重启用例按边界守卫跳过）。

**接口破坏提示（任务03/Edge 消费方）**：`GET /api/v1/events`、`/api/v1/receipts/:requestId`、`/api/v1/inspections/:id(+/next-actions)` 现要求 `X-Principal-Credential` 并按授权过滤；匿名调用 403。Edge 面板与 E1 需携带获准凭据后重跑（任务03 范围）。

## 10｜v2.3 增量契约登记（2026-09-17，goal-01 集成 writer）

来源：`docs/backend-upgrade/goal-01/`（并发正确收口 + 定向性能优化）。审核基线 1ec0ee4；设计/测试/性能证据在其目录。v1（§0–§7）与 §8/§9 语义除下述显式修订外不变。

**证据对象锚定匹配（A1；验收"错设备材料"）**
- 错误码新增 409 `EVIDENCE_OBJECT_MISMATCH`（errors.ts）。
- 检查项锚定 objectRef 时：`answer.evidenceRefs` 引用显式锚定到**其他对象**的材料 → 409 `EVIDENCE_OBJECT_MISMATCH`（事务内零写入）；锚定项的**自动核实**（`requires_human_verification=false` → verified）与**晚到材料重开**只认 objectRef 匹配材料；未锚定材料仍可被引用并进入人工核验路径（to_verify 行为不变，人工核验权威不变）。next-actions 缺口按同口径展示。

**豁免登记制（A2；验收"假豁免"）**
- 新表 `domain_exemptions`（迁移 008；只新增对象，回退=保留对象停用入口）。
- 新 API：`POST /api/v2/customers/:id/domain-exemptions`（登记）、`GET /api/v2/customers/:id/domain-exemptions`（列表）、`DELETE /api/v2/domain-exemptions/:id`（撤销；即刻生效只阻断新引用，历史冻结包不改写）。登记/撤销权限 = 人类 principal + permission_matrix 动作 `domain-exemption.grant`（矩阵未配置/无条目 → 409 POLICY_PENDING，fail-closed）。`approved_by` 由服务端从凭据解析，请求载荷无 approvedBy 字段。
- **破坏性收紧**：`decision-packages.exemptions[]` 只接受 `{exemptionId, note?}`——出现自报 `domain/approvedBy/scope` → 400 INVALID_INPUT；引用须 valid、未过期、政策版本匹配、客户/租户匹配（否则 404 NOT_FOUND / 409 POLICY_PENDING）。`findings/:id/resolve` 的 not_applicable `waiverRef` 只接受 `{exemptionId}`（登记 scope 须覆盖差异类型/规则ID/'any'）；自报 `policyApproved/approvedBy/validUntil` → 400。旧行为（自报字符串可形成必需域豁免）作废。
- server：DELETE 请求与 POST 一样解析 JSON body（原先仅 POST；存量无 HTTP DELETE 消费方，无迁移影响）。
- 测试：`test/evidence-object-match.test.mjs`（G2-1..5）、`test/domain-exemptions.test.mjs`（X1..X7）；全量回归 **114/114**（自有隔离容器 jw-goal01-pg@15446，pg16）。

**性能（A3；接口语义不变）**：getCustomerExposure 批量桶推导（O(1) 查询）、reserve 响应桶由门内快照+增量推导、reverifyBasis/提额证据批量取锁读——全部为读合并与重复消除；门序、锁序、事务边界、失败语义一律不变。量化对照见 `docs/backend-upgrade/goal-01/PERF_BEFORE_AFTER.md`。

## 11｜v2.4 增量契约登记（2026-09-18，goal-01 四任务产品交付轮·路径01 集成 writer）

来源：`JW_product_delivery_four_tasks` 任务01（提取通用可信核心，交付可供页面办理的租赁业务服务）；设计冻结与消费者清单见 `docs/product-delivery/goal-01/DESIGN.md`。基线 `v02-goal1234-delivery@e4ed7a5`。v1（§0–§7）与 §8–§10 语义不变；本节全部为加法。迁移 `009_customer_invitations.sql`（只新增对象，回退=保留对象停用入口）。

**G1 客户目录（权威分页查询）**
- `GET /api/v2/customers?search=&limit=&cursor=`：已验证**内部** principal 专用（roles 含 `customer` → 403；匿名 403）；租户与客户授权服务器端过滤（`customers='grant'` 仅见 `principal_customer_grants` 在册客户，不可见即不存在）。响应 `{customers:[{customerId,displayName,status,createdBy,createdAt}], nextCursor}`；`limit` 默认 20、上限 100；键集游标仅基于 `customer_id`（全局唯一；`created_at` 微秒精度经 JS 毫秒编码有截断，禁止用作游标键）。

**G2 受限邀请与客户联系人身份**
- 新表 `customer_invitations`（code_sha256 UNIQUE；role∈customer-owner/customer-finance/customer-plant；allowed_kinds 非空 jsonb；status active/used/revoked；expires_at；redeem_request_id 对账锚点）与 `customer_identities`（A 内核首批 DB 侧动态身份；credential_sha256 UNIQUE；status active/disabled）。
- API：`POST /api/v2/customers/:id/invitations`（human business/admin；body role/allowedKinds[]/subjectRef?/expiresInHours?默认168上限720/note?）→ 返回 `code` 明文仅此一次；`GET /api/v2/customers/:id/invitations`（内部，不含 code）；`POST /api/v2/invitations/:invitationId/revoke`（即刻生效；used/revoked → 409）；`POST /api/v2/invitations/redeem`（**唯一匿名 v2 写口**；body code/requestId?）。
- 兑换语义：未知码统一 404 `INVITATION_NOT_FOUND`（不泄露存在性）；已用 409 `INVITATION_ALREADY_USED`（同 requestId 重放 → 200 `replayed:true` 对账响应，**不重发凭据明文**——凭据只在首次响应出现）；已撤销 410 `INVITATION_REVOKED`；已过期 410 `INVITATION_EXPIRED`。恰一次由 `status='active'` 行级竞争保证。兑换创建 customer_identities 行 + principal_customer_grants 行 + audit + `INVITATION_REDEEMED` 事件。
- **身份校验链扩展**：`authenticate` 在进程内合成目录未命中时查 `customer_identities`（sha256、active）→ Principal `{kind:'human', roles:['customer'], projects:[], tenants:[租户], customers:'grant'}`。受邀角色只存 DB 不进 roles——防止绕开"纯客户角色"边界（见下）。匿名 redeem 之外全部走既有门序；鉴权先于幂等缓存回放（K02 语义不变）。
- **撤权级联**：admin 经既有 `DELETE /api/v2/customers/:id/grants/:principalId` 撤 grants 时，同事务级联 `customer_identities.status='disabled'`——该凭据即刻不可认证，重放同样 403。
- **邀请授予面（服务端强制）**：客户联系人身份 `registerArtifact` 时 `kind` 必须 ∈ 其 allowed_kinds（否则 403 PERMISSION_DENIED）；grade 提升既有 K04 规则不变。内部身份不受 allowed_kinds 约束。
- **B13 加固**：`listArtifacts` 客户角色拦截由 `roles.every(r=>r==='customer')` 改为 `some(...)`（混合角色同样拒绝；存量身份无混合角色，行为不变）。

**G3 材料处理状态（服务身份回执制 + 获准披露）**
- 新表 `artifact_processing`（UNIQUE(artifact_id, run_ref, stage_rank)；stage∈received/parsed/analyzed/needs_review/failed）。
- 写口 `POST /api/v2/customers/:id/artifacts/:artifactId/processing`：**仅 kind=service**（human 403）；body 单段或 `stages[]`（1..20）；`runRef` 1..128；**同一 runRef 内 stage_rank 严格递增**（回退/重复/同档互斥 → 409 `PROCESSING_STAGE_REGRESSION`）；**新 runRef = 新处理尝试**，可从任意 stage 重开（failed 后重解析是合法恢复路径，按尝试序如实留痕）。`stage=failed` 必须给 `failureReason`；`failed|needs_review` 必须给 `nextAction`（页面要能解释下一动作）。幂等经既有 requestId 门；成功发 `ARTIFACT_PROCESSING_UPDATED` 事件。载荷白名单校验，金额/价格字段禁入（§3.1 口径），不承载任何授信语义。
- 读口 `GET /api/v2/customers/:id/artifacts/:artifactId/processing`（内部，客户角色 403）→ `{current, history[]}`。
- **客户侧获准披露** `GET /api/v2/my/materials`（仅客户联系人身份；内部 403）→ 本客户工件白名单投影 `{artifactId, kind, createdAt, duplicateOf, stage(未处理=registered), failureReason?, nextAction?}`——不含 grade/事实值/provenance/内部摘要；`listArtifacts` 行为不变（客户角色仍 403）。

**测试**：`test/invitations-directory.test.mjs` V1–V6（目录 grants 过滤/搜索/分页/匿名；邀请全生命周期与 requestId 对账；撤权级联+重放不借缓存；授予面与核验等级；获准披露白名单；处理状态单调/尝试/失败解释）。全量回归见 `docs/product-delivery/goal-01/TEST_RESULTS.md`。

**对消费方（03/Edge、02/Connectors）**：Edge 会话绑定可用 redeem 凭据；目录/材料状态为本轮冻结面。Connectors 协调器如需推进 A 侧处理状态，经服务身份调 G3 写口（确定性 requestId 纪律同 a_register），不得直写 A 表。

### §11.1 交付运行时服务身份（DEF-G04N-04 A 侧；2026-09-19 路B=任务01 冻结形状）

**背景**：G2/A2/G3 的 service 专用写口（`rule-gate-receipts`、`analysis-runs/start|finish`、`artifacts/:id/processing`）在交付运行时无 kind=service 可认证主体，依据包可信链不可达 → 页面正式提案恒 409 `BASIS_PACKAGE_REQUIRED`（该门语义本身不变）。本节补齐"交付运行时补 service 主体"（DEFECTS owner-01 项）。

- **迁移 `010_service_identities.sql`**（只新增对象；回退=保留对象停用入口）：`service_identities(principal_id PK, tenant_id, display_name, credential_sha256 UNIQUE, status active|disabled, created_by, created_at, disabled_at, disabled_by)`。
- **身份校验链扩展（加法）**：`authenticate` 合成目录 → `customer_identities` 未命中后，再查 `service_identities`（sha256、active）→ Principal `{kind:'service', roles:['service'], projects:[], tenants:[创建时绑定租户], customers:'all'}`。凭据仅存 sha256，明文只在创建响应出现一次（`svc_` 前缀，纪律同邀请码）。
- **API（全部 admin 人类专用）**：
  - `POST /api/v2/service-identities` `{requestId, tenantId(必填), displayName?≤128}` → 200 `{ok, principalId(svc_*), credential(明文仅此一次), tenantId, displayName, status:'active'}`；403 非人类/非 admin；幂等经 requestId（重放不重发明文）。
  - `GET /api/v2/service-identities` → `{ok, identities:[{principalId, tenantId, displayName, status, createdAt, disabledAt}]}`（无凭据派生字段）。
  - `POST /api/v2/service-identities/:principalId/disable` `{requestId}` → 200 `{ok, status:'disabled'}`，**即刻不可认证，重放同样 403**（语义同撤权级联）；已禁用重复禁用 → 409 `NOT_READY`；跨租户/不存在 → 404。
- **不改变既有门**：service 三口（Gate 回执/分析运行/处理状态）与 createPackage（human credit/business）权限语义一字不动；本节只提供"可认证的 service 主体"。**03 路页面消费链**：admin 签发 svc 凭据 → Edge/Connectors 服务端保管 → 页面动作触达：Gate 回执登记（svc）→ 分析运行 start/finish（svc）→ 域结果登记（policy/credit/commerce/asset 目录角色，human）→ 依据包冻结（human credit/business，`POST /api/v2/customers/:id/decision-packages`）→ 提案显式携带 `packageId`（既有权威校验：存在+属本客户，404 语义不变）。

### §11.2 工件单件读回（IR-03-3；2026-09-19 路B=任务01 冻结形状）

- **`GET /api/v2/customers/:customerId/artifacts/:artifactId/content`**：原件预览数据源（供 Edge 受控代理）；**只读回**，不落对象存储、不产生任何写路径。
- **鉴权**：已验证**内部** principal（roles 含 `customer` → 403 `PERMISSION_DENIED`，B13 口径；匿名 403）；租户+客户授权同 v2 读口（`grant` 模式不在册 → 404，不泄露存在性）。
- **响应 200** `{ok:true, artifact:{artifactId, customerId, kind, factKey, sha256, createdAt, createdBy, supersededBy, duplicateOf, materialFile}}`——`materialFile` 为信封 v0 投影 `{name, mime, size, encoding:'base64', data}`（content JSON 含 `materialFile` 时原样取出；非信封件为 null，结构化事实经 `content` 字段原样返回）。被取代/重复件同样可读（历史可审计；行内 `supersededBy/duplicateOf` 如实携带）。
- **错误码**：404 `NOT_FOUND`（不存在/不属本客户/无授权）；无新增错误码。`data` 大小即登记时信封上限（≤512KB base64，Edge 侧约定）；A 不做二次转码。
- **Edge 代理约定（03 路消费）**：`/api/jw/v2/connectors/...` 同型只读代理；A 侧响应 `Cache-Control: no-store`（既有全局行为，预览不缓存）。
