# soak-v04-system 运行入口（RUN.md）

V0.4 长程测试 01_SYSTEM：Edge 消息服务（`messages.mjs` + `message-store.mjs` 快照）在并发、断连、进程崩溃、重启下的持久化一致性长测。

## 唯一运行入口

```bash
cd C:/Users/22673/Desktop/JW/Back/Edge
node --test --test-concurrency=1 test/soak-v04-system/smoke.test.mjs   # 冒烟（约12分钟，验证harness）
node test/soak-v04-system/driver.mjs --plan full --seed 20260921        # 长测主运行（约4.5小时）
```

长测主运行产物目录：`C:/Users/22673/Desktop/JW/.local/soak-v04-system/run-<UTC时间戳>/`
（`RESULTS.json`、`metrics.jsonl`、`events.jsonl`、`ledger.jsonl`、`sink-journal.jsonl`、`state.json`、各相位 `summary-*.json` 与 `phase-*-result.json`、`messages.db`、`audit-*.jsonl`）

中断后续跑（从完成相位之后继续，当前相位重跑）：

```bash
node test/soak-v04-system/driver.mjs --plan full --seed 20260921 --run-dir <同一目录> --resume
```

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--plan` | `full` | `full`=正式长测（30+30+35+35+120 分钟）；`pilot`=短验证（4+8 分钟） |
| `--seed` | `20260921` | 负载随机种子（可复现） |
| `--run-dir` | `.local/soak-v04-system/run-<ts>` | 运行产物目录（非Git） |
| `--snapshot` | `.local/soak-v04-system/snapshot/src` | 被测源码快照（固定输入，防在制热更新污染） |
| `--lease-ms` | `8000` | pending intent 租约（产品默认 15 分钟；长测调短以便恢复窗口可测） |

## 结构

- `child-server.mjs`：被测子进程——从快照导入真实 `messages.mjs`/`message-store.mjs`，按 `server.mjs` 同构装配（`threadStore=receiptStore=同一store`；SQLite 文件库 WAL）；HTTP 面为 `/messages`（POST 路由/GET 线程读）+ `/__ctl/*`（统计/回执/故障臂/旧回执种子）。故障臂按 requestId 精确触发：`crash_before`（claim 后出站前退出）/`crash_after`（出站后 finalize 前退出）/`error`（deliver 抛错）/`hang_ms`（延迟，供断连与 SIGKILL 场景）。
- `sink.mjs`：外发替身（本机 HTTP），每笔出站逐条落盘 `sink-journal.jsonl`，供与服务回执逐条对账。
- `driver.mjs`：编排——场景调度（正常发送/重放/跨作用域负例/旧回执/受众门/长历史/分页/跨进程争抢）、12 个崩溃恢复周期、令牌桶限速 ≤3op/s、并发 ≤ 档位（最高8）、每分钟采样（RSS/heap/event-loop lag/宿主内存）、每5分钟聚合、断点续跑、收尾对账与 `RESULTS.json`。
- `smoke.test.mjs`：压缩时间轴全矩阵冒烟（node:test）。

## 资源边界

- 全部端口系统分配、绑定 127.0.0.1；外发为零真实出站（本地替身）；不读凭据/真实客户数据；不动 A/B/Connectors、server、activity、模型回执。
- 故障只施加于本包登记的子进程（SIGKILL/自退出）与本包自建 SQLite 文件；不重启共享服务。
- 单请求超时 30s；内存/磁盘预算见任务书，超限自动降载并在 RESULTS.json 记录。

## 判定口径

硬不变量（任一违反即 CRITICAL）：同 requestId 出站 >1、已确认 200 持久消息丢失、sent 回执无对应出站（伪报成功）、unknown 重放出站、跨作用域回执披露。崩溃周期各记录恢复时间与前后出站计数；负载途中连接拒绝若落在崩溃窗口内计"预期"，窗口外计"非预期"。
