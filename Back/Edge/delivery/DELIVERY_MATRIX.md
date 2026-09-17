# 任务三 · 受控交付矩阵（C1 边界固定）

> **交付状态（2026-09-17 收口）**：可自动化项全部执行并留证（§6）；**非作者复核门已通过并含增量复核闭环**——首轮"接受"→ 并行 writer 重写 kernel-store 后增量复核"有条件接受"（P2 一项）→ 整改（删除未声明变量）经复核代理**确认闭合，整体结论更新为"接受"**（全文见 REVIEW_BRIEF.md"复核记录"；如治理上要求 Codex 复核可另行再做）。**距"本范围受控交付通过"仍差最后一步：用户现场验收**——按 `OPS.md` 三物理终端运行 delivery-up → delivery-seed → 前端连接真实后台走贯穿场景并录屏（含 C01 非开发操作者走查、C02 三终端、C06 视觉降级、跨端录屏），结果回填 §6。
> 复核产出 7 项 P3：**全部处置完毕**——5 项随首轮整改修复，2 项遗留（T5：subscribe 游标失效显式 resync 信号、A 停止命令行 marker 第四证 + heartbeat 子进程存活校验）亦已修复并实测（E0 27/27、双 E1 1/1、delivery 四证停止走查 exit 0）；并发 writer 的 X08 修改已由本路 writer 折中裁决（保留不一致拒绝、放行剥 Origin 的 same-origin 声明），**Edge E0 复跑 27/27**（HANDOFF_DEFECTS T6）。回放/训练命名空间仍 BLOCKED（未建）。
> **C1 授权修复版集成**：并发 writer 重写 kernel-store（按身份分桶/撤权断流/提交序重查/分页直读，接入任务二决策面）——架构保留；其引入的 2 处回归（存在性泄露、settle 缺 pick 致额度区恒空）已由本路 writer 外科修复，E0 27/27 + 两支 E1 复验全绿（HANDOFF_DEFECTS T7）。
> **现场验收随行清单已备**：`ACCEPTANCE_CHECKLIST.md`（三终端连接/贯穿场景动线/录屏要求/回填字段，打印即用）。

2026-09-17。任务书：用户本轮《任务三｜把完整系统装配成可部署、可恢复、可重复演示的受控交付版本》。
本文件是任务三的 C1 边界产物：固定本轮输入版本、消费面契约、角色/资源矩阵与 C01–C12 验收映射。
"本文列出的目录和命名均为建议：执行前映射到已有实现"——所有映射以本文件为准，不建第二套事实源。

## 1｜本轮输入版本（开始时实测记录，非转述）

| 输入 | 版本/状态（2026-09-17 实测） | 任务三消费方式 |
|---|---|---|
| Git HEAD | `9c724c0`（main），60 个工作区未提交文件 = 三任务并行交付，**未获授权不 commit/push** | 版本封存以 dirty 指纹如实记录（`/versionz`） |
| 任务一·检查会话（本轮 A01–A12） | migration 003 + `A/src/domain/inspection.ts` + 25 条 `/api/v1/inspections/*` 路由已落；作者声明的 A1–A3 测试文件未在工作区出现（in-progress） | 会话操作条/核验卡按 `A/docs/INSPECTION_SESSION_V1.md` §4 接线；漂移即如实报错 |
| 任务一前作·客户授信 v2 | `A/docs/CUSTOMER_CREDIT_V2.md`：28 条 `/api/v2/*` 路由 + A01–A24 测试 48/48（其交付说明，2026-09-17） | E2E 骨干：贯穿场景的双设备/双申请/预占/Gate/重启 |
| 任务二·决策闭环（本轮 B01–B14） | migration 004（差异复核/依据包/报告视图/对象重关联）+ `A/src/domain/review.ts`/`decision-support.ts` 已落；**路由未挂载、测试未现**（in-progress） | 本轮不消费 004 面；报告区入口接检查小结接口（已挂载） |
| 任务二前作·四域 Agent/Gate | B：`fd-tools@1.0.0`、四域路由、E1+C09–C25 矩阵（82/82 记录）；C：规则包 v1.0.0（8 规则 hard_block、simulation_only）、C01–C28 矩阵、42 场景 | 经 A 目标通道间接触发；Edge 不直连 B/C；封存记录版本 |
| 上一轮任务04·Edge 骨架 | S1 版本封存/S2 SSE 语义/S3 代理+受众+审计/CSRF（27/27）、备份恢复演练 12/12、E1-D02 骨架 | 本路继承演进（Back/Edge 唯一 writer） |
| Back/CONTRACT.md | v1.3（A 路独占 writer；本轮任务二为共享契约集成 writer） | 不改写；消费面以 `Back/Edge/contract/consumed-surface-v1.json` 固定 |
| Front | React 19 + Vite 单页（六角色本地合成模拟）；**无 Unity/三维场区**（任务书前提与实现不符，如实记录：交付形态为二维页面） | 四项最小接线 + 重新构建 dist |
| 旧 48080/15432 实例 | env-check 实测**未运行**（端口空闲） | 不触碰 |

## 2｜九角色 × 客户端矩阵（C02 口径）

| 角色 | principal 目录角色 | 可由 | 自动化客户端标注 |
|---|---|---|---|
| 客户实控人 customer_owner | （客户侧无 A principal；经 Edge messages audience=customer + 会话问题回答参与） | 真人 / 明确标记 Agent | automated: customer-session 模拟客户端 |
| 厂长 plant_manager | 参与者名册 roles（会话 presence/items） | 真人（三物理终端之一） | automated |
| 客户财务 customer_finance | 同上（获准线程回答） | 真人 / Agent | automated |
| 业务 business | A 目录角色 `business` | 真人（三物理终端之一） | automated |
| 见微 jianwei | A 目录角色 `jianwei`（**无默认额度权限**） | 真人 / Agent | automated |
| 政策 policy | `policy` | Agent（确定性评估器） | automated(agent) |
| 信审 credit | `credit`（矩阵审批档位） | 真人（三物理终端之一）/ Agent 候选 | automated |
| 商务 commerce | `commerce` | Agent | automated(agent) |
| 资产 asset | `asset` | 真人 / Agent | automated(agent) |

- 正式额度动作权限由 A `permission_matrix`（服务端目录）裁决，载荷声明无效；导演总览/Unity Host/投屏账户**不是审批人**。
- 验收口径：九个独立授权客户端/服务会话 + 至少三独立物理终端；自动化客户端如实标注，**不得称九台真机/九名真人**。三物理终端与真人操作属用户现场验收（NOT_RUN 直至执行）。

## 3｜资源与端口矩阵（演示形态；env-check.mjs 只读核查）

| 资源 | 端口/标识 | 说明 |
|---|---|---|
| Front 预览（Start-JW.cmd） | 3618 | 静态 dist + 启动服务；跨机演示需以受控地址反代，**127.0.0.1 不是共享服务地址** |
| Edge（任务三交付入口） | 48200 | `/versionz`、`/healthz/*`、`/api/jw/v2/**`、`/harness/`；停止按启动标识三证复核 |
| A 内核 | 48180 | `--credit-matrix` 等政策位需显式配置（未配置 → POLICY_PENDING fail-closed） |
| PostgreSQL | 15442（jw-v01-pg 容器） | 仅 loopback；备份/恢复见 BACKUP_RESTORE_DRILL |
| C mock / Connectors | 3730 / 48100 | 可选组件；Connectors 真实提供方 BLOCKED |
| E1 测试段 | 15434 / 17919 | 隔离容器 `v7d-` 前缀 + 179xx A 端口；用后即毁 |

## 4｜前端四项接线映射（唯一清单；不新增完整产品页面）

| 任务书四项 | 落点（现有实现） | 真实数据源 |
|---|---|---|
| 会话操作条 | `home-overview.tsx` 页签条区新增窄条 | Edge session + A inspections：runStatus/start/pause/resume/end、outboundPaused=等待原因、availableActions 由服务端下发 |
| 侧栏核验卡 | `home-role-view.tsx` 待办页签扩展"核验卡"块 | workspace.openItems + next-actions（问题/证据定位/差异/需要谁行动）；后端拒绝显示原因，不自行改状态 |
| 额度/报告区 | `home-role-view.tsx` 候选倾向/条件区扩展 | exposure 桶（候选=assessment.candidate、已批准=facility、可用=availableForNewDrawMinor）、basis 版本、会后报告=summary 入口 |
| 连接/模式提示 | 全局顶条（复用 sendError 横幅模式） | Edge /healthz/ready + /versionz(buildId)、SSE 连接态；Live=真实后台，Training/本地模拟=合成 mock，Replay=未建（如实受限） |

前提差异如实声明：任务书"沿用现有工作本和三维场区"，本仓 Front 无三维场区（无 Unity/three.js 产物）——按"执行前映射到已有实现"条款以现有二维页面交付；C12 的"三维全部关闭退二维"在本形态下退化为"Edge/内核不可达时本地合成演示仍可运行、真实数据路径恢复后自动回连"。

## 5｜C01–C12 验收映射与状态

状态口径：PASS / FAIL / BLOCKED（外部授权或上游未冻结）/ NOT_RUN（本轮未执行，含用户现场项）。测试命令与退出码见 evidence 索引（交付时回填）。

| ID | 场景 | 自动化载体 | 状态 |
|---|---|---|---|
| C01 | 干净获准环境启动固定交付包 | `env-check.mjs` + 安装启动说明（C4）+ `/versionz` 核对 | 见 §6 回填 |
| C02 | 九角色独立会话 | E1 九会话自动化矩阵（automated 标注）+ 用户三终端现场（NOT_RUN） | 回填 |
| C03 | 客户/内部身份与权限分发 | Edge messages 受众审计测试（已有 E0）+ E1 逐角色拒绝断言 | 回填 |
| C04 | 快照/订阅间写入、断流乱序 | Edge SSE 语义 E0（已有 7 用例）+ E1 真实内核事件桥 | 回填 |
| C05 | 关键动作丢响应→重连回执恢复 | E1：UPSTREAM_UNKNOWN 后同 requestId 重试幂等 | 回填 |
| C06 | 三维/模型/录制分别注入降级 | 能力位逐项报告（/healthz/ready + capabilities）；三维 absent 如实 | 回填 |
| C07 | 重启 A/数据库恢复 | E1：贯穿场景中途重启内核 → 无丢失无双重效应 | 回填 |
| C08 | 隐藏答案/随机设备冲突 | 四域 42 场景 + heldout 冻结（任务二前作复跑）；Edge 无答案注入路径 | 回填 |
| C09 | 培训重置/回放 | 回放/训练命名空间未建（受限如实）；B/C 确定性重放测试复跑 | 回填 |
| C10 | 停止/回退遇未知进程/旧卷 | edge-stop 三证复核（已有）+ env-check 不强杀 + 回退手册（C4） | 回填 |
| C11 | 十轮完整流程 + 一小时协作 | 稳定性脚本（受时长限制按实际执行轮数如实报告） | 回填 |
| C12 | 三维全关走二维保底 | 前文本无三维；Edge API 直连路径 = 保底路径 E1 | 回填 |

## 6｜验收状态回填（2026-09-17 实测；证据索引见 §7）

状态口径：PASS / FAIL / BLOCKED（外部授权或上游未冻结）/ NOT_RUN（本轮未执行，含用户现场项）。
PASS 只覆盖其"自动化载体"列所述范围；真人/真机/视觉项不因自动化通过而计 PASS。

| ID | 场景 | 状态 | 证据（相对 docs/customer-next/acceptance/evidence/task3-20260917/） |
|---|---|---|---|
| C01 | 干净获准环境启动固定交付包 | PASS（编排自动化部分：up→探针→down 全绿）／NOT_RUN（非开发操作者完整现场走查，待用户） | delivery-updown.log（就绪报告+buildId 5378df5b660da525+403/200 探针+三证停止+端口归零）；env-check.json（FAIL=0） |
| C02 | 九角色独立会话 | PASS（automated 矩阵：10 会话两两不同、角色目录裁决）；NOT_RUN（三物理终端真人视角） | edge-all.log；.run/task3-e2e/connection-matrix.json → stability/evidence 目录副本 |
| C03 | 客户/内部身份、权限分发 | PASS（见微批准被矩阵 409 POLICY_PENDING；customer 角色事件流受限如实标注；AUDIENCE_MISMATCH 403+审计） | edge-all.log（E1 断言） |
| C04 | 快照/订阅间写入、断流乱序 | PASS（E0 SSE 7 用例 + E1 真实动作→SSE 事件到达 + 基线游标/去重语义） | edge-all.log |
| C05 | 关键动作丢响应→重连 | PASS（同 requestId 重放 replayed:true、账面无双重效应、回执经 Edge 可查；UPSTREAM_UNKNOWN 502 语义 E0 覆盖） | edge-all.log |
| C06 | 能力降级分别如实 | PASS（内核停→ready 逐依赖翻转+502 UPSTREAM_UNAVAILABLE；能力位逐项独立；三维 absent 如实）；NOT_RUN（前端降级视觉验收，待用户） | edge-all.log；/versionz capabilities |
| C07 | 重启 A 恢复 | PASS（杀内核→live 保持/ready 翻转→重启→会话/证据/额度/回执全恢复，幂等不重复） | edge-all.log |
| C08 | 隐藏答案/随机设备冲突 | PASS（任务二前作 42 场景 + 14 冻结 heldout 套件复跑 72/72；Edge 侧无答案注入路径——投影只回显服务端） | B/C 套件证据（本轮实测 C_SUITE_EXIT=0） |
| C09 | 培训重置/回放 | BLOCKED（回放/训练命名空间未建，如实受限）；B/C 确定性重放测试复跑绿 | Back/C rules 引擎历史回放用例（72/72 内） |
| C10 | 停止/回退边界 | PASS（edge-stop 三证既有用例；delivery-down 三证拒杀路径实测——heartbeat 过期/内容标识不符两次 exit 5 拒杀后按修复通过；env-check 不强杀）；NOT_RUN（获准环境旧卷演练，待用户） | delivery-updown.log；OPS.md §3/§5 |
| C11 | 十轮完整流程 + 一小时 | PASS——十轮：10/10；**连续一小时：142/142 轮全 PASS（60 分钟实测，exit 0，每轮独立隔离库/端口，无人工改库、无重复业务效应）** | stability 目录 stability-summary.json；task3-stability-1h 目录 |
| C12 | 三维全关走二维保底 | PASS（本交付无三维，前端即二维；贯穿场景全程 API 直连=保底路径完整，权限/额度约束不变） | edge-all.log（scenario-result.json） |

性能与质量口径（§7 任务书）：桌面 1080p 持续 30fps / 本地反馈 p95≤100ms / 跨客户端事件可见 p95≤1s 为**验收目标**。
本轮测量（perf-baseline + M4 独立测针，loopback 同机，外部提供方时延因 BLOCKED 不可测）：**M1 快照读 p95=0.33ms（目标≤500ms）、
M2 命令 p95≤0.35ms（目标≤1s）、M3 Edge 层事件可见 p95=0.44ms（目标≤1s）、M4 全链路可见性（含 A 内核 DB 提交+Edge 轮询）
p95=612ms / p50=608ms（目标≤1s，20 样本）→ WITHIN_TARGET**。1080p/30fps 属前端渲染项：本交付无三维、二维 React 页面渲染
远低于该口径的压力面，且浏览器视觉验收属用户现场项（NOT_RUN）。模型质量沿用任务二前作冻结样本（42 场景复跑 72/72 内），未新造指标。
PASS/FAIL/BLOCKED/NOT_RUN 分列如上；合成输入跑真实服务（E1）≠真实提供方连通（E2 BLOCKED）≠用户操作体验（现场 NOT_RUN），三者不互证。
公开提交扫描（D25，任务三新增凭据示例文件后复跑）：**NO_HARD_FINDING**（hard=0；REVIEW 76 项均为 Achieve 历史类，真实运行时配置已入 Git 排除）——evidence/d25-scan-20260916-185459/。

上游回归复跑（本边界内记录，非任务三自报）：

| 套件 | 命令形态 | 结果 |
|---|---|---|
| 任务一+二·A 全量（A01–A24/检查会话/决策闭环+回归，81 用例） | `node test/run-all.mjs`（隔离容器） | 首跑 **77/81（4 FAIL，在制品）→ 上游 writer 落地修复后复跑 81/81 全过 exit 0**（两次记录均存档，见 HANDOFF_DEFECTS T2） |
| 任务一 `npm test` 包装 | `npm test` | 塌缩假绿（T1，已转交 owner；不能作为全量证据） |
| 任务二·B 执行器 | `npm test` | **83/83 PASS，exit 0** |
| 任务二·C 四域/规则/Gate | `node test/run-all.mjs` | **72/72 PASS，exit 0** |
| Edge E0+两个 E1 | run-all + e1-task3-inspection + e1-task3-scenario | **27/27 + 1/1 + 1/1 全 PASS**（T6 X08 冲突已由本路 writer 折中裁决并复跑；中间态 25/27 记录见 HANDOFF_DEFECTS T6） |
| 备份恢复演练（全迁移扩展） | `node scripts/backup-restore-drill.mjs` | **PASS**（11 步，s5-drill-20260916-182846） |
| Front 测试/typecheck/build | npm test / typecheck / build | **19/19 PASS；typecheck 0 错；dist 已重建** |

## 7｜证据索引（task3-20260917/）

- `a-suite-full.log` / `a-suite-final.log` — A 全量直跑（修复前后两轮记录）
- `edge-all.log` — Edge E0 + 检查会话 E1 + 贯穿场景 E1
- `delivery-updown.log` — 交付编排真实启停走查（up→探针→三证停止→端口归零）
- `env-check.json` — 环境检查机器可读结果
- `stability-copy/` — 十轮汇总 + 连接矩阵 + 场景结果副本
- 连续一小时：`task3-stability-20260916T194943/`（142 轮逐轮日志 + stability-summary.json，142/142 PASS）
- 性能：`perf-baseline-20260916-190035/`（M1–M3）与 `perf-m4-20260916T194844/`（M4 全链路 p95=612ms）
- 版本封存：`s1-*/version-seal.json`（version-seal.mjs --probe 最新输出）
- D25 扫描：`d25-scan-20260916-185459/`（NO_HARD_FINDING）
- 转交缺陷：`Back/Edge/delivery/HANDOFF_DEFECTS.md`；复核移交：`Back/Edge/delivery/REVIEW_BRIEF.md`
