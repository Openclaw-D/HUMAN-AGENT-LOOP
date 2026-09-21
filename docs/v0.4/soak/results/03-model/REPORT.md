# V0.4 soak 03_MODEL · 长程测试报告（提前收尾版）

2026-09-21 · ZCode（单包 ownership，仅本任务写入）· 任务书 `docs/v0.4/soak/03_MODEL.md`

## 结论（如实）

- **按用户"快速收尾"指示在有效长测约 48 分钟处提前终止**，未达到任务书"至少 4 小时有效长测"目标；
  不以等待/编码时间抵扣测试时长，不冒充达标。
- **已执行部分全部硬不变量与守卫零违反**：P0 既有回归 37/37 绿；正式跑累计 ~13,700 ops、
  0 非预期错误、0 违规；终局补收对账 ok=true（详见 `RECONCILIATION.md`）。
- **产品源码（glm.mjs / assistant-receipts.mjs 白名单文件）零改动、零已证实缺陷**；全程真实外部出站为 0。
- 发现并修复的缺陷全部在**本包测试 harness 自身**（8 项，见 §5），逐项有最小复现与修复记录。

## 1. 执行时间线

| 阶段 | 内容 | 结果 |
|---|---|---|
| 预检 | 快照复制+hash 留档、writer 状态核对、既有 37 例回归 | 37/37 绿（logs-p0-regression.log） |
| harness 构建 | stub/worker/run/reconcile + 多轮冒烟（修复 harness 缺陷 1–7） | 冒烟 exit=0、0 违规 |
| 正式跑 P1 | 基线并发 1，30 分钟，四场景轮换 | **完成**：8619 ops，0 意外 0 违规 |
| 正式跑 P2a | 混合负载并发 2，约 17.5 分钟 | **按指示终止**：0 意外 0 违规 |
| P2b/P2c/P3/P4 | 并发 4/8、7 个故障恢复周期、80 分钟稳定窗 | 未执行（提前收尾） |
| 终局补收 | finalize.mjs（stub 命中流已随进程丢失，按 §4 口径补收） | ok=true，0 违反 |

- 开始 2026-09-20T22:59:19Z，终止 ~2026-09-20T23:48Z；有效长测 = P1 30 分钟 + P2a ~17.5 分钟 ≈ **48 分钟**。
- 终止方式：用户指示后 taskkill 本包 worker 子进程（PID 登记）；编排器随即暴露自身 bug（§5-8），
  未走完自动终局产物，由 finalize.mjs 补收。

## 2. 结果摘要

### P1 基线（并发 1，完整 30 分钟）
- 8619 ops（限速 5 req/s 实测 ~4.9）；成功 1758 / 重放 5531 / 未知 210 / 预期拒绝 466+；**非预期 0**
- 时延（系统侧观测，含替身模拟延迟）：成功 p50 20ms / p95 1015ms / p99 1034ms（p95+ 由 delay1000 形态主导）；
  未知（超时/断连族）p50 50ms / p95 2526ms（=客户端 2500ms 超时，符合预期）；失败 p95 29ms
- 系统额外开销（观测延迟−替身模拟延迟）：delay50 p50≈31ms、delay200 p50≈21ms、delay1000 p50≈25ms（冒烟/基线口径一致）
- 资源：worker RSS 112→128MB 平稳、heap ≤40MB、事件循环 lag ≤0.7ms、句柄 3–4；宿主无降载触发

### P2a（并发 2，部分 ~17.5 分钟）
- 5108+ ops（终止前最后采样），0 非预期 0 违规；RSS ~130MB 平稳、lag ≤0.1ms、速率 5/s 满限

### 终局总量（P1+P2a）
- 替身命中 3521（去重 requestId 3521，**重复 0**）；形态分布覆盖全部 12 种（含 429×277、5xx×312、
  截断/断连×216、超时×104、缺 usage×144）
- 账本：预占 3523 笔（每 requestId 恰 1 笔）合计 35.23 / 上限 200；actual 2343 笔（均有 usage 命中）；
  12 客户预占均 ≤ customerMax
- 回执：3523 terminal（unknown 320）+ 3523 intent 全部配对（崩溃残留 0）、损坏 0
- **未知围栏：注册表 unknown 声明 320 == unknown 回执 320，重试/重启路径零新增出站（未知自动重发=0）**

## 3. 真实模块/替身边界（不称真实模型质量）

- 被测为固定快照 `glm.mjs`、`assistant-receipts.mjs`、`assistant-model.mjs`（hash 见 input-hashes-start.json /
  source-sha256-final.txt，快照=开跑时=终局，零漂移、并行 writer 零干扰）。
- 替身验证协议语义（三分发送、回执、预算、幂等），**不构成 GLM 真实服务延迟/质量测试**；
  全部响应标记 `source.mode='mock'`/`status='simulated'`，预算金额为模拟名义值（billKnown/notional 如实标注）。

## 4. 终局对账口径与局限（如实）

- 进程终止导致替身逐 requestId 命中流（内存态）丢失；终局以 **stub-counters 终值（终止前 ≤5s 刷新）+
  完整账本/回执/注册表** 做总计闭环（容差 30 ≈ 5s×5req/s，实测偏差 -2）与逐 requestId 可验子集硬不变量扫描。
- 运行期内 worker 每分钟对账（含全量命中 join）自始至终无 RECONCILE 违规（P1 结果与 samples 可证）。
- 完整口径见 `RECONCILIATION.md` / `reconciliation.json`。

## 5. 缺陷清单（全部 harness 侧；产品文件零改动）

| # | 缺陷 | 最小复现 | 修复 |
|---|---|---|---|
| 1 | worker 装配漏传 receiptsDir/costLedgerPath → 全部调用 BUDGET_LEDGER_UNREADABLE 失败关闭（产品侧行为正确） | 冒烟首轮 307 ops 全 failed | 补齐装配参数 |
| 2 | pick() 权重表用整数（和>1）→ 分布塌缩到首元素（customer/assistant/question 全退化） | 300 次抽样全落 c00/business/问题0 | pick 按总和归一 |
| 3 | pickNew 丢失 buildObserveInput → observe 收到空 context → 同身份 requestId 漂移 | 回执 identity.context={} 两族 requestId | pickNew 经 buildObserveInput |
| 4 | 假设 glm.mjs 转发 x-soak-form 测试头，实际不转发（产品契约正确，不为其加头） | 全部替身命中 form=ok | 改为替身端按命中序号循环 harness 编程形态序列；形态↔状态断言移至对账面 join |
| 5 | 守卫按"单请求窗口替身增量"断言 → 并发窗口重叠误报；drain 竞态 | 冒烟 138 次误报 | 命中数断言全部改为对账面按 requestId 全流核对（免竞争） |
| 6 | reconcile 简写属性笔误（registryBadSample） | 冒烟控制面错误 | 改为 regBadSample |
| 7 | 429 命中语义错误（429=已到达未处理，替身有 1 命中） | 冒烟 13 条误报 | 命中数规则改为：预算阻断/不可达=0，其余=1 |
| 8 | run.mjs 收尾路径 `w is not defined`（作用域笔误），提前终止时未走完自动终局 | 终止时编排器崩溃 | 修复解构；终局由 finalize.mjs 补收 |

**产品侧（白名单 glm.mjs / assistant-receipts.mjs）：0 个已证实缺陷，0 行改动**——既有 37 例回归 + 全程
守卫/对账无违反，与本轮 R2 交付后基线（03-receipts 报告）结论一致。

## 6. 遗留与未测（如实）

- **有效长测 48 分钟 ≪ 4 小时目标**；P2b/c（并发 4/8）、P3 全部 7 个故障恢复周期（优雅重启/SIGKILL/
  替身重启/双进程账本竞争/双杀/坏行失败关闭/未知围栏持久——冒烟仅行使优雅重启+探针 1 个子集）、
  P4 连续 60 分钟稳定窗均未执行。
- 预算客户级耗尽路径（customerMax 触达后的 BUDGET_CUSTOMER_EXCEEDED）在本次窗口未自然发生
  （最高客户预占 ~6.6/8，全局 35.23/200）。
- 断点续跑（soak-state.json donePhases）已在结构上支持、冒烟验证过跳过逻辑，正式跑未行使。
- 真实 GLM 质量/延迟、页面驱动链路：不属本包范围。

## 7. 交付物与保留物

`docs/v0.4/soak/results/03-model/`：RESULTS.json（正式跑真实结果）、REPORT.md（本文）、RUN.md（运行入口）、
RECONCILIATION.md / reconciliation.json（终局对账）、input-hashes-start.json、source-sha256-final.txt、
logs-p0-regression.log（37/37）、run-logs/（控制台与回归日志）。
`Back/B/test/soak-v04-model/`：run.mjs / worker.mjs / stub.mjs / reconcile.mjs / finalize.mjs（可复现 harness）。
保留：`.local/soak-v04-model/`（state 原始证据：账本/回执/注册表/采样 + src-snapshot + node_modules junction）；
清理命令见 RUN.md。进程：worker 已终止、编排器与替身随进程退出，本包无遗留进程；未触碰任何未知 PID 与共享栈。
