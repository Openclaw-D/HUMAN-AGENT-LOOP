# 任务01 实现报告 · 客户授信内核（S2+S3+S4）

2026-09-17。执行者：ZCode。输入：`JW_customer_credit_backend_tasks/01_CUSTOMER_CREDIT_KERNEL.md` + 同包 00_READ_FIRST；本地 HEAD `9c724c0`（origin/main=`5497576`，本地落后 2 提交未同步——属分支变更需授权，未执行）；S0/S1 文档为本任务前序会话产物，本轮复核与实况一致后沿用。

## 1. 实际修改文件（全部在授权范围 `Back/A/**` 与任务书指定的 `docs/customer-next/`）

新增：
- `Back/A/migrations/002_customer_credit.sql` — 客户/关系/工件/事实/评估/额度/融资申请/账目/决定/权限矩阵/v2 幂等表 + projects.customer_id + outbox_events.customer_id
- `Back/A/src/domain/credit.ts` — v2 命令面（约 1,300 行）
- `Back/A/test/customer-credit.test.mjs` — A01–A24
- `Back/A/test/ledger-property.test.mjs` — 固定种子属性测试
- `Back/A/docs/CUSTOMER_CREDIT_V2.md` — 实现说明/运行方式/与 S1 提案差异
- `docs/customer-next/IMPLEMENTATION_REPORT_TASK01.md`（本文件）

修改（行为差异全部向后兼容）：
- `src/config.ts` — principal 第 5 段租户范围（缺省 'all' 保持 v1）；4 个 v2 政策启动参数
- `src/domain/principal.ts` — Principal.tenants + authorizeTenant
- `src/domain/errors.ts` — 13 个 v2 错误码（纯新增）
- `src/domain/kernel.ts` — v2 命令面挂接 + health 增加 contractVersion/creditPolicy 字段（加法）
- `src/http/server.ts` — 26 条 `/api/v2/**` 路由（纯新增）+ frame 注入 `__path`（v1 幂等哈希显式剔除，行为不变）
- `test/utils.mjs` — `JW_A_ADMIN_DB_URL` env 参数化（缺省旧 15432 不变）+ createTestDb URL 派生 + startKernel 可选 principalSpec
- `test/run-all.mjs` — ping 用同一 env
- `test/integration-crash.test.mjs` — 容器重启用例须经 `JW_A_TEST_PG_CONTAINER/JW_A_TEST_PG_ISREADY` 显式指定，未设置时 **skip**（不再盲重启 v7next-a-pg——修复了"跑全量会重启旧共享容器"的历史风险）

未触碰：Back/B、Back/C、Back/D、Back/Edge、Back/Connectors、Front、Back/CONTRACT.md、Achieve、旧容器与 48080 遗留进程。

## 2. 资源与边界

- 本任务新建并持有：Docker 容器 `jw-cc-kernel-pg`（127.0.0.1:**15444**，卷 `jw_cc_kernel_pgdata`）。15443 已被任务02 的 `jw-connectors-pg` 占用，故另选端口；未动 `v7next-a-pg@15432`、`jw-v01-pg`、Dify 系列。**收口状态：容器已按 jw-v01-pg 先例干净停止、卷保留**（复跑：`docker start jw-cc-kernel-pg` + §4 env）。
- 会话期间环境发生两次 Docker Desktop 引擎关停（三个 PG 容器同时 Exited(0)，非本任务操作；48/48 全量是在引擎存活窗口内完成并留有退出码 0 记录）。本任务仅重启过自己的容器。
- 测试收口核验：15444 上无残留测试库（`v7next_a_test_*` = 0 个）；测试拉起的内核子进程全部随套件退出；3 个 node 进程（21496/18452/2536）为任务开始前即存在的旧树遗留，未触碰。
- 无 Git commit/push/分支操作；无真实密钥、真实资金接口、真实模型调用。

## 3. 命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck`（Back/A） | 0 | 0 错误 |
| `node --test --test-concurrency=1 test/customer-credit.test.mjs`（JW_A_ADMIN_DB_URL=15444） | 0 | 24/24 pass |
| `node --test --test-concurrency=1 test/ledger-property.test.mjs` | 0 | 1/1 pass（seed=20260917，120 步） |
| `node test/run-all.mjs`（含 JW_A_TEST_PG_CONTAINER/ISREADY 指向 jw-cc-kernel-pg） | 0 | **48/48 pass / 0 fail / 0 skipped**（v1 回归 23 + v2 24 + 属性 1），耗时 ~73s |

## 4. 测试覆盖 → 任务书 §8 全表

A01 两渠道合并约束+新建项目零额度 ✅｜A02 同名不同企业/同主体拒重 ✅｜A03 联系人不合并 ✅｜A04 100 重复材料去重 ✅｜A05 有利转不利可降级暂停 ✅｜A06 上限+1分/币种单位明确/跨币种拒 ✅｜A07 900万占用并发两笔80万恰一成功 ✅｜A08 100 并发同 requestId 单效应 ✅｜A09 同键异载荷冲突零副作用 ✅｜A10 跨租户读写/事件/回执全拒+匿名拒 ✅｜A11 响应丢失重放原效应 ✅｜A12 unknown 不盲发不自动释放、对账后恰一出账 ✅｜A13 重复结算幂等 ✅｜A14 暂停与支用提交点裁决 ✅｜A15 依据更新后批准 STALE_BASIS（含并发竞态两侧）✅｜A16 降额保敞口显超额禁新增 ✅｜A17 非循环还款不恢复 ✅｜A18 候选金额合法但 authority=none 无激活通道 ✅｜A19 假角色拒绝+审计无秘密 ✅｜A20 发票/合同冲突双留痕 ✅｜A21 rejected 不映射通过 ✅｜A22 迁移中断回滚+重复运行零副作用 ✅｜A23 业务与 outbox 同事务、恢复补投、eventId 幂等 ✅｜A24 多子额度受主上限+关联组集中度约束 ✅｜属性测试：金额守恒/占用≤批准额/无负桶/无非法跃迁/重放零效应 ✅

## 5. 已知失败 / 未测依赖 / 不在通过范围

- 已知失败：无（本轮 48/48）。
- 未测依赖：真实业务规则（矩阵/集中度均为合成 dev 版，明确非公司制度）；生产身份；真实资金/银行接口（P-07 仅受控模拟适配器）；企微/视频通道（任务02/03 范围）；第二客户端仅为进程内独立 HTTP 客户端（不同凭据、独立连接），非第二台机器。
- 遗留门：v1.3 `staleReviewAck` 业务政策 PENDING-USER-RULING 未动；本地 main 落后远端 2 提交（V0.2 基线文档），同步需授权；A 历史"全量测试硬编码 15432"已参数化修复，但旧容器自身仍未被本任务触碰。

## 6. 下一阶段允许范围（对齐总控 §四）

- 01 代码收口后交 Codex 只读独立验收；共享契约（Back/CONTRACT.md）v2 章节由总控单 writer 汇入。
- 02/03 可按本内核暴露的 v2 契约冻结接口（Connectors 直写业务表仍被禁止，须经受控登记 API）。
- 04 的 BLOCKED(01) 场景（D07/D12/D14/D15/D23/D28）已具备 E1 依赖，可安排集成轮。
- 未授权前不 commit/push、不同步远端 main、不停止任何遗留进程。
