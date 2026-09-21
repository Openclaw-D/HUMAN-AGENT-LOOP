# R2-01 契约：消息幂等与持久未知（冻结于实现前）

2026-09-21；基线 HEAD `e298a789bc9d49eac23a17f9dfe75244f73ca64f`；输入 `docs/v0.4/results/back-message-idempotency/REPORT.md`（BACK_FIX 复现报告，12 项回归 6 pass / 6 fail）。

## Ownership（仅本路可写）

- `Back/Edge/src/messages.mjs`、`Back/Edge/src/message-store.mjs`（开工时两文件与 HEAD 一致，无在制 writer）。
- `Back/Edge/test/v04-message-idempotency.test.mjs`（BACK_FIX 遗留，12 项断言不弱化、不改语义）。
- 新增 `Back/Edge/test/v04-message-persistence*.test.mjs`。
- 报告仅写 `docs/v0.4/results/r2-01-messages/`。
- `server.mjs`、`customer-activity.mjs` 及其余模块只读。

## 语义契约

### 1. 可信作用域（scope）

- `scope = (customerId, session.principalId, session.tenantId ?? '')`，三者全部来自服务端可信来源（customerId 路由参数经 validateTarget 校验；principal/tenant 来自 session，`session.mjs:23` 为权威，未配置租户为 null→''）。
- body 中的 `principalId`/`tenantId` 声明一律忽略，不参与 scope。
- 指纹 `fingerprint` 保持不变：`{audience, text, threadId, internalContent}`。

### 2. 回执记录（message-store 增量，仅限本 store）

`message_receipts` 新增列：`principal_id`、`tenant_id`、`status`（`pending`=在途 intent / `terminal`）、`deliver_state`（`sent`/`failed`/`unknown`/NULL）、`owner_token`、`claimed_at`。旧库经 `PRAGMA table_info` 检测后 `ALTER TABLE ADD COLUMN` 兼容迁移；旧行默认 `status='terminal'`、`principal_id=''` → 按"旧无作用域回执"处理。不删行、不改键、不清账。

### 3. 重放 / 冲突（terminal 回执探测）

| 情形 | 结果 |
|---|---|
| 旧无作用域回执（`principal_id=''`） | **409 REQUEST_ID_CONFLICT（legacy 失败关闭）**：零发送、不披露旧 delivery、不清账、不静默改键重发 |
| scope 或 fingerprint 任一不同 | 409 REQUEST_ID_CONFLICT：零发送、不披露对方回执 |
| 同 scope 同指纹 | 200 `{...原回执, replayed:true}`（failed/unknown 态原样重放，不二次发送） |

### 4. 原子认领（claim）与 owner 校验

- 发送前先 `claimReceipt`：`BEGIN IMMEDIATE` 事务内 `INSERT ... ON CONFLICT(request_id) DO NOTHING`，`changes===1` 即胜者，获随机 `owner_token`；落库 `status='pending'` intent。两个独立连接争抢同 ID 时有且仅有一个胜者。
- 败者读到既有记录按 §3/§5 处理，绝不进入 deliver。
- intent→terminal 仅 owner 可为：`finalizeReceipt` 带 `WHERE request_id=? AND owner_token=? AND status='pending'`；owner 不匹配或已被租约回收 → 不覆盖既有 fail-safe 记录。

### 5. pending（在途 intent）

- 同 scope 同指纹：409 REQUEST_ID_IN_FLIGHT（首次尝试未决：不重发、不重放、不披露）。
- 异 scope / 异指纹：409 REQUEST_ID_CONFLICT（不租约回收、不披露）。
- 租约过期（仅同 scope 同指纹者）：原子转 terminal `unknown`（`claimed_at <= now-pendingLeaseMs`，默认 15 分钟，路由可配），此后按 unknown 回执重放，永不重发。跨进程崩溃遗留的 intent 由此收敛，不因重启被遗忘或误重发。

### 6. 发送后异常持久 unknown

- deliver 抛错：owner 立即把 intent 落 terminal `unknown`（持久化），返回 **502 DELIVERY_UNKNOWN**（`delivery.state='unknown'`，ok:false）。
- 重放（含重启后）：200 `{ok:true, requestId, audience, delivery:{messageId:'unknown',state:'unknown'}, replayed:true}`，零二次发送。
- 与"deliver 正常返回 unknown 态"的既有语义一致：都持久 unknown、都不重发；502 仅区分"通道异常"与"通道如实上报未知"。

### 7. 裁剪保护

`maxReceipts` 裁剪跳过 `status='pending'` 与 `deliver_state='unknown'` 的行（不因裁剪忘记"可能已发送"的请求）；`sent`/`failed` 照旧按 `created_at` 裁最旧。内存兜底 ledger 同规则（有界 1024）。

### 8. 内存兜底（E0 兼容，无 receiptStore）

进程内 ledger 实现同一协议：claim（单线程事件循环下原子）/owner 校验/租约回收/裁剪保护。路由单一代码路径，不因 store 类型分支语义。

### 9. 兼容面（不改动语义）

- `getReceipt(requestId)`/`putReceipt(...)` 签名不变：putReceipt=直写 terminal（`principal_id=''`、deliver_state='sent'，兼容/测试用，路由侧按旧无作用域失败关闭）；getReceipt 仅返回 terminal 行，`customer-activity.mjs` 只读面不受影响。
- 鉴权与守卫顺序不变：400 校验 → validateTarget → 幂等探测 → 受众守卫（403，不落回执、可重试）→ claim → deliver。重放路径仍跳过受众守卫（不发生发送）。external-send 权限点仍在 server 层。
- 审计、线程留档（仅成功后入栈）、响应体形状（除新增 502 错误体外）不变。

## 测试契约

- 原 12 项（v04-message-idempotency）全部转绿，断言一字不改。
- 新增 v04-message-persistence 至少覆盖：两独立 SQLite 文件库连接争抢（store 级 + router 级）、进程重启（关闭重开）恢复、崩溃遗留 intent 租约收敛、异常 unknown 跨重启持久、legacy 回执跨重启仍失败关闭、裁剪保护（pending/unknown 不裁）、内存兜底与 SQLite 同语义、受众/客户/身份/租户边界、各场景实际出站计数。

## 不宣称

修复完成≠用户业务上线≠server 全链验收；可信 tenant 未配置时仍为''（等值绑定，不宣称租户区分已生产就绪）；HTTP 层新错误码透传属 server 只读面，如需接线另立任务。
