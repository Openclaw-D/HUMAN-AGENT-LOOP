# ZCode R2-04 · 隔离恢复与一致性验收包 — 交付报告

2026-09-21 · writer：ZCode R2-04 · ownership：新建 `Back/Edge/test/v04-recovery/`（4 文件）＋本目录；临时资源 `.local/v04-r2-04/`。**业务源码、配置、现有测试、runner 零改动。**

## 1. 目标与结论

建立 V0.4 持久来源（thread 线程 sqlite / model_receipt 回执落盘 / kernel 业务事件）在 Edge 进程刷新/重启后的可重复验收。**结论：6/6 测试全绿，两轮可重复（EXIT=0），验证冻结快照零漂移。** 重启（优雅与硬杀两种）后：ID/原始时间/actor/状态逐字段不变、进程#1 签发的游标进程#2 可续读不漏不重、重复投递不重复出条、裁剪/缺失显式披露、跨客户与受众越权拒绝、unknown 重启后仍是 unknown、读取面零模型调用。

## 2. 交付物与文件清单

| 文件 | 说明 |
|---|---|
| `Back/Edge/test/v04-recovery/run.mjs` | **唯一可执行入口**：hash 快照比对＋残留清理＋串行跑测试＋日志落盘＋退出码透传 |
| `Back/Edge/test/v04-recovery/v04-recovery.test.mjs` | 六组重启验收测试（node:test，自足） |
| `Back/Edge/test/v04-recovery/edge-child.mjs` | 自有 Edge 子进程引导：真实 `startEdgeServer` 装配，随机端口，IPC 优雅关停协议 |
| `Back/Edge/test/v04-recovery/back-a-standin.mjs` | 替身 A（父进程持有，跨子进程重启存活）＋受控身份表 |
| 本目录 `REPORT.md` / `hashes-start.txt` / `hashes-pinned.txt` / `hashes-end.txt` | 报告与三轮 hash 快照（见 §5） |

## 3. 可执行入口与测试证据

```
node Back/Edge/test/v04-recovery/run.mjs        # 从仓库根；或 cd Back/Edge 后 node test/v04-recovery/run.mjs
```

| 轮次 | 结果 | 日志（`.local/v04-r2-04/logs/`） |
|---|---|---|
| 第 1 轮（21-16-08Z） | **6/6 PASS，EXIT=0** | `recovery-run-2026-09-20T21-16-08-625Z.log` |
| 第 2 轮（21-16-28Z） | **6/6 PASS，EXIT=0，可重复** | `recovery-run-2026-09-20T21-16-28-262Z.log` |

（调试期失败轮日志如实保留：21-00-34Z 轮 4 失败，均为本测试脚本自身缺陷——计数错误/目录未建/清理路径泄漏——已修，未改任何产品代码。）

六组测试对任务书要求的覆盖：

1. **优雅重启主链**：重启后整页响应与重启前 deepEqual（ID/occurredAt/actor/tenantId/state/refs/cursor 全等）；intent-only 回执 unknown 重启后仍 unknown；进程#1 游标（limit=2 首页）在进程#2 逐页续读到头，全量覆盖零重复、各源升序前缀、同游标重复读幂等；requestId 重放（R2-01 持久回执跨进程命中 replayed:true）与 A eventId 重放均不重复出条；cust-2 记录不串入 cust-1；全程替身 A 仅收到 GET `customers/:id` 与 `/events`（模型/上传/审批零调用，结构性＋日志双断言）。
2. **硬杀重启（模拟崩溃）**：SIGKILL（TerminateProcess，无 checkpoint 机会）后同文件重启，整页逐字段恢复（WAL＋synchronous=FULL 兜底已提交事务）。
3. **重启后缺失/裁剪明确**：保留窗口裁剪（maxPerCustomer=3）后旧游标续读 `truncated:true + retentionBase:2`，从保留窗口如实续读 seq 3–5；损坏回执跳过并计数披露；纯 `.claim` 残留不入列；旧格式（缺 phase）回执 state=unknown 不伪装 completed。
4. **重启后越权面**：客户受众强制排除内部消息与 model_receipt（`AUDIENCE_FORBIDDEN + excludedByAudience` 显式披露，显式点名 403）；跨客户/跨租户 404 存在性不泄露；**借进程#1 游标翻页中撤权 → 403**，恢复授权后同游标可读（逐请求重验跨进程有效）。
5. **旧格式库迁移重启**（R2-01 集成落盘后新增的最强"旧格式负例"）：手工构造 R2-01 之前老 schema 库＋旧无作用域回执 → 迁移后线程消息 ID/时间/actor 完好可读；旧回执重放 **409 失败关闭零重发**；迁移期新回执二次重启仍幂等重放。
6. **负例**：A 事件源断连（503）→ 单源 `incomplete[].code='EVENTS_SOURCE_DOWN'` 不拖垮整页，恢复即读；A 全断连（重启指向已关闭端口）→ 目标校验失败关闭整请求 502 `UPSTREAM_UNAVAILABLE`（不静默返回纯本地数据）；缺失回执路径 → 空集不崩溃（读取面把 ENOENT 视作空目录）；消息文件目录不存在 → 自动创建；非法/旧格式游标 10 例（垃圾、明文旧形态、v9/v0 版本、缺 c、未知来源键、非字符串值、形状错×3）全部 400 `INVALID_CURSOR` 不静默重置。

## 4. 替身边界（三源分开声明）

| 来源 | 本验收证明 | 边界 |
|---|---|---|
| 真实代码 | Edge 全链：`startEdgeServer` 路由/鉴权/CSRF、kernel-store 逐请求读 A、message-store **真实 sqlite 文件**（含 R2-01 列迁移）、messages 路由幂等协议、session、audit、customer-activity 聚合——全部经真实 HTTP | 未装配模型/上传/审批面 → 读面零模型调用是结构性的 |
| 替身 A | `back-a-standin.mjs` 只替代 Back/A 持久数据库的只读面（customer/events 端点＋凭据 ACL＋撤权/事件源故障开关）；存活于父测试进程，Edge 子进程重启时 A 不重启（与生产拓扑一致） | **不声称真实 A 持久数据库整链通过**（真实 A 链由 V0.3 backend-qa-r2 另行覆盖） |
| 合成文件 | 模型回执按 assistant-receipts 落盘形状**手工直写** fixture（terminal/intent/损坏/缺 phase/纯 claim 五种）；旧格式 sqlite 库按老 schema 手工构造 | **明确是存储读取测试，不冒充真实模型执行恢复**；真实模型调用不属本任务授权 |

## 5. 输入 hash 漂移事件与验收快照（重要）

本轮中途发生两次并行 writer 落盘，均按任务书"固定 hash 快照标注，不验收未稳定版本"处理：

1. **`message-store.mjs`＋`messages.mjs`**（R2-01 消息幂等与持久未知集成，轮始 hash `72fcb9a5`/`4b01f516` → 落盘 `742c47d0`/`7094b288`）：落盘后跑其自有单测 `t4-message-store + v04-message-idempotency + g03e-message-thread` = **24/24 全绿**（含此前 6 失败的幂等回归），证实集成完整稳定；**验收快照重钉到落盘后版本**，并新增第 5 组"旧格式库迁移重启"测试把 R2-01 迁移路径纳入恢复验收。
2. **`assistant-receipts.mjs`**（`modelConfigHash` 增加 routing 字段，`3177fb8d` → `0a4be304`）：不触碰回执文件格式与读取面，与本验收语义无关，随第二次重钉纳入快照。

三份快照：`hashes-start.txt`=轮始（含已被替换的 R2-01 前版本，留档）；`hashes-pinned.txt`=**验证冻结快照**（run.mjs 每次运行自动逐行比对，不一致即打印"待复验"警示）；`hashes-end.txt`=轮末（与 pinned 逐行相同，零漂移）。两轮验证期间 server.mjs/customer-activity.mjs/kernel-store.mjs/session.mjs 均未再漂移。

## 6. 观察到的实际行为（如实记录，非缺陷判定）

- **会话不跨重启**（session store 进程内存）：旧 sessionId 重启后 401，重新交换同凭据即可读同一批数据；activity 游标无状态（opaque base64），跨进程天然有效。前端按会话过期语义重登即可。
- **kernel 源无 Edge 侧持久化**：activity 的 kernel 源每请求直读 A，重启后由 A 复读、零丢失；Edge 内存事件缓冲（SSE 订阅面）重启即清，`replayFrom` 判 expired → 客户端 resync——该实时面不属本验收范围（activity 读面不受影响）。
- **缺失回执目录=空集不报错**：读取面把 ENOENT 视作空目录（既有代码语义）；如需"配置目录必须存在"的强校验，属产品决定，交 CTRL。
- **model_receipt 排序键时钟回拨边界**（04-activity 契约 §4 已披露）本轮未复演，边界维持披露状态。

**业务代码缺陷：本轮零新增需复现项**——全部断言对当前冻结快照通过。R2-01 已修复的旧回执跨作用域泄漏由第 5 组测试从重启维度补验（409 失败关闭零重发）。

## 7. 资源登记与清理

- 测试临时目录：每用例独立 `mkdtemp` 于 `.local/v04-r2-04/run-*`，用例结束自清理（含 Windows 文件锁重试）；run.mjs 启动时清理上轮残留。当前 `.local/v04-r2-04/` 仅余 `logs/`（14 个运行日志）与 `last-run-hashes.txt`。
- 测试子进程：全部 fork 子进程经优雅关停/硬杀＋`slay` 兜底收尾；替身 A 全部 close。轮后核查进程表：**无 edge-child 残留**，现存 node 进程均为用户共享栈（takeoff-up/vite/A@48304/Connectors/Edge@48324），未触碰。
- 未重启任何共享实例；未占用固定端口（全部随机）；未建容器；无真实模型调用；未读取凭据。

## 8. 复验步骤

1. 确认输入未漂移：`git -C C:/Users/22673/Desktop/JW status --porcelain -- Back/Edge/src/` ＋比对 `docs/v0.4/results/r2-04-recovery/hashes-pinned.txt`（或直接看 run.mjs 输出的漂移警示行）。
2. 从仓库根执行 `node Back/Edge/test/v04-recovery/run.mjs`，期望：无漂移警示、`# pass 6 / # fail 0`、退出码 0。
3. 若 hash 漂移（如 message idempotency 后续契约或 server 路由再变更）：结果对该版本**标待复验**——重跑如绿且差异属预期语义，更新 `hashes-pinned.txt` 并在本目录追加一行变更记录；如红，按失败断言定位，业务缺陷仅复现记录不代修。

## 9. 遗留与不声称

- 本验收**不声称**：生产实例恢复、真实 A 数据库整链、真实模型执行恢复、SSE 实时订阅面（`/events`）重启行为——各自由对应授权链覆盖或未在本任务范围。
- `v04-message-idempotency.test.mjs` 等他路文件本轮零改动；R2-01 集成后的完整 Edge 目录回归（run-all）属串行集成职责，本包未代跑全量（仅按需跑过 3 个直接相关既有文件=24/24 绿）。
- Front 四页/聊天消费 activity 的前端接线未验收（非本路 ownership）。
