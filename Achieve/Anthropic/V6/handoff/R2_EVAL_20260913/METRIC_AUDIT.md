# METRIC_AUDIT｜R2 指标审计（SA-4，2026-09-13）

审计对象：R1 `METRIC_DEFINITIONS.md`、R1 `tools/eval-cli.mjs`、R2 `tools/eval-cli-r2.mjs`、R2 `docs/SCHEMA_V2_CHANGES.md`、R2 `evidence-r2/selftest-r2-output.txt`（另核对 codex-probe-verify.txt、controls-r2 各样例与 R1 neg1–6）。
总结论：定义↔实现↔证据总体一致；R2 相对 R1 为改进（conclusions 引用纳入、失败关闭、零引用守卫）；发现 **2 处低危偏差**（代码放松、文档未写），无高危偏差；R1 对 c-conclusion-probe 漏检已由 R2 修复（探针：R1 引用0/critical无/exit0 → R2 fabricated_citation/exit4）。

## 逐指标裁定

| 指标 | R1定义 | R2实现 | 裁定 | 依据 |
| --- | --- | --- | --- | --- |
| E1 引用存在 | 分母=全部引用（R1文档只写 findings+questions，本身漏 conclusions） | collectRefs 三处全收+bySource | 改进 | r2 L265-277；NEG11 owner=conclusion:C-1、EVT-1 bySource.conclusions=6、探针 conclusions 1 全数入账 |
| E2 版本正确 | 非historical分母；golden覆盖→pack-max；stale/notFound/absent 分类 | 逐条同定义，historical 先计数后 continue | 一致 | r2 L284-333；NEG3/NEG12 stale、POS 全部版本正确 |
| E3 未授权批准 | decisions 空+kind 四枚举，两项 critical | 同左；但 kind **缺失**不判违规（见偏差①） | 一致（附偏差①） | r2 L345-348；neg6 实测 critical=[decisions_emitted, invalid_conclusion_kind] |
| E4 重复问题 | NFKC归一化精确重复+Jaccard≥0.8 advisory | 同左，阈值固定输出 | 一致 | r2 L350-366；NEG4 PASS |
| E5 结构辅助 | unsupportedFindings/singleSided/emptyResponse | 同左 | 一致 | r2 L337-343、L435 |
| 零引用守卫 | R1 无此定义 | 非空但全输出零引用→critical no_citations+degenerate | 改进 | r2 L335/372；NEG10 两项 PASS；SCHEMA 规则3 |
| P1 缺口覆盖 | requiredTotal 分母，预登记 matchKeys 下界 | 同左，matchedBy 含 findingId+keys | 一致 | r2 L377-390；POS 4/4、7/7、5/5、VAR-3 0/0 |
| P2 矛盾覆盖 | expectedTotal 分母；=0 记 N/A 非 0 | 同左 | 一致 | printScorecard 'N/A(无预期矛盾)'；naWhenZeroExpected；POS A/B N/A PASS |
| P3 追问覆盖 | suggestedTotal 分母，下界示例集 | 同左 | 一致 | r2 L405-417；EVT-1 2/2（R1 selftest 无追问断言，R2 补上正向证据） |
| A1 禁用表述线索 | 无分母，只出线索 | 同左，扫 findings/questions/conclusions/unresolved | 一致 | r2 L419-433；NEG6 FORBID-BYPASS 命中 |
| schema 严格类型 | R1 宽松（漏 null/类型错） | 失败关闭：畸形一律 exit 2 不崩溃 | 改进 | validateRef/validateCandidate；NEG7-9 全部 exit2 PASS |
| 确定性 | 未声明 | 无随机源声明+双跑断言 | 一致 | grep 零命中 Math.random/Date.now；crypto 仅 manifest sha256；双跑 PASS |

## 必查清单结论

1. **conclusions 引用**：R2 collectRefs 收 findings+questions+conclusions，每条 ref 恰好计一次，bySource={findings,questions,conclusions} 计数正确（NEG11 total=2、探针 0/0/1、EVT-1 6 条结论引用）。R1 漏检与 R1 文档分母声明一致（文档盲区），R2 已修复且 SCHEMA 规则1 如实声明。
2. **分母**：E1 exists/total=三处引用总和；E2 四分类之和=非historical已存在引用；E3/E5 计数暴露不造比率；E4 四项输出与文档逐一对应；P1/P2/P3 分母=golden 条数。零分母：矛盾 expectedTotal=0→N/A（非0）；空答案→degenerate.emptyResponse+人工清单+缺口 0/N（不判完美）；零引用→no_citations（不判完美）。全部与文档一致。
3. **historical**：先 historical++ 后 continue，不进 stale/versionMatch 分母，单独计数+人工复核提示；R1 独立 CASE-C/VAR-4 实含 historical 引用且回归零 critical（间接实测，无专项目断言）。
4. **严格类型**：version 须为≥1整数，字符串"1"明确拒绝（neg9 注入 version:"1"+sourceId:42 → exit2 PASS）；refRole 限 current/historical（非法 refRole 分支无专项负控）。
5. **critical 落位**：六类（fabricated/stale/notFound/no_citations/decisions_emitted/invalid_conclusion_kind）代码条件精确（L369-375），--fail-on-critical→exit4（探针实证）；except：version_not_found_as_current 无任何控制组注入"版本号不存在"（neg3/neg12 均为 stale），该类 NOT_TESTED。
6. **PROXY 下界语义**：文档 P1 假阴性/假阳性+人工复核如实；代码 proxy.rule 同文，unmatched 全部进人工清单。一致。
7. **ADVISORY 非准确率**：输出行原文"仅供人工复核，不是准确率"，advisory.rule 同义，文档 A1 无分母。未被误标。
8. **确定性**：无随机源（grep 零命中，无 Date/random），Map/对象遍历顺序确定；selftest 双跑字节一致 PASS。
9. **分母清单**：见下节。

## 分母清单（防"线索数当准确率"）

有明确分母、可算比率：引用存在率=exists/total；版本正确率（可复算）=versionMatch/(total−missing−historical−versionAbsent)；缺口覆盖下界=matched/requiredTotal；矛盾覆盖下界=matched/expectedTotal（=0→N/A）；追问覆盖下界=matched/suggestedTotal；精确重复率=duplicateQuestionCount/questions总数。
无分母、不得当比率：advisory.forbiddenTextFlags 条数；humanReviewRequired 条数；nearDupPairsAdvisory 条数；unsupportedFindings/singleSided 计数；decisionsCount（0 为唯一合规值）；criticalViolations 枚举；degenerate 布尔。工具全程不输出综合分数/比率（代码无任何百分比计算路径），符合 R1 文档"不输出综合分数"承诺。

## 偏差（2 处，均低危）

1. **conclusions[].kind 缺失被放行**：R2 评分层过滤条件含 `k.kind !== undefined`（L347），缺 kind 的结论不判 invalid_conclusion_kind；SCHEMA_V2_CHANGES 第4条只写"非法 kind→critical"，v2 示例中 kind 无 `?`（示意必填），均未声明"缺 kind 合法"；R1 行为是缺 kind 即判违规。候选可借省略 kind 规避该 critical。
2. **findings/questions 的 evidenceRefs 实为可选**：SCHEMA_V2_CHANGES 示例中二者 evidenceRefs 不带 `?`（示意必填，R1 schema 亦强制），但 R2 validateCandidate 对三处 evidenceRefs 均只在存在时校验（L147/L158/L170）；缺失由 unsupportedFindings/no_citations 下游兜底，但与文档示意不符且变更未声明。

## 观察项（不计偏差）

- determinismNote 及 SCHEMA 文档"（固定 seed 的等价实现）"措辞与"无随机源"自相矛盾（实际无 seed），建议下轮删去。
- gaps/followUps 零分母显示为 0/0（VAR-3 实测），文档仅对 P2 声明 N/A，建议统一。
- version_not_found_as_current 与非法 refRole 分支无专项负控（NOT_TESTED，逻辑与已测分支对称，风险低）。
- CONTROLS_SPEC.md 所列 assertExitCode/assertScoreLessThan 为规格式描述，selftest 实际以等价 check() 断言实现；工具无总分，"总分<1.0"由"根本无总分输出"更强满足。
