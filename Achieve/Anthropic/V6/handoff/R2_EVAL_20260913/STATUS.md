# STATUS｜R2_EVAL_20260913（并行C第二轮）

- 状态：**READY_FOR_REVIEW（冻结）**——2026-09-13 04:35 收束（早于 08:30 冻结线；Goal 工作包全部完成）。续改须先形成新批次。
- writer：R2 任务C（ZCode）。写面仅 `V6/handoff/R2_EVAL_20260913/`；`V6/handoff/PARALLEL_EVAL_20260913/`（R1批次，64/64哈希复核零改动）、产品代码、其他 lane、Codex 报告全部只读。
- 真实模型调用 0、产品 API 调用 0、无 Git 写、未操作 Codex、无新依赖、无服务占用。

## Goal 接收与收束记录（ZCODE_GOALS_TO_0900_20260913.md + ZCODE_GOAL_C_TO_0700_20260913.md）

- 接收 03:33（系统时间已核实）；按 Goal 覆盖执行：并发默认2/最多3（SA-5+SA-6、SA-7+SA-8、SA-9 均合规），限流退避未重试风暴；08:30 冻结线前完成全部工作包，提前收束。
- 工作包1–7 全部交付（见 REPORT.md 第二部分）；收束产物：MORNING_REPORT.md（accepted-candidate/changes-required/deferred/手机演示缺口）、SCENARIO_COVERAGE.md、SCORER_ADVERSARIAL_REVALIDATION.md（SA-9：误报0/漏报3/不确定1，其中2项已修复）、AGENT_LEDGER.md、MANIFEST.json（90文件）。

## 最终验证状态

- selftest-r2：**109/109，exit 0**（含 R1 全量回归 15 控制组 + 7 场景正控 49 断言 + neg7–16 断言（neg16=缺version负例：versionAbsent计数+人工复核路由）+ 确定性）
- metamorphic：**10/10，exit 0**（T1–T5；T4 曾抓到真缺陷并修复）
- Codex 探针对照：R1 exit0 漏检 → R2 `fabricated_citation` exit4
- 适配器映射三态：正常映射 / status拒绝 / 缺version拒绝
- golden 泄漏：候选可见面（render 输出）7 场景 × 评估端标记 = 0 命中
- MANIFEST 复跑字节稳定；R1 批次零回写

## 给主任务的接手提示

- 评分入口：`node tools/eval-cli-r2.mjs score --candidate <jw-eval-candidate@1|@2 文件>`；`--pack` 可喂变换副本（metamorphic 用）
- A 适配器结果接入：`node tools/map-adapter-to-candidate.mjs --adapter-result <file> --case CASE-X [--variant V]`（失败关闭，映射表见 docs/A_ADAPTER_MAPPING.md）
- 演示拍摄按 MOBILE_DEMO_STORYBOARD.md v2 五段式；手机演示缺口清单见 MORNING_REPORT.md
- golden（R1 golden/ 与 R2 golden-r2/）不得进入任何模型或产品请求

## Goal 接收记录（ZCODE_GOALS_TO_0900_20260913.md + ZCODE_GOAL_C_TO_0700_20260913.md）

- 接收时间：2026-09-13 03:33（系统时间已核实）。截止：北京时间 09:00；08:30 冻结新增范围；08:50 起晨报与安全收束。
- Subagent 并发：默认 2、最多 3；限流退避降并发（上一轮 SA-2/SA-3 曾遇[1302]限速，本轮遵守退避）。
- 已完成（Goal 工作包1）：conclusions 引用漏检修复、全字段 schema、畸形输入失败关闭、零分母守卫、冻结输出隔离、R1 全量回归——selftest-r2 60/60；SA-4 指标审计返回 2 处低危偏差（缺 kind 放行、findings/questions evidenceRefs 放松未文档化），本 slice 立即修复。
- 接续工作包：2–4 场景族（生命周期/前序越权/人机冲突/语音纠偏扩展/会话归属/提醒去重/挂断接续/权限规则）→ 5 metamorphic → 6 A适配器映射与独立坏例复验 → 7 分镜v2（五行总览→全屏访谈→文字Agent辅助→纠偏/确认→挂断回聊天）→ 覆盖报告 → MORNING_REPORT.md。

## 已读输入

| 文件 | 要点 |
| --- | --- |
| AGENTS.md（根） | 权威顺序、单writer、Human authority、完成Gate |
| V6/ZCODE_FOUR_TASKS_ROUND2_20260913.md | R2协调入口：原生subagent大规模并行、AGENT_LEDGER、iPhone 17标准版402×874竖屏主基准、手机90–95%精力、语音核心要求、解说页只交事件与字段建议 |
| V6/CODEX_REVIEW_FOUR_TASKS_20260913/REPORT.md | C项缺陷：collectRefs漏conclusions（c-conclusion-probe引用0、critical无、exit0）；需全输出引用、畸形输入失败关闭、独立负控制、零分母不判完美、手机演示脚本改版 |
| V6/ZCODE_R2_C_20260913.md | 本轮指标与交付清单 |

## 修复方案（已冻结，v2）

1. **候选schema v2**（`jw-eval-candidate@2`）：conclusions 新增可选 `evidenceRefs[]`，与 findings/questions 的引用走同一 collectRefs；v1 候选继续合法（union 接受），R1 旧答案不回写、作为回归正控制复用。
2. **引用分类报告**：fabricated / stale-as-current / version-not-found / version-absent 分别列出，含 `bySource`（findings/questions/conclusions）计数。
3. **畸形输入失败关闭**：null、非对象、字段类型错误、嵌套畸形（ref非对象、version为字符串等）→ 明确 schema 失败 exit 2，绝不未捕获崩溃、绝不部分评分。
4. **零分母守卫**：findings+questions+conclusions 非空但全输出零引用 → critical `no_citations`；空答案维持 emptyResponse 标记；语义指标仍人工复核。
5. **每类新错误独立负控制**：neg7–neg12（null/类型错/嵌套畸形/零引用/结论捏造引用/结论过期引用），R1 neg1–6 全部保留为回归。
6. **EVT-1 合成事件场景**：语音草稿→ASR关键金额错误→用户手机更正→旧依据下游失效（标注/复核/核算 stale），只测事件数据，标注"非真实ASR接通"。
7. **手机演示分镜**（MOBILE_DEMO_STORYBOARD.md）：402×874 主基准；每案例列手机操作者/看见的依据/输入或纠偏/后端事件/下游变化/待谁判断；解说页仅事件与展示字段建议。
8. **确定性**：工具无随机源；`--seed` 概念不适用，以双跑字节一致断言替代；输出只写本批次 evidence-r2/，不回写冻结批次。

## 文件 ownership（单writer）

| writer | 文件 |
| --- | --- |
| 主agent | STATUS/REPORT/MORNING_REPORT/MANIFEST/AGENT_LEDGER/README-R2/SCENARIO_COVERAGE、tools/eval-cli-r2.mjs、tools/metamorphic-test.mjs、tools/map-adapter-to-candidate.mjs、tools/fixtures/、inputs-r2/（EVT-1及SCN-3/4/5包）、golden-r2/（EVT-1及SCN-3/4/5 golden）、neg13–neg16、docs/、evidence-r2/ |
| SA-1（对抗） | candidate-responses/controls-r2/neg7…neg12.json + CONTROLS_SPEC.md |
| SA-2（独立答案） | candidate-responses/independent-r2/EVT-1.json |
| SA-3（分镜v1） | MOBILE_DEMO_STORYBOARD.md（v1基础） |
| SA-4（指标审计） | METRIC_AUDIT.md |
| SA-6（场景族族B） | inputs-r2/variants/EVT-2、SCN-1、SCN-2 包 |
| SA-7（正例答案） | candidate-responses/independent-r2/EVT-2、SCN-1…SCN-5.json |
| SA-8（分镜v2） | MOBILE_DEMO_STORYBOARD.md（v2增量修订） |
| SA-9（独立复审） | SCORER_ADVERSARIAL_REVALIDATION.md + evidence-r2/adversarial/ |
| （SA-5 限速零产出，其范围由主agent补写） | — |

## 进度（终局）

- [x] 接手确认 + Goal 接收记录（03:33，系统时间核实）
- [x] schema v2 冻结 + CLI-R2 实现（含 SA-4 偏差修复：kind/refs 必填、字段允许名单）
- [x] EVT-1/EVT-2/SCN-1..5 场景与 golden（评估端）+ neg13–neg16
- [x] subagent 并行：负控制/独立答案/分镜/指标审计/场景族/正例答案/分镜v2/独立复审（9路，限流3次如实记录）
- [x] selftest-r2 109/109 + metamorphic 10/10 + 全量评分 + 回归 + golden泄漏0 + MANIFEST 复跑稳定
- [x] REPORT / MORNING_REPORT / MANIFEST / AGENT_LEDGER → **READY_FOR_REVIEW 冻结**
