# README-R2｜并行C第二轮交付（评估盲点修复与手机演示证据）

日期：2026-09-13。写面仅 `V6/handoff/R2_EVAL_20260913/`；R1 批次（`../PARALLEL_EVAL_20260913/`）与产品代码只读。

## 本轮修复（对照 CODEX_REVIEW_FOUR_TASKS_20260913/REPORT.md C项）

| 验收缺陷 | 修复 | 证据 |
| --- | --- | --- |
| collectRefs 漏 conclusions：c-conclusion-probe.json 引用0、critical无、exit0 | v2 schema（conclusions 可带 evidenceRefs）+ collectRefs 三处统一收集；R1/R2 CLI 对同一探针对照复验 | evidence-r2/codex-probe-verify.txt（R1 exit0 → R2 fabricated_citation exit4） |
| 需全输出引用、分类报告 | citations.bySource（findings/questions/conclusions）+ fabricated/stale/not-found/absent 分别列出 | evidence-r2/scorecards/*.scorecard.json |
| 畸形输入需失败关闭 | validateCandidate 全面严格化（null/类型错/嵌套畸形/ref.version字符串等→明确schema失败exit2，不崩溃不部分评分） | neg7/8/9 exit=2；selftest-r2 |
| 零引用/空答案不得因分母0完美 | 新critical `no_citations` + degenerate 标记；空答案维持 emptyResponse | neg10 exit=4 |
| 新错误类别需独立负控制、正确样例不误伤 | neg7–neg12（SA-1产出）+ R1九正控/六负控全量回归 | selftest-r2 60/60（evidence-r2/selftest-r2-output.txt） |
| 固定seed重跑确定性 | 工具无随机源；同候选双跑字节一致断言 | selftest-r2 末项；manifest 可重复生成 |
| 手机演示改版 | MOBILE_DEMO_STORYBOARD.md（402×874主基准、三案例事件分镜表、EVT-1语音纠偏插播、解说页字段建议） | 该文档 |
| golden 仅留评估端 | golden-r2/ 独立目录 + 评分卡声明字段 + README 边界 | 结构与声明 |

## 快速开始

```bash
cd V6/handoff/R2_EVAL_20260913
node tools/eval-cli-r2.mjs list                  # R1基线+R2增量
node tools/eval-cli-r2.mjs selftest              # 60/60
node tools/eval-cli-r2.mjs score --candidate candidate-responses/independent-r2/EVT-1.json
node tools/eval-cli-r2.mjs score --candidate candidate-responses/controls-r2/neg11-conclusion-fabricated-ref.json --fail-on-critical   # exit 4
```

## 目录

```
STATUS.md / REPORT.md / MANIFEST.json / AGENT_LEDGER.md / METRIC_AUDIT.md
README-R2.md            本文件
docs/SCHEMA_V2_CHANGES.md   候选/评分卡 schema v2 冻结说明
docs/manifest-meta.json     MANIFEST 元信息
inputs-r2/variants/EVT-1-voice-correction.json   语音纠偏事件场景（addSource到CASE-B）
golden-r2/EVT-1.golden.json                      评估端预期（不给模型）
candidate-responses/independent-r2/EVT-1.json    人工独立答案（positive control，v2示范）
candidate-responses/controls-r2/neg7…neg12 + CONTROLS_SPEC.md   新负控制
MOBILE_DEMO_STORYBOARD.md                        手机演示分镜（SA-3）
tools/eval-cli-r2.mjs                            R2评估CLI（读R1基线只读）
evidence-r2/                                     命令输出与评分卡
```

## schema 兼容

候选 `jw-eval-candidate@1` 与 `@2` 均接受；v2 = conclusions 可带 evidenceRefs。R1 的 9 份独立答案与 6 个负控制原样只读复用作回归，零回写。

## 三条不可绕过的边界（沿用并强化）

1. golden（R1 golden/ 与 R2 golden-r2/）只存评估端，不进任何模型请求。
2. 对 independent/controls 的评分只证明评估工具能工作；真实模型质量仍未知（NOT TESTED）。
3. 不构造信用分/定价/资料数量优惠；核算口径未配置即"无法完成"。
