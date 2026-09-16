# 任务三 · 定向缺陷转交清单（退回原 owner，不代修）

2026-09-17 复跑实测（证据：`docs/customer-next/acceptance/evidence/task3-20260917/`）。
任务三纪律：基线缺陷退回原 owner 定向处理；本清单只记录事实与复现入口，不冒充已修复。

## T1｜A 路 `npm test` runner 塌缩（假绿）——owner：Back/A writer

- 现象：`cd Back/A && npm test`（= `node --test test/run-all.mjs`）在本机 node v22.23.1 下触发
  `Warning: node:test run() is being called recursively within a test file. skipping running files.`，
  整套塌缩为 1 个平凡用例并 **exit 0**——不是全量结果。
- 正确入口：`node test/run-all.mjs`（直接运行，其内部 spawn 全部测试文件）。
- 影响：任何"npm test 全绿"的 A 路自报在该机器形态下无效，须以 run-all 直跑为准。
- Edge 侧同类问题不存在（Edge run-all 用 spawn 而非 run()；npm test 可用）。

## T2｜A 全量直跑（run-all）曾出现 4 个失败——owner：任务一/任务二 writer；**已在当轮被上游修复**，留档存照

两次实测（同一隔离容器 jw-cc-kernel-pg@15444，本会话内先后执行）：

| 轮次 | 证据 | 结果 |
|---|---|---|
| 第一次 | `a-suite-full.log` | **77/81 过，4 FAIL（B09/B12/A10/A3，均为任务一/二在制品测试文件），exit 1** |
| 第二次（上游 writer 落地修复后） | `a-suite-final.log` | **81/81 过，0 FAIL，exit 0**（A 内核 contractVersion 同步升为 `v1.3+v2.1-credit+decision-loop(task01+task02)`） |

第一次的失败原文（修复前）：

| 用例 | 文件 | 失败要点 |
|---|---|---|
| B09 两主体同时复核/批准同一版本 | `test/decision-loop.test.mjs:447` | "恰好一人成功，另一人版本冲突" 断言不满足 |
| B12 预占/批准响应丢失：幂等查回执恢复 | `test/decision-loop.test.mjs:573` | "重复生成返回既有报告" 断言不满足 |
| A10·会后补证：新修订只重开受影响项 | inspection closure 套件 | 期望 409 `INSPECTION_CLOSED`，实际 `SESSION_NOT_RUNNING` |
| A3·outbox 事件契约 | inspection closure 套件 | "缺少必发事件 INSPECTION_READY_FOR_ASSESSMENT" |

教训（转交并存照）：任务一/二的交付在任务三执行窗口内仍在演进（并行 writer），"最后一次绿灯"与
"此前失败"都如实保留；不能以任一次单一结果冒充全程。任务三消费面（credit 链 + 检查会话生命周期）
在其间未发生语义漂移，E1 全程绿。

## T3｜Edge `test/e1/e1-d02-real.test.mjs` pgctl 导入路径错误——owner：Edge（任务三），已修

- `'../../D/harness/pgctl.mjs'` 少一级（D 在 Back/D 不在 Back/Edge/D）；此前因旧冻结门一直 skip 而未暴露。
- 已由任务三改为 `'../../../D/harness/pgctl.mjs'`（本文件修复；列此存照）。

## T4｜信息项（不阻塞，供 owner 参考）

- A 内核启动时**自动应用全部迁移**（db.ts migrate）；任何"手动 psql 预迁移再启动内核"的做法都会撞
  `relation already exists`。外部编排（如任务三 delivery-up）必须以 migrate-cli / 内核自迁移为准。
- 004_decision_loop.sql 属任务二在制品：本轮内核启动可正常应用，其路由/测试随上游落地（本会话内
  contractVersion 已升 `v1.3+v2.1-credit+decision-loop(task01+task02)`，A 全量复跑 81/81）。
- **bigint 事件序号以字符串返回**（pg 驱动行为）：`outbox_events.seq` 为 bigint，HTTP 投影 seq 到达消费方时是
  字符串（如 "42"）。Edge kernel-store 已自行 Number() 归一；**提醒其他事件消费方（B/未来前端直连）同样注意**，
  否则游标水位比较会静默失效（字符串与数字比较恒 false/NaN）。
- `npm test`（node --test 包装 run-all）塌缩问题见 T1——同形态也可能影响其他 lane 的同名包装。
