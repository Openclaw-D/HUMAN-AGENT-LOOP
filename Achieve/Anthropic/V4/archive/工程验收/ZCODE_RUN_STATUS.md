# ZCode Overnight Run Status

状态：`P1-BE-01 FUNCTIONAL_CANDIDATE_ACCEPTED / P1 PRODUCT ACCEPTANCE OPEN / PRODUCTION NOT READY`

原协议由 ZCode 主 Agent 写、Codex heartbeat 只读。用户已授权 Codex 将独立验收结论回写本文件。本文件分层记录，互不混写：**当前快照**（ZCode 本轮）、**Codex acceptance snapshot**（历史裁决，原样保留）、**历史 snapshot**（更早轮次）。每次代码变更后旧 Gate 数字立即失效，以当前快照为准。

## Codex acceptance snapshot（当前裁决，2026-09-04 22:00）

- `verdict`: **FUNCTIONAL_CANDIDATE_ACCEPTED / P1 PRODUCT ACCEPTANCE OPEN / PRODUCTION NOT READY**。
- `independentGate`: Codex 独立复跑 P1 focused **31/31**、full `npm.cmd test` **574/574**、HTTP quality **27/27**、typecheck **0**、lint **0**、build **complete**；localhost `canonical API`、`/work`、`/work/screen` 均为 **200**。
- `authorityReview`: 默认 `p1CandidateSemantics='off'` 已把未确认的核验角色、窗口角色和隐含封存状态隔离；demo runtime 显式 opt-in。Agent/模型仍为 `authority=none`，正式 Decision/Receipt 仍走 Human Gate。
- `durabilityReview`: 本轮证明了已覆盖窗口下“不重复事件、不重复 Receipt、损坏/错配失败关闭”；但文件 event log 与 command journal 仍非原子事务。journal 写失败且进程重启时，work/decision 依靠状态规则拒绝重复，不保证恢复原 accepted response；生产仍必须使用事务数据库/唯一约束，不能外宣 exactly-once transaction。
- `scopeReview`: 21:17 后实际写入仅落在本轮授权的 `lib/v4life/**`、两份新增测试、一份更新测试和三份状态文档；`seed.ts`、`app/**`、根部 authority、依赖与部署未被本 checkpoint 修改。
- `remainingProductGate`: 四域核验/窗口 Human Role、最终主风险、stale 阈值、自动封存/重开、正式核验 Receipt 与合成 seed 仍由用户决定；P1 命令当前没有 HTTP 路由，因此本裁决不等于 P1 端到端操作面完成。
- `timeCorrection`: ZCode snapshot 原写 `22:05`，但文件 mtime 与 ZCode 最终 UI 均为约 `21:51`；已按可观察 wall-clock 纠正，不使用未来时间作为 Evidence。
- `controlRevisionRead`: 0003。

## ZCode execution snapshot（P1-BE-01，已由上方 Codex 当前裁决承接）

- `updatedAt`: 2026-09-04T21:51:00+08:00（Codex 按文件 mtime 与最终 UI 纠正）
- `overall`: COMPLETE_CANDIDATE（ZCode 交付时自报；Codex 已于 22:00 独立复验并形成上方当前裁决）
- `phase`: P1-BE-01 EXECUTED（用户直接授权 checkpoint）
- `objective`: 完成前一轮 P1 Candidate 的权威对账（FROZEN / CANDIDATE / 越界裁定）+ 默认正式路径隔离 + journal 双写加固；不扩张产品语义
- `writerCheck`: 无并行 writer（最后代码写入 20:53，本会话 21:17 开始；3100 服务为任务自有）
- `materialChange`:
  1. `p1CandidateSemantics: 'off'(默认)|'demo'` 隔离开关 —— 五个 candidate 命令（changeVerification + 窗口四命令）与初始化隐含批次 major=1 SEALED 退出默认正式权威路径；strict 下 context 投影为 `'NONE'` 空窗口；幂等 replay 先于闸门（历史命令跨模式可 replay）；demo runtime 显式 opt-in，`/work`、`/work/screen`、HTTP demo 行为不变；seed.ts 0 diff
  2. journal 加固：context 命令族以 `'context_batch'` 入 durable journal（此前重启丢幂等）；journal.append 故障 = 原错误上抛 + 进程内幂等保留；崩溃窗口跨重启由自然键/状态规则失败关闭（不重复事件/Receipt）；构造期 rev 一致性守卫（journal 超前事件流 → 失败关闭）
- `tests`: full **574/574**（0 失败；变更前基线 559/559 已实测核实）；P1 focused 31/31；v4life+work focused 190/190；HTTP quality 27/27
- `typecheck` / `lint` / `build`: 0 / 0 / 完成
- `acceptanceSurface`: 3100 任务自有服务已用当前构建重启；canonical API、`/work`、`/work/screen` 均 200，demo context 仍 major=1 SEALED
- `pendingForCodex`: RESOLVED（22:00 已独立复验；`CONTRACT.md` §15/§16 已由 Codex 对账补记）
- `unconfirmedForUser`: 四域核验/窗口 Human Role、最终主风险、stale 阈值、Context 自动封存/重开、正式核验 Receipt 语义、合成 seed 事实与 P1 完整 Acceptance（清单见 BACKEND_PROGRESS P1-BE-01 节 F）
- `currentBlocker`: none
- `controlRevisionRead`: 0003

## Codex acceptance snapshot（历史裁决，2026-09-04 13:38，本轮变更前）

- `verdict`: **FUNCTIONAL_CANDIDATE_ACCEPTED / COMPLETE_DOD_NOT_PASSED**（对应代码 = 本轮变更前状态；新增 durable journal 后端到端验证见 14:55 correction snapshot 与 16:16 BACKEND_PROGRESS 追加段）
- `backendFocused`: v4life + work-model 106/106；HTTP quality 27/27
- `repositoryGate`: 当时 full 494/496、lint 2+1（后经授权 correction checkpoint 修复至全绿，见下）
- `canonicalDecision`: `lib/v4life/**` + `app/api/v4life/**` 为唯一 canonical；旧 `lib/v4/**`/`app/api/v4/**` 降 legacy Candidate
- `controlRevisionRead`: 0002

## Historical snapshots（更早轮次，原样保留要点）

### 2026-09-04T14:55｜Correction checkpoint executed（ZCode，Codex 授权修复）

授权修复两个 legacy full-test 失败与 reset route lint warning；durable command journal + 文件持久化适配器（V4LIFE_DATA_DIR opt-in）+ SSE + HTTP 防护对齐落地；当时 full 536/536、typecheck/lint/build 全绿；`JOURNAL-E2E-PROVED`（production 重启后同 commandId 200 replayed）。`pendingForComplete`: CONTRACT 全面统一（D076–D080）另行 checkpoint —— 仍未完成（本轮亦无 CONTRACT 写权）。

### 2026-09-04T03:20｜Overnight COMPLETE_CANDIDATE（ZCode 主 Agent）

后端四域事件溯源内核 + `/work` 五角色双端真实联调 + Golden Case happy path 浏览器全程驱动（rev 45、4 Receipt、8 WorkItem）；当时 full 494/496（2 排除面遗留，后获授权修复）；20 路并发试验 requested/started/completed=20、0 失败降档。

## Checkpoints

### 2026-09-04 21:51｜P1-BE-01 后端权威对账与稳定性加固｜COMPLETE_CANDIDATE
- Files changed: `lib/v4life/{engine,types,command-journal,replay,runtime}.ts`、`test/v4life-p1-semantics.test.mjs`、新增 `test/v4life-p1-isolation.test.mjs` + `test/v4life-journal-hardening.test.mjs`、`docs/v4/{ZCODE_RUN_STATUS,BACKEND_PROGRESS,ACCEPTANCE}.md`；`seed.ts`/`app/**`/`CONTRACT.md` 0 diff
- Behavior completed: drift matrix 11 项逐项裁定（详见 BACKEND_PROGRESS）；candidate 语义默认隔离（demo opt-in 不变）；journal context_batch + 故障注入 + rev 守卫；3100 服务当前构建重启并复验 200
- Exact command/result: full `npm.cmd test` 574/574；typecheck 0；lint 0；build complete；quality 27/27；focused 190/190 + P1 31/31
- Failure/root cause: 首轮 3 处测试缺陷（flaky journal 故障计数、空 journal 文件、闸门先于幂等 lookup 导致跨模式 replay 丢失）——前两者修测试，第三处修 engine 闸门位次（幂等 lookup 之后）
- Current ownership: ZCode 主 Agent（本轮）；CONTRACT.md 归下一位 writer
- Next action: 用户在 V4-RISK 中裁决 §11.3 的产品语义；后端不继续擅自扩张
- Control revision read: 0003
