# goal-01 基线与认领（2026-09-18 04:26+0800）

## 认领声明

本会话认领**路径 01**（Back/A/**、A 迁移与依赖、Back/CONTRACT.md、docs/product-delivery/goal-01/）。
观察到另一并行 writer 会话正以路径 04 身份工作（04:24-04:25 写入 docs/product-delivery/goal-04/ 六文件；
04:20:28 分支切换 reflog 与其发布装配职责一致）。本会话不读写 goal-04 目录，不与其争抢共享文件；
跨路需求按任务书写各自 INTERFACE_REQUESTS.md。

## 实际基线（按任务书"基线和执行纪律"记录）

- **分支/HEAD**：`v02-goal1234-delivery` @ `e4ed7a5`（goal-01~04 四轮联合交付）。该切换发生于本会话启动后
  （reflog 04:20:28，moving from main to v02-goal1234-delivery），非本会话所为；本轮基线即为该分支，
  本会话不做任何切分支/commit/push 操作。
- **main @ 1ec0ee4** 为该分支的直接父提交；两分支差异 = goal 四轮交付（A 内核豁免登记迁移008/设备对象匹配/
  性能收口、C 解析适配器、Connectors 持久处理协调器、Edge 工作台、docs/backend-upgrade 证据），PR#4 已推
  origin、**未合并、未经用户验收**。本轮产出如何与 main 合流（merge PR#4 或新 PR）留用户裁决。
- **脏文件**：仅未跟踪 `JW_product_delivery_four_tasks/`（任务书，MANIFEST 含 sha256）与
  `docs/product-delivery/`（本轮各路文档，goal-04 由并行会话写入中）。
- **任务书**：`JW_product_delivery_four_tasks/`（00_START_HERE、01..04 分任务、
  FOUR_TASKS_COMPLETE=超集、MANIFEST.json）。本路以 01_CORE_AND_LEASING_BOUNDARIES.md + 总书共同标准为准。
- **共享契约**：Back/CONTRACT.md v1.3 + §8(v2.1 决策闭环/检查会话) + §9(v2.2 A1/A2/A3) + §10(v2.3 豁免登记制/
  对象锚定/性能)。全量回归基线 114/114（jw-goal01-pg@15446）。
- **既有边界事实**（读本轮代码核实）：A = v1 内核（templates/projects/goals/evidence/claim/complete/accept/
  decide/outbox）+ v2 客户授信域（customers/grants/artifacts/assessments/candidates/submit-review/decide/
  facilities/financing-requests/reserve/release...）+ 检查会话域 + 依据包/发现/Gate 回执/分析运行/必需域政策/
  台账两层去重/提额请求/豁免登记。Connectors 有 evidence/a_register.mjs（A 登记桥）与 processing/coordinator.mjs
  （持久处理）。Edge 为 /api/jw/v2 BFF（workspace/events/actions/messages/receipts/audit + CSRF/会话）。

## 本路测试资源（隔离登记）

- PG：`jw-goal01-pg@15446`（jw-goal01/jw-goal01，pg16，**已在运行**）；A 测试工具自选随机 API 端口+独立库。
- 不动：jw-cc-kernel-pg@15444、jw-connectors-pg@15443、jw-v01-pg@15442、v7d-pg-4a0850f79d@15433（未知归属）、
  goal-04 段（15438+17923 / 15439+17927）、任务03 段（15436/17921）。

## 此前缺陷处置起点

goal-04 轮遗留 DEF-G04-01/02/09/10 与 D27-R BLOCKED 属路径 04 域，由其处理；本路在 A 域内如遇关联
（如 E1 对 A 接口消费缺陷）在 INTERFACE_REQUESTS.md 登记，不代修 04 文件。
