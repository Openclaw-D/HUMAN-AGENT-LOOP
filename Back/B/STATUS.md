# V7 backend-next B STATUS｜持久执行与路由

Lane: B　Owner: V7/backend-next/B/**　更新: 2026-09-16 06:35（DEF-04+锁安全最终轮,07:00 停新增）
任务入口: V7/NIGHT_BACKEND_20260916.md §B + 06:00 定向 Goal(D/DEFECTS.md DEF-04)。只写 B/**;不操作 Codex;无 Git 操作;
真实密钥 0 读取/0 付费调用(GLM-5.2 仅预留);Celery 仍为 spike 候选不晋升。

## 当前状态:DEF-04 接线已修+锁安全加固+worker 端到端预算回归;63/63 全绿;常驻 25/25;新指纹 37cd7a9c05568eb0

**06:00 最终轮(DEF-04 + 锁安全):**
- [x] DEF-04(预算门未接线):runtime.mjs 补 budget 透传(顶层 config.budget 或 transport.budget);
      T9 worker 端到端测试:真实 worker 流程首个 goal 耗尽预算,第二个 goal 被 BUDGET_EXCEEDED 拒
      → fail 出口,合计恰 1 次出站——模块修复现在是产品行为。
- [x] 锁安全:抢占仅针对已死 owner(pid 不存在),活 PID 不因超龄被删锁(不盲抢活锁);
      等待超时=BUDGET_LOCK_TIMEOUT 失败关闭;owner 释放带随机 token 校验,不删新 owner 的锁;
      半写锁仅 mtime 超龄才抢。
- [x] 账本负 amount 拒绝(BUDGET_LEDGER_CORRUPT)。
- [x] 估算语义声明:预算门按 perCallEstimate 名义值记账,非真实费用硬上限(HANDOFF-D §2)。
- [x] DEF-03 安全恢复无回退(常驻自证 25/25 复跑);63/63 全套回归。
- [x] 新指纹 **37cd7a9c05568eb0**(46 文件);HANDOFF-D §2/§6/§7 更新,供 D 以新 hash 复测 DEF-04。

**05:00 轮(预算门 P1 重写):**
- [x] 根因:读-查-写无原子锁(6 实例并发全放行)、账本 I/O 错误被吞(目录账本放行+1 次出站)、
      坏行跳过、非法预算不校验——全部按评审修:
      budget.lock(wx 独占创建)跨进程互斥,临界区内【严格读账→判定→预占】;持锁崩溃由
      陈旧锁抢占(pid 死亡/超龄 10s)恢复;锁等待超时=失败关闭。
- [x] 失败关闭矩阵:目录/权限/未配置账本=BUDGET_LEDGER_UNREADABLE;坏行/amount 非法=
      BUDGET_LEDGER_CORRUPT;预占写失败=BUDGET_LEDGER_IO;锁超时=BUDGET_LOCK_TIMEOUT;
      超限=BUDGET_EXCEEDED——全部确定未发送,绝不吞 I/O 错误后出站。
- [x] 非法预算(NaN/Infinity/负数/0/缺项)=createModelTransport 创建即抛错。
- [x] reserve/actual 语义明确(见 HANDOFF-D §2):reserve=扣减主体(估算预占,永久,只偏高);
      actual=观测+超额补记(差额入账);求和=全部条目。
- [x] 真实并发/跨进程测试:budget.test.mjs 8 项——6 实例 Promise.all(恰 1 次出站/5 次拒绝)、
      子进程+父进程真实并发(合计出站恰 1)、重启不绕过、目录/坏账本/非法预算、reserve+actual 账本断言。
- [x] 常驻自证 25/25 复跑(DEF-03 链路无回退);62/62 全套回归。
- [x] 新指纹 a10651000cc7857d(46 文件);HANDOFF-D §2/§6/§7 更新(语义/指纹/台账 10-13)。

**04:06 轮(DEF-03 + D-25):**
- [x] DEF-03 根因:r33 时 failGoal 缺 expectedVersion 被拒致 goal 停 leased(该腿 03:30 已修);
      剩余两腿=版本门误伤授权重试(恢复期上报推进 A 版本 → retry_step 被 VERSION_CHANGED 拒,
      exit 0 零调用)+ CLI resume 不回写 A。两腿均已修:
      版本门仅约束 provide_evidence 显式重锚(retry/abort/accept 授权即重锚,完成前漂移仍拦截);
      新增 settleAfterResume(新 requestId ::complete:rN + 租约过期自动重领 + failed-goal 不跨门指引)。
- [x] 恢复对 unknown 改为持牌待重试( clarification 待办如实上报;goal 留 leased 不抢先 fail),
      B 本地可信重试与 A resume 双通路闭环(resident T3/T5)。
- [x] resume 边界前置检查:已完成/在途线程直接拒(堵重复授权重放图的洞;零写入零调用)。
- [x] 定向验证:进程内 test/def03-resume-resend.test.mjs(中断→unknown→版本漂移→可信 retry_step
      恰一次新 attempt/requestId 重发→收口 candidate_ready;负例:重复授权/重复 settle 零新增调用);
      常驻自证 verify-resident **25/25**(T3 即 D-27b 配方,真实常驻进程+真实 A+PG+C mock)。
- [x] D-25 预算上限:budget 配置段(maxTotalCost/perCallEstimate)→ BUDGET_EXCEEDED 确定未发送
      失败关闭;持久账本(cost-ledger.jsonl)防重启绕过、调用前重读全账本防并发绕过;账本不可读时
      全拦。测试 4 项(budget.test.mjs);本地 mock 可测,0 真实调用,无共享契约变更(纯 B 内部,
      已在 HANDOFF-D §2 注记)。
- [x] 固定 hash 重生成:45 文件,整体指纹 **9da0eda634e7a146**;HANDOFF-D §0/§7/§8 更新。

**本轮(03:05 评审收口)已做:**
- [x] 常驻入口明确并补齐:`node src/cli.mjs worker`(恢复扫描→消费主循环;SIGINT/SIGTERM 优雅停,
      SIGKILL 靠恢复链);integration 脚本已声明仅为开发冒烟,不替代常驻交付(HANDOFF-D §1)。
- [x] 配置样例补齐:`config/b-config.http-sample.json`(http 契约+tok-agent+C 3730+projectFilter+
      identity+worker 参数;taskTimeout<A 租约 90s 已注记)。
- [x] 跨进程取消补齐:CLI `cancel <goalId>` → `runtime/cancellations/` 标志 → worker 步边界取消
      (未发送=cancelled;在途已发送=intent 无回执按 unknown)。
- [x] 常驻可观测性:CLI 显式接 logger → stdout/`runtime/worker.log`(全部经脱敏)。
- [x] 固定 hash:`evidence/b-release-manifest.json`(sha256,43 文件,含 package-lock;整体指纹
      `f58b732b3ba04ad6`;再变更用 `node scripts/hash-manifest.mjs` 重生成)。
- [x] 常驻端到端自证 **20/20**(`scripts/verify-resident.mjs`,对真实 A 48080+真实 PG+C mock,
      被测物为常驻进程):T1 正常 candidate_ready;T2 SIGKILL→重启→unknown→fail+待办+**零盲重发**
      (C 请求数不增);T3 A 人工 resume→新周期恰 +1 次调用→candidate_ready;T4 CLI 取消→fail+待办。
- [x] 本轮修复 4 缺陷(均带验证):①恢复收尾缺 expectedVersion(A 400,goal 卡 leased);
      ②A resume→重领复用相同 fencingToken → B 周期 requestId 碰撞拦截新周期 → 周期标识改为
      `c<token>-<claimedAtMs>`;③跨进程取消通道缺失;④常驻进程无日志。
- [x] **D 最小交接文件:`HANDOFF-D.md`**(入口/配置/端口/数据路径/关闭恢复/固定 hash/反证配方/边界)。

**遗留(如实):** 未变更面沿用上轮结论(53/53 单测、13/13 集成、Celery spike 待裁决、GLM-5.2 0 调用、
生产身份未接);A 最终组合的 B 侧就绪 —— A 按 HANDOFF-D §1 启动常驻 worker 即可,不需要 A 改动。

## 下一步

1. D 按 HANDOFF-D §8 配方做 kill/restart/unknown/取消黑盒反证;缺陷按 owner 回 B 走 R1。
2. A 最终组合消费常驻 worker(§6:B 侧就绪,以 HANDOFF-D 为准)。
3. A 裁量 interface-change-request.md(OBS-1~4)。

---

## 上轮结论(02:50,未变面摘要)

**已做(实际交付,全部有 evidence/ 对应):**
- [x] 消费 A CONTRACT v1.0:`src/contract/client.mjs`(events 拉取/claim/complete/fail/回执/待办,
      tok-agent 身份头);B 本地 stub(`contract/stub.mjs`)只作测试替身,不是第二套共享 schema。
- [x] 可信路由:`router.mjs` 规则限定(首中即用/决策带 ruleId/NO_ROUTE 升级人工/配置非法失败关闭)。
- [x] LangGraph 持久化执行图 + FileCheckpointSaver(真实落盘;SIGKILL 跨进程恢复测试通过)。
- [x] 人工 interrupt/resume:D-9 身份门在包装层,凭据零进 checkpoint;verifier/authorizer 异常文本过 redact(D-10 修复)。
- [x] 三分发送语义(对齐 C MOCK_API §3);unknown 零盲重发。
- [x] 独立 worker:事件游标/软超时/租约自检/回执前置检查/有界安全重领/recoverAll。
- [x] 陈旧结果丢弃;取消步边界生效。
- [x] 真实集成 `scripts/run-a-integration.mjs` 13/13(证据 evidence/a-integration-*.json)。
- [x] Celery 隔离 spike:Linux 容器验证投递/有界重试/跨语言回调;**列待裁决**,更小替代有证据
      (spike/celery/SPIKE_RESULT.md)。
- [x] 接口观察 4 条 → `interface-change-request.md`。

**恢复方法(摘要):** `npm test`(53);`node scripts/run-a-integration.mjs`(A 不可达 exit 3);
`node scripts/verify-resident.mjs`(常驻自证 20);`node src/cli.mjs recover`;Celery 复现见
spike/celery/SPIKE_RESULT.md §5。
