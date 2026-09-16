# ROWS_FULLSTACK 验证计划（Verification worker）

日期：2026-09-11。依据：`V5/ZCODE_ROWS_FULLSTACK_TASK.md`（验证与交付 Gate）、
`V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md`（FROZEN §2 路由/错误码/幂等、§3 种子、§6 测试要求）、
`jianwei-v3/site/lib/v5-preview/shared-types.ts`（类型契约）。

## 范围与写面

- 独占写面：`test/v5-preview-http.test.mjs`、`test/v5-preview-recovery.test.mjs`、`verification/**`。
- 不修任何实现（前端 app/v5-preview/**、后端 lib/v5-preview/**、app/api/v5-preview/** 均非我所有）；
  不跑其他测试文件；不 git 操作；不装依赖；测试内只 kill 自己 spawn 的进程。
- 发现缺陷只记录复现证据（请求载荷、期望 vs 实际），交主控分派修复。

## 环境与进程生命周期（两条测试文件各自独立）

| 项 | http | recovery |
| --- | --- | --- |
| 端口 | 3399 | 3398 |
| 数据目录 | `<site>/.v5-preview-data-http-test` | `<site>/.v5-preview-data-recovery-test` |
| 启动 | `npm.cmd run dev -- --port 3399`（env `V5_PREVIEW_DATA_DIR=<数据目录>`，cwd=site） | 同式，3398 |
| 就绪判据 | 轮询 `GET /api/v5-preview/project` 直到 200，1s 间隔，超时 150s | 首启/重启同左；损坏场景"服务可达即可"（预期 500） |
| 进程 | spawn npm.cmd（EINVAL 时回退 ComSpec 模式，v4life-gate.mjs 先例），记录 PID | 同式 |
| 终止 | `taskkill /PID <pid> /T /F`，等待退出 + 确认端口释放 | 同式 |
| 启动前 | 数据目录先删干净；端口空闲自检（被占则拒绝运行，不抢占未知服务） | 同式 |

PID/端口生命周期事件（spawn/ready/killed/exit/port-released）随测试输出记录进 raw.log。

## A. test/v5-preview-http.test.mjs（12 用例，串行构成一次验收旅程）

1. GET 初态 = approval 种子：version 7；四域顺序 政策/信审/商务/资产 及各自 segments/灯/summary；
   信审黄"待补充"；todo-device-list 待补充（relatedDomain=credit）；消息含 system 开场 + 信审请求设备清单；
   Cache-Control: no-store。
2. 验收闭环：POST notes {requestId:'v-001', expectedVersion:7, todoId:'todo-device-list',
   text:'设备清单：CNC 机床两台及辅助夹具（合成说明）。', actorRole:'business'} → 200；
   version 8；todo 待复核；信审 judgmentText=待复核且仍黄；messages 恰 +2（business 补充说明 + system 记录）；
   政策域逐字段不变；GET（第二视口）读到同一状态。
3. 幂等重放：同 requestId v-001 同载荷 → 200 replayed=true；GET 确认 version 与消息数不变。
4. REQUEST_MISMATCH：同 requestId 换 text（expectedVersion=8 隔离变量）→ 409 REQUEST_MISMATCH，version 不变。
5. VERSION_CONFLICT：expectedVersion=7（过期）→ 409 且 body.serverVersion=8，version 不变。
6. INVALID_INPUT：空 text（全空白）/ 2001 字符 text / 缺 requestId / 缺 actorRole → 各 400 INVALID_INPUT，version 不变。
7. 越权：actorRole='credit' → 403 ROLE_FORBIDDEN，version 不变。
8. messages：POST 正常追加 → version+1；GET 顺序含新消息（business、"接收进展"）。
9. seed settled：→ todo=null、overall 已结清（演示）、version 41、四域全绿；随后 notes → 409 NO_OPEN_TODO；
   messages 仍 200（version+1）。
10. seed post-rental：资产黄"观察中"（segments done/done/current/pending）、todo-inspection 待补充
    （relatedDomain=asset）、overall 起租后资产管理、version 23。
11. BAD_SCENARIO：seed {scenario:'bad'} → 400 BAD_SCENARIO；当前情景/版本不被破坏。
12. 畸形 JSON body（'{broken'）→ 400 INVALID_INPUT（ApiError 形状）。

## B. test/v5-preview-recovery.test.mjs（2 用例）

1. 重启恢复：首启（approval 种子）→ POST message（version 7→8）→ 确认 rows-store.json 存在
   → taskkill 自起实例并确认端口释放 → 同数据目录重启 → GET 断言 version/情景/消息/待办/四域
   与重启前逐字段一致。
2. 存储损坏：kill → rows-store.json 写入 `{broken` → 重启（服务可达即可）→ GET 500 且
   body.error='STORE_CORRUPT' → POST messages 也 5xx（STORE_CORRUPT）→ 文件内容逐字节未变
   （未静默重置/清空/重建）→ kill 清理。损坏文件保留作证据。

## 执行协议

1. 先写两测试文件 + 本计划（已完成）。
2. 轮询实现就绪标志：`app/api/v5-preview/project/route.ts` 与 `lib/v5-preview/service.ts` 存在
   （每 20s 一次，最多等 25 分钟）。
3. 就绪后依次独立运行：
   - `cd jianwei-v3/site && node --test test/v5-preview-http.test.mjs`
   - `node --test test/v5-preview-recovery.test.mjs`
4. 失败=证据：完整记录用例名、请求载荷、期望 vs 实际响应；可整体重试一次以排除 dev 首次编译竞态
   （就绪轮询已含 150s 余量）。不修实现。
5. 结果写入 `verification/RESULTS.md`（结构化：通过/失败清单+复现载荷）与 `verification/raw.log`
   （完整执行输出）。服务 PID 与端口生命周期一并记录。

## 通过判据

- A 文件 12 用例全过、B 文件 2 用例全过 = 验证通过。
- 任何失败按"失败复现清单"如实报告（载荷、期望、实际、服务输出尾部），不隐藏、不因此修改实现。
