# V7 Backend CONTRACT v0.2（A 路独占 writer；v0/v0.1 2026-09-15 发布，v0.2 同日码位与顺序澄清）

状态：`v0.2`（v0 FROZEN + v0.1/v0.2 澄清与小步扩展；全部为文本澄清或失败关闭收紧，无破坏性改动）。本合同是四路唯一共享接口；B/C/D 只读，接口变更只能向 A 提请求（在各自目录写 `interface-change-request.md`，A 裁量后升版本号发布）。变更规则：新增可选字段=小版本（v0.x）；破坏性改动=v1 并需说明迁移。

## 0｜目标与边界

轻量后端：真人与角色 Agent 可持续交互的项目事实源——真实 HTTP API、可持久化、失败恢复、手机/电脑双端共享同项目事实、可迁移运行。模型/计算输出恒为候选（`authority=none`）；只有人工动作改变正式状态；不自动审批。本轮**不**做：site 接线（只出 diff proposal 等基线门）、真实客户数据、自动重试冒充成功、重型平台。

## 1｜存储选型（已评估，本合同冻结）

采用：**单进程 JSON 文件存储**（两个独立文件 `facts.json`/`runs.json`，schema 校验失败关闭、临时文件+rename 原子替换、每次命令重读盘、内置 requestId 幂等表）——V5/V6 已验证的模式，零依赖、可迁移（拷目录即迁移）、失败恢复=重放/快照。
评估并否决（本轮）：better-sqlite3（真事务但引入原生依赖；当前单 writer 单进程无跨进程并发证据）、lowdb（无增量价值）、数据库平台（重型，违反约束）。升级路径：若出现多进程 writer 需求，迁移 SQLite，实体形状不变。**纪律：一个数据目录只归一个服务进程；测试/故障注入用各自隔离目录与端口。**

## 2｜实体（最小集）

```jsonc
// facts.json  schema "v7-a-facts@1"
Project     { projectId, name, factVersion:int(≥1, 每项目证据写递增), createdAt, updatedAt }
Evidence    { evidenceId, projectId, version:int(≥1), kind, content:object, sha256,
              supersedes:null|evidenceId, supersededBy:null|evidenceId,
              factVersion:int(采集时项目 factVersion), capturedAt }
RuleVersion { version:int(全局单调), status:"published", indicators:string[], allowedTools:string[],
              humanEscalation:string[], notes, publishedAt }   // 不可变

// runs.json   schema "v7-a-runs@1"
Run { runId, projectId, ruleVersion, factVersion:int(创建时项目快照),
      inputs:[{evidenceId, version}], state, calculation, opinions[], humanActions[],
      version:int(≥1, run 聚合版本，每次写 +1), createdAt, updatedAt }

state ∈ pending|candidate_ready|human_required|unknown|failed|resolved（**resolved 为终态**：不可再 escalate、不可再追加人工动作——重新处理=以当前项目事实新建运行，无业务重开制度；D-3 裁决）

runId 由服务端生成；外部请求标识经 `requestReceipt` 关联（B 编排 runId 与 A runId 是两个标识，ICR-3）。opinions 中的意见记录不含命令 requestId（幂等回执经 `GET /receipts/:requestId` 查询）。

**意见状态门（v0.1 D-4 裁决；v0.2 码位澄清）**：opinion 仅可写入 `pending|candidate_ready`；对 `human_required|unknown|failed`（已交回人工）→ 409 `RUN_ESCALATED`；对 `resolved` → 409 **`RUN_RESOLVED`**（与人工动作终态保护同码；`RUN_ESCALATED` 仅指升级态——消费方按码分支不混淆，C v3 观察 #4 的实测偏差已由 A 实现改码对齐）。多角色顺序贡献意见无需状态扩展（同态内多条合法），升级期间一律闭门。**校验顺序：状态门先于证据引用校验**（升级态上的伪造引用返回状态码而非 400；C v3 观察 #7）。

**证据引用失败关闭（v0.1，D-5 裁决）**：`basedOnEvidence` 每项必须指向**同项目存在且版本一致**的证据；`candidate.evidenceRefs` 每个 token 的 evidenceId 部分必须存在。引用不存在/版本不符 → 400 `INVALID_INPUT`（伪造引用不入库）。
calculation = null | { toolVersion, inputHash, output:object, assumptions:string[], computedAt, computedBy }
opinions[]  = { opinionId, authority:"none", provider:"simulation"|"real_http", requestReceipt,
                candidate:{ observations[], evidenceRefs[], assumptions[], uncertainty[],
                            recommendedHumanAction:enum },
                basedOnEvidence:[{evidenceId, version}], at }        // 只追加，不改写
humanActions[] = { actionId, action:"accept_candidate"|"return_for_evidence"|"take_over",
                   actorRole:"human", actorName, note, basedOnRunVersion:int, at }  // 只追加
```

**权威分离（硬规则）**：opinion/calculation 只能由 `provider/simulation|real_http` 的模型与计算通道写入，`authority:"none"`，服务端拒绝 candidate 携带禁用键（`approval|approved|decision|quota|price|rate|approve|reject` 及其变体）——结构层强制，不靠提示词。

candidate 字段约定（ICR-1/ICR-2 澄清）：`recommendedHumanAction` 四值枚举 `accept_candidate/return_for_evidence/take_over/need_more_evidence`，**省略该键 = 无建议**（B 的 'none' 哨兵在 B 边界省略该键即可）；`candidate.evidenceRefs` = `"evidenceId"` 或 `"evidenceId@vN"` 字符串数组（显示引用；**结构化有效性引用一律由 `opinion.basedOnEvidence` 承载**）。

humanActions 仅接受 `actorRole:"human"`（其他值 403 ROLE_FORBIDDEN）；`action` 是唯一正式记录，`formalOutcome` = 最近一条 humanAction（读时计算，**位于 GET /runs/:id 响应顶层**，连同 `stale`/`currentProjectFactVersion`——run 实体内不含这三个投影字段）。

**可信 principal 边界（v0.1 新增，D-6 裁决）**：`actorRole` 是字段值不是认证。正式动作必须携带 `principalCredential`（string，请求体），经服务构造时注入的同步 `principalVerifier(credential) → {ok, principalId, role}` 验证；`role!=='human'` 或验证失败/缺失凭据 → 403 `PRINCIPAL_UNTRUSTED`。**未注入验证器（无可信身份源）= 默认失败关闭**——自声明 human 不构成授权；模块层直连与 HTTP 同界不可绕过。验证器须同步返回（写路径保持全同步串行纪律；异步身份源为后续升级项）。服务端参考实现：`--principal-tokens`/`V7_A_PRINCIPAL_TOKENS`（逗号分隔 token 允许列表，仅存 sha256；合成测试适配用，非账户体系）。**本包不引入真实账号/密钥；若部署环境始终无可信身份源，正式动作保持阻断——这是能力边界，不是已修复。**

**失效按输入版本，不按全局版本**：opinion/humanAction 记录 `basedOnEvidence`；run 记录创建时 `factVersion`。读取时现算：引用的证据被 superseded → 该记录 `stale:true`（历史保留不删）；`project.factVersion > run.factVersion` → run 顶层 `stale:true`。未命中的旧记录不失效。

**状态迁移**：opinion 写入仅 `pending→candidate_ready`；escalation（state 命令）可从任何非 resolved 态置 `human_required|unknown|failed`（附 reason，不自动重试）；human action：`accept_candidate→resolved`、`take_over→resolved`、`return_for_evidence→pending`（新循环，正式留痕保留）。`unknown`=发送后结果不可知，不得伪造为失败或成功。

## 3｜命令与幂等（全部写命令统一）

每个写命令携带 `requestId`(1..64) + 相应聚合 `expectedVersion`。语义：同 requestId 同载荷 → 重放原响应（`replayed:true`）；同 requestId 异载荷 → 409 `REQUEST_MISMATCH`；版本过期 → 409 `VERSION_CONFLICT` + `serverVersion`。跨存储无事务：命令只写所属 store（facts 或 runs），创建 run 时对 facts 只读校验——部分失败面=单文件原子写，恢复=重放。

## 4｜HTTP API（wire 层；模块层=同语义 service 函数，assembly 可直连）

```
GET  /api/v7/health
POST /api/v7/projects                                     {requestId,name}
GET  /api/v7/projects/:projectId                          （含证据链状态投影）
POST /api/v7/projects/:projectId/evidence                 {requestId,expectedVersion,kind,content}
POST /api/v7/projects/:projectId/evidence/:eid/supersede  {requestId,expectedVersion,content}   // 取代=新建证据实体（新 id、version=1、supersedes=旧id；旧实体 version 不变，置 supersededBy）——非同 id 升版本
GET  /api/v7/rules            POST /api/v7/rules          {requestId,indicators,allowedTools,humanEscalation,notes}
GET  /api/v7/rules/:version
POST /api/v7/projects/:projectId/runs                     {requestId,expectedVersion,ruleVersion,inputEvidence:[{evidenceId,version}]}
GET  /api/v7/runs/:runId                                  （含 stale/formalOutcome 投影）
POST /api/v7/runs/:runId/opinions                         {requestId,expectedVersion,provider,requestReceipt,candidate,basedOnEvidence}
POST /api/v7/runs/:runId/calculation                      {requestId,expectedVersion,toolVersion,inputHash,output,assumptions}
POST /api/v7/runs/:runId/state                            {requestId,expectedVersion,state,reason}   // state ∈ human_required|unknown|failed
POST /api/v7/runs/:runId/human-actions                    {requestId,expectedVersion,action,actorRole,actorName,note,principalCredential}
GET  /api/v7/receipts/:requestId?store=facts|runs         （回执查询；跨端一致性辅助）
```

错误码表：400 INVALID_INPUT / 403 ROLE_FORBIDDEN|PRINCIPAL_UNTRUSTED / 404 NOT_FOUND / 409 VERSION_CONFLICT|REQUEST_MISMATCH|EVIDENCE_SUPERSEDED|RUN_ESCALATED|RUN_RESOLVED / 500 STORE_CORRUPT|STORE_UNAVAILABLE。响应统一 `{ok:true,...}` 或 `{ok:false,error,message,serverVersion?}`；所有响应 `Cache-Control: no-store`。

## 5｜运行方式

`node V7/backend/A/src/server.mjs --port 3601 --data-dir <dir>`（默认 3601/`V7/backend/A/.data`；env `V7_A_PORT`/`V7_A_DATA_DIR` 同义）。零 npm 依赖（Node ≥22 ESM）。双端一致性=同一服务同一事实源；两客户端刷新即见相同 `factVersion`/`run.version`。

## 6｜对其他路的接口点

- **B（编排）**：产出意见/升级经 `opinions`/`state`/`calculation` 命令落库（HTTP 或 assembly 直连 service）；模型真实发送的回执语义=你的 gateway receipt id 存入 `requestReceipt`；恢复/幂等以本合同命令幂等为准，checkpoint 不替代本事实源。
- **C（规则/计算/案例）**：规则包内容按 `RuleVersion` 形状提交（A 落版本）；计算结果按 `calculation` 形状；案例预期用 run/opinion 投影断言。
- **D（反证）**：黑盒走 HTTP；故障注入用自有 `--data-dir`+端口；损坏注入=改坏 JSON 文件后请求须 500 STORE_CORRUPT 且不静默重置。
- **assembly**：A 在 `V7/backend/A/assembly/` 组合 B/C 发布产物（记录来源文件+hash，不复制修改原件）。

## 7｜基线门

本包全部产物在 `V7/backend/**` 新目录，不触碰 site/V6/home/**/3607/3467。site 正式接线仅出精确 diff proposal，等待用户基线授权。
