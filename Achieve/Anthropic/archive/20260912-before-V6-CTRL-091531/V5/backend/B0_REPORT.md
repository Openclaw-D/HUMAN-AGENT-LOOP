# B0_REPORT｜V5 后端 B0：现状复验、协议核验、接口 Candidate、基线清单

状态：`B0 COMPLETE_CANDIDATE · Rev1（按 B0_CODEX_REVIEW 完成候选修订后再交独立检查；未放行 B1，未写任何代码）`
`controlRevisionRead`：ZCODE_BACKEND_TASK.md（2026-09-06）＋ V5/DECISIONS.md ＋ V5/CONTRACT.md ＋ 根部 DECISIONS/NORTH_STAR（V5-RISK）。
生成：2026-09-06，ZCode 主会话（原生命生成分工：2 个只读研究 lane + 主控串行写入）。B0 期间 site 仓库零代码写入、零 git 操作、未动 3100/3101 服务、未操作/联系 Codex。

## 1｜交付物索引

| 文件 | 内容 |
| --- | --- |
| 本文件 | 状态、实测、能力→缺口→最小改动→验证矩阵、未决项、停止点 |
| `B0_INTERFACE_CANDIDATE.md` | 消息身份、差异化 packet、状态机、API、ownership、B1 精确写面与兼容策略 |
| `B0_BASELINE_MANIFEST.md` | 基线分类、用户改动归属待确认、非 Git 数据边界、恢复方案（未 commit/tag） |
| `evidence/B0/` | `gates-20260906.txt`、`full-test-20260906.txt`、`http-quality-20260906.txt`、`git-snapshot-20260906.txt`、`git-snapshot-20260906-rev1.txt`（Rev1 新增复核快照）、`sources-protocol-research-20260906.md`、`synthetic-event-example.md` |

## 2｜实测（环境 Node v22.23.1 / Windows / Git Bash；HEAD 63c41c3；79 dirty entries；退出码均为真实捕获）

| 检查 | 命令 | 结果 | 退出码 |
| --- | --- | --- | --- |
| 全量测试 | `npm.cmd test` | **612/612，0 失败**（含 v4life 全系 + ENG01 verification/recovery） | 0 |
| typecheck | `npm.cmd run typecheck` | 无错误 | 0 |
| lint | `npm.cmd run lint` | 0 问题 | 0 |
| build | `npm.cmd run build` | Build complete（vinext） | 0 |
| HTTP quality（进程内，无需起服务） | `node scripts/v4life-http-quality.mjs` | 27/27 | 0 |
| HTTP quality 运行方式核实 | 读 scripts 源 | 纯进程内 handler 调用，无网络监听 | — |

历史 612/612 属实测复验结果，**不构成**对 V5 目标的通过声明（任务书 §已查到基础 同义）。检查未修改任何受控文件；build 产物仅入忽略目录。

## 3｜模块精确核对结论（"当前能力→缺口→最小改动→验证"矩阵）

| # | 能力 | 当前状态（文件级实测依据） | 缺口 | 最小改动 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| 1 | 任务身份与幂等 | caseId+rev（事件账本 append 条件写 SEQ_CONFLICT，event-log.ts:80）、commandId 幂等 + durable journal（engine recordAcceptedCommand + command-journal.ts，重启恢复实测） | 无协作任务对象；无 message/context 关联链 | CANDIDATE 类型 CollaborationTask/CollabMessage，eventId 复用 case 粒度（interface §1） | 单测 + HTTP（lane-c 模式） |
| 2 | 依赖推进/角色/退回否决 | 依赖三分法 + ROLE_MISMATCH + returned/否决级联（engine.ts applyEvent，26 项对抗测试绿） | 跨域协作任务不在其管辖 | additive 事件与闸门（`collabSemantics:'off'` 默认，P1-BE-01 先例） | 既有 612 零回归 + 新 focused |
| 3 | 差异化输入 | **无**（engine 只有 Evidence/命令，无 packet 概念） | 按职责裁剪的 packet 组装器 | `collaboration/packets.ts` 纯函数（读 Projection + 域职责表） | 纯函数单测（sharedFacts 一致 + 职责差异断言） |
| 4 | 消息往返/去重 | 无 | 往返消息 + messageId 去重（A2A 仅 MAY） | additive 消息命令族 | HTTP 边界 + 重复投递不重复产工（B1 测试 3） |
| 5 | 人输入/纠偏/版本 | P1 有 INPUT_EVENT + context batches（M.m）但属收集窗口语义，非协作纠偏 | 纠偏→新版本→受影响任务隔离→未受影响保留 | correction 事件 + contextVersion + superseded 判定 | 故障注入（晚到结果隔离，B1 测试 4） |
| 6 | 持久/恢复 | 内存 + 文件事件账本（JSONL append-only、逐行失败关闭，file-event-log.ts 实读）+ journal 恢复 + rebuildProjection | 协作对象须全量事件化 | 全部协作状态走事件账本 | 重启恢复测试（persist-runtime 模式，B1 测试 7） |
| 7 | 权威边界 | authority='none' 候选校验 + Human Gate/Receipt（engine validateCandidateObject；lane-d 对抗绿） | Agent 结果→Candidate→Gate 的提交通道 | `submit_candidate` additive 命令，正式化复用既有 Gate | B1 测试 5（不得伪装人批准） |
| 8 | 并发冲突 | expectedRev VERSION_CONFLICT（已实测） | 候选级冲突解释 | 沿用 expectedRev + additive 错误码 | B1 测试 6 |
| 9 | 订阅/投影 | SSE `/events/stream` + Projection（events-stream 测试绿） | 协作任务可视投影（谁在做/等什么/下一行动者） | 投影 additive 扩展 | SSE + 投影测试（B1 测试 9） |
| 10 | A2A 线协议 | 无 | Agent Card/SendMessage 映射 | B1 可选兼容层（不阻塞内部 API；社区 TS SDK 引入属用户依赖 Gate） | 跨框架互通为后续 Gate |

诚实边界（实测确认，非推断）：单进程演示态；事件/命令日志非原子事务（P1-BE-01 故障注入已固化"失败关闭 + 幂等按可用账本最大恢复"边界）；演示角色非生产认证；未接真实模型。

## 4｜协议核验摘要（详见 evidence/B0/sources-protocol-research-20260906.md）

- **A2A**（Linux Foundation，最新 Release v1.0.1 / 2026-05-28；规范文本 v1.0.0，commit f63dbb4 2026-08-28；v0.3.0 类型源对照）：任务身份、消息往返、状态枚举（含 INPUT_REQUIRED "interrupted state"）、幂等取消、SSE 订阅/重订阅、push notification 均为**标准原生**；断线补发语义、恢复执行、messageId 幂等保证（MAY）为**实现层**。→ 采用其对象命名与语义，不自造第二套。
- **Microsoft Agent Framework**（SK/AutoGen 官方后继；文档 updated 2026-08-25）：orchestrations（concurrent/handoff/magentic）、HITL request/审批、superstep checkpoint、A2A host/client 均框架原生；**差异化输入需应用层**；运行时为 .NET/Python/Go，**无 Node**——不能作为本仓库依赖，仅作模式参照与对端互操作参考。
- 结论：差异化输入、纠偏版本化、权威写入三件事由 v4life 应用层扩展承接（interface §0.2/§8 对照表）。

## 5｜合成事件设计与 B1 写面

- 合成事件（步骤 4）：`evidence/B0/synthetic-event-example.md`——同一事件四份共享事实引用 packet（可断言 sharedFacts 逐字节一致 + relevantFacts/responsibility/goal 两两不同）、往返追问关联链、人纠偏 → contextVersion 1.1 → 受影响任务停止旧推进、晚到结果 `superseded` 隔离可追溯；候选事件类型 10 个全部 additive/默认关闭。
- B1 精确写面（步骤 5）：`B0_INTERFACE_CANDIDATE.md` §7——共享类型唯一 writer = 主控冻结 `lib/v4life/collaboration/types-collab.ts`；既有文件仅 5 个的 additive 修改（types/engine/replay/runtime/http，主控串行窗口）；新增 collab 路由 8 个；agent adapter 用可控测试替身；明确不改 `lib/v4/**`、前端、seed、lockfile。

## 6｜未决项（需用户/Control 决定，B0 未替决）

1. B1 放行前置：baseline commit + annotated tag 的范围（含/不含 §B 类用户改动，见 BASELINE_MANIFEST §2B/§3）——须用户明确授权，B0 未执行。
2. 准备性并行的精确边界（"无硬前序 + 低成本可撤回"白名单）——任务书标注待 Control 评审。
3. 共享对象最高编辑权与并发合并规则（V5/DECISIONS 保留开放项）。
4. 是否引入 A2A 社区 TS SDK 或最小自实现（新依赖 = 用户依赖 Gate）；是否对外暴露 A2A wire 兼容层。
5. 协作路由最终路径与事件载荷 schema 冻结（B0_INTERFACE_CANDIDATE 仅 Candidate）。
6. 超时/取消的量化参数（maxRounds、超时时长）——演示值须用户确认，不为演示新造政策阈值。

## 7｜停止点

B0 四类交付物齐备（本文件、INTERFACE_CANDIDATE、BASELINE_MANIFEST、evidence/B0/** 7 文件，含 Rev1 新增复核快照）；命令结果真实（§2）；来源可核查（evidence 索引，读取日 2026-09-06）；候选接口与精确写面可评审（§5/INTERFACE §7）；基线缺口清楚（BASELINE_MANIFEST）。**按要求停止，不自动跨入 B1**；等 Codex 独立检查与用户边界决定。

## 8｜Rev1 修订记录（2026-09-06，接 B0_CODEX_REVIEW）

用户开新会话整合两条工作线并要求接续；本会话（ZCode，接续 B0 同一 writer 角色）按审查完成候选修订。未写代码、未做任何 git 操作、未触 `B0_CODEX_REVIEW.md`（Codex 所有）。逐项对应：

1. **局部纠偏误伤**（审查 1）：INTERFACE §4 改为任务级失效判定——`appliesTo` 命中 / `effectiveDependencies` 失效 / `relevantFacts` 被改写三条件；仅全局版本变旧不失效，未命中结果 `carried_forward` 保留有效；补受影响（信审/商务 superseded）/未受影响（政策/资产 carried_forward）对照轨迹（evidence §3 同步）。经验来源 STARS reconsiderContext（HISTORICAL_REUSE B0-1）。
2. **恢复载荷不足**（审查 2）：INTERFACE §4 明确恢复载荷下限——派发/重派事件携带 packet 全文、消息携带正文 parts、纠偏携带全文，全部入事件账本；`packetHash` 仅完整性/去重辅助、不是恢复源；冷启动按此下限逐项断言（B1 测试 7）。evidence §3 轨迹同步改写。
3. **A2A 路线与状态混用**（审查 3）：INTERFACE §0.3 改"实现路线分阶段声明"——本轮无安装依赖约束 ≠ 长期自实现路线；§3 增三层状态分离表（A2A 协议态 / 应用结果有效性 / Human Gate 正式权威，独立判定互不替代）；§8 增 Node 侧自实现 / SDK / adapter 三选项比较，决策留用户依赖 Gate；§6 增证据分级约束——本地状态测试与 wire 兼容测试均不得称互通。
4. **Candidate 解锁正式化表述含糊**（审查 4）：INTERFACE §3 增"Candidate 不解锁正式前序"——正式推进前置只能是有效 Human Decision/Receipt，候选齐备而无 Receipt 一律拒绝；evidence §1 商务 packet `taskGoal` 及依赖注记同步改写。

文档质量补充（审查末段）：BASELINE §4 文件数量矛盾更正（当前 10 文件）；§2.C.4 共享服务运行配置标"未核实"；§4"零写入"限定为自报并新增 `evidence/B0/git-snapshot-20260906-rev1.txt` 时点佐证（与 gate-time 快照 79 条 porcelain 逐条一致、HEAD 相同）。

修订后 B0 仍为 Candidate；B1 放行前置不变：Codex 复验修订 + 用户接受并行/写入边界决定 + baseline commit 与 annotated tag 授权。本轮未派工 B1。
