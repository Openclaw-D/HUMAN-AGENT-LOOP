# V0.4 soak 03_MODEL · 运行入口与复现方法

任务书：`docs/v0.4/soak/03_MODEL.md`（模型调用链、回执与预算效率长程测试）

## 一条运行入口

工作区根目录执行：

```bash
node Back/B/test/soak-v04-model/run.mjs            # 正式长测（约 4.2 小时，支持断点续跑）
node Back/B/test/soak-v04-model/run.mjs --quick    # 约 2.5 分钟冒烟自检
```

- 断点续跑：重跑同一命令即可，已完成阶段（`state/soak-state.json` 的 `donePhases`）自动跳过；
  替身端口持久化在 state 中，重启后回执身份（configHash 含 baseUrl）保持有效。
- 正式跑推荐 `node Back/B/test/soak-v04-model/run.mjs > .local/soak-v04-model/results-raw/run-console.log 2>&1` 后台执行。

## 前置条件（首次准备，已在本轮完成）

```bash
# 1) 固定输入快照（结果绑定快照 hash，免疫在制源码热更新）
mkdir -p .local/soak-v04-model
cp -r Back/B/src   .local/soak-v04-model/src-snapshot/Back/B/src
cp -r Back/Edge/src .local/soak-v04-model/src-snapshot/Back/Edge/src
# 2) 依赖复用已安装只读目录（快照在 .local 下解析不到 node_modules）
cmd /c "mklink /J C:\Users\22673\Desktop\JW\.local\soak-v04-model\node_modules C:\Users\22673\Desktop\JW\Back\B\node_modules"
```

run.mjs 启动时会校验并留档快照与在制源码的 SHA256（`.local/soak-v04-model/results-raw/input-hashes.json`）；
快照被改动时请按上式重建。

## 阶段计划（正式跑）

| 阶段 | 内容 | 时长 |
|---|---|---|
| P1-baseline-c1 | 低载基线，并发 1，四场景轮换（normal/negative/replay/history） | 30 min |
| P2a/b/c-mixed-c2/c4/c8 | 混合负载，并发 2→4→8 渐增，每档内 7.5min×4 场景轮换 | 3×30 min |
| P3-fault-recovery | 7 个恢复周期：CY1 优雅重启 / CY2 SIGKILL+崩溃探针 / CY3 替身同端口重启 / CY4 双进程共享账本竞争 / CY5 双进程硬杀恢复 / CY6 隔离坏行失败关闭探针 / CY7 未知围栏持久探针 | ~40 min |
| P4-closeout-c4 | 收尾稳定窗（要求连续 60min 无新非预期错误） | 80 min |

限幅：令牌桶平均 ≤5 req/s、突发 ≤8；并发 ≤8；单请求超时 2.5s（超时形态替身延迟 4s，显式例外）；
替身 127.0.0.1 系统分配端口；预算账本/回执/注册表全部在 `.local/soak-v04-model/state/` 隔离；
宿主每分钟采样内存/磁盘/CPU，越限写 `state/shed.json` 降载。

## 判定口径（硬不变量，任一违反即 exit 3 并中止）

- H1 预占先于出站：每个替身命中 requestId 必有 reserve；
- H2 同一幂等命令重复副作用=0：每 requestId 至多 1 次 reserve、至多 1 次替身命中；
- H3 伪报语义：terminal simulated/succeeded ↔ 命中恰 1；预算阻断/TRANSPORT_UNREACHABLE ↔ 命中 0
  （429 属已到达未处理=1）；确定失败 ↔ 命中 1；terminal unknown ↔ 命中恰 1（未知自动重发=0）；
- H4 预算：每客户 reserve 合计 ≤ customerMax(8)，全局 ≤ maxTotalCost(200)；
- H5 回执/账本完好：全部可解析；仅 intent 残留只允许出现在崩溃窗口并如实列出。

逐请求守卫（worker 进程内）：重放一致性（同身份同 requestId 同状态同错误码）、unknown sent=null、
预算阻断 sent=false、source.mode='mock'、合并路径语义。

## 产物位置

- 运行状态/原始数据：`.local/soak-v04-model/state/`（samples/log5min/registry/账本/回执/host-samples）
- 汇总：`docs/v0.4/soak/results/03-model/RESULTS.json`、`REPORT.md`、`RECONCILIATION.md`/`reconciliation.json`
- 全量命中流（对账断言源）：`.local/soak-v04-model/all-hits.json`

## 单独重跑终局对账

```bash
node Back/B/test/soak-v04-model/reconcile.mjs   # 读取既有 all-hits.json 与账本，exit 0=硬不变量全成立
```

## 清理（测试结束后）

```bash
rm -rf .local/soak-v04-model/state .local/soak-v04-model/all-hits.json .local/soak-v04-model/host-samples.jsonl
# 保留 src-snapshot 与 node_modules junction 供复现；如需彻底清理：
# rm .local/soak-v04-model && rmdir "$(cygpath -w C:\Users\22673\Desktop\JW\.local\soak-v04-model 2>/dev/null)"
```

替身/worker 全部为本包子进程，随 run.mjs 退出即终止；不停止任何未知 PID，不触碰共享栈与真实账本。
真实外部模型/API 出站为 0（全程本地替身，响应标记 `source.mode='mock'`/`status='simulated'`）。
