# D路缺陷报告（V7 backend · 第一轮黑盒验收 · v2 更正版）

日期：2026-09-15 02:5x。被测：A `src/server.mjs|service.mjs|store.mjs`，hash 见 `D/evidence/a-src-hashes-at-dtest.txt`（server 6636e6be…/service 6056c9b7…/store a7a399b3…）。
方法：CONTRACT v0 黑盒 HTTP，隔离实例（3491+ 自有数据目录，用后即清）。复现：`node V7/backend/D/runtime/x_matrix.mjs`（~30s，台账 `D/evidence/x-matrix.json`）。

**汇总（v2 终版）：56 PASS / 4 FAIL。4 个 FAIL = 4 项真实缺陷（D-3～D-6）。**
**v2 更正**：初版 D-1/D-2（run stale/formalOutcome"缺失"）经源码核对与复测**撤回**——功能存在且值正确，位于**响应顶层**（`GET /runs/:id` → `{stale, formalOutcome, run, currentProjectFactVersion}`）；初版断言查 `run` 对象内为定位错误。降级为 **K-1 接口澄清项**（合同措辞歧义，见下）。B/C 消费方按合同"run 顶层"字面理解为 run 对象内会读空——需 A 澄清。

---

## D-3（低-中｜owner=A）resolved 终态后仍可追加人工动作

- **实测**：run resolved（accept_candidate）后，再发 `take_over`（actorRole:human、当前 expectedVersion）→ **200** 入库。
- **影响**：结合 formalOutcome="最近一条 humanAction"语义，resolved 后的追加动作将改写正式结果；且"重新打开已结案轮次"无门槛。
- **合同**：§2 未明确禁止对 resolved 追加动作（"非 resolved"限制仅写在 state 命令）。建议：终态 409 保护，或合同明示追加语义。
- **复现**：x_matrix.mjs X-8e。

## D-4（中｜owner=A）`unknown` 态可写入模型意见（状态机门缺失）

- **合同**：§2"opinion 写入仅 `pending→candidate_ready`"。
- **实测**：run 置 unknown 后 POST opinions → **200**。
- **影响**："调用状态未知必须升级人工、交回人"被绕过——服务端不可知期间仍可静默注入候选意见。
- **复现**：x_matrix.mjs X-4d。期望 409。

## D-5（中｜owner=A）伪造证据引用被接受（basedOnEvidence 无存在性校验）

- **实测**：opinions 携带 `basedOnEvidence:[{evidenceId:"ev-nonexistent",version:1}]` → **200** 入库。
- **影响**：模型候选可声称引用不存在的证据（伪造引用面）；此类幽灵引用永不触发 stale（无可被取代的原件），"引用可复核"失效。
- **复现**：x_matrix.mjs X-7a/X-7b。建议 400（引用不存在或版本不符）。

## D-6（高｜owner=A）人工动作身份=自声明字段，无可信身份验证

- **实测（X-8f）**：无任何凭据/签名的黑盒客户端，自称 `actorRole:"human", actorName:"匿名伪造者"` → **200**，正式动作 `return_for_evidence` 入库且状态翻转（resolved→pending）。
- **定位**（心跳反证 + D 复核一致）：`service.mjs` 仅校验 `actorRole === "human"` 字段值；`server.mjs` 直传 body。字段**不是认证**——X-8a 的 403 只证明字段白名单，不构成权限控制。
- **影响**：任何可达端口的客户端（含其他 Agent/恶意脚本）可冒充人类发正式动作、翻转状态、改写 formalOutcome。与"人处理例外并保有正式决定权"直接冲突。
- **建议**：v0 合同明示"无认证"边界 + 预留 `actorToken`/签名校验钩子；真实接线前升级为必须项。
- **复现**：x_matrix.mjs X-8f（台账记 PASS=缺陷存在性证实，注意语义）。

## K-1（低｜owner=A·合同澄清）`stale`/`formalOutcome` 位于响应顶层而非 run 对象内

- **合同**：§2"…→ run 顶层 `stale:true`"、"`formalOutcome` = 最近一条 humanAction"——未写明挂载位置。
- **实测**：响应顶层 `{stale:true, formalOutcome:{…}}` 正确；`run.stale`/`run.formalOutcome` 为 null。D 初版断言即因此误报"缺失"。
- **影响**：B/C 按"run 对象内"理解会读空（D 已踩坑）。建议合同补一行响应形状示例。
- **复现**：`GET /api/v7/runs/:id` 顶层键 `['currentProjectFactVersion','formalOutcome','ok','run','stale']`。

---

## 通过面（未发现缺陷）

双端同刻一致（X-1）；同requestId重放/换载荷409/并发恰一次/回执查询含found:false诚实（X-2）；SIGKILL 重启后事实/run/幂等表全恢复且版本单调（X-3）；unknown 三态语义+无自动重试（X-4a-c）；supersede 链+opinion 级 stale+EVIDENCE_SUPERSEDED（X-5）；计算缺 toolVersion/inputHash/output 全 400 且不落库（X-6）；candidate 禁用键（approval/approved/decision/quota/price/rate）结构拒绝（X-7c）；actorRole=model 403+过期版本 409（X-8a-c）；错误语义统一 400/404/ok:false+no-store+破损JSON体400（X-9）；损坏 JSON→500 STORE_CORRUPT 且不静默重置、恢复文件即恢复服务（X-10）。

## 归属与传递

- D-3～D-6、K-1 全部 owner=A（实现/合同澄清），已按单 writer 落本文件；A 修复后 D 以同一脚本复测，X-8f 判据按 A 对 D-6 的裁决更新。
- B/C 侧：本轮未组合（B 正在按合同接 C；assembly 现为 sim-round 占位），其组合验收在 A 发布 assembly 产物（固定 hash）后进行。
- 归类：D-3～D-6=工程故障/合同缺口；无模型能力项（真实通道凭据阻断中）。


---

## 复测记录（2026-09-15 03:1x · A service.mjs 变更后）

- A src 漂移复核：server.mjs/store.mjs 未变，service.mjs 变更内容为 b-round 组合适配（导出 startServer 等），**D-3/D-4/D-5 复测仍 FAIL（未修复）**；D-6/K-1 未变。X 矩阵维持 56/4。

## D-7（高｜owner=B）deps.mjs 的 fs 封装缺 promises API → b-round 组合崩溃

- **复现**：`node V7/backend/A/assembly/b-round.mjs` → 种子/建 run 成功后，B thin 编排器 start → saveSnapshot → `ports.mjs:137 atomicWriteJson` 抛 `TypeError: Cannot read properties of undefined (reading 'writeFile')`，脚本中断。
- **根因**：`B/src/ports.mjs:8` `import { fs } from './deps.mjs'`——deps.mjs 导出的 fs 封装**无 `promises` 成员**（`fs.promises.writeFile/rename` 均不可用）。
- **影响**：A×B 组合无法通过编排器启动；checkpoint 真实落盘（B 目标核心项）在组合路径上不可用。B 自测 33/33 未覆盖此路径（疑似单测用了完整 node:fs 或未走 thin start）。
- **证据**：`D/evidence/b-round-d-run.txt`（完整崩溃输出）。
- **建议**：deps.mjs 的 fs 封装补 `promises`（或 atomicWriteJson 改用回调式 fs + promisify）。
- **连带观察（低｜owner=A）**：b-round.mjs 无 try/finally 清理——崩溃时遗留孤儿 A server（D 已清理本次 PID 38520）。建议脚本 finally 兜底。


## D-7 关闭复核（2026-09-15 03:4x）

- 重跑 `node A/assembly/b-round.mjs`：编排器正常 start（崩溃消失），B thin 全链跑通——ratio_query 事件→2 步→simulated 意见（sent=false）经 a-sync 以确定性 requestId 落 A opinions（runVersion 2）→C 计算工具 succeeded 落 calculation（runVersion 3）→"B 编排跑至 completed"检查通过。**D-7 行为关闭**（deps.mjs/ports.mjs 修复方式以盘上代码为准）。

## D-8（低-中｜owner=A）b-round.mjs:114 读取 opinion 记录不存在的 `requestId` 字段导致验证脚本崩溃

- **复现**：`node A/assembly/b-round.mjs` 跑至"确定性回执 requestId"检查 → `aView.run.opinions[0].requestId` 为 undefined → TypeError 中断，后续检查未执行。
- **根因**：CONTRACT §2 的 opinions[] 记录形状**不含 requestId**（requestId 是命令字段，用于幂等，不回存记录）。b-round 的检查应读命令回执（`POST /runs/:id/opinions` 响应或 `GET /receipts/:requestId`），而非记录字段。
- **影响**：组合验证脚本后半段（formalOutcome 留痕等）无法执行；不影响业务 API 本身。
- **证据**：`D/evidence/b-round-d-run2.txt`。


---

## 复测关闭记录（2026-09-15 04:0x · CONTRACT v0.1）

A 发布 CONTRACT v0.1（principalVerifier 身份层）后终版复测：

| ID | 终态 | 复测证据 |
| --- | --- | --- |
| D-3 | **关闭** | X-8e：resolved 终态+有效凭据 take_over → **409** 终态保护 |
| D-4 | **关闭** | X-4d：unknown 态写意见 → 409 状态门生效 |
| D-5 | **关闭** | X-7a/b：伪造证据引用被拒且未落库 |
| D-6 | **关闭** | X-8f：无凭据自称 human → 403 PRINCIPAL_UNTRUSTED 且状态不翻转（fail-closed；合法凭据路径 X-4e/X-8c/d 全过，token 仅 sha256 存储） |
| D-7 | **关闭** | B 修 ports.mjs:137 调用点；b-round 编排全链跑通（03:4x 复核） |
| D-8 | **关闭** | b-round 验证改走意见命令回执（receipts），确定性 requestId 断言通过（b-round-d-run4.txt） |
| K-1 | **关闭** | CONTRACT v0.1 发布（响应形状随版本澄清） |

**终版：X 矩阵 60/60 全过；b-round 组合全过（含 B 去重/A 幂等双层、无凭据失败关闭、principalId 留痕）。**
台账：`evidence/x-matrix.json`（60/0）；`evidence/b-round-d-run4.txt`。


---

## 编排级反证轮（2026-09-15 05:3x · HEARTBEAT_20260915_0425 §D）

`runtime/orch_tests.mjs` **19/19 全过**：unknown 不自动重发（O-1）、SIGKILL 后 journal 重放恢复且 intent-无回执步判 unknown 零重发（O-2）、同输入重入去重+A 意见不重复（O-3）、resume 三重校验（匿名/越权角色/角色越动作/版本漂移全部拒绝，合法重锚定接受）（O-4）。台账：`evidence/orch-tests.json`。

## D-9（中｜owner=A+B · 合同边界，v0.1 内已知取舍）身份作用域无项目级绑定

- **实测（O-5a）**：同一 principalToken 对**第二个项目**的 run 发正式动作 → 200 成功。token=全局人类身份，无项目/run 级绑定。
- **B 侧**：resume 的 `actor.id/role` 为**自声明字符串**+角色白名单（coordinator/credit_officer/policy_officer），无凭据绑定——能触达 B dataDir/journal 的调用方可自declare任意协调者身份完成 resume。
- **威胁面**：token 持有者可对系统内任意项目发正式动作；B 层身份可伪造。v0.1 单机演示边界内可接受，但**合成 token 不等于生产认证**（心跳明示）。
- **建议**：生产化门=凭据→principalId→(可选)项目/域级授权绑定三层；合同明示当前边界。
- **复现**：orch_tests.mjs O-5a/O-4e。


---

## 06:25 心跳轮（LangGraph 实际候选 · HEARTBEAT_20260915_0625 §D）

`runtime/lg_orch_tests.mjs` **17/17 全过**（LangGraph 实际候选，独立隔离数据，不外推 thin 结果）：

- **LG-1 unknown**：不停留 completed/模型步非 succeeded/恰一次调用/两次 continueRun 零重发/FileCheckpointSaver 落盘非空。
- **LG-2 kill-recover**：模型步执行窗口 SIGKILL→同 checkpointer 新进程重放→中断步判 unknown **零重发**（`evidence/lg-kill-recover.txt`）。
- **LG-3 幂等**：重入去重或显式拒绝、A 意见不重复。
- **LG-4 resume 现版三重拒绝**：匿名/role=model/版本漂移（经 LangGraph 原生 interrupt/Command 门，拒绝不抛异常）。
- **LG-5 D-9 B 部分验证 ✅**：`validateResumeAccess`（principalVerifier→principalId→authorizer(项目/动作)）三层生效——合法凭据+授权项目 resume 接受（gateStamp 盖章进 run）；**授权器跨项目拒绝 AUTHORIZATION_DENIED 生效**；错误凭据 PRINCIPAL_UNTRUSTED。

## D-9 状态更新

- **B 部分（可信 resume 绑定）：已修复并经 D 独立验证关闭**（LG-5；B 侧 fail-closed 三层+gateStamp）。
- **A 部分（token 全局作用域）**：维持为**测试适配边界**——全局测试 token 的跨项目权限仅在本机测试环境成立；生产身份源/真实岗位与项目权限**未验收、需用户确认**，不暗设制度（0625 心跳明示）。A 层若需项目级绑定，走 authorizer 注入（B 已提供钩子；A assembly 是否配置=A 裁量）。
- 附带发现（低，owner=A·记录）：A 层 HTTP `human-actions` 的 authorizer 钩子在 B resume 已落地，A HTTP 侧是否对称配置由 A 裁量；当前 A HTTP 凭据=token 允许列表（全局），威胁面同 D-9 原报告。


---

## 最终轮（07:47 更新 · recovery-round + manifest 审计 + 凭据泄漏反证）

被测版本钉版：`evidence/final-pinned-hashes.txt`（service d2035d2c / server 3e36a518 / resume-core d055f458 / thin 470e062c / lg 5f68921d / recovery-round 422584bc / CONTRACT c0cf5ca0 等 44 文件）。复现命令在各条目。

## D-10（低-中｜owner=B）verifier 异常消息内嵌凭据直接传播进 resume 错误（泄漏面）

- **复现**：构造抛 `Error("verifier backend unreachable while checking credential=<TOKEN>")` 的 principalVerifier → resume → 错误消息含 `principal 验证器异常:${e.message}` → **TOKEN 全文出现在返回给调用方的错误中**（L-1a）。authorizer 抛异常同型（`授权器异常:${e.message}`，resume-core 同模式）。
- **持久化面（已测为零）**：B journal/snapshot、A 存储、A 403 响应体、A 服务器日志均无凭据明文（L-1b/c/d/e）——泄漏面=调用方错误消息（调用方打日志即泄漏）。
- **建议**：messageZh 不透传底层 e.message（固定文案+审计代号），或对异常文本做凭据脱敏；token 本就 sha256 存储，异常文本是唯一明文出口。
- **复现**：`node runtime/final_audit.mjs`（L-1a）。

## D-11（低｜owner=A）manifest 覆盖缺口：传递依赖与锁定依赖未登记

- **实测（传递 import 闭包审计，`runtime/final_audit.mjs` M-1b）**：`B/src/deps.mjs`（ports.mjs 的 2 跳依赖，resume/atomicWriteJson 实际使用）**不在 23 项清单**。
- **实测（M-1c）**：`B/package.json` + `B/package-lock.json`（锁定 langgraph 0.2.62/core 0.3.68）**不在清单**——锁定依赖不可经 manifest 追溯。
- **影响**：23/23 匹配只证明已登记项；按此清单复原组合会缺 deps.mjs（运行即崩）与 B 依赖版本凭据。
- **精确补齐清单（给 A）**：manifest 增补 `B/src/deps.mjs`、`B/package.json`、`B/package-lock.json`（→26 项）。
- **复现**：`node runtime/final_audit.mjs`（M-1b/M-1c）。

## 文档偏差（非产品故障）

- A STATUS 自报 recovery-round "23/23"；实际输出 **24 条 ok**（C 规则包 1 + 双候选各 11 + checkpoint 1）——计数偏差，记录为文档问题（与 Codex 复跑结论一致，不隐去）。
