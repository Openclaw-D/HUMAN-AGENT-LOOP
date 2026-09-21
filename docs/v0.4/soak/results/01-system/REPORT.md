# V0.4 长程测试 01_SYSTEM 报告（提前收尾版）

任务书：`docs/v0.4/soak/01_SYSTEM.md`。执行者：ZCode（独立任务，无 subagent/Codex/跨对话消息）。
结束方式：**用户在长测进行约 66 分钟时指示"快速收尾"，驱动被主动停止**；本报告如实按已完成窗口交付，未达任务书 4 小时有效长测目标（见 §4）。

## 1. 结论摘要

- **发现并修复 1 个真实产品缺陷（F1）**：`message-store.mjs` 未设置 SQLite busy_timeout，两进程共享同库并发写时 `BEGIN IMMEDIATE` 立即抛 `database is locked` → 服务 500。修复前复现 **160 笔并发写 77 例锁错误**；修复后 **0 例**，且跨进程幂等（恰一胜者/IN_FLIGHT/unknown 不重发）全部保持。修复为白名单内一行 `PRAGMA busy_timeout = 5000`（含约束注释），既有回归 54/54 + 16/16 两轮全绿。
- 已完成窗口内**零非预期错误**（baseline 30 分钟 + t1 30 分钟共 11,105 次操作），4 个硬不变量全部成立：同 requestId 出站 ≤1（0 例外）、已确认消息 60/60 抽验恰一次出站、3 个崩溃/异常周期全部收敛为持久 unknown 且零二次发送、跨作用域/旧回执/受众门 662 次负例全部预期拒绝且不披露。
- 资源无泄漏信号：子进程 RSS 78→73MB（63 分钟）、event-loop lag ≤15ms、限速稳定 ~3 op/s。

## 2. 运行身份与边界

| 项 | 值 |
|---|---|
| 运行目录 | `.local/soak-v04-system/run-full-01/`（非Git，含 RESULTS-final.json、metrics.jsonl、events.jsonl、sink-journal.jsonl、messages.db、phase-*-result.json） |
| 开始/停止 | 2026-09-20T22:46:59Z → 2026-09-20T23:50:00Z（wall 63 分钟） |
| 有效完成窗口 | **60 分钟**（baseline 30 + t1 30）+ t2 部分 3 分钟（未计完成窗口） |
| 被测版本 | 固定快照 `.local/soak-v04-system/snapshot/src/`：`messages.mjs` `7094b288…`、`message-store.mjs`（F1 修复后）`925de0a850…`；快照在 F1 修复后由共享源重建，长测全程无热更新 |
| 装配 | 与 `server.mjs` 同构：`threadStore=receiptStore=同一 createMessageStore 实例`（SQLite WAL、maxPerCustomer=500、maxReceipts=4096）、`pendingLeaseMs=8000`（长测调短以便恢复窗口可测）、validateTarget 镜像 live 语义（`x-` 前缀不可读） |
| 替身边界 | 外发为本地 HTTP 计数替身（`sink.mjs`，逐笔落盘）；**零真实模型/外部出站**；不读凭据、不触 A/B/Connectors/server/activity/模型回执；全部端口系统分配绑定 127.0.0.1 |
| 资源守卫 | 宿主空闲内存多次 <2GB，驱动按预案触发 41 次"降载5分钟"（仍属有效测试时间）；测试数据+日志约 25MB；无共享服务启停 |

## 3. 场景计数与性能（完成窗口）

**baseline（30 min，并发上限1）**：4861 发送（p50=18ms p95=19 p99=21）+ 547 重放（p95=1ms），共 5408，非预期 0。

**t1（30 min，并发上限2，sink延迟100ms）**：3995 发送（p50=51 p95=116 p99=128）+ 812 重放 + 440 跨作用域冲突 + 106 目标拒绝 + 95 载荷拒绝 + 15 旧回执失败关闭 + 139 旧回执被有界裁剪后重发（设计内语义，见 §5），共 5597+139，非预期 0。

**崩溃/恢复周期（长测内 3 个，全过，恢复时间 10–11 秒，由 8 秒租约主导）**：

| 类型 | 崩溃后出站 | 租约内 | 租约后 | 最终出站 |
|---|---|---|---|---|
| crash_before（claim后出站前退出） | 0 | 409 IN_FLIGHT | 200 replayed unknown | **0** |
| error（deliver抛错） | 0 | —（当场502 DELIVERY_UNKNOWN） | 200 replayed unknown | **0** |
| crash_after（出站后finalize前退出） | 1 | 409 IN_FLIGHT | 200 replayed unknown | **1**（不重发） |

另在冒烟/复现阶段验证过 SIGKILL 硬杀、terminal 前断连、跨进程 IN_FLIGHT 三种周期（见 §5 与 `smoke-34560/` 现场），语义全部正确。

**数据库终态**：messages 6899 条/26 客户（soak-c1 触发保留裁剪 base=347，读取面 truncated+retentionBase 披露）；回执 4096（有界窗口满额运转），**unknown 恰 3 条=3 个周期 ID（跨重启/裁剪不遗忘）**，pending 0；20 条 legacy 种子按有界窗口被逐出（legacy_evicted 重发均为新发送+重新播种，无旧回执披露）。

## 4. 与任务书目标的差距（如实）

| 任务书要求 | 达成情况 |
|---|---|
| 有效长测 ≥4 小时 | **未达成**：60 分钟完成窗口。原因：用户于长测 66 分钟处指示快速收尾；此前预检/搭建/F1 修复/冒烟合计约 1.6 小时。未用等待/安装时间抵扣测试时长 |
| ≥8 个崩溃/恢复周期分散长测 | 长测内完成 **3** 个（t1 全部计划周期）；SIGKILL/断连/跨进程周期在冒烟阶段各验证 1 次通过，未能在长测档位中重复 |
| 混合负载 1→2→4→8 每档≥20分钟 | 仅完成 1→2 档；t2(4)/t3(8)/stable(120min) 窗口未执行 |
| 收尾 60 分钟无新错误稳定窗口 | 未执行（停止时 t1+ 阶段全程零非预期，但不构成独立稳定窗口） |
| sink 出站与服务回执逐条对账 | 达成（全量查重 + 双向抽验 40/60 + 终态 unknown/pending 核验） |
| 数据库锁与忙等待须有超时 | **发现缺口并修复（F1）** |

## 5. 缺陷清单与精确改动

### F1（已修复）：跨进程同库并发写无忙等超时 → 500 "database is locked"

- **现象**：两个 Edge 进程共享同一 `--messages-file` 时，任一方的 `claimReceipt`/`appendOne`/`trimReceipts`/`finalizeReceipt` 写事务与他方碰撞即抛 SQLITE_BUSY。复现 40 回合×4 并发写 = **77/160 例**（`test/soak-v04-system/f1-busy-repro.test.mjs`，修复前运行 EXIT=1 留证 `/tmp/f1-prefix.log` 数据同报告）。
- **影响**：用户侧发送失败（500）；跨进程水平扩缩容或双开 Edge 即触发。违反任务书"数据库锁与忙等待要有超时"。
- **改动**（`Back/Edge/src/message-store.mjs`，白名单内，紧跟 `PRAGMA journal_mode` 一行）：
  ```js
  // 跨进程写锁忙等上限：多进程共享同库文件时 BEGIN IMMEDIATE 须等待他人短写事务而非立即
  // SQLITE_BUSY 抛错（soak F1：无此项时 160 笔并发写 77 例 "database is locked"→500）。
  // 超时后仍如实抛错，不做全局串行化、不吞异常。
  db.exec('PRAGMA busy_timeout = 5000;');
  ```
- **修复后**：同复现 0 例锁错误 EXIT=0；同 ID 对撞恒一次出站；既有回归 `v04-message-idempotency`+`v04-message-persistence`+`t4-message-store`+`g03e`+`v04-activity-http`+`s3-proxy` **54/54**、`s3-harness`+`s3-csrf`+`takeoff-surface` **16/16**，两轮 exit 0。
- **hash**：修复前 `742c47d0a17fb2d4…`（=R2-01 交付态）→ 修复后 `925de0a850d1049…`；`messages.mjs` 零改动 `7094b288…`。

### 观察项（非缺陷）

- **回执有界窗口（maxReceipts=4096）**：持续发送下最旧 sent/legacy 回执被裁剪；同 ID 在被裁后重放会成为新发送（legacy_evicted=139 例）。这是 R2-01 冻结的设计语义（pending/unknown 永不裁剪，实测 3 条 unknown 全保留）；但业务上"幂等记忆约最近 4096 笔"，高吞吐下旧 ID 重放不受保护——若需更长幂等记忆应另立任务调参/换键，不在本包扩权。
- harness 冒烟曾出现的 4 个"非预期"为探针自身缺陷（重放载荷不一致/竞态判据过严/相位未传），已修正并复验，非产品问题。

## 6. 交付物与清理登记

- **本报告目录** `docs/v0.4/soak/results/01-system/`：`RUN.md`（唯一运行入口）、`REPORT.md`（本文）、`RESULTS.json`（= run-full-01/RESULTS-final.json 副本）、`DEFECTS.md` 缺陷清单。
- **测试包**（Git 内，独占）：`Back/Edge/test/soak-v04-system/`——`child-server.mjs`、`sink.mjs`、`driver.mjs`、`smoke.test.mjs`、`f1-busy-repro.test.mjs`（长期回归）。
- **运行现场（保留）**：`.local/soak-v04-system/run-full-01/`（RESULTS-final.json、events/metrics/sink-journal、messages.db）、`smoke-34560/`（修复后冒烟现场）；`snapshot/src/`（被测快照）。复跑入口见 RUN.md。
- **已清理**：全部本包 node 进程（驱动+子进程，复查 0 残留、端口 62634/62635 已释放）、`%TEMP%` 冒烟临时目录、早期失败冒烟现场。
- **遗留/未测**：t2/t3 档位与 8 并发、stable 稳定窗口、长测内 SIGKILL/断连/跨进程周期重复、宿主低内存（最低 0.3GB）下的长期行为——如需补足 4 小时目标可用 RUN.md 入口 `--resume` 续跑（当前相位重跑）。

## 7. 复验/恢复方法

1. 既有回归：`cd Back/Edge && node --test --test-concurrency=1 test/soak-v04-system/f1-busy-repro.test.mjs test/v04-message-idempotency.test.mjs test/v04-message-persistence.test.mjs test/t4-message-store.test.mjs`（全绿为预期）。
2. 长测续跑：`node test/soak-v04-system/driver.mjs --plan full --seed 20260921 --run-dir C:/Users/22673/Desktop/JW/.local/soak-v04-system/run-full-01 --resume`。
3. F1 回退检测：移除 `busy_timeout` 后运行 f1-busy-repro 即失败（该测试为长期回归）。
