# soak 01_SYSTEM 缺陷清单

## F1（已修复，白名单内）message-store.mjs 跨进程写锁无忙等超时

- **严重级**：HIGH（多进程部署下用户可复现的发送失败 500；违反任务书"数据库锁与忙等待要有超时"硬要求）
- **模块**：`Back/Edge/src/message-store.mjs`（任务书白名单内）
- **触发条件**：≥2 个 Edge 进程共享同一 `--messages-file`，写事务（claimReceipt/appendOne/finalizeReceipt/trimReceipts 的 `BEGIN IMMEDIATE`）碰撞
- **复现**：`node --test --test-concurrency=1 Back/Edge/test/soak-v04-system/f1-busy-repro.test.mjs`
  - 修复前：**77/160 笔并发写报 `database is locked`**（500 CHILD_INTERNAL），EXIT=1
  - 修复后：0 例，EXIT=0；同 requestId 对撞出站恒 ≤1
- **改动**：开库后补一行 `db.exec('PRAGMA busy_timeout = 5000;')`（含约束注释；超时后如实抛错，不吞异常、不全局串行化）
- **hash 前后**：`742c47d0…` → `925de0a850d104919f3664075f929544ddb6ec230719c409f2042e9120903fa1`
- **回归**：54/54 + 16/16 两轮 exit 0（幂等/持久化/store/线程/activity/proxy/harness/csrf/takeoff）
- **状态**：已回写共享源并重建长测快照；f1-busy-repro 作为长期回归保留

## 观察项（非缺陷，登记备查）

1. **回执有界窗口语义**：`maxReceipts=4096` 下最旧 sent/legacy 回执被裁剪；被裁 ID 重放=新发送（长测内 legacy_evicted 139 例）。pending/unknown 永不裁剪（实测成立）。如业务需更长幂等记忆，另立任务，本包不扩权。
2. **soak-c1 保留裁剪**：base=347，4 条早期消息出站记录仍在 sink 日志但消息行已被 maxPerCustomer 裁剪——设计内，读取面 truncated+retentionBase 显式披露，非数据丢失。
3. **宿主内存压力**：宿主空闲内存多次 <2GB（最低 0.3GB），驱动按守卫条款自动降载 41 次；未影响不变量，但说明该机器不宜同时跑多包长测。
