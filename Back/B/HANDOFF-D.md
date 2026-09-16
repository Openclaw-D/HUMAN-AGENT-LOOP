# HANDOFF-D — B 常驻执行器最小交接（04:06 DEF-03 修复轮更新；2026-09-16）

对象:D 路独立验收。被测物 = **常驻进程** `node src/cli.mjs worker`(不是 integration 脚本;
`scripts/run-a-integration.mjs` 只是开发期冒烟,不代表交付形态)。

## 0｜DEF-03 已修复(04:06 定向轮;D 按 §8 复测 D-27b)

**根因(三层叠加,与 r33 证据逐条对应):**
1. r33 时恢复收尾缺 expectedVersion → failGoal 400 被拒 → goal 停留 leased(03:30 轮已修);
2. **版本门误伤**:恢复期上报失败使 A 目标乐观版本推进,D-9 版本门把 retry_step 误判为
   VERSION_CHANGED → pauseNotice、exit 0、零调用(r33 观察到的直接现象)→ 修复:版本门改为
   **仅 provide_evidence 需显式重锚**;retry_step/abort/accept 由人工显式授权即重锚基线
   (完成前若事实再漂移,完成前新鲜度核对/终态门仍拦截;unknown 安全不回退);
3. **CLI resume 不回写 A**:图内重跑成功后无人提交 → 新增 `settleAfterResume`:授权重试完成后
   以**新 requestId**(`::complete:rN`,N=授权次数)提交 A;租约过期/旧 token → 自动 claimGoal
   重领新 fencing 后提交;goal 已 failed → 不跨 A 状态门,返回 needs-a-resume 指引走 A resume 腿。
4. 配套:恢复对 unknown 运行改为**持牌待重试**(clarification 待办如实上报,goal 留 leased,
   不抢先 fail)——使 B 本地可信重试可在 A 上收口;A resume 腿(常驻 worker 新周期)保持可用。
5. 加固:**resume 边界前置检查**——已完成/在途线程直接拒绝(无 interrupt 挂起时 Command{resume}
   会重放图,是重复授权的洞);重复授权零写入零调用。

**自证(真实常驻进程,对真实 A+PG+C mock):`node scripts/verify-resident.mjs` = 25/25**,
其中 T3 即 D-27b 配方:无凭据拒绝(exit≠0,零调用)→ `B_RESUME_CREDENTIAL=cred:boss resume
<taskRunId> retry_step --step <stepId>` exit 0 → **恰一次新 attempt/requestId 重发**
(总调用=1中断+1授权重发)→ **A candidate_ready** → 重复授权 exit≠0 零调用。
进程内单测:`test/def03-resume-resend.test.mjs`(含版本漂移下的重发与收口)。
负例矩阵:无凭据/错凭据/重复授权/跨项目授权(ctx 校验)→ 全部 D-9 失败关闭,零额外调用;
凭据不落盘(checkpoint 零凭据断言保持)。

## 1. 长期运行入口(常驻)

```bash
cd V7/backend-next/B
npm install                                   # 锁版依赖(@langchain/langgraph 0.2.62 等)
cp config/b-config.http-sample.json config/b-config.json

# 前置:A 内核 48080 运行 + C mock 3730 运行
#   cd ../A && docker start v7next-a-pg && node scripts/start-kernel.mjs
#   cd ../C && node scripts/start-mock.mjs            # 默认 127.0.0.1:3730

node src/cli.mjs worker                       # 常驻:先恢复扫描,后进入消费主循环
# 后台运行建议(Windows): start /b node src\cli.mjs worker > runtime\worker.log 2>&1
#   或 Git Bash: nohup node src/cli.mjs worker > runtime/worker.log 2>&1 &
```

## 2. 配置(config/b-config.json;样例即 `config/b-config.http-sample.json`)

| 键 | 值(样例) | 说明 |
|---|---|---|
| transport.mode | `mock` | `real`=GLM-5.2(本轮 0 调用;key 显式注入,不读环境) |
| transport.mock.baseUrl | `http://127.0.0.1:3730` | C 的 loopback 假模型 API |
| contract.mode | `http` | `stub`=B 本地测试替身(单测用) |
| contract.baseUrl | `http://127.0.0.1:48080` | A 内核 |
| contract.principalCredential | `tok-agent` | A 发布的合成 agent principal |
| contract.projectFilter | `[...]` | 可选:只消费列出的 projectId(部署范围护栏;A 的授权仍是第一道) |
| identity.mode | `synthetic` | B 本地 resume 身份源(`cred:<id>`→human;**仅测试/组合**,生产=注入真实验证器;`none`=resume 一律失败关闭) |
| worker.taskTimeoutMs | `60000` | 软超时(步边界取消);**必须 < A 租约 90s** |
| worker.concurrency / pollIntervalMs / maxReclaims | 2 / 500 / 1 | 并发上限 / 轮询间隔 / 有界重领次数 |
| budget.maxTotalCost / perCallEstimate | 0.5 / 0.01 |(06:00 轮)**接线**:顶层 config.budget 经 runtime 透传到 transport(DEF-04 已修,worker/CLI 同一装配);**估算语义**:按 perCallEstimate 名义值记账,非真实费用硬上限(真实费率未注入)。(06:00 轮)**锁安全**:抢占仅针对已死 owner(pid 不存在),活 PID 不盲抢,等待超时=BUDGET_LOCK_TIMEOUT 失败关闭;owner 释放带 token 校验,不删新 owner 的锁。 **D-25 预算上限**(可选段,两值都须为正有限数,缺一/非法=创建即抛错)。账本语义(amount<0 拒绝):**reserve=扣减主体**(出站前按估算预占,永久入账不冲销,失败/崩溃也保留,只偏高绝不偏低);**actual=观测+超额补记**(真实用量超出估算的差额才入账,mock 名义值=估算故差额 0)。并发/跨进程安全=budget.lock 文件 wx 独占创建互斥,临界区内【严格读账→判定→预占】;持锁者崩溃→陈旧锁(pid 死亡/超龄 10s)被抢占;锁等待超时/账本 I/O 错误/目录路径/坏行/amount 非法 → 一律失败关闭(BUDGET_EXCEEDED / BUDGET_LOCK_TIMEOUT / BUDGET_LEDGER_UNREADABLE / BUDGET_LEDGER_CORRUPT / BUDGET_LEDGER_IO),确定未发送。重启不绕过(账本持久)。删除 budget 段=不启用 |

## 3. 端口与进程

- B worker **不监听任何端口**(拉模式:轮询 A events+claim);进程 = `node src/cli.mjs worker`。
  kill 反证目标即此进程(记录 PID 或按进程名+命令行定位)。
- 相关端口:A `127.0.0.1:48080`;C mock `127.0.0.1:3730`;PG `127.0.0.1:15432`(A 的容器)。
- Celery spike 容器(如启用)`b-celery-spike-*`,默认关闭,与本 worker 无依赖。

## 4. 数据路径(默认 `--data-dir V7/backend-next/B/runtime/`,可用 `--data-dir` 改)

| 路径 | 内容 |
|---|---|
| `runtime/checkpoints/<taskRunId>/` | LangGraph 持久 checkpoint(线程级,崩溃恢复依据) |
| `runtime/receipts/<requestId>.json` | B 本地 intent/terminal 回执(幂等权威镜像) |
| `runtime/worker/runs.json` | 运行登记+事件游标(`#cursor`;崩溃恢复入口清单) |
| `runtime/cancellations/<goalId>.flag` | 跨进程取消标志(CLI cancel 写;worker 每 tick 消费) |
| `runtime/cost-ledger.jsonl` | 模型调用成本流水(mock 为 0 费用记录) |
| `runtime/worker.log` | 常驻日志(启动后所有 worker/编排日志经脱敏落此) |

## 5. 关闭/恢复方式

- **优雅停**:`Ctrl-C`(SIGINT/SIGTERM)→ 等在途任务收尾后退出;SIGKILL 亦安全(靠下述恢复)。
- **崩溃/kill 后恢复**:`node src/cli.mjs recover` —— 读 runs.json 中未收尾 run →
  checkpoint 投影 → **B 回执+A 回执双重对账** → 系统统跑(intent 无 terminal 的模型步=unknown,
  零盲重发)→ 终局处置:
  - **unknown → 持牌待重试**(clarification 待办如实上报;goal 留 leased,不抢先 fail——
    保证可信 B 本地 retry 可在 A 上收口);
  - 其余终局(failed/waiting/candidate)→ fail/complete 补提交(带当前 expectedVersion)。
  `worker` 子命令每次启动自动先跑同一恢复扫描。
- **unknown 处置(两条已验证通路)**:
  - **B CLI(DEF-03)**:`B_RESUME_CREDENTIAL=cred:<id> node src/cli.mjs resume <taskRunId>
    retry_step --step <stepId>` → D-9 门 → 恰一次新 attempt/requestId 重发 → 自动收口 A
    (candidate_ready 或诚实 fail);租约过期自动 claimGoal 重领新 fencing;
  - **A resume 腿**:A 人工 resume(failed 目标,带 expectedVersion)→ GOAL_RESUMED →
    常驻 worker 新周期。
- **取消**:`node src/cli.mjs cancel <goalId|taskRunId> --reason ...` → 标志文件 →
  worker 步边界取消:未发送步=cancelled,在途已发送步按 transport 语义(intent 无回执=unknown)。
- **查看**:`node src/cli.mjs view <taskRunId>` / `status`(transport/路由/契约指纹,不含密钥)。

## 6. 固定 hash

- 清单:`evidence/b-release-manifest.json`(sha256;**46 文件**,覆盖 src/test/scripts/config/spike
  + package.json + **package-lock.json**)。
  + package.json + **package-lock.json**)。
- 清单整体指纹(对 files 映射做 sha256 取前 16 位):**`37cd7a9c05568eb0`**(2026-09-16 06:3x
  DEF-04 接线+锁安全轮;若代码再变,以重跑 `node scripts/hash-manifest.mjs` 后的最新清单为准)。
  DEF-03 修复轮;若代码再变,以重跑 `node scripts/hash-manifest.mjs` 后的最新清单为准)。
- 单测基线:`npm test` = **63/63**(预算门 9 项:含 T9 worker 端到端接线回归);
  真实组合自证:`node scripts/verify-resident.mjs` = **25/25**(可随时对常驻形态复跑)。
  真实组合自证:`node scripts/verify-resident.mjs` = **25/25**(可随时对常驻形态复跑)。
  `node scripts/verify-resident.mjs` = **25/25**(可随时对常驻形态复跑)。

## 7. 修复缺陷台账(与 D 相关;均已带测试/自证)

03:05 轮:
1. **恢复收尾缺 expectedVersion** → A 400 INVALID_INPUT,goal 卡 leased:recoverAll 的
   fail/complete 现取当前目标版本提交。
2. **A resume→重领复用相同 fencingToken** → B 周期 requestId 碰撞,旧失败回执拦截新周期:
   周期标识改为 `c<token>-<claimedAtEpochMs>`,同周期幂等、跨周期唯一。
3. **跨进程取消不可达** → `cancellations/` 标志通道 + CLI `cancel` 子命令。
4. **常驻进程无日志** → CLI 显式接 logger(stdout 重定向即得 `runtime/worker.log`)。

06:00 轮(DEF-04 + 锁安全):
14. **DEF-04 预算门未接线**:runtime.mjs 未透传 config.budget(账本/锁修复成死代码,真实 worker
    预算完全未生效)→ 已透传(顶层 config.budget 或 transport.budget),T9 worker 端到端回归
    (真实 worker 流程:首个 goal 消耗预算,第二个 goal 被 BUDGET_EXCEEDED 拒→fail 出口,合计恰 1 出站)。
15. **锁安全**:抢占仅针对已死 owner(pid 不存在)——活 PID 不因超龄被删锁(不盲抢活锁),
    等待超时=BUDGET_LOCK_TIMEOUT 失败关闭;owner 释放带随机 token 校验,不删新 owner 的锁;
    半写锁仅 mtime 超龄才抢。
16. **账本负 amount 拒绝**(BUDGET_LEDGER_CORRUPT)。
17. **估算语义声明**:预算门按 perCallEstimate 名义值记账,非真实费用硬上限(真实费率未注入)。

05:00 轮(预算门重写,反例=Codex 六实例并发全放行+目录账本放行):
10. **读-查-写无原子锁(TOCTOU)** → budget.lock(wx 独占创建)跨进程互斥,临界区内严格读账→判定→预占;
    持锁崩溃由陈旧锁抢占恢复(pid 死亡/超龄);锁超时=失败关闭不等待无限期。
11. **账本 I/O 错误被吞** → 全部不吞:目录/权限/未配置=BUDGET_LEDGER_UNREADABLE,预占写失败=BUDGET_LEDGER_IO,
    均确定未发送;actual 记录失败可见于 costSnapshot(预算按 reserve 扣减不受影响)。
12. **坏账本静默放行** → 坏行/amount 非有限数值=BUDGET_LEDGER_CORRUPT 失败关闭,不跳过。
13. **非法预算配置** → NaN/Infinity/负数/0/缺项=创建即抛错(失败关闭),不带病运行。
    测试:budget.test.mjs 8 项(真实 6 实例 Promise.all、真实子进程并发、重启、目录、坏账本、非法预算)。

04:06 轮(DEF-03,见 §0):
5. **版本门误伤授权重试** → 版本门仅约束 provide_evidence 显式重锚;retry/abort/accept 授权即重锚
   (resume-identity 测试更新)。
6. **CLI resume 不回写 A** → `settleAfterResume`(新 requestId `::complete:rN` + fencing 刷新重领 +
   failed-goal 不跨门指引)(def03 测试 + resident T3)。
7. **恢复对 unknown 抢先 fail** → 改为持牌待重试(待办上报 + goal 留 leased),
   B 本地可信重试与 A resume 双通路均可闭环(resident T3/T5)。
8. **resume 边界缺挂起检查** → 已完成/在途线程直接拒绝,堵重复授权重放图的洞
   (def03 测试负例;零写入零调用)。
9. **D-25 预算上限** → `budget` 配置段(§2),`BUDGET_EXCEEDED` 确定未发送失败关闭,
   持久账本防重启/并发绕过(budget 测试 4 项;本地 mock 可测,0 真实调用,无契约变更)。

## 8. D 反证配方建议(评审"kill/restart/unknown/取消";与 verify-resident 同构)

```
1) 正常:建 goal → 常驻 worker 消费 → A candidate_ready(result.provider=simulation)。
2) kill/restart/unknown:C 切 latency(POST /__mock__/config {defaultScenario:'latency',latencyMs:9000})
   → 建 goal → 等 A status=leased → SIGKILL worker → 重启 → 断言:goal 留 leased(持牌待重试)、
   clarification 待办在、/__mock__/requests 项目内请求数不增(零盲重发)。
3) DEF-03 重试腿:无凭据 `B_RESUME_CREDENTIAL='' node src/cli.mjs resume <taskRunId> retry_step
   --step <stepId>` → exit≠0 零调用;带 cred:<id> → exit 0 → 断言恰一次重发(总调用=1中断+1授权重发)
   → A candidate_ready;再重复授权 → exit≠0 零调用。
4) 取消:C 切 latency → 建 goal → leased 后 `node src/cli.mjs cancel <goalId>` →
   断言 goal=failed、待办在、未发送部分无出站请求。
5) A resume 腿:对 failed 目标 A resume(带 expectedVersion)→ 常驻 worker 新周期 → candidate_ready。
```

## 9. 边界(如实)

- 真实 GLM-5.2 0 调用(transport real 仅预留);生产身份源未接(identity.synthesized 仅测试/组合);
- Celery 为已验证 spike 候选,不在常驻交付内;
- A 的 goal 投影无 projectId/人工待办列表蛇形列名等 4 项接口观察在 `../B/interface-change-request.md`。

## §9 任务 03 追加（2026-09-16）：四域 + 稳定性修复的 D 复测入口

D 独立复测（任务 04 执行）新增入口：

- **四域常驻形态**：`cp config/b-config.four-domain-sample.json config/b-config.json && node src/cli.mjs worker`——四域评估为确定性工具链（`tools.mode=four-domain` + `routesPath=config/routes-four-domain.json`），任务种类 `four_domain_evaluation` → `candidate_ready`，provider=calculation，零模型调用零出站。
- **四域复跑（无需 A/B 服务）**：`cd ../C && node src/evaluation/run-four-domain-evaluation.mjs --all`（42 场景/196 断言；exit 2 = held-out 冻结清单被改）；`node src/evaluation/ab-experiment.mjs`（§8 对照）；`node test/run-all.mjs`（C 72 项）。矩阵全表：`../C/evidence/four-domain-matrix-map.md`。
- **本轮 B 修复（可反证）**：①EPERM——`node test/atomic-write-eperm-child.mjs <file> 2`（重试成功零残留）+ 矩阵「C24」（永久 EPERM→ATOMIC_WRITE_FAILED 旧内容完好）；②恢复竞态——矩阵「C22/恢复竞态」（活 pid 锁不盲抢/死锁接管/registry 并发写不损坏）；③多粒度预算——矩阵「S3 多粒度预算」「C20」「C21」（新错误码 BUDGET_CUSTOMER_EXCEEDED/BUDGET_SESSION_EXCEEDED/BUDGET_CALLS_EXCEEDED/BUDGET_CALLS_SESSION_EXCEEDED，账本条目含 customerKey/sessionKey，旧账本条目保守计入所有作用域）；④请求大小限额 REQUEST_TOO_LARGE。
- **发布清单**：`evidence/b-release-manifest.json` 已重生成（含全部四域新文件）；D 以清单核对所测字节。
