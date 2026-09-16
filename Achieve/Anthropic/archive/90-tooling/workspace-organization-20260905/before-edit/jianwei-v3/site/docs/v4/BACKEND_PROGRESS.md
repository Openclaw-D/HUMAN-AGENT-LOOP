# 见微 V4 后端进度 —— 四路 wave（Phase 1）

状态：`P1-BE-01 FUNCTIONAL_CANDIDATE_ACCEPTED / P1 PRODUCT ACCEPTANCE OPEN / PRODUCTION NOT READY`

权威链：根部 `NORTH_STAR.md`/`DECISIONS.md` → 执行书 `docs/v4/ZCODE_BACKEND_GOAL.md`（只读）→ `docs/v4/CONTRACT.md`（FROZEN FOR THIS SLICE / 2026-09-03）→ 本记录。本文件只做忠实结构化记录，不反向定义产品。

> 当前真相以本文最末的 `P1-BE-01` 与 `Codex 独立复验结果` 为准；§1–§6 及此前各 Wave 是按时间保留的历史 Evidence，不再代表当前进度。

## 1｜四路 ownership（文件级）

| Lane | 拥有文件（写） | 当前状态（2026-09-03 00:36 观测） |
| --- | --- | --- |
| A｜领域状态机 | `lib/v4life/types.ts`、`lib/v4life/engine.ts`、`lib/v4life/seed.ts`、`test/v4life-kernel.test.mjs` | **未落地契约版**：三文件 mtime 仍为冻结前（23:20–23:26），`engine.ts` 不含 `commandId/expectedRev/rev`；`test/v4life-kernel.test.mjs` 仍断言旧幂等行为（同 evidenceId 异载荷 → replayed），与契约 §6 `EVIDENCE_CONFLICT` 相悖，须随新引擎更新 |
| B｜Store 与重放 | `lib/v4life/event-log.ts`、`lib/v4life/replay.ts`、`test/v4life-lane-b-store.test.mjs` | 已落地（00:26–00:34）；Lane D 独立探针：`rebuildProjection(seed, 契约形状事件)` 产出 §8 全字段 Projection（`rev/evidence/evidenceCount` 齐全，`WORK_ITEM_STARTED` 折叠正确） |
| C｜HTTP/API | `lib/v4life/http.ts`、`lib/v4life/runtime.ts`、`app/api/v4life/**`、`test/v4life-lane-c-http.test.mjs` | 已落地（00:24–00:36）：runtime 提供 §10 四函数（含 `resetV4LifeRuntime`）；http.ts 按契约 §6 解析 command/expectedRev，§12 状态映射齐全（409 族已映射）；routes 为新版 |
| D｜对抗验收 | `test/v4life-lane-d-adversarial.test.mjs`、`scripts/v4life-http-quality.mjs`、`docs/v4/ACCEPTANCE.md`、`docs/v4/BACKEND_PROGRESS.md` | 本切片交付（详见 §3/§4） |

只读共享：`docs/v4/CONTRACT.md`、`docs/v4/ZCODE_BACKEND_GOAL.md`。四路无文件写重叠；Lane D 未修改 A/B/C 任何实现文件。

## 2｜Phase 0 契约冻结记录

- `docs/v4/CONTRACT.md` 于 2026-09-03 标记 `FROZEN FOR THIS SLICE / ZCODE EXECUTION`，先于四 lane 派发。
- 冻结内容：§1 对象与类型（types.ts 唯一类型源）；§2 事件账本（seq 从 1 单调、只追加、`payload.type` 形状、查询深克隆）；§3 状态机与依赖三分法（含退回重做、否决级联只停真实依赖）；§4 角色权限；§5 Candidate 确定性规则 R1/R2 与 dedupeKey；§6 命令/幂等/版本竞争与六步校验顺序；§7 引擎 frozen API（含 `rev`、`getEvents(afterSeq, limit)` → `{events, nextSeq, hasMore}`，receiptId 格式 `rcpt-<gateId>-<n>`）；§8 Projection（含 `rev`/`evidence`，domains 固定顺序）；§9 存储 port 与 `rebuildProjection`；§10 路由与错误 envelope；§11 Golden fixture 与四证明点；§12 错误码总表；§13 未实现边界。

## 3｜Lane D 运行命令与结果（2026-09-03，Node v22.23.1）

| 命令 | 结果 |
| --- | --- |
| `node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-lane-d-adversarial.test.mjs` | 26 tests：**10 pass / 16 fail**（等待 60 秒复跑一次，结果一致） |
| `node scripts/v4life-http-quality.mjs` | 27 steps：**5 pass / 22 fail**，退出码 1（复跑一致） |

通过项：越权 4 项（Gate 双门 + 五工作项 + WI-C3 的 ROLE_MISMATCH，失败关闭不产生事件）、乱序 3 项（blocked 提交 / Gate 未开 / 重复决定，全部 409）、appendEvidence 同 commandId 幂等重放（事件总数不变、rev 为原接受时 rev）、缺失依赖硬等待（WI-C3 stopped 前恒 blocked）、Candidate 不越权（R1/R2 不改正式状态、authority 全 none）、HTTP 404 CASE_NOT_FOUND（GET/POST）、400 INVALID_ENGINE_INPUT envelope、no-store 头。

失败项：全部同源于 Lane A 引擎未落地（见 §4），阻塞链为“旧 Projection 无 `rev` → HTTP `expectedRev=undefined` → 400”及引擎本身缺 §6/§7 能力。Lane D 脚本为进程内执行（不启动服务、不 fetch 网络地址），文件头已注明。

<!-- MAIN: 待整合阶段填写（四路合计测试数、全量 npm.cmd test 通过数、typecheck/lint/build 结果） -->

## 4｜对抗测试发现的缺陷清单（归属 lane）

全部 16 个测试失败 + 22 个脚本步骤失败经逐一归类，**均指向同一根因：Lane A 引擎（`lib/v4life/engine.ts` + `types.ts` + `seed.ts`）仍为契约冻结前的旧 candidate**。按“lane 未完成”记录；若 Lane A 落地后复跑仍失败，升级为“契约违例”。

| # | 缺陷（契约依据） | 归属 | 对应失败用例 |
| --- | --- | --- | --- |
| D1 | 命令无 `commandId/expectedRev`，引擎无 `rev`（§6/§7） | Lane A | 测试 #10/#11/#13/#14；脚本全部 POST 类步骤（400 级联） |
| D2 | 无 `IDEMPOTENCY_CONFLICT`/`EVIDENCE_CONFLICT`/`VERSION_CONFLICT` 错误码（§6/§12） | Lane A | 测试 #12/#13/#14 |
| D3 | `getEvents` 无 `limit`/`hasMore`（§7） | Lane A | 测试 #21/#26；脚本 S1.10 |
| D4 | Projection 缺 `rev`/`evidence` 字段（§8） | Lane A | 测试 #16；脚本快照比对类步骤 |
| D5 | 事件形状为顶层 `type`，非 §2 的 `payload.type` | Lane A | 测试 #20 |
| D6 | `submitWork`/`recordDecision` 结果无 `status`/`rev`（§7 结果类型） | Lane A | 测试 #10/#11 |
| D7 | `returned` 时 `receipt` 为 `undefined`，契约要求 `null`（§7） | Lane A | 测试 #17 |
| D8 | Projection 查询返回浅拷贝（workItem 引用共享），违反深克隆要求（§2） | Lane A | 测试 #22 |
| D9 | 校验顺序：Actor 校验先于字段校验，违反 §6 步骤 1→2 | Lane A | 测试 #5 |
| D10 | 引擎公共 API 缺 `rev`，不满足 §7 frozen surface | Lane A | 测试 #19 |
| D11 | 既有 `test/v4life-kernel.test.mjs` 断言“同 evidenceId 异载荷 → replayed”，与 §6 `EVIDENCE_CONFLICT` 相悖，须随新引擎更新 | Lane A | （非 Lane D 用例，整合时须处理，勿以删测试换通过） |

已落地的 Lane B/Lane C 代码在 Lane D 探针与失败矩阵中未发现契约违例：`rebuildProjection` 产出 §8 全字段 Projection；HTTP 404/400 envelope、`Cache-Control: no-store`、运行时 `resetV4LifeRuntime` 隔离均符合 §10。真正的重放等价证明（测试 #20）需待引擎产出 §2 形状事件后复跑。

## 5｜未验证项

- `npm.cmd test`（全量）、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build`——主 Agent 整合阶段统一执行（DoD #5）。
- Lane D 的 16 + 22 个失败项——待 Lane A 引擎落地后按 §3 命令复跑。
- Lane A/B/C 自有测试（`test/v4life-kernel.test.mjs`、`test/v4life-lane-b-store.test.mjs`、`test/v4life-lane-c-http.test.mjs`）与 Lane D 测试的全量合跑结果。
- 事件重放等价（`rebuildProjection` 与在线 `getProjection` deepEqual）的端到端确认。

<!-- MAIN: 待整合阶段填写（未验证项复核结果与遗留风险） -->

## 6｜下一适配点

1. **live 模型 adapter**：Candidate 目前全部 `deterministic-v1`（§5/§13）；接入真实模型时仅可产生 Evidence 处理结果/Candidate/草案，`authority` 恒为 `none`，不得触碰 §7 三个命令路径。
2. **持久化**：以 §9 `V4LifeEventLog` port 为缝，替换内存适配器为事务数据库/持久事件账本（需唯一约束、`SEQ_CONFLICT` 条件追加语义保真），不改变引擎与 HTTP 层。
3. **部署**：进程内 runtime（`Map` 持有引擎）仅适用单进程演示；多实例部署需先完成持久化与外部化组合根，并补认证/RBAC、审计与保留策略（§13 边界）。

## 2026-09-04｜20 路并发试验 + Phase A/B 收官（主 Agent 追加）

### 并发试验 Evidence（ZCODE_CONCURRENCY_TRIAL.md）

- requested=20，单批次同时派发；started=20；completed=20；failed=0；throttled=0；cancelled=0；peak-active≈20（单批同时返回）。
- 构成：Writer 2（L01 引擎重写、L02 种子/内核测试）+ 只读 reviewer/validator 18。subagent 未再派生 subagent。
- 结论：当前平台实际可承载 ≥20 并发；writer ceiling 建议 ≤4（受单文件单 writer 约束），read-only reviewer 并发 16–20 可稳定复用。

### 整合裁决与修复

1. evidenceId 自然键歧义（L12 裁决请求）：契约 §6 步骤 6 冻结为「同 id 同 payload → replayed（无论 commandId），异 payload → EVIDENCE_CONFLICT」；引擎行为符合契约，quality 脚本 S2.09/S2.10/S2.12/S3.04/S3.05 五步为测试设计缺陷（重用已提交内容当首次接受），已改为全新 supplement 证据。
2. 测试缺陷修复：kernel #16（提交了 blocked 的 WI-B1）、lane-c #3（rev+1 应为 rev+2，多事件语义）、lane-c #21（新种子 WI-C1 应为 in_progress）。
3. lint：engine basis 未用变量、events 路由未用导入、kernel 未用变量 —— 已删。
4. DomainWorkbench effect 内 setState 改为域键派生状态；BusinessPanel 未用常量删除。

### 工作台扩展与前端联调

- 契约 §14 冻结：Projection.actors、WI-B2/BG-1、WI-A2/AG-1、demo reset（production 失败关闭）、client 命令纪律。
- 后端扩展：WA（types/engine/seed/replay + extension 测试 7）、WB（runtime + reset 路由 + reset 测试 7）；引擎零特判（纯依赖机制驱动承接链）。
- 前端：W1 workspace-model（selectors/client/hooks + 18 测试）、W2 BusinessPanel、W3 DomainNetwork/Workbench、W4 InspectionRail/StatusPrimitives；主 Agent 串行整合 WorkShell/CaseChat/page.tsx + workspace-contract.ts 冻结。
- 修复的集成缺陷：契约类型未 re-export；BusinessPanel 自生成 evidence id 破坏依赖图触发（改用 §11 规范 id）。

### 最终 Gate（2026-09-04 03:15）

- v4life focused：88/88（kernel 18 + extension 7 + reset 7 + lane-b 10 + lane-c 21 + lane-d 26 之和为 89？——以逐文件运行为准：六文件合计 88+work-model 18 全部通过）
- scripts/v4life-http-quality.mjs：27/27 PASS
- `npm.cmd test`：494/496（2 失败 = #52 管理页、#266 evolve：排除面遗留源码漂移，本会话前已存在；v4-work-surface 5 项已重写为新工作台不变量并全绿）
- `npm.cmd run typecheck`：0 error；`npm.cmd run build`：complete
- `npm.cmd run lint`：2 error 均在 app/v4-surface-nav.tsx（禁止修改的遗留文件 `<a>` 应为 `<Link>`），待授权修复

### 浏览器 E2E Evidence（真实 viewport，截图见 docs/v4/evidence/workspace/）

- 01-desktop-1920-business-initial.png：rev 6 初态，四域网络 + 硬等待标注 + authority=none
- 02-desktop-1920-policy-PG1-approved.png：PG-1 批准，Receipt rcpt-PG-1-1 生成，WI-C3 硬等待释放为 in_progress
- 03-desktop-1920-asset-AG1-final.png：AG-1 终局批准，rev 45、4 Receipt、8 WorkItem completed、8 贡献保留、事件账本 45
- 04-mobile-390-business.png：390×844 业务移动端「看板/事项/协同」重排，无横向溢出
- Golden Case happy path 全程经真实 UI 驱动（业务补件→四域并行→三道正式 Gate→AG-1 Receipt）；重复触发被引擎失败关闭语义正确拒绝，无双写
- 任务自有服务：127.0.0.1:3100（vinext start，本 Goal 启动，保留供次日验收）

### 未验证/遗留

- 浏览器级 return/reject/adversarial 路径未在浏览器重演（kernel #15 退回重做、lane-d 26 对抗断言已覆盖语义）；reset 在 production 被正确禁用故浏览器级重置演示需重启进程
- #52/#266 测试失败与 lint 2 error 位于排除面遗留文件，需 Codex 裁决是否授权修复

## 2026-09-04｜优化 Wave：持久化 / SSE / 防护对齐 / 一键门禁（ZCode 本会话执行，用户直接授权）

Ownership 变更：用户指示「进一步优化后端」，执行权由过夜会话移交至本会话；过夜交付（COMPLETE_CANDIDATE）已经本会话独立复跑核验（focused 106/106、质量门 27/27、typecheck 0、全量 494/496、lint 2 遗留、build 完成，与自报一致）。

### 交付物（Wave 0 侦察 3 lane + Wave 1 施工 3 lane + 主 Agent 串行接线）

1. **文件持久化适配器（opt-in）**：`lib/v4life/file-event-log.ts` 的 `createFileEventLog({dir})` 实现 §9 V4LifeEventLog port（JSONL append-only、SEQ_CONFLICT 条件追加、损坏行失败关闭含行号、防路径穿越、深克隆）；`runtime.ts` 接线——设置环境变量 `V4LIFE_DATA_DIR` 即启用，demo reset 同步清盘；未设置时行为与纯内存完全一致。侦察确认引擎构造期 `options.eventLog.loadAll` 非空即 refold 全部写路径状态（rev/Gate/工作项/evidence），无需修改 engine.ts。
2. **SSE 事件流端点**：`app/api/v4life/cases/[caseId]/events/stream/route.ts`（GET，`force-dynamic` + `no-store` 双保险规避 vinext 生产 ISR clone 缓冲），连接排量历史 → 500ms 轮询推帧 → 15s 心跳，abort/cancel 双路径清理。
3. **HTTP 防护对齐**：`lib/v4life/http.ts` 的 `readJsonBody` 内部改用现成 `readBoundedJsonBody`（流式字节上限 + 10s 读超时），新增错误码 `REQUEST_BODY_TOO_LARGE: 413` / `REQUEST_BODY_TIMEOUT: 408` / `INVALID_JSON: 400`（types.ts §12 联合扩展）；命令路由不再静默吞非法 JSON，demo/reset 以 `{lenient:true}` 保留"省略即默认"语义，413/408 仍显式失败。新增 4 个钉子测试（声明超限 413、chunked 无声明超限 413、reset 宽容、reset 超大 413）。
4. **一键门禁**：`scripts/v4life-gate.mjs` + `npm run gate:v4life`（专注测试 + 质量门 + typecheck，`--full` 追加全量与 lint；Windows npm.cmd EINVAL 已按 CVE-2024-27980 回退处理）。

### 门禁证据（2026-09-04，本会话实测）

| 命令 | 结果 |
| --- | --- |
| v4life 专注测试（10 文件） | **129/129**（原 106 + 防护钉子 4 + L1 9 + L2 7 + 持久化端到端 3） |
| `node scripts/v4life-http-quality.mjs` | **27/27** |
| `npm run gate:v4life` | 3/3 ALL GREEN，退出码 0（总耗时 ~2.5s） |
| `npm.cmd test` | **517/519**（2 失败仍为旧 V4 遗留 #52/#266，未越权修复） |
| `npm.cmd run lint` | 2 errors（app/v4-surface-nav.tsx 遗留）+ 1 warning，无新增 |
| `npm.cmd run build` | 完成 |
| typecheck | 0 错误 |

### 端到端持久化证据（真实 production 服务器重启）

`PORT=3199 V4LIFE_DATA_DIR=<dir> vinext start`：GET rev=6 → POST evidence 201（rev 6→7，ev-e2e-persist-check）→ 杀进程 → 同目录重启 → GET **rev=7 且该 Evidence 完整恢复**（`PERSISTENCE-E2E-PROVED`）。SSE 端点同机验证：200 + `text/event-stream` + `no-store` + chunked，非法 afterSeq 400 JSON envelope。

### 诚实边界（新增后仍成立的限制）

- 持久化为 opt-in 环境变量开关，默认不启用；commandId 幂等缓存不跨重启（engine.ts 头注释自述），重启后同 commandId 重发靠 evidenceId 自然键兜底（测试钉住）；
- 持久化适配器为全同步单进程实现，多实例共享目录需要文件锁，仍属 §13 演示边界；
- SSE 推送为 500ms 进程内轮询（非事件订阅），单进程内足够，跨进程需持久化+外部队列；
- 真实模型接入、认证/RBAC、多 case 工厂仍未实现（§13），等待平台选型结论（Codex 并行评估中）。

### 待裁决（不变）

① 旧 V4 遗留 2 测试失败 + 2 lint 错误是否授权修复；② lib/v4 与 lib/v4life 双实现 canonical 取舍。验收请求已发至 Codex（会话「验收 V4 四域后端候选」），结论按协议回写 `docs/v4/ZCODE_RUN_STATUS.md`。

## 2026-09-04｜Durable Command Journal + 大屏镜像页（ZCode 本会话，用户授权继续推进）

1. **Durable command journal**（关闭 Codex newFinding）：`lib/v4life/command-journal.ts`（JSONL 文件适配器）+ types.ts §15 port + engine.ts 七处外科修改（三命令接受路径先 journal.append 再更新缓存；构造期 loadAll 恢复幂等记录）；runtime 成对接线（eventLog+commandJournal 同目录注入/同盘清理）。已知非原子性（journal.append 在事件 commit 后）如实注释。**端到端实测**：production 服务器 POST 201 → 杀进程重启 → 重发同 commandId **200 replayed**（修复前 409 VERSION_CONFLICT，`JOURNAL-E2E-PROVED`）。
2. **Canonical 大屏镜像页**：`/work/screen`（client-only，EventSource 订阅 SSE + 500ms 节流 Projection 重取；深色大字号四域泳道、awaiting_gate 呼吸高亮、Receipt 流水、断线容错）——P5 大屏 live 镜像第一版。
3. **部署接线**：`scripts/run-localhost.ps1` 注入 `V4LIFE_DATA_DIR`（托管 3000 服务持久化 opt-in 生效）。

### 门禁（全量复验）

| 项 | 结果 |
| --- | --- |
| 全量测试 | **536/536，0 失败**（原 527 + journal 9） |
| lint / typecheck / build | 0 问题 / 0 错误 / 完成 |
| v4life focused | 138/138 |

### 与 P1 契约的衔接

`docs/v4/P1_SCHEMA_EXTENSION_PROPOSAL.md` 已起草（CANDIDATE）：引擎 Evidence 语义扩展（§5 verificationStatus/subjectRef/时间三元组）、Risk Thread 投影、InputEvent、§11 七项待确认清单附推荐答案——等用户逐条确认后进入 P1-01 施工（seed 内容仍按契约暂不改）。

## 2026-09-04｜P1 Candidate 落地（前一轮 lane 实施，本轮 ZCode 复验）

前一轮 lane（16:12–20:53）在 `lib/v4life/**` 落地 P1 语义 Candidate：Evidence §5 扩展字段（sourceType/subjectRefs/时间三元组/evidenceRef/confidence，可选、向后兼容）、verificationStatus 五态（append 恒置 claimed）、`EVIDENCE_VERIFICATION_CHANGED` + `changeVerification` 命令、D076/D077 收集窗口（`CONTEXT_BATCH_*` + open/appendInputEvent/stabilize/seal 命令族）、InputEvent（minor 递增）、Risk Thread 投影（riskThreadKey 折叠）、`/work/screen` 大屏消费。自报 full 559/559 —— 本轮变更前基线复验 **属实（574 前实测 559/559、exit 0）**。

## 2026-09-04｜P1-BE-01 后端权威对账与稳定性加固（ZCode 本会话，用户直接授权 checkpoint）

### A｜drift matrix（authority 来源逐项裁定）

| # | P1 语义项 | 裁定 | 说明 |
| --- | --- | --- | --- |
| 1 | Evidence §5 扩展字段 + verificationStatus 五态（append 恒 claimed） | CANDIDATE（保留） | 可选字段，不注入时 P0 逐字节不变；Rev 0003 明确允许 |
| 2 | `changeVerification` 命令 + 核验事件（不产 Receipt） | CANDIDATE → demo-only | 正式 Receipt 语义未确认；已隔离（见 B） |
| 3 | 四域核验角色矩阵（business 不得自核验等，`VERIFICATION_ROLES`） | CANDIDATE → demo-only | 待 §11.3 Human Role 确认；已隔离 |
| 4 | D076 contextVersion M.m + InputEvent 不可变版本 | FROZEN 机制（DECISIONS.md V4L-D076） | 机制冻结；kind 枚举与角色为 CANDIDATE |
| 5 | D077 OPEN→STABILIZING→SEALED 窗口状态机 | FROZEN 机制（V4L-D077） | 同上 |
| 6 | open=business、stabilize/seal=policy 角色指派 | CANDIDATE → demo-only | 待 §11.3；已隔离 |
| 7 | 初始化自动隐含批次 major=1 SEALED | CANDIDATE/NOT-ACCEPTED → demo-only | Rev 0003 列"自动封存/重开"未确认；且 D077 要求初始批次过窗口；已隔离，strict 下 context 为 `status='NONE'` 空窗口 |
| 8 | Risk Thread（riskThreadKey + 纯派生投影） | CANDIDATE（保留） | 只读投影；seed.ts 未注入 key（内容未动） |
| 9 | `/work/screen` v2 | CANDIDATE（未改动） | Rev 0003 允许的只读演示投影；本轮仅复验 HTTP 200 |
| 10 | P1 命令 HTTP 暴露 | 无（如实记录边界） | `app/api/v4life/**` 无任何 P1 路由；`parseChangeVerificationBody` 暂无调用方 —— candidate 命令不可经 HTTP 触达 |
| 11 | `docs/v4/CONTRACT.md` §16.1 称 D076/D077"未实现" | **已解决（Codex 22:00 对账）** | §15/§16 已改为“机制已实现、产品内容仍为 Candidate、默认隔离”，并补记非原子持久化边界 |

### B｜Candidate 隔离（默认正式权威路径不启用）

- `V4LifeEngineOptions.p1CandidateSemantics: 'off'（默认）| 'demo'`：`'off'` 时五个 candidate 命令（changeVerification + 窗口四命令）在幂等 lookup 之后失败关闭（`INVALID_ENGINE_INPUT` + detail），不产生事件；初始化不预置隐含批次（context 投影 `{major:0,minor:0,status:'NONE',batches:[]}`）。
- 闸门位于 §6 步骤 3 之后：历史上已接受的 candidate 命令跨模式重发仍 `replayed`（幂等语义不随模式切换丢失，测试钉住）。
- 通用层不受闸门影响：Evidence §5 扩展字段、新事件类型、Risk Thread 投影、历史 verification 事件重放（graceful fallback）均可用。
- `runtime.ts` demo 路径显式 `'demo'` opt-in —— `/work`、`/work/screen`、HTTP demo 行为逐字节不变（浏览器验收面不受影响）。
- `rebuildProjection(seed, events, generatedAt?, options?)` 增第四参：重建 demo 事件流须显式传 `'demo'`；含收集窗口事件的流进 strict 引擎失败关闭（模式属引擎身份，跨模式事件流移植不支持，测试钉住）。
- `seed.ts` 内容未动（0 diff）。

### C｜Journal 双写加固（事件账本 ↔ durable command journal 非原子窗口）

1. **context 命令族入 journal**：`V4LifeCommandJournalRecord.command` 追加 `'context_batch'`（枚举超集，旧文件照常可读）；窗口四命令由进程内缓存改走 `recordAcceptedCommand` —— 此前该族重启后幂等丢失，现跨重启 `replayed`（测试钉住）。
2. **journal.append 故障语义**（同进程"事件已提交、journal 未提交"）：原错误上抛（不伪造成功）**且**进程内幂等缓存照常写入 —— 同 commandId 重发 → `replayed`，无重复事件/Receipt。故障注入测试：evidence、decision（故障精确命中第 N 次 append）两用例。
3. **崩溃窗口（跨重启、journal 记录缺失）**：evidence 走自然键 `replayed`（无重复事件）；work/decision 由状态规则失败关闭（`WORK_ITEM_NOT_ACTIVE` / `GATE_ALREADY_DECIDED`），Receipt 恰好 1 条。诚实边界：文件适配器无法与事件追加原子化（无真实事务数据库），失败窗口缩至 journal 自身故障/进程崩溃，恢复按可用账本最大努力。
4. **反向场景守卫**（"journal 已写、事件缺失"）：构造期校验 journal 记录 `result.rev ≤ 事件流长度`，超前即 `INVALID_ENGINE_INPUT` 失败关闭 —— 账本被截断/替换/错配不得凭 journal 伪造幂等恢复。守卫精确性（rev 恰等合法、超 1 拒绝）已测试。

### E｜当前真实 Gate（本轮变更后，旧数字全部失效）

| Gate | 结果 |
| --- | --- |
| 变更前基线 full test | 559/559（exit 0，核实前一轮自报属实） |
| P1 focused（isolation 8 + journal-hardening 7 + p1-semantics 16） | **31/31** |
| 全部 v4life + work 相关 focused | **190/190** |
| HTTP quality script | **27/27** |
| full `npm.cmd test` | **574/574，0 失败**（559 + 新增 15） |
| `npm.cmd run typecheck` | 0 错误 |
| `npm.cmd run lint` | 0 问题 |
| `npm.cmd run build` | 完成（vinext） |
| 3100 验收服务 | 已用当前构建重启；`/api/v4life/cases/demo-sme-robot-500w`、`/work`、`/work/screen` 均 200，demo context 仍 major=1 SEALED |

### F｜未确认决策清单（不得替用户拍板）

① 四域核验与窗口命令的精确 Human Role（§11.3）；② 最终唯一贯穿主风险；③ stale 阈值；④ Context 自动封存/重开规则（含初始化是否预置 SEALED 批次）；⑤ 正式核验是否应产生 Receipt；⑥ 合成 seed 事实与完整 P1 Acceptance。以上任一确认后，对应 demo-only 语义可按用户决定晋升或删除。

### Codex 独立复验结果（2026-09-04 22:00）

- 裁决：`FUNCTIONAL_CANDIDATE_ACCEPTED / P1 PRODUCT ACCEPTANCE OPEN / PRODUCTION NOT READY`。
- 独立复跑：P1 focused 31/31、full 574/574、HTTP quality 27/27、typecheck/lint/build 全绿；localhost canonical API、`/work`、`/work/screen` 均为 200。
- 权威边界：strict 默认关闭未确认的 P1 命令与隐含窗口，demo 显式 opt-in；本轮不冻结精确 Human Role、自动封存、stale、正式核验 Receipt 或 seed。
- 持久化边界：故障注入证明已覆盖窗口内不重复事件/Receipt并失败关闭；文件双写仍非原子事务。rev 守卫能检测 journal 超前于事件流的截断/错配，不能证明抵抗同长度外部篡改；生产必须补事务数据库、唯一约束与更强一致性绑定。
- 端到端边界：P1 核验与 Context window 命令尚无 HTTP 路由，本裁决不等于 P1 操作面完成。
