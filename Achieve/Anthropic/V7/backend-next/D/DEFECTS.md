# D路 缺陷与观察报告（2026-09-16 夜间批次）

D路独立黑盒验收产出。每条含：严重度 / owner / SUT固定hash / 精确复现 / 预期 vs 实际 / 证据路径。
owner修复或契约澄清后，D按新hash定向复测对应项，不整轮空转。

## DEF-01（P0 · owner 用户裁决；实现方A）证据更新后"必要下游"的失效传播缺口 —— 两层状态，保持开放

**层次(a) 实现一致性：PASS。** 实现（A/src/domain/recompute.ts）与 CONTRACT v1.2 文字一致：级联在 accepted/decided 处停止，下游继续消费已验收产出。D以 D-19/D-19b/D-19c 三测试、145+断言验证（含跨accepted中间节点三级链逐字节对比，`evidence/r11-g6`）。

**层次(b) 原需求满足度：OPEN · 待用户裁决。** 用户原需求"证据更新通过引用映射失效受影响目标及必要下游"在跨 accepted 中间节点场景未满足：下游（含隔层下游）无任何 stale/invalidated 标记、无人工复核提示，可直接 claim+complete 产出建立在旧依据链上的候选。保留历史正式决定（不改写 accepted/decided）与"下游失效传播/提示"是两件事；v1.2 将后者随前者一并停止级联，属实现方契约裁量，**未经用户业务决定授权**。常设反例 D-19d 保持 FAIL 状态直至用户裁决（可选语义：下游投影 stale 标记+人工复核提示/阻止无提示继续/维持现状）。证据取代后，accepted-stale上游的下游不被级联失效——与CONTRACT v1.0 §3.6文字冲突

- **SUT版本**：`evidence/r3-g6/SUT_VERSION.json`（A源码树140文件，combined `54bf820078e98513…`，即 full-r2-0310 同版）
- **时间线**：03:05 监督纠偏——不得仅以升契约关闭原需求缺口；D恢复原反例并补跨accepted中间节点反证。
  - v1.0→v1.2：A将"级联停止"写入契约文字（语义自v0.1未变）。D-19/D-19b/D-19c 按 v1.2 断言：PASS（实现一致性）。
  - **D-19d（常设FAIL）**：三级链 root(accepted,stale)→middle(accepted,stale)→leaf(ready)：root与middle输入先后被取代后，leaf 无任何标记仍可 claim+complete（HTTP 200），产出候选 `{builtOn:'stale-root-evidence'}`。复现：`D_SUITES=g6 D_ONLY=D-19d node harness/run-all.mjs repro-def01b`。证据 `evidence/r12-g6d`。
  - **未覆盖门（待用户裁决语义后D才可验收）**：下游stale标记是否存在/是否阻止无提示继续/人工复核提示形态/对已decided上游的隔层下游语义。
- **现象**：下游 `review`（ready、非decided、依赖边指向collect）在取代命中其唯一上游的输入证据后**保持 ready 且无任何 stale 标记**，可被直接 claim/complete 消费过期上游产出。
- **契约依据**：CONTRACT v1.0 §3.6：「下游沿依赖边级联为 `invalidated`（不自动回 ready，等上游重新验收）」。
- **实现侧注释**：`A/src/domain/recompute.ts` `invalidateForEvidence()` 中 accepted 分支 `continue` 前注释「验收已过：级联到其下游停止（下游继续消费已验收产出）」——实现为有意设计，契约文字未记载该例外。
- **精确复现**（套件已自动化，45断言）：
  ```bash
  cd V7/backend-next/D && D_SUITES=g6 node harness/run-all.mjs repro-def01
  # 断言点：g6_evidence_invalidation.test.mjs D-19「下游ready目标被级联失效」
  # 流程：模板(collect[facts]→review dependsOn collect) → 提证e1 → collect claim/complete/accept
  #       → review自动ready → supersede e1 → collect accepted+stale:true（✓）→ review仍ready（✗预期invalidated）
  ```
- **预期（契约）**：review → `invalidated`，等上游重新验收后重算。
- **实际（实现）**：review → `ready` 不变。
- **风险**：stale上游的下游目标可无提示地继续执行并产出新候选，违背「失效只重算受影响目标」的失效封闭性（失效集合不完整）。
- **owner裁决选项**：(a) 改码：accepted-stale 仍向下游级联 invalidated；(b) 升契约：§3.6 补记「accepted-stale 处级联停止」例外并说明理由。
- **证据**：`evidence/r3-g6/g6_evidence_invalidation.result.json`（D-19，failures[0] 含分歧自述与三态快照 `{review:ready, collect:accepted, collectStale:true}`）、`evidence/r3-g6/g6_evidence_invalidation.log`。

## DEF-02（P2 · owner B）【已关闭 04:15 —— B发布 src/cli.mjs，D完成接入与反证】worker 无 CLI 常驻入口
**解决**：B交付 `node src/cli.mjs worker|recover|resume|view|status`（支持 `--config`/`--data-dir` 全覆盖，D自有配置+运行时目录，B源码零写入）。D随即完成：D-12（claim→calc→candidate+kill/restart恢复）、D-12b（mid-flight击杀+零盲重发，15断言）、D-15（D自有runtime凭据扫描，PASS）、D-27b（unknown人工恢复链，见DEF-03）。原"留门"内容存档如下。

- **SUT版本**：`evidence/r3-g4/SUT_VERSION.json`（B源码树，同 full-r2 版）
- **现象**：`B/src/worker/worker.mjs` 为库模块（导出 `reportOutcome` 等），以 `node src/worker/worker.mjs` 直跑立即 exit=0（无守护循环）；`B/package.json` 无 `worker`/`start` script、无 `bin`。
- **影响**：矩阵 D-12（杀worker恢复/已回执步不重执行/unknown零盲重发端到端）、D-15（checkpoint凭据零泄漏）、D-26/27（B侧来源标记消费、unknown人工恢复）留门，无法验收。
- **owner交付建议**：提供 `node src/worker/cli.mjs --base <A url> --token tok-agent [--once]` 类常驻/单步入口 + README 参数表 + checkpoint 落盘路径说明；D 就绪即测。
- **证据**：`evidence/r3-g4/g4_recovery.result.json`（D-12 BLOCKED note：`exit=0，worker.mjs为库模块无CLI守护循环`）、`evidence/r3-g4/g4-worker.log`。

## 留门（BLOCKED，非缺陷）

| 项 | 状态 | 恢复条件 |
|---|---|---|
| D-12/D-15 | BLOCKED | B发布worker CLI（见DEF-02） |
| D-27 端到端 | BLOCKED | 同上（探针就绪度已验证：C假API断连场景注入成功，控制面可查） |
| D-25 费用/上下文限额 | BLOCKED | A契约v1.0与B均未发布成本限额接口；本轮0真实调用，如实不可测 |

## 观察项（实测确认的行为，非缺陷；供owner知悉）

1. **takeover 角色门**：takeover 要求 principal 具备目标 `responsibleRole`（如 business）；approver 角色被 403 ROLE_FORBIDDEN。契约未钉死此规则，行为合理，D-08 已按此语义通过（fencing 单调 + 零写副作用）。
2. **submitEvidence 跨项目开放写**：outsider（绑定不存在项目）向 p2 提交证据返回 200——与 v1.0「非敏感（匿名可写但可审计）」一致；建议 owner 关注审计面是否足以追溯匿名写入。
3. **读接口无 principal 校验**：GET /projects/:id 路由不注入 principal（任何可回环访问者可读任意项目投影）。契约敏感清单未含读；如需项目级读隔离属契约变更，交 A 裁量。
4. **已排除的疑似项**：干净目录 `tsc --noEmit` 通过（A类型面干净）；r1 曾记录的「构建失败」系D侧干净副本拿到A旧 package.json 所致，撤回，不构成A缺陷。

## 缺陷流转

- 上述缺陷已写入本文件并同步 D/STATUS.md。owner 修复发布新版本后，D 复现命令定向复测：
  `D_SUITES=g6 node harness/run-all.mjs retest-def01`（DEF-01）；B 就绪后 `D_SUITES=g4,g8 node harness/run-all.mjs retest-def02`（D-12/15/26/27 端到端）。


## DEF-03（P1 · owner B）【已解决 04:50 —— B 04:29 worker.mjs 修复，D 复测通过】人工授权 retry_step 被接受但不触发 transport 重发——unknown 恢复闭环的"重发腿"未走通

- **SUT版本**：`evidence/r33-g4full/SUT_VERSION.json`（B含 src/cli.mjs CLI；A同 full-r2 版；C含 latency 场景）
- **现象**：model步在途（C mock latency 6s）时 SIGKILL worker → 重启 worker recoverAll → run 以 failed+waiting_evidence/unknown 诚实升级（**零盲重发：mock计数不变 ✓**，D-12b/D-27b前半验证）。此后人工 `B_RESUME_CREDENTIAL='cred:<id>' resume <taskRunId> retry_step --step <stepId>`：
  - 无凭据 → 403式拒绝（D-9失败关闭 ✓）；
  - 带 `cred:` 合成身份凭据 → CLI exit=0，D-9门通过，graph `[advance] r0` 重跑、terminal 置 unknown、**transport 调用数 +0**（授权重发未发生）；goal 停留 `leased`（无 complete 提交），人工恢复闭环中断。
- **精确复现**：
  ```bash
  cd V7/backend-next/D && D_SUITES=g4 D_ONLY=D-27b node harness/run-all.mjs repro-def03
  # 断言点：'人工授权重发恰一次（总调用=1中断+1授权重发）'与'人工恢复后到达candidate_ready'
  ```
- **预期**：授权 retry_step 后，对 intent/sent=null 的步恰重发一次（新attempt/requestId），完成提交→candidate_ready。
- **实际**：CLI 接受动作并记录 humanActions，graph advance 重算后 terminal=unknown，transport 零新增调用；goal 停留 leased。
- **证据**：`evidence/r33-g4full`（D-27b failures + 最终 `__mock__/requests` 日志：恰2条=两个run各1次，retry未+1）、`evidence/r30-g4d27`～`r33-g4full`。
- **复测记录（新hash，04:25）**：B 更新 src/worker/worker.mjs（04:14）后两轮定向复测：
  - `evidence/retest-def03-r1`（resume前停worker）与 `retest-def03-r2`（resume时worker存活）：行为有改进——resume 后 terminal 被清除（`[advance] r0 ... terminal=-`），但 **transport 调用仍 +0**（`__mock__/requests` 恰2条=两个run各1次），goal 终为 failed。
  - 零盲重发语义在任何一轮都成立（计数从未因重启/恢复而增加）；缺口始终是"授权后的那次重发"未发生。
  - D 侧已尝试的组合：resume前停worker / resume时worker存活 / resume后再起worker（旧hash轮）。若 B 的意图是其他组合（如需 takeover 或特定 state），请给出确切调用序；否则该腿按缺陷修复。
- **解决确认（04:50）**：B 04:29 worker.mjs 修复后，D 按修正后的判据（按 runId 过滤 C mock 请求记账——C 在响应完成时才入账，被杀在途请求不入账，此前总计数断言低估）复测 **PASS（28断言）**：
  ① 中断→worker恢复→零盲重发（run1 仅1次调用，诚实 failed）；
  ② 无凭据 resume → 拒绝（新增 `RUN_NOT_RESUMABLE` 并发保护 + D-9 失败关闭）；
  ③ `cred:` 合成人工凭据 resume retry_step → **恰 1 次真实重发**（按 runId 计数）→ 真实响应 → complete → **candidate_ready**（provider=simulation）。
  证据：`evidence/retest-def03-r4`（PASS）与 `diag-def03-r4`（最终投影：真实 simulation 候选 + receiptCount=2）。D-27 端到端闭环完成。


## DEF-04（P0 · owner B）预算门未接线：config.budget 不透传 transport——预算1/1被6次并发调用击穿（含 Codex 独立反例复现）

- **SUT版本**：`evidence/d25-r8/SUT_VERSION.json`（B 含 05:07 glm.mjs 严格账本实现；runtime.mjs 为 04:2x 版）
- **现象（5项反证全中，`evidence/d25-r8`）**：
  1. **D-25a 跨进程并发**：3 个真实 worker 子进程同抢 3 个 ready 目标，budget={maxTotalCost:1, perCallEstimate:1} → mock 实收 **6 次调用**、3 目标全部 candidate_ready（期望恰1次/1个）；
  2. **D-25b 账本不可读**：costLogPath 指向目录 → **2 次调用**照常（期望失败关闭 0 次）；
  3. **D-25c 坏账本**：损坏行+超限有效行 → 调用照常（静默放行）；
  4. **D-25d 非法预算**：maxTotalCost="100"（字符串）→ worker 正常启动不报错、调用照常（期望构造即拒绝）；
  5. **D-25e 重启绕过**：第一笔消耗后重启 worker，第二目标仍 candidate_ready（账本持久语义未生效）。
- **根因（静态可见）**：`B/src/runtime.mjs` 的 createModelTransport 调用仅传 `{mode, real, mock, costLogPath}`——**`config.budget` 未透传**（grep budget = 0 命中）；glm.mjs 内部的严格预算实现（ledgerSumStrict/withBudgetLock/构造期正有限数校验）收不到 `p.budget`，`budget=null` → budgetGate 直接放行。即：账本与锁的修复是"死代码"。
- **精确复现**：
  ```bash
  cd V7/backend-next/D && D_SUITES=g8 D_ONLY=D-25a,D-25b,D-25c,D-25d,D-25e node harness/run-all.mjs repro-def04
  ```
- **期望**：HANDOFF-D §2 文档面（顶层 budget 段 + transport.costLogPath）生效——并发恰 1 次调用、目录/坏账本/非法预算全部失败关闭、重启不绕过。
- **最小修复候选**：runtime.mjs createModelTransport 参数补 `budget: config.budget`（一行）；glm.mjs 内部实现已就绪。
- **证据**：`evidence/d25-r8/g8_gateway.result.json`（5 FAIL 明细）、`d25-r8/d25a-worker*.log`（3 worker 并发实录）、`d25-r8/g8-mock17934.log`。
- **复测确认（05:51，最新构建）**：`evidence/d25-diag` — 预算1/1下 3 worker → **mock实收6次调用、3目标全部candidate_ready**（states=candidate_ready,candidate_ready,candidate_ready），DEF-04 在 B 最新代码上仍完整成立。
