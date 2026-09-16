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
