# README｜并行C交付（远程尽调合成案例与独立评估工具）

日期：2026-09-13。本目录是并行任务C的唯一写面，交付时冻结（READY_FOR_REVIEW）。

## 快速开始（零依赖，Node ≥ 18）

```bash
cd V6/handoff/PARALLEL_EVAL_20260913

node tools/eval-cli.mjs list                 # 查看案例与变体
node tools/eval-cli.mjs selftest             # 评估工具自测（49项，POS/NEG 控制组）
node tools/eval-cli.mjs score --candidate candidate-responses/controls/neg2-fabricated-ref.json --fail-on-critical
node tools/eval-cli.mjs score --candidate candidate-responses/independent/CASE-C.json --out /tmp/sc.json
node tools/eval-cli.mjs render --case CASE-C --variant VAR-4   # 阅读有效资料包
```

退出码：0 正常；2 用法/IO/schema 错误；3 selftest 失败；4 `--fail-on-critical` 且存在 critical 违规。

## 目录

```
CASE_MANIFEST.md        案例与变体清单（先读）
inputs/                 只含可给模型的事实与请求（task-request + 3案例 + 6变体 + SVG测试图形）
golden/                 评估端预期（缺口/矛盾/可接受追问/禁用结论/版本关系）——不得发给模型
candidate-responses/    independent/ = 人工撰写的独立参考答案（非模型输出）
                        controls/    = 6个注入错误模式的负控制
tools/eval-cli.mjs      零依赖评估CLI（score/render/list/selftest/manifest）
METRIC_DEFINITIONS.md   指标定义、分母、无法判定项、人工复核步骤
DEMO_SCRIPT.md          六分钟演示脚本草案（录制预算，非业务SLA）
evidence/               命令输出与评分卡存证
docs/manifest-meta.json 生成 MANIFEST.json 的元信息
STATUS.md / REPORT.md / MANIFEST.json
```

## 冻结的接口（schema v1）

| schema | 用途 | 关键字段 |
| --- | --- | --- |
| `jw-eval-case@1` | 案例资料包 | caseId/stages[].sources[]，source 内 facts[]：factId/text/status(claimed·recorded·observed·verified)/observationScope；同 sourceId 多版本并存表达替代 |
| `jw-eval-variant@1` | 变体派生 | basedOn + mutations(removeSource/addSource)；evaluationQuestion 唯一 |
| `jw-eval-request@1` | 给模型的统一任务请求 | instruction + boundary（modelAuthority=none） |
| `jw-eval-golden@1` | 评估端预期 | requiredGaps/expectedContradictions/acceptableFollowUps/forbiddenConclusions/currentVersions；matchKeys 为预登记别名 |
| `jw-eval-candidate@1` | 候选结构化结果 | candidateId/caseId/variantId/findings[]/questions[]/conclusions[]/decisions(必须空)/unresolved[]；evidenceRefs：{sourceId, version, refRole?: current·historical} |
| `jw-eval-scorecard@1` | 评分卡 | exact/proxy/advisory/humanReviewRequired/criticalViolations |

主任务后续把 A lane 适配器的输出映射为 `jw-eval-candidate@1` 即可评分；本格式冻结，不要求 A 修改其接口。

## 使用流程（真实模型接入后）

1. `resolvePack`（由 CLI 在 score 时自动执行）合成有效资料包 = 基础案例 + 变体 mutation；
2. 把 **inputs/task-request.json + 有效资料包** 交给模型（**不含 golden**）；
3. 模型输出映射为 `jw-eval-candidate@1`；
4. `score` 生成评分卡：EXACT 精确指标 + PROXY 覆盖下界 + ADVISORY 线索；
5. 按 METRIC_DEFINITIONS 人工复核清单终审。

## 三条不可绕过的边界

1. golden 与 inputs 严格分离：任何预期标签（好/中/坏、预期通过/否决）不进 inputs；golden 不作提示。
2. 对 independent/controls 的评分**只证明评估工具能工作**，不证明任何真实模型能力；本轮真实模型调用数 = 0。
3. 不构造统一信用分/定价公式/资料数量优惠规则；核算口径未配置时输出"无法完成"，不用默认值补齐。
