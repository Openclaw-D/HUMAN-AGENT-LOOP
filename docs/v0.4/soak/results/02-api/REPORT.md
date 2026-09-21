# V0.4 长程测试 02_API 包 · 交付报告（提前收束版）

2026-09-20/21 · writer：ZCode（02_API 包）· 契约：`docs/v0.4/soak/02_API.md`

## 0. 结论（先读）

- **长测判定：未通过（按契约如实报告，不缩短标准冒充完成）。** 契约要求 ≥4 小时有效长测 + ≥60 分钟稳定收尾窗；实际有效约 30 分钟（P1 完整 25 分钟 + P2 约 4.5 分钟部分），因**用户在会话内明确指示快速收束**而提前终止（P2 于 23:44Z 停止，P3–P7 未执行）。
- **已交付且有效**：可复现 harness（一条入口可续跑全契约矩阵）；**两条真实缺陷在白名单内修复并全量回归**（SOAK-01 材料清单截断披露、SOAK-02 SSE 重订游标被整窗重放忽略）；P1 基线数据（1274 请求、零越权泄漏、零非预期错误——唯一 1 例即 SOAK-02 证据本身）。
- 长测的持续性结论（泄漏/资源趋势/稳定窗）**不可据此 30 分钟宣称**，恢复执行入口见 `RUN.md`（`--plan full` 或逐相位 `--phase`）。

## 1. 时间与时长

| 项 | 值 |
|---|---|
| 总开始（P1 相位起点，UTC） | 2026-09-20T23:00:02Z |
| 总结束（P2 终止，UTC） | 2026-09-20T23:44:41Z |
| 有效长测 | P1 1514s（完整）+ P2 约 250s（部分）≈ **29 分钟** |
| 准备/修复时间（不计入有效长测） | harness 编写、矩阵回归、SOAK-01/02 定位与修复、探针取证 |
| 契约 10 小时执行硬上限 | 未触及 |

## 2. P1 基线（c=1，25 分钟，修复前源码 314c5f9f）

1274 请求：成功 1273、预期拒绝 0、非预期 1（该 1 例即 SOAK-02 的洪泛证据）。端点分项（n / p50 / p95 / p99，ms）：

| 端点 | n | p50 | p95 | p99 | 非预期 |
|---|---|---|---|---|---|
| workspace | 193 | 141 | 158 | 204 | 0 |
| activity-first | 189 | 33 | 37 | 38 | 0 |
| messages-get | 181 | 16 | 17 | 18 | 0 |
| events-page | 209 | 17 | 19 | 20 | 0 |
| sse-cycle | 76 | 21614 | 22767 | 22773 | 0 |
| activity-cust | 96 | 20 | 33 | 34 | 0 |
| healthz/versionz/audit/neg-*（400/403/404/405 负例） | 313 | 1–17 | 1–17 | 1–3 | 0 |
| churn（晚到/重复/回执终态） | 23 | 16–33 | 17–33 | — | 1（SOAK-02 关联） |

- SSE 周期延迟被 **OBS-03**（带游标空补播静默至 15s 心跳）主导，属观察项非缺陷。
- 资源（driver 日志/采样）：Edge RSS ≈ 94–104MB（预算 1GB 的 ~10%），事件循环滞后 ≤0.04ms，host-metrics 显示宿主可用内存多次 <2GB，护栏按契约自动降载（令牌桶 50%），未动其他进程。
- 不变量：跨客户/租户 404、客户受众排除、非法游标 400、GET 零副作用（替身 A 只收白名单 GET）——全程零违例。

## 3. 缺陷与修复（详见 [DEFECTS.md](DEFECTS.md)）

| ID | 位置 | 一句话 | 修复 hash |
|---|---|---|---|
| SOAK-01 | kernel-store.mjs | workspace 材料清单超单页不披露截断（准入输入静默丢失 900/1000 条且无提示） | 3d8b6131 → 314c5f9f |
| SOAK-02 | kernel-store.mjs | SSE 带游标重订：同键桶被旧定时器错删 + 空桶首拉无视游标整窗重放（P1 出现 3 次，探针秒级复现） | 314c5f9f → 32d4771f |
| OBS-01/03/04 | server.mjs（只读未改） | messages 路由丢 truncated 披露；SSE 空补播静默至 15s 心跳；workspace 创建的桶无定时器不回收（有界泄漏） | 未改动，仅登记 |

每次修复均通过目标回归 + 相关面全量回归（SOAK-01：57/57；SOAK-02：95/95 含 matrix 两轮、s1-sse、v04-activity、takeoff/workbench/e1 面）+ 探针复验（SOAK-02 修复前秒级违规 → 修复后 4 分钟零违规）。

## 4. 替身边界（如实声明）

- **替身**：`Back/A 持久数据库 + PG`（`test/soak-v04-api/standin-a.mjs`，内存 HTTP 上游：A 只读端点形状、凭据 ACL、撤权/延迟/错误/停机注入；事件追加按 eventId 幂等去重以符合真实 A 主键语义）。会话核实经真实 `createLiveCredentialVerifier`。回执文件按 assistant-receipts 落盘形状直写（真实模型出站=0）。
- **真实**：Edge 全链真实代码运行于隔离源码快照副本（hash 绑定 RESULTS.json）：kernel-store、customer-activity、server 只读路由/鉴权、session、message-store sqlite(WAL)、回执扫描、audit、proxy/readProxy，真实本地 HTTP。
- **真实 A + 隔离 PG 整链**：未跑（10k 事件历史无法经真实业务链按配额构造）——不宣称真实 A 整链长测通过。

## 5. 已测 / 未测清单

已测（矩阵 + 长测 P1/P2 部分）：10/1000/10000 首末续页与全量走读（count·连续·零重复）、activity 复合游标走读、晚到事件、重复事件去重、同 ID 回执终态、线程裁剪 truncated/retentionBase、内核缓冲裁剪→EDGE_RESYNC_REQUIRED、SSE 断开重连/Last-Event-ID、订阅中撤权 auth 帧、翻页撤权 403、会话过期 401、跨客户 404、客户受众 403/排除、非法游标 400、GET 零副作用、1000 材料元数据。

**未测（原 P3–P7 计划，因提前收束未执行）**：并发 4/8 档持续负载、慢客户端背压（resync）实测、A 宕机/延迟/5xx 故障恢复窗口、Edge 优雅重启+硬杀持久化验证、收尾 60 分钟稳定窗、p95 恶化 25% / RSS 单调增长等调查信号的长时观测。

## 6. 恢复与清理

- **恢复执行**：`node Back/Edge/test/soak-v04-api/driver.mjs --plan full --run-dir .local/soak-v04-api/run`（或 `--phase P3` 逐相位续跑；修复后源码用 `--fresh-copy`）。
- **清理状态**：本包子进程（driver / edge-child / stand-in A）已全部停止并核实零残留；无共享服务/端口被触碰；`.local/soak-v04-api/`（运行副本、SQLite 线程库、回执目录、日志，Git 排除区）保留作证据，RESULTS.json 已登记字节数。
- **保留物**：`docs/v0.4/soak/results/02-api/`（RUN.md、RESULTS.json、DEFECTS.md、本报告）、`Back/Edge/test/soak-v04-api/`（standin-a / edge-child / driver / matrix.test / finalize / probe-sse-replay 取证工具）。

## 7. 源码 hash（轮始→轮末）

- `kernel-store.mjs`（本包白名单）：3d8b6131（包启动前）→ 314c5f9f（SOAK-01）→ **32d4771f（SOAK-02，最终）**
- `customer-activity.mjs`（白名单）：de36c7ec 全程零漂移
- `server.mjs`/`message-store.mjs` 等（他路在制，本包只读）：轮内零改动；soak 结果绑定 `.local/soak-v04-api/run/copy` 快照 hash（RESULTS.json.copyHashes）
