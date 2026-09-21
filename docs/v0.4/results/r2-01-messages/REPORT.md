# R2-01 交付报告：消息幂等与持久未知修复

2026-09-21；基线 HEAD `e298a789bc9d49eac23a17f9dfe75244f73ca64f`；任务书 `docs/v0.4/tasks/ZCODE_R2_01.md`；契约（实现前冻结）`docs/v0.4/results/r2-01-messages/CONTRACT-R2-01.md`。

## 结论

BACK_FIX 路复现的六项失败全部修复：原 12 项回归 6 pass/6 fail → **12/12 全绿，断言一字未改**。新增 13 项持久化回归全绿。消息模块及 HTTP 相关回归共 70 项全绿，退出码 0。

## 变更（均在本路 ownership 内）

- `Back/Edge/src/messages.mjs`：幂等裁决重写——回执绑定可信作用域 `scope=(customerId, session.principalId, session.tenantId??'')`（body 伪造声明一律忽略）；terminal 回执按 scope+指纹裁决（同→200 重放，异→409 不披露）；旧无作用域回执（`principal_id=''`）409 失败关闭：零发送、不清账、不静默改键重发；发送前原子 claim（胜者持随机 owner_token）；deliver 抛错→owner 落持久 unknown 并返回 502 DELIVERY_UNKNOWN；pending intent 租约（`pendingLeaseMs`，默认 15 分钟，可配）到期原子收敛为 unknown，永不重发；无 receiptStore 时内存兜底 ledger 走同一协议（E0 兼容）。鉴权/目标校验/受众守卫/审计/线程留档的顺序与语义全部保持原样。
- `Back/Edge/src/message-store.mjs`：`message_receipts` 增列 `principal_id/tenant_id/status/deliver_state/owner_token/claimed_at`，旧库经 `PRAGMA table_info` 检测逐列 `ALTER TABLE` 兼容迁移（增量仅限本 store，未重构存储）；新增 `claimReceipt`（BEGIN IMMEDIATE + ON CONFLICT DO NOTHING，跨连接恰一胜者）、`finalizeReceipt`（`WHERE owner_token=? AND status='pending'`，非 owner 不覆盖）、`expirePendingReceipt`（仅到期 pending 原子转 unknown）、`getReceiptRecord`；裁剪跳过 pending 与 unknown（不因裁剪忘记可能已发送的请求），sent/failed 照旧裁最旧；`getReceipt/putReceipt` 签名与语义兼容不变（`customer-activity.mjs` 只读面不受影响）。
- `Back/Edge/test/v04-message-persistence.test.mjs`（新增 13 项）：两独立 SQLite 连接争抢、两 router 各持独立连接并发同 ID、重启恢复、崩溃遗留 intent 租约收敛、异 scope 不回收不披露、异常 unknown 跨重启、legacy 跨重启仍关闭且不清账、裁剪保护、tenant 未配置(null)等值边界、body 伪造、受众边界（拒绝不落回执）、内存兜底同语义、failed 跨重启重放；每场景断言实际出站计数。
- `Back/Edge/test/v04-message-idempotency.test.mjs`（BACK_FIX 遗留）：零修改。
- `server.mjs` 等其余模块零改动（只读）；他路在制文件（assistant-\*、customer-activity 等）零触碰。

## 原六项失败逐项核对

| # | BACK_FIX 失败场景 | 修复后 | 证据 |
|---|---|---|---|
| 1 | 跨客户同 ID 返回他作用域回执 | 409，不披露，发送 1 次 | idempotency #3 + persistence #9 |
| 2 | 跨 principal 同 ID 泄漏 | 同上 | idempotency #4 + persistence #9 |
| 3 | 跨可信 tenant 同 ID 泄漏 | 同上；tenant null 与 null 等值、与 't2' 冲突 | idempotency #5 + persistence #9 |
| 4 | 旧无作用域回执被重放披露 | 409 失败关闭，0 发送，行保留 | idempotency #7 + persistence #7（跨重启） |
| 5 | 共享存储并发同 ID 双发送 | 恰 1 次发送，败者 409 | idempotency #11 + persistence #1/#2 |
| 6 | 发送后异常可盲重发 | 502 DELIVERY_UNKNOWN 持久 unknown，重放 0 二次发送 | idempotency #12 + persistence #6（跨重启） |

## 验证证据（命令与退出码）

```
node --test test/v04-message-idempotency.test.mjs
→ tests 12 / pass 12 / fail 0，EXIT=0（修复前同命令 6 pass/6 fail，EXIT=1）

node --test test/v04-message-persistence.test.mjs
→ tests 13 / pass 13 / fail 0，EXIT=0

node --test --test-concurrency=1 test/t4-message-store.test.mjs test/v04-message-idempotency.test.mjs
  test/v04-message-persistence.test.mjs test/g03e-message-thread.test.mjs
  test/v04-activity-http.test.mjs test/s3-proxy.test.mjs
→ tests 54 / pass 54 / fail 0，EXIT=0

node --test --test-concurrency=1 test/s3-harness.test.mjs test/s3-csrf.test.mjs test/takeoff-surface.test.mjs
→ tests 16 / pass 16 / fail 0，EXIT=0
```

BACK_FIX 报告记录的 `customer-activity.mjs:302` 在制 SyntaxError 导入阻断已由他路消除（本轮 `node --check` 通过，s3-proxy/HTTP 回归正常导入），非本路改动。未发现因他路在制导致的导入失败，无需留证豁免。

说明：计数均为本地 deliver 替身实际调用次数；"重启"=SQLite 文件库关闭后重开连接（与 BACK_FIX 同口径），不冒充真实进程重启；并发测试为单进程双连接 + 事务串行化，跨进程语义由 BEGIN IMMEDIATE 保证并有两连接争抢测试覆盖。

## 源码 SHA256（交付时点）

- `Back/Edge/src/messages.mjs`：`7094b2886157d2a81df47fbcd24f21d9760bc8093652092565e0896b8d5f1ae7`
- `Back/Edge/src/message-store.mjs`：`742c47d0a17fb2d4f5f78ec920793b63d62a3767121aace7c75171b3198f8c60`
- `Back/Edge/test/v04-message-idempotency.test.mjs`：`23fbde88c4c8f352f65b57f14213b3565a97422717fd49d430d9ec0412889b63`（零修改）
- `Back/Edge/test/v04-message-persistence.test.mjs`：`dc615c660da0ddbb2c9c8b9f3cba78764ede528fc8b8406fdb3c4fb8cce775b5`

## 资源状态

- 无自建端口、无共享服务启停、无数据库容器、无真实模型调用、未读凭据。
- 测试临时目录（`%TMP%/jw-edge-msgpersist-*`、`jw-edge-msgrace-*`）已全部清理，残留 0。
- 无残留测试进程（node --test 均已退出）。未 commit/push、未建分支/worktree。

## 遗留与不宣称

1. 修复完成≠用户业务上线≠生产验收；HTTP 面由 `sendJson` 原样透传新 502 DELIVERY_UNKNOWN，未改 server。
2. 可信 tenant 未配置时绑定为 `''`（null 等值自身、异值冲突）；不宣称生产租户区分已就绪（tenantId 权威来源 `session.mjs:23` 未变）。
3. 崩溃遗留 intent 在租约内（默认 15 分钟）返回 409 REQUEST_ID_IN_FLIGHT，需等租约到期收敛为 unknown；如需开机即收敛可另立任务在 server 启动时调用 `expirePendingReceipt`（本路 server 只读，未接线）。
4. `putReceipt` 兼容直写仍产生无作用域回执（被路由失败关闭）——仅供既有测试/兼容使用，新代码应走 claim/finalize。
5. `g03e`/`s3-*`/`takeoff-surface` 等 HTTP 回归通过，但完整 Edge 全套（39 文件）未整刷（含他路在制文件，避免误报；按任务要求不反复刷全套）。
