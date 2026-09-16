# 见微 V4 验收 Gate —— v4life 四域后端垂直切片

状态：`P1-BE-01 FUNCTIONAL_CANDIDATE_ACCEPTED / P1 PRODUCT ACCEPTANCE OPEN / PRODUCTION NOT READY`

## 0｜当前真相分层（2026-09-04 晚，P1-BE-01 后）

- **Codex 当前裁决（22:00）**：独立复跑 P1 focused **31/31**、full **574/574**、HTTP quality **27/27**、typecheck/lint/build 全绿，localhost canonical API、`/work`、`/work/screen` 均为 200；本次后端功能 Candidate 接受。该裁决不冻结 P1 产品语义，也不等于生产就绪。
- **持久化边界**：文件 event log + command journal 的故障注入与失败关闭通过，但两者仍无原子事务。journal 写失败后跨重启的 work/decision 以状态规则阻断重复，并不保证返回原 accepted response；生产必须补事务数据库/唯一约束，不得宣称 exactly-once transaction。
- **未完成的端到端面**：P1 核验与 Context window 命令尚无 HTTP 路由；精确 Human Role、最终主风险、stale 阈值、自动封存/重开、正式核验 Receipt 与合成 seed 仍待用户裁决。
- **Codex accepted（历史）**：2026-09-04 13:38 `FUNCTIONAL_CANDIDATE_ACCEPTED / COMPLETE_DOD_NOT_PASSED`，对应 P0 后端切片 + correction checkpoint。**该验收对应的代码已被本轮修改**（P1 隔离 + journal 加固），按 Control Channel Rev 0003 须重新裁决，不得外推为对当前代码的接受。
- **当前复验（ZCode，本轮变更后实测）**：full test **574/574**、P1 focused **31/31**、v4life+work focused **190/190**、HTTP quality **27/27**、typecheck **0**、lint **0**、build **完成**；3100 验收服务以当前构建重启，canonical API / `/work` / `/work/screen` 均 200。逐项证据见 `BACKEND_PROGRESS.md` P1-BE-01 节与 `ZCODE_RUN_STATUS.md` 当前快照。
- **Candidate（未接受，默认路径已隔离）**：全部 P1 语义（Evidence §5 扩展字段、核验命令/事件、收集窗口、InputEvent、Risk Thread、`/work/screen`）保持 `CANDIDATE / NOT ACCEPTED`；其中精确 Human Role、自动封存、初始化隐含批次已通过 `p1CandidateSemantics` 开关退出默认正式权威路径（默认 strict 失败关闭 + `'NONE'` 空窗口；demo 显式 opt-in）。`P1_GOLDEN_CASE_CONTRACT.md` 仍为 `SCENARIO FROZEN / CONTENT CANDIDATE / USER ACCEPTANCE OPEN`，§11 七项待用户确认。
- **契约漂移已解决（Codex 22:00）**：`CONTRACT.md` §15/§16 已补记 `p1CandidateSemantics`、`'context_batch'` journal 类别、rev 一致性守卫与 `'NONE'` 空窗口，并保留非原子事务边界。
- **代码完成、测试数量和模型自报不等于产品接受**；用户拥有每个 checkpoint 与最终交付的接受权。

上位权威：工作区根部 `NORTH_STAR.md`、`DECISIONS.md` 与 `ROADMAP.md`。
执行书：`docs/v4/ZCODE_BACKEND_GOAL.md`（只读，§8 Definition of Done 为本 Gate 的验收清单）。
共享契约：`docs/v4/CONTRACT.md`（`FROZEN FOR THIS SLICE / 2026-09-03`）。

> 2026-09-04 对账更新：下文 §1–§5 的“部分达成/待整合复跑”均为 Lane D 整合前快照，只作历史 Evidence；当前真相仅以 §0 和本文后续 P1-BE-01 记录为准。

本文件由 Lane D（对抗验收）重写，把执行书 §8 DoD 的 7 条逐条映射到证据来源与当前状态。证据只来自可复跑的测试文件、脚本与命令；模型自报不作为证据。

## 1｜DoD 逐条映射（执行书 §8）

| # | DoD 条目 | 证据来源 | 当前状态 |
| --- | --- | --- | --- |
| 1 | `CONTRACT.md` 不再是空壳，准确描述本切片真实能力和未实现边界 | `docs/v4/CONTRACT.md`（§1–§12 exact contract、§11 Golden fixture、§13 未实现边界） | **达成**（本切片冻结版已含真实能力与边界，未实现边界见本文 §4） |
| 2 | 四域核心证明点均有自动化断言：跨域并行、硬等待、Human Gate/Receipt、否决停止且贡献保留 | `test/v4life-lane-d-adversarial.test.mjs`（缺失依赖硬等待 #15、否决级联保留 #16、退回重做 #17、Candidate 不越权 #18；跨域并行由 Lane A `test/v4life-kernel.test.mjs` 覆盖） | **达成（2026-09-04 整合后复跑）**：Lane A 新引擎落地后 #15–#18 全部通过 |
| 3 | 幂等冲突、乐观并发、角色权限、错误映射、事件分页与重放均有测试 | 同文件：幂等 #9–#11、同键异载荷 #12/#13、并发 #14、越权 #1–#5、乱序 #6–#8、分页 #21/#26、重放 #20、深克隆 #22；`scripts/v4life-http-quality.mjs`（错误映射 S2 矩阵） | **达成（整合后复跑）**：幂等/同键异载荷 IDEMPOTENCY_CONFLICT/EVIDENCE_CONFLICT/版本竞争/分页/重放/深克隆全部通过 |
| 4 | Route Handler 集成测试覆盖成功、重放、拒绝和失败关闭 | `test/v4life-lane-d-adversarial.test.mjs` HTTP 块（#23–#26，进程内 `new Request` 调用，不起服务）+ `scripts/v4life-http-quality.mjs`（S1 健康路径 / S2 失败矩阵 / S3 幂等重放） | **达成（整合后复跑）**：成功/重放/403/409/404/400 全部通过；另 `scripts/v4life-gate.mjs` 一键门禁 3/3 |
| 5 | `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build` 全部通过 | Codex 2026-09-04 22:00 独立复跑 | **达成（当前代码）**：574/574；typecheck/lint 0；build complete |
| 6 | `BACKEND_PROGRESS.md` 列出实际 diff、四路 ownership、运行过的命令、结果、未验证项和下一适配点 | `docs/v4/BACKEND_PROGRESS.md`（本切片新建） | **达成**（内容随整合阶段更新） |
| 7 | 未修改禁止范围，未留下真实凭据、运行中服务或被隐藏的失败 | Lane D 仅写入 4 个授权文件（`test/v4life-lane-d-adversarial.test.mjs`、`scripts/v4life-http-quality.mjs`、`docs/v4/ACCEPTANCE.md`、`docs/v4/BACKEND_PROGRESS.md`）；脚本进程内执行不启动服务；无凭据；失败全部如实列出（§2） | **达成**（以主 Agent 整合阶段复核为准） |

## 2｜本切片运行证据（Lane D 实测 2026-09-03）

环境：Node v22.23.1，Windows（Git Bash）。按派发协议运行与重试（等待 60 秒后复跑一次，结果一致）。

| 命令 | 结果 |
| --- | --- |
| `node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-lane-d-adversarial.test.mjs` | 26 tests：**10 pass / 16 fail** |
| `node scripts/v4life-http-quality.mjs` | 27 steps：**5 pass / 22 fail**（退出码 1） |

已通过项（代表）：全部越权 ROLE_MISMATCH（引擎+HTTP 两途径中的引擎途径）、乱序 409 状态机、appendEvidence 幂等重放、缺失依赖硬等待、Candidate 不越权、HTTP 404 CASE_NOT_FOUND 与 400 INVALID_ENGINE_INPUT 失败关闭 envelope。

失败项归属：**16 个测试失败与 22 个脚本步骤失败全部同源**——`lib/v4life/engine.ts`（连同 `types.ts`/`seed.ts`）仍为契约冻结前的旧 candidate（未含 `commandId/expectedRev/rev`、无 conflict 错误码、事件/Projection 形状为旧版）。Lane B（`event-log.ts`/`replay.ts`）与 Lane C（`http.ts`/`runtime.ts`/routes）已按契约落地，Lane D 对 `rebuildProjection` 注入契约形状事件的独立探针通过。逐项缺陷清单见 `docs/v4/BACKEND_PROGRESS.md` §4。**这些失败属于“lane 未完成（待整合复跑）”，不是已落地 B/C 代码的契约违例**；若 Lane A 新引擎落地后对应用例仍失败，再升级为契约违例记录。

## 3｜未验证项（历史整合前快照，已被 §0 当前裁决覆盖）

- `npm.cmd test`（全量）、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build`——由主 Agent 整合阶段统一执行（DoD #5）。
- 本文件 §2 列出的 16 + 22 个失败项——待 Lane A 引擎按契约落地后复跑（命令同 §2）。
- Lane A/B/C 自有测试文件的最终清单与结果——待整合阶段汇总（`test/v4life-kernel.test.mjs` 现仍断言旧幂等行为，须随新引擎更新，否则与契约 §6 `EVIDENCE_CONFLICT` 冲突）。
- 真实浏览器与 E2E（原 A3 Gate）——不在本后端切片范围内，未开始。

## 4｜未实现边界（历史切片快照；当前边界见 §0 与 CONTRACT §15–§16）

进程内内存实现（重启即失）；无认证体系/RBAC/租户隔离（仅有角色-权限校验语义）；无真实模型调用（Candidate 全部确定性规则）；无生产数据库/部署；无多 case 工厂；无前端交付。生产试点需要事务数据库或持久事件账本、唯一约束、认证/RBAC、审计与保留策略。

## 5｜A4｜用户最终接受（原样保留）

- 灰阶图、视觉实现和决赛 PPT 都必须在对应前置 Gate 通过后进入；
- **代码完成、测试数量和模型自报不等于产品接受**；
- 用户拥有每个 checkpoint 与最终交付的接受权。

## 2026-09-04｜最终状态（主 Agent 收口）

| DoD | 证据 | 状态 |
| --- | --- | --- |
| 1. CONTRACT 非空壳 | docs/v4/CONTRACT.md §1–§14 | 达成 |
| 2. 四证明点断言 | kernel #2–#5、extension 全链路、lane-d #15–#18 | 达成 |
| 3. 幂等/并发/权限/分页/重放 | kernel #6–#10、lane-b 10/10、lane-c、quality S2/S3 | 达成 |
| 4. Route 集成 | lane-c 21/21 + quality 27/27 | 达成 |
| 5. 全量 Gate | test 494/496；typecheck 0；build complete；lint 2 legacy（排除面文件） | 达成（2 项排除面遗留如实上报） |
| 6. BACKEND_PROGRESS | 本文件 + BACKEND_PROGRESS.md 2026-09-04 追加段 | 达成 |
| 7. 无越界/无凭据/无隐藏失败 | L15/L16 审计 + 本轮修复记录 | 达成 |

浏览器 E2E：见 `evidence/workspace/01–04` 截图与 BACKEND_PROGRESS 追加段；happy path 经真实 UI 全程驱动至 AG-1 Receipt。
代码完成 ≠ 用户接受：本切片为 Candidate，等待 Codex/用户验收。
