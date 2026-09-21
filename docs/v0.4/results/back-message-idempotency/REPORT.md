# BACK_FIX：复现完成，修复受 ownership 阻断

2026-09-21；HEAD `e298a789bc9d49eac23a17f9dfe75244f73ca64f`。

## 结论

未修复产品源码。新增最小回归证实跨客户、principal、可信 tenant 的旧回执泄漏，以及共享存储并发重复发送、发送后异常允许重发。仅修改 fingerprint 能挡住顺序调用的跨作用域重放，不能解决发送前无原子认领的问题，不能据此交付“消息幂等已修复”。

按 BACK_FIX.md 明确停止条件：“若仅修改messages.mjs无法安全处理存储并发/唯一性，交付复现与最小待集成说明，不能宣称已修复。”未扩大到 message-store、server 或四路 writer 文件。

## 本任务文件

- 新增 `Back/Edge/test/v04-message-idempotency.test.mjs`：12 项回归，失败断言保留。
- 新增本报告；未修改 `Back/Edge/src/messages.mjs`。
- 该测试文件会被现有 run-all 自动发现，因此完整 Edge 测试仍会因已复现缺陷失败；没有 skip、降低断言或改成“缺陷存在即通过”。

## 复现与验证

`node --test Back/Edge/test/v04-message-idempotency.test.mjs`

退出码 1；12 项，6 pass / 6 fail / 0 skip。使用合成数据、真实 node:sqlite 内存数据库和本地函数发送替身；计数为实际调用 deliver 的次数，不是网络/真实客户发送次数。重建 router 复用数据库，不冒充进程重启测试。

| 场景 | 实际结果 |
|---|---|
| 同作用域同载荷 | pass；发送1次，第二次重放 |
| 同ID异载荷 | pass；409，累计发送1次 |
| 跨客户 / principal / 可信tenant | 各 fail；200 replayed=true，返回之前作用域回执，累计发送1次 |
| body伪造principal/tenant | pass；不改变可信作用域，发送1次 |
| 已有无作用域回执 | fail；返回旧回执，新增发送0次；期望失败关闭 |
| 内部受众 / 未确认外发 | pass；未确认外发403且0发送，内部消息保持internal |
| 返回failed / unknown | 各 pass；重放原状态，各仅发送1次 |
| 两个router共享回执存储并发 | fail；同ID实际发送2次，分别发往c1、c2 |
| 发送后替身抛异常，再次提交 | fail；实际发送2次，无持久intent阻断 |

`node --test --test-concurrency=1 Back/Edge/test/g03e-message-thread.test.mjs Back/Edge/test/t4-message-store.test.mjs Back/Edge/test/s3-proxy.test.mjs`

未完成：导入在制 `customer-activity.mjs:302` 报 `SyntaxError: Illegal return statement`，已出现6项失败记录，测试实例未自行退出；本任务中断自己的测试会话，返回退出码1。此为观察时的外部在制依赖状态，不判定为本任务回归或最终版本缺陷。未改该文件，未重启共享服务。随后按精确测试文件名检查进程，无匹配残留。

独立执行 `node --test Back/Edge/test/t4-message-store.test.mjs`：退出码0，7 pass / 0 fail / 0 skip，包含现有文件数据库关闭重开测试。HTTP受众及显式外发权限整体验证未完成；新增模块测试不代替server权限验收。

## 根因和最小待集成范围

1. messages.mjs:10 的 fingerprint 只有正文/受众/thread/internalContent，:45 开始按原始requestId查回执，缺customer/principal/tenant绑定；旧回执也没有可证明的发送者作用域。
2. message-store.mjs 的putReceipt使用 `ON CONFLICT (request_id) DO NOTHING`，不返回认领胜者；messages在deliver完成后才落回执。两个调用可先后读空并同时发送。简单进程内锁不能提供跨实例和重启保护。
3. 若在现有单一回执键提前写intent，当前接口不能将其原子更新为terminal；若另造前缀键或切换命名空间，会涉及旧任意requestId冲突、原回执兼容及裁剪保护，不能作为无契约的小修引入。

最小后续契约应覆盖 messages.mjs + message-store.mjs：保持旧requestId可探测；可信scope绑定；原子claim与胜者返回；可核验owner的intent→terminal转换；发送后异常持久unknown；无作用域旧回执返回明确409且不重发；in-flight/unknown不因现有回执裁剪被遗忘。测试应覆盖两个独立文件数据库连接竞争、进程重启恢复、同scope重放、不同scope冲突及旧回执。

可信tenant来自服务端session（session.mjs:23）；未配置时为null，不能从body补入，也不能宣称已完成租户区分。正式接线仍需校验可信customer及session权限，不以新fingerprint替代鉴权。

本报告是待集成说明，不派发实施任务。本任务已停止；未调用模型、未建分支/worktree、未commit/push、未发送协调消息。

## 源码 SHA256

开始与结束一致：

- messages.mjs：`4B01F516EF81CEE8AD230603F1BC697B7C054EDC4ECDB2DFB4050310D1FE18F4`
- message-store.mjs：`72FCB9A5C3CC85835473231DF464E22F32986C28C25327BFB25F5DE4451CDD94`

HTTP回归失败后观察值（其他任务在制，不保证等于导入瞬间）：

- customer-activity.mjs：`79AF6C2AA3FB71736E25202E92273D0004F778285A01CD070980B026DEA8ABD5`
- server.mjs：`926E98354EA6BBE81D231F6E20E5F4F8DD6DB7D9A79F7B4298A127265FCF6846`
