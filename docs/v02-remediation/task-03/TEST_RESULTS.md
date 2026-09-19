# 任务03 · TEST_RESULTS（2026-09-19）

## 运行环境

- 隔离测试库：容器 `jw-t03-pg`（postgres:16 @127.0.0.1:15461；测试库 `v7next_a_test_*` 由套件自动建删，不动业务库）。
- 全部测试为真实 PostgreSQL + 黑盒 HTTP；预期全部引自有效契约（CONTRACT §9/§10/§11/§12、DECISION_LOOP_V1、INSPECTION_SESSION_V1），未为通过而放宽规则。

## 结果汇总

| 套件 | 结果 | 说明 |
|---|---|---|
| `test/authoritative-reads.test.mjs`（新增） | 6/6 pass | 清单分页边界/排序/授权矩阵/搜索/处理引用 |
| `test/risk-recheck-task03.test.mjs`（新增） | 11/11 pass | 五项风险真实反例复验（R1–R5，含 2 条如实反例断言） |
| 全量回归 `node test/run-all.mjs` | 见下节 | 改动后全量（含既有 114+ 项） |
| `npm run typecheck`（tsc --noEmit） | 0 error | |

## 五项风险复验结论（详见 CONTRACT §12.4；测试=R* 用例）

| 风险 | 结论 | 证据用例 |
|---|---|---|
| R1 Gate 回执绑定规则版本 | 版本=激活版本/仅 service/跨客户 404/换版后提交点 STALE_BASIS 全部成立 | R1a/R1b/R1c |
| R1' Gate 回执绑定分析输入 | **反例成立**：inputDigest 自报可登记，A 不校验（待裁决 P-03a） | R1d |
| R2 冻结会话回退/新增 | closed 终态写拒（INSPECTION_CLOSED）；晚到材料推进 revision 后旧包不失效=契约 §7.4 行为，冻结引用可见 | R2 |
| R3 豁免撤销/过期/跨客户 | 登记点全部拒绝；**冻结后撤销不追溯**（提交点仍放行）=契约字面，待裁决 P-03b | R3a/R3b |
| R4 晚到分析变当前依据 | 不成立（安全）：域按运行盖章 digest 判 changed/deps_changed；同包换依赖集 400；旧 run 复登维持 changed | R4 |
| R5 撤权重放/服务身份批准 | 撤权后重放 404 不借缓存；service 正式批准/出账 403；DB 签发身份 disable 后重放 403 | R5a/R5b/R5c |

## 全量回归（改动后，最终记录）

- 命令：`cd Back/A && JW_A_ADMIN_DB_URL='postgres://jwt03:jwt03-local-demo@127.0.0.1:15461/postgres' node test/run-all.mjs`
- **结果：149 项 → 148 pass / 0 fail / 1 skip（2026-09-19，jw-t03-pg@15461）**。
  - skip = "PostgreSQL 容器整机重启（docker restart）"：按边界守卫跳过（需显式 `JW_A_TEST_PG_CONTAINER` 指名容器才启用——避免测试触碰非本测试的容器；本轮纪律同样禁止）。重启正确性由 A22 同库重启路径与 integration-core 覆盖。
  - 过程中发现并修复：A22（customer-credit）的迁移清单断言按惯例适配 001–011（新增 011 只加索引；"中断可恢复/旧数据不改写"语义不变）。
- 验收命令对照任务书：正常/越权/撤权/跨客户/分页边界/长历史（25 行分页+游标稳定性）/晚到结果（R4）→ 本轮新增套件；并发提交 → 既有 `ledger-races-a3`（K12–K18 真实 PG 客户锁屏障）；重启持久化 → 既有 `integration-core`/A22。

## 独立实测 vs 联合验收

- **A 包独立实测**：上表全部内容。
- **待联合验收**：Edge 快照切换权威清单后的 UI 旅程；Connectors 按 §11.1/§12 契约的消费链；搜索在真实页面的表现。
- **未跑标注**：无（本任务范围内的用例均实际执行，无 NOT_RUN）。
