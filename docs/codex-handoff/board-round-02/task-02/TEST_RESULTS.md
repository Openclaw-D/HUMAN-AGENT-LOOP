# 任务02 · 测试结果（board-round-02）

日期：2026-09-19。环境：已登记独立 PG 资源——`jw-connectors-pg`@127.0.0.1:15443（cnext/cnext/cnext，
Connectors 测试库）与 `jw-cc-kernel-pg`@127.0.0.1:15444（jwcc，A 管理库），运行前逐一核对凭据与
README/TEST_PLAN 登记一致；`jw-v01-pg`@15442 未触碰。A 内核以真实进程参与（node src/index.ts，
Node 22.23）。证据日志：`.local/task02-round2/`。

## 结果总表（执行者自验；用户验收未发生）

| 套件 | 命令 | 结果 | 日志 |
|---|---|---|---|
| Connectors 全量 | `npm test`（Back/Connectors） | **88/88 PASS，0 skip，0 fail** | connectors-full-test.log |
| 本路链路（真实 A 内核） | goal02-link-chain.test.mjs | **6/6 PASS** | goal02-link-chain.log |
| 等待态语义与恢复 | goal02-blocked-recovery.test.mjs | **3/3 PASS** | goal02-blocked-recovery.log |
| actor 与归属（新增） | goal02-actor-trust.test.mjs | **2/2 PASS** | goal02-actor-trust.log |
| Back/C 回归（适配器改动） | `npm test`（Back/C run-all） | **101/101 PASS** | （终端运行） |

## 任务书六类真实回执证据 → 测试映射（全部 PASS）

| 要求场景 | 覆盖用例 | 关键断言 |
|---|---|---|
| 正常新客户全链 | L1 | 零配置首传：A 权威同 ID 核验自动接通 → done + aRegistered=true + A 材料恰 1 份，linked_by=auto_authoritative_same_id |
| 第二客户伪造 | L4 + T2 | 借他人邀请上传 → 403 CUSTOMER_MISMATCH 零落库；借材料录入/借事实更正 → 403 零副作用；预览归属不一致 → 403 |
| A 停机恢复 | R1 + L5 | A 未配置 → blocked_a_unavailable（游标保留）→ A 上线 sweep 重入全链完成；parse 段崩溃 → 重启同库续跑 → done，A 材料恰 1、事实零重复 |
| 响应丢失 | P09（全量内） | A 材料登记超时 → blocked_unknown → 回执对账恢复续跑，材料 POST 恰一次（不换 ID 重发） |
| 同号重试 | L3 + R1 | 同字节同声明元数据重复上传 → skipped_duplicate，A 无双份材料；a_links requestId 零重复（幂等） |
| 扫描件人工转录/获准复核 | L6 + T1 | 人工录入转录 → Gate NEEDS_EVIDENCE→HOLD_FOR_REVIEW（压力门命中）→ A 侧 Gate 回执逐次递增 → 更正回落；核验升级受 actor 代理权约束 |

## 修复记录（本轮发现并修复，均有测试钉住）

- L5 根因①：tick 循环同 tick 重认领回队任务 → 测试改 maxTasks=1（保持崩溃窗口）。
- L5 根因②：hookAfterStage 先于游标推进 → coordinator 改为游标先行（"段后"语义诚实化）。
- L6 根因：CSV 声明表值列吞并 unit/caliber 列 → Back/C 适配器表头感知提取；修复后压力覆盖率
  真实计算，Gate 依冻结规则包（nonWaivable=false）为 HOLD_FOR_REVIEW 而非 HARD_BLOCK——
  测试期望按规则包修正，未改任何制度阈值。
- correct-fact 500（artifact_id 列不存在）→ 取 from_artifacts[0]。

## NOT_RUN / BLOCKED（不计 PASS）

- 真实页面办理（浏览器级）：NOT_RUN——属 04 路装配 journey，需按新语义复跑。
- 真实企微/TRTC/真实 GLM/生产部署：BLOCKED（未授权，设计内恒关闭）。
- A 侧套件（03 路所有权）：本轮未跑。
- 并行轮次隔离容器变体（CONNECTORS_TEST_PG_PORT 覆盖场景）：NOT_RUN（本轮单轮次执行）。
