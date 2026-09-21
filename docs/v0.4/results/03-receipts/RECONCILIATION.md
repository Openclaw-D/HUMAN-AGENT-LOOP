# 历史用量对账 · real-api-qa 轮（zloop，2026-09-20 17:20–18:00Z）

来源：run-log 42 行；成本账本 112 条（窗口内 56，窗口外更早轮次 56 条不动）；回执目录 117 个文件。全部只读。

## 口径结论

- 出站尝试（权威口径，CORRECTION-FINAL L41）：**28** = 25 条案例调用（含首次R25截断）+ R05-replay 误出站 + R28-replay 误出站 + R25b 复验。run-log 带真实 requestId 的出站行 26 行、去重 requestId 26 个（R28 两行、R25 首次/复验两行为不同调用）。
- usage 留证：run-log 带 usage 的行 **27 行**，其中 1 行（L41 R25b 注解）与 L34（17:58:31 R25 复验）为**同一调用的注解复写**（CORRECTION-FINAL 已言明注解重复计数）。REPORT §3“27次 usage 入97,358/出35,340”即 27 行直和，**含这次重复**；去重后逐条留证 = **26 次不同调用，入 94264 / 出 33762 tokens**（差值 3094/1578 恰为 R25b 那一次）。
- 28 出站 = 26 次有逐条 usage + 2 次意外出站（R05-replay/R28-replay，driver 当时未记 usage）。
- 成本账本（窗口内）：reserve **28** 条 / actual **28** 条，预占合计 9.8 元；孤儿账本条目 0 条。
- 零出站门（如实计入口径、无出站）：R04(L4,http=503)、R15(L15,http=422)、R21(L21,http=200)、R21b(L24,http=200)、R26(L27,http=409)、R27(L28,http=400)、R29(L30,http=0)、R29(L32,http=0)、R01-replay(L35,http=409)；零出站重放：R30-replay(L38)。

## 逐 requestId 对账表

| requestId（前缀） | 案例 | 回执 terminal/intent/claim | 回执status/sent | usage(run-log) | usage(回执) | 账本 r/a | actual billKnown |
|---|---|---|---|---|---|---|---|
| `amq:cust-mu9yqi5s-a0beff262876:v2-7edcd248920143fd403595ef…` | R18 | T/I/- | succeeded/true | 3059/1881 | 3059/1881 | 1/1 | true |
| `amq:cust-mu9yqi5s-a0beff262876:v2-e170df60241b62d27d0c96d3…` | R17 | T/I/- | succeeded/true | 2228/646 | 2228/646 | 1/1 | true |
| `amq:cust-mu9yqi5s-a0beff262876:v2-e331f9138a04a2b129635a4e…` | R19 | T/I/- | succeeded/true | 2878/1247 | 2878/1247 | 1/1 | true |
| `amq:cust-mu9yqi5s-a0beff262876:v2-f14356eb27a2ace9bea551ea…` | （无run-log行） | T/I/- | succeeded/true | - | 2241/711 | 0/0 |  |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-3045d21413446b7353aaacae…` | R02 | T/I/- | succeeded/true | 3242/1801 | 3242/1801 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-316bd94e13e723b0783a2bbf…` | （无run-log行） | T/I/- | succeeded/true | - | 3116/1773 | 0/0 |  |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-57e410c37eaafe720eac5710…` | （无run-log行） | T/I/- | succeeded/true | - | 2952/1355 | 0/0 |  |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-5ba736db32503659144d1e6f…` | R20 | T/I/- | succeeded/true | 3899/1260 | 3899/1260 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-622bed14b43d44a18047c866…` | R05 | T/I/- | succeeded/true | 2948/834 | 2948/834 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-71d6115d93265cc64de9848d…` | R09 | T/I/- | succeeded/true | 3880/1237 | 3880/1237 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-74cf3a097bd916e27af20128…` | （无run-log行） | T/I/- | succeeded/true | - | 2251/1623 | 0/0 |  |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-74f7b5ca97f0497bea0cdafe…` | R22 | T/I/- | succeeded/true | 3884/769 | 3884/769 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-9d6899391ec6f5796903f5bc…` | （无run-log行） | T/I/- | succeeded/true | - | 4427/1321 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-b02a919c14c7219b71593e00…` | R06 | T/I/- | succeeded/true | 3878/1471 | 3878/1471 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-b2e4cada2db60552ae0f3385…` | R07 | T/I/- | succeeded/true | 3880/590 | 3880/590 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-be5bde28843061cb8c208468…` | （无run-log行） | T/I/- | succeeded/true | - | 3119/1000 | 0/0 |  |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-c74bff15262921fb6512ce85…` | （无run-log行） | T/I/- | succeeded/true | - | 3116/736 | 0/0 |  |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-ce57319b1c75026074120398…` | R30 | T/I/- | succeeded/true | 4437/1523 | 4437/1523 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-d93b7f2ea837c3d913919450…` | （无run-log行） | T/I/- | succeeded/true | - | 3119/585 | 0/0 |  |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-d9fc6a940920f06d96957249…` | （无run-log行） | T/I/- | succeeded/true | - | 2326/944 | 0/0 |  |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-deee8abf5fcb777d82e03806…` | R08 | T/I/- | succeeded/true | 3878/721 | 3878/721 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-e8acd95397ee3d96be9cf3fa…` | R01 | T/I/- | succeeded/true | 3144/743 | 3144/743 | 1/1 | true |
| `amq:cust-mu9yu9db-948bbe5d2f28:v2-ece662a43127c65ac8a36c76…` | R10 | T/I/- | succeeded/true | 3889/1814 | 3889/1814 | 1/1 | true |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-08da02e7f437363be84a2e94…` | R24 | T/I/- | succeeded/true | 4972/1859 | 4972/1859 | 1/1 | true |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-0e61b12a60f6f108c123b3f5…` | R28 | T/I/- | succeeded/true | 5041/1423 | 5041/1423 | 1/1 | true |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-13647111cae2531143f566da…` | （无run-log行） | T/I/- | unknown/- | - | - | 0/0 |  |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-207b9c0eb7d1ef44487b5b28…` | R11 | T/I/- | succeeded/true | 4853/1275 | 4853/1275 | 1/1 | true |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-43433639b629c1a907fe559a…` | （无run-log行） | T/I/- | succeeded/true | - | 4697/1216 | 1/1 | true |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-5933f2de70d0c550560fb0da…` | R12 | T/I/- | succeeded/true | 4849/1306 | 4849/1306 | 1/1 | true |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-8e4eb2facef7f3bfcb0bbeb7…` | R03 | T/I/- | succeeded/true | 4844/1475 | 4844/1475 | 1/1 | true |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-a47dbbe9551b4b55bdc623e4…` | （无run-log行） | T/I/- | succeeded/true | - | 4844/1296 | 0/0 |  |
| `amq:cust-mu9zheml-a99d1b6c3080:v2-b3e7dd0678eb70aa9e4b7e6a…` | R28 | T/I/- | succeeded/true | 4972/1929 | 4972/1929 | 1/1 | true |
| `amq:cust-mu9zp319-80f58775851e:v2-1ab277c1e65708967364105b…` | R16 | T/I/- | succeeded/true | 2025/582 | 2025/582 | 1/1 | true |
| `amq:cust-mu9zp319-80f58775851e:v2-863c874916d4b212e9563c82…` | R14 | T/I/- | succeeded/true | 2205/683 | 2205/683 | 1/1 | true |
| `amq:cust-mu9zp319-80f58775851e:v2-a96c8a45db0e4c07ffe7e43b…` | R25 | T/I/- | succeeded/true | 3094/1578 | 3094/1578 | 1/1 | true |
| `amq:cust-mu9zp319-80f58775851e:v2-c34b10a869580f96a4596d37…` | R23 | T/I/- | succeeded/true | 2985/1508 | 2985/1508 | 1/1 | true |
| `amq:cust-mu9zp319-80f58775851e:v2-dfd9be26e1bbd477452fd871…` | R25 | T/I/- | succeeded/true | 3094/2000 | 3094/2000 | 1/1 | true |
| `amq:cust-mu9zp319-80f58775851e:v2-f60db225f86af7a4a97f03af…` | （无run-log行） | T/I/- | succeeded/true | - | 2196/1418 | 0/0 |  |
| `amq:cust-mu9zp319-80f58775851e:v2-f75bcda9c45021a9ca2bb21a…` | R13 | T/I/- | succeeded/true | 2206/1607 | 2206/1607 | 1/1 | true |

## 证据缺口（来源与缺失分开）

- 出站 requestId 无 terminal 回执：无。
- 有 terminal 回执但 run-log 无对应行（更早轮次残留，不动）：13 个（见 reconciliation.json）。
- 两次意外出站 driver 层未记 usage；回执目录 17:45–17:47Z 窗口的 terminal 回执 usage 见 reconciliation.json `accidentalReceiptUsage`（回执在，driver 台账缺，属证据源差异，费用已含在账本预占内，不据此猜测拆分）。
- 供应商账单口径未知（以智谱控制台为准）；本表不做费用猜测。