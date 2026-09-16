# ROWS_FULLSTACK 验证结果（Verification worker）

执行时间：2026-09-11 23:40 – 2026-09-12 01:19（本地）。执行者：Verification worker（原生 sub-agent）。
契约依据：`IMPLEMENTATION.md`（FROZEN §2/§3/§6）、`lib/v5-preview/shared-types.ts`、任务书"验证与交付 Gate"§6.1。

## 一、结论（最终确认轮 run#7 / recovery run#3，dev:node 运行时）—— **14/14 全部通过**

| 测试文件 | 用例数 | 通过 | 失败 | 说明 |
| --- | --- | --- | --- | --- |
| `test/v5-preview-http.test.mjs`（端口 3399） | 12 | **12** | **0** | 含用例 6"缺 actorRole"→ 400 INVALID_INPUT（DEFECT-3 修复验证通过；actorRole=credit 仍 403） |
| `test/v5-preview-recovery.test.mjs`（端口 3398） | 2 | **2** | **0** | 重启恢复逐字段一致 ✓；损坏存储 500 STORE_CORRUPT + POST 5xx + 文件逐字节未改写（不静默重置）✓ |

**已验证通过的能力（dev:node 运行时，隔离数据目录 + 真实 HTTP）**：GET 初态 approval 种子全形状
（version 7、四域顺序/segments/灯/summary、todo-device-list、消息开场、no-store）；验收闭环
（notes → version 8、todo 待复核、信审待复核仍黄、messages +2、政策域不动、第二视口 GET 一致）；
幂等重放（replayed=true，不重复追加/不推进 version）；同 requestId 换载荷 409 REQUEST_MISMATCH；
过期版本 409 VERSION_CONFLICT+serverVersion；空 text/超 2000/缺 requestId/缺 actorRole →
400 INVALID_INPUT（version 不变）；actorRole=credit → 403 ROLE_FORBIDDEN；messages 追加 version+1；
seed settled（todo=null、四域全绿、NO_OPEN_TODO、messages 仍可写）；seed post-rental（资产黄观察中、
todo-inspection）；BAD_SCENARIO 400 且状态不破坏；畸形 JSON 400；服务重启恢复一致；
存储损坏失败关闭且不静默重置。

**已验证通过的能力（dev:node 运行时，隔离数据目录 + 真实 HTTP）**：GET 初态 approval 种子全形状
（version 7、四域顺序/segments/灯/summary、todo-device-list、消息开场、no-store）；验收闭环
（notes → version 8、todo 待复核、信审待复核仍黄、messages +2、政策域不动、第二视口 GET 一致）；
幂等重放（replayed=true，不重复追加/不推进 version）；同 requestId 换载荷 409 REQUEST_MISMATCH；
过期版本 409 VERSION_CONFLICT+serverVersion；空 text/超 2000/缺 requestId → 400 INVALID_INPUT
（version 不变）；actorRole=credit → 403 ROLE_FORBIDDEN；messages 追加 version+1；seed settled
（todo=null、四域全绿、NO_OPEN_TODO、messages 仍可写）；seed post-rental（资产黄观察中、
todo-inspection）；BAD_SCENARIO 400 且状态不破坏；畸形 JSON 400；服务重启恢复一致；
存储损坏失败关闭且不静默重置。

**单一根因（阻塞全部 14 个用例）**：所有 v5-preview 路由在真实 dev server（vite + @cloudflare/vite-plugin，
rsc/ssr 环境跑在 workerd）中执行时，`lib/v5-preview/store.ts` 依赖的 `node:fs` 写操作不可用：

- GET `http://localhost:3399/api/v5-preview/project` → `500 {"ok":false,"error":"STORE_UNAVAILABLE","message":"v5-preview 存储 写入 失败：Error: operation not permitted"}`
- POST `notes`（合法载荷）→ 同上 500 STORE_UNAVAILABLE
- 任何一次服务运行后，`V5_PREVIEW_DATA_DIR` 指向的数据目录**从未被创建**（`mkdirSync` 即失败）；
  `rows-store.json` 从未存在。
- Backend worker 运行 #3 前后曾在 project 路由留有调试探针（响应体为
  `{"probe":{"envKeys":0,...,"amkdir":"ERR:File path must be a file: URL"...}}`），显示路由运行时内
  `process.env` 枚举为空（`V5_PREVIEW_DATA_DIR` 不可见）且 mkdir 失败；该探针已于 00:17:52 移除，
  此后 GET 改为诚实失败关闭（500）。

**根因（DEFECT-1，已修复）**：原 vinext/workerd 运行时（vite + @cloudflare/vite-plugin dev）中
`node:fs` 写操作不可用（"operation not permitted"，`process.env` 枚举为空），fs 单文件存储无法初始化。
主控裁决统一改用 `npm.cmd run dev:node`（真 Node next dev）并修订 IMPLEMENTATION.md §1 后，
存储在真实 dev server 中正常工作（run#6/10 全量通过证实）。

### DEFECT-3（已修复并验证 ✅）：缺 actorRole 曾返回 403 而非 400

- 历史：run#6（01:01）实测缺 actorRole → 403 ROLE_FORBIDDEN，与冻结错误码表
  （INVALID_INPUT 400 = "缺字段"）及验证任务书 §6 用例 6 期望（400）偏差。
- 修复：BE 按主控裁决 (a) 调整校验顺序——结构校验（含 actorRole 字段存在性）在前 →
  缺字段 400 INVALID_INPUT；值 ≠ business → 403 ROLE_FORBIDDEN。
- 验证：run#7（01:17）用例 6"缺 actorRole → 400"通过，actorRole=credit → 403 保持，12/12 全绿。
- 复现载荷留档：POST `/api/v5-preview/notes`
  `{"requestId":"...","expectedVersion":<当前>,"todoId":"todo-device-list","text":"<合法>"}`（无 actorRole 键）。

## 二、执行历史（全部记录见 `raw.log`，含完整 TAP 输出）

| # | 时间 | 对象 | 结果 | 关键事实 |
| --- | --- | --- | --- | --- |
| 1 | 00:08:44 | http 测试 run#1 | 0/12（+after hook 失败，共 13 not ok） | vinext dev 项目级单实例锁拒绝第二实例：`Another vinext dev server is already running. PID 5092, port 3390`。该服务非本测试进程，未触碰。测试 harnness 改用官方开关 `VINEXT_NO_DEV_LOCK=1` |
| 2 | 00:12:05 | http 测试 run#2 | 0/12 | 服务正常启动监听 3399，但就绪轮询全部 `fetch failed`：vite `host=localhost` 在本机只绑 `::1`（既有 3390 实例 netstat 仅 `[::1] LISTENING` 可证），轮询目标误用 127.0.0.1。修正为冻结规定的 `http://localhost:<port>`，端口探测改双栈 |
| 3 | 00:16:47 | http 测试 run#3 | 1/12 | 首次真正触达业务路由。GET 返回调试探针体（customerName undefined）；全部写操作 500 STORE_UNAVAILABLE "operation not permitted"；唯一通过：畸形 JSON → 400 INVALID_INPUT（说明请求解析与 ApiError 形状正确） |
| 4 | 00:19:44 | http 测试 run#4（允许的一次重试；期间 Backend 移除探针、更新 service.ts@00:20:47） | 0/12 | GET 稳定 500（150s 内每次轮询均 500），就绪失败 → 全部用例挂起于 before()。server log 侧证：`GET /api/v5-preview/project 500 in 8-13ms` 连续 150+ 次 |
| 5 | 00:23 左右 | 一次性探针（非测试文件；自起实例后 taskkill 清理） | — | 取得决定性错误体（见 §一）；POST notes 合法载荷同样 500 STORE_UNAVAILABLE |
| 6 | 00:24:47 | recovery 测试 run#1 | 0/2 | 用例1：首启就绪失败（GET 恒 500）；用例2：`rows-store.json` 不存在（ENOENT）——存储从未初始化，损坏注入前置不成立。已把该前置改为显式断言以便后续复跑给出可读信息 |
| 7 | 00:36:11 | http 测试 run#5（按主控裁决改 `npm.cmd run dev:node`，真 Node next dev） | 0/12 | next dev 同样有项目级单实例锁：`⨯ Another next dev server is already running. - Local: http://localhost:3311 - PID: 11208`。该实例非本测试进程（node.exe，监听 0.0.0.0:3311，有活跃 ESTABLISHED 连接），未触碰，测试拒绝运行。**主控前提"next dev 无该锁"在 Next 16.2.6（Turbopack dev）上不成立** |
| 8 | 00:40–00:51 | 阻塞期取证与等待 | — | (a) 只读探针 GET `http://localhost:3311/api/v5-preview/project` → **200 正常 ProjectOverview**（approval，version 8，updatedAt 16:39:03）——**DEFECT-1 的 dev:node 修复已生效**，剩余阻塞仅锁竞争；(b) 锁持有者中途已换代（11208 → 21152，同一 3311 端口，6+ 活跃连接）：有人正在活跃使用 dev:node 实例；(c) 被动轮询 8 分钟（每 20s 查 3311 监听）未释放。**复跑被共享锁阻塞，停等主控协调** |
| 9 | 01:01:10 | http 测试 run#6（主控裁决选项 1：3311 演示实例已由主控停止、锁释放、窗口打开） | **11/12** | dev:node 自起实例 2s 就绪；唯一失败=用例 6"缺 actorRole"→ 403（期望 400，见 DEFECT-3）；其余 11 用例含验收闭环/幂等/冲突/越权/三情景全过。生命周期：自起 PID 27524@3399，ready 200，毕即 taskkill，端口释放 |
| 10 | 01:02:03 | recovery 测试 run#2（同窗口） | **2/2** | 三次自起实例（首启 PID 7020、重启 PID 1328、损坏重启 PID 8596@3398）均 ready→killed→端口释放；重启恢复逐字段一致；损坏存储 GET 500 STORE_CORRUPT、POST 5xx、`rows-store.json` 保持 `{broken` 逐字节未改写 |
| 11 | 01:17:29 | http 测试 run#7（最终确认轮：BE 按裁决 (a) 修复 DEFECT-3——结构校验前移，缺 actorRole → 400） | **12/12** | 用例 6"缺 actorRole"现返回 400 INVALID_INPUT（修复验证通过）；actorRole=credit 仍 403；其余 11 用例回归全绿。自起 PID 26884@3399，毕即 taskkill，端口释放 |
| 12 | 01:18:04 | recovery 测试 run#3（最终确认轮） | **2/2** | 首启 PID 28088 / 重启 PID 4628 / 损坏重启 PID 15904@3398，均 ready→killed→端口释放；结果与 run#2 一致 |

## 〇、最终窗口执行的裁决链

主控裁决 DEFECT-1 → 统一改 `npm.cmd run dev:node`（真 Node next dev）；发现 next dev 同有项目级单实例锁
（`.next/dev/lock`）→ 主控裁决选项 1：停止 3311 演示实例释放锁 → 窗口内复跑成功（本节 run#9/10）。

## 三、缺陷复现清单（交主控分派；Verification worker 不修实现）

### DEFECT-1（阻塞级）：workerd 运行时下 fs 存储不可写 → 全路由 500 STORE_UNAVAILABLE

- 复现：`cd jianwei-v3/site`，以
  `V5_PREVIEW_DATA_DIR=<site>/.v5-preview-data-http-test`、`VINEXT_NO_DEV_LOCK=1` 启动
  `npm.cmd run dev -- --port 3399`，然后：
  - `GET http://localhost:3399/api/v5-preview/project`
  - `POST http://localhost:3399/api/v5-preview/notes`，
    body `{"requestId":"probe-1","expectedVersion":7,"todoId":"todo-device-list","text":"probe（合成）。","actorRole":"business"}`
- 期望（IMPLEMENTATION §2）：GET 200 ProjectOverview（approval 种子 version 7）；notes 200 WriteResponse。
- 实际：两者均 `500 {"ok":false,"error":"STORE_UNAVAILABLE","message":"v5-preview 存储 写入 失败：Error: operation not permitted"}`；
  数据目录与 `rows-store.json` 始终未被创建。
- 波及：验收闭环、幂等重放、版本冲突、越权、seed 三情景、重启恢复、存储损坏检测——全部无法验证。
- 附带问题（同一根因的表现）：`process.env` 在路由运行时内枚举为空，`V5_PREVIEW_DATA_DIR` 即使读到
  也不会有值（run#3 探针体 `envKeys:0`）；修复持久化通道时需一并解决配置注入。

### DEFECT-2（已被修复，记录备查）：project 路由曾返回调试探针体而非 ProjectOverview

- run#3 期间 `GET /project` 200 但 body 为 `{"probe":{...}}`，`customerName` 等字段 undefined。
- Backend worker 于 00:17:52 移除（`app/api/v5-preview/project/route.ts` 当前为干净转发）。run#4 起未复现。

### 未验证项

无。冻结 §6 要求的全部必测项均已在最终窗口（run#6/10）以真实 HTTP 验证，除 DEFECT-3 一项偏差外全部通过。

### 早期验证为正确的行为（run#3，探针期服务；最终窗口再次通过）

- 畸形 JSON body（`{broken`）POST notes → 400 且 `{"ok":false,"error":"INVALID_INPUT",...}`（ApiError 形状正确，不 5xx）。

## 四、测试基础设施发现（影响所有需要自起 dev 实例的 worker/DEMO，供主控记录）

1. **vinext dev 项目级单实例锁**：`<site>/.vinext/dev/lock.json` + PID 探活；项目内已有 dev 服务运行时
   （本轮为 PID 5092 @ 3390，非本测试所有，未触碰）第二实例直接退出 code 1。并行隔离实例必须
   `VINEXT_NO_DEV_LOCK=1`（vinext 官方开关，`node_modules/vinext/dist/cli.js` L201）。
2. **vite localhost 只绑 `::1`**：本机 dev server 监听 IPv6 loopback；`http://127.0.0.1:<port>` 连不上，
   必须用 `http://localhost:<port>`。
3. **Windows Node≥22 spawn `npm.cmd` EINVAL**：须回退 `ComSpec /d /s /c "..."` + `windowsVerbatimArguments`
   （v4life-gate.mjs 同款）。两个测试文件均已内置。
4. 进程纪律：所有实例只 kill 自己 spawn 的 PID（`taskkill /PID <pid> /T /F`），kill 后确认端口双栈释放；
   未发生抢占或结束未知服务。
5. **next dev 也有项目级单实例锁（run#5 实证，2026-09-12 00:36）**：Next 16.2.6 Turbopack dev 在
   `<site>/.next/dev/lock` 上持原生 SWC flock（`node_modules/next/dist/build/lockfile.js`，调用点
   `server/lib/router-utils/setup-dev-bundler.js` L92）。锁被持有则新实例打印
   `Another next dev server is already running`（含 PID/端口/Dir/Log 四行）并 exit 1。
   **无 CLI flag、无环境变量可关闭**（`next dev --help` 全量 flag 已核；无 NEXT_DIST_DIR 类覆盖；
   distDir 由 next.config 决定，属实现写面）。`next dev` 默认 `-H 0.0.0.0`（--help 可证），
   一旦能启动则 localhost/127.0.0.1 双栈均可达（与 vinext 只绑 `::1` 不同）。
   当前锁持有者：PID 11208（node.exe，监听 `*:3311`，有活跃连接，疑似 Backend worker 冒烟实例未关）。
   回避删除锁文件强开：两 next dev 共写 `.next/dev` 构建缓存必然互相破坏（含对方实例），
   且违反"共享 lockfile 必须串行修改"约束——明确不采用。

## 五、服务 PID 与端口生命周期（来自测试输出 `[lifecycle]` 行，均在结束时确认端口释放）

| 运行 | 端口 | 包装 PID | 结局 |
| --- | --- | --- | --- |
| run#2 | 3399 | 7492 | exit code 1（锁拒绝，启动即退），taskkill 收尾，端口释放 |
| run#3 | 3399 | 22688 | ready 200 → 测试毕 taskkill，端口释放 |
| run#4 | 3399 | 4304 | ready 轮询 500×150s → 超时 → taskkill，端口释放 |
| recovery#1 | 3398 | 6228 | ready 轮询 500×150s → 超时 → taskkill，端口释放 |
| 探针 | 3399 | （cmd 包装） | 取证后 taskkill，端口释放 |
| run#5 | 3399 | 22068 | 锁冲突启动即退（exit 1）→ taskkill 收尾，端口释放 |
| run#6 | 3399 | 27524 | ready 200（2s）→ 11/12 → taskkill，端口释放 |
| recovery#2 | 3398 | 7020 / 1328 / 8596（首启/重启/损坏重启） | 均 ready→killed→端口释放；损坏文件 `{broken` 保留于数据目录作证据 |
| run#7 | 3399 | 26884 | ready 200（3s）→ **12/12** → taskkill，端口释放 |
| recovery#3 | 3398 | 28088 / 4628 / 15904（首启/重启/损坏重启） | 均 ready→killed→端口释放；**2/2** |

最终核验：`netstat` 无 3398/3399 监听（3311 演示实例由主控重启，与本测试无关）。
证据留存：`.v5-preview-data-http-test/rows-store.json`（正常终态）、
`.v5-preview-data-recovery-test/rows-store.json`（损坏原样 `{broken`，未静默重置的直接物证）；
两目录均未跟踪，可整目录删除。

## 六、写面与产物

- 本 worker 独占写面（未越界）：`test/v5-preview-http.test.mjs`、`test/v5-preview-recovery.test.mjs`、
  `verification/PLAN.md`、`verification/RESULTS.md`、`verification/raw.log`。
- 未修改任何实现文件（app/v5-preview/**、lib/v5-preview/**、app/api/v5-preview/** 均只读）；
  未运行其他测试文件；未 git 操作；未装依赖。
- 证据文件：
  - `V5/handoff/ROWS_FULLSTACK/verification/raw.log`（5 次运行完整 TAP 输出 + [lifecycle] 行；UTF-8，
    含 ANSI 色码，grep 需 `-a`）
  - `V5/handoff/ROWS_FULLSTACK/verification/PLAN.md`（验证计划：用例矩阵与环境协议）
  - 测试文件头部注释含冻结契约引用与运行方式：`node --test test/v5-preview-http.test.mjs`、
    `node --test test/v5-preview-recovery.test.mjs`（各自独立）。

## 七、停止声明（最终）

冻结 §6 全部必测项已在 dev:node 运行时以真实 HTTP 全量验证：**最终确认轮 14/14 全部通过**
（http 12/12：run#7；recovery 2/2：run#3）。无未验证项、无未决缺陷。
历史过程证据（workerd fs 阻塞 → DEFECT-1 → dev:node 裁决 → next dev 锁协调 → DEFECT-3 修复）
完整保留于执行历史表与 raw.log，供主控 REPORT.md 引用。
本 worker 全程未修改任何实现文件、未跑其他测试、未 git 操作、未装依赖；
所有自起实例均已 taskkill 并核实端口释放，他人进程与演示实例（3311）从未触碰（仅只读 GET 取证）。

## 八、测试基建加固（npm test 串行竞态修复，2026-09-12 01:30）

**竞态根因**（主控全量 Gate 发现，644/646）：`npm test` 串行下，http 文件（3399）after() 的
`taskkill /T /F` 后，next dev 的**实际服务进程可能逃脱树杀**（中间进程退出导致 PID 树断裂），
残留实例仍 LISTENING 3399 并持有 `.next/dev/lock`；recovery 文件随后的 spawn 即撞
"Another next dev server is already running"（错误信息中的 PID 为残留服务进程，非测试包装进程）。
单独复跑时序不同故全过。属测试基建竞态，非应用缺陷。

**加固（只改本 worker 两个测试文件的基建函数，断言语义零改动）**：
1. **spawn 前环境就绪等待**（`waitForEnvReady`，新组合入口 `startServerReady` = 等待→spawn→就绪轮询，
   覆盖全部 4 处 spawn 点）：**端口无 LISTENING = 硬条件**（`netstat -ano` 口径，满足即放行 spawn），
   最多等 20s。锁文件存在/pid 探活**降级为信息记录、不阻塞**（初版曾把"文件存在+pid 活"当锁被持有
   而阻塞——假阳性：flock 随真正监听进程死亡即释放，残留 lock 文件的 serverInfo.pid 可能是存活但
   已不持锁的包装进程；全量 npm test 二轮 644/646 即此因，错误体
   "LISTENING=[] 但 lock 被活进程持有=true" 定位）。真被锁住的情形由既有兜底承接：spawn 立即退出含
   "already running" → 等 3s 重试一次 → 仍失败才报错（错误体含定位信息）。锁信息以
   event=lock-file-present-nonblocking 记入 `[lifecycle]`。
2. **already-running 自动重试一次**（`waitForServer`）：spawn 后进程立即退出且服务输出含
   "already running"（项目级 dev 锁竞态残留）时，`killServer` 清理 → 等 3s → 重新 spawn → 继续就绪
   轮询；仅重试一次，二次仍失败则带完整输出尾部报错。重试事件记入 `[lifecycle]`（event=lock-race-retry）。
3. **after() 释放确认强化**（`killServer`）：taskkill 后轮询 `netstat` 确认端口无 LISTENING 再返回
   （替换原绑定探测口径）；若发现本端口残留 LISTENING PID——因 spawn 前已确认本端口空闲，
   该 PID 只能是自己实例树逃脱的成员——对其定向补刀一次 `taskkill /T /F`（留痕 event=
   follow-up-taskkill），15s 仍不释放则报错人工核查。

**自证结果**（raw.log "FINAL HARDENING verify" / "SERIAL SIM" / "SINGLE RUNS" 段）：
- b) 串行模拟（同一条命令 `node --test http` 后立刻 `node --test recovery`）：**12/12 + 2/2**，
  node 退出码 0×2（PIPESTATUS 确认）；recovery 三个 spawn（含紧随 http 实例被杀之后的重启）全部
  干净就绪，无锁冲突。
- a) 单独各跑一次：**12/12 + 2/2**，node 退出码 0×2。
- 终版加固后又自证两遍（串行 + 单独），结果同上全过。
- 待主控重跑完整 `npm test` 终验（646/646 预期）。
