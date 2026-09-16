# AGENT_LEDGER｜R2_EVAL_20260913 subagent 并行台账

协调授权：`V6/ZCODE_FOUR_TASKS_ROUND2_20260913.md` + `V6/ZCODE_GOALS_TO_0900_20260913.md`（Goal 4 覆盖：并发默认2/最多3、限流退避）。主agent：R2任务C执行者。**并发峰值：2**（SA-1/2/3 首轮曾达3；Goal 覆盖后 SA-5+SA-6、SA-7+SA-8 均为2）。开发额度读数不可得，资源记录中额度一栏如实记"未知"。

| # | 目标 | owner(subagent) | 关键输入（sha256前12位） | 输出文件（唯一writer） | 结果 | 资源记录 |
| --- | --- | --- | --- | --- | --- | --- |
| SA-1 | 对抗负控制：neg7–neg12 + 规格书 | general-purpose | docs/SCHEMA_V2_CHANGES.md `c7b8af754ac8`（v1版） | candidate-responses/controls-r2/neg7…neg12.json、CONTROLS_SPEC.md | **完成**：6 JSON 全部校验通过；selftest 按预期识别 | tokens≈146,696；tool_uses=10；时长≈423s；额度未知 |
| SA-2 | EVT-1 独立参考答案 | general-purpose | inputs-r2/variants/EVT-1-*.json `6d34384b4181`；golden-r2/EVT-1.golden.json `d36d7587c49d`；case-B.json `50b409f3d53d` | candidate-responses/independent-r2/EVT-1.json | **完成**（限速发生在写后自验阶段，文件完整）：selftest 六项断言全过 | 时长≈1309s后遇[1302]限速终止；额度未知 |
| SA-3 | 手机演示分镜 v1 | general-purpose | case-{A,B,C}.json（`fe6640f1f2c3`/`50b409f3d53d`/`79df38b5e69a`）；EVT-1 `6d34384b4181`；R1 DEMO_SCRIPT.md `f5dea8df4b51` | MOBILE_DEMO_STORYBOARD.md | **完成**（限速发生在回报阶段，文档完整）：主agent逐字审读采信 | 时长≈820s后遇[1302]限速终止；额度未知 |
| SA-4 | 指标审计（定义↔实现↔证据） | general-purpose | R1 METRIC_DEFINITIONS.md `d5a7a1af1df8`；R1 eval-cli.mjs `a1538de7bc93`；R2 eval-cli-r2.mjs（修复前）`4826f19f392a`；SCHEMA_V2_CHANGES.md；selftest证据 | METRIC_AUDIT.md | **完成**：总体一致，2处低危偏差（缺kind放行、evidenceRefs放松未文档化）——主agent已修复（见主agent行Slice1），修复后 selftest 63/63 | tokens≈413,685；tool_uses=13；时长≈474s；额度未知 |
| SA-5 | 场景族起草：族A/族C（SCN-3/4/5包） | general-purpose | EVT-1范本 `6d34384b4181`；case-{A,B,C}.json | inputs-r2/variants/SCN-3…SCN-5.json | **失败**：启动后遇[1302]限速，**零产出**；由主agent按同一规格补写（见主agent行Slice2b），未重试风暴 | 时长≈294s后遇[1302]限速终止；额度未知 |
| SA-6 | 场景族起草：族B（EVT-2/SCN-1/SCN-2包） | general-purpose | 同SA-5规格 | inputs-r2/variants/EVT-2…SCN-2.json | **完成**：3包结构/无标签泄漏/长度全部达标，主agent验证通过 | tokens≈147,263；tool_uses=8；时长≈495s；额度未知 |
| SA-7 | 六场景正例答案（EVT-2/SCN-1..5） | general-purpose | 各场景包+golden（评估端writer可见golden） | candidate-responses/independent-r2/EVT-2、SCN-1..5.json | **完成**：6份全绿（critical无、缺口/矛盾/追问全覆盖、禁用串0命中——含37串归一化全文扫描）；SCN-3/4/5单侧矛盾如实暴露留人工复核 | tokens≈963,877；tool_uses=29；时长≈1322s；额度未知 |
| SA-8 | 分镜v2：手机五段式流程修订 | general-purpose | MOBILE_DEMO_STORYBOARD.md v1（18,348B）；EVT-1 `6d34384b4181`；SCN-2包（第5段语义参照，只读） | MOBILE_DEMO_STORYBOARD.md（增量修订，219行，v2标注） | **完成**：五段式（五行总览→全屏访谈→文字Agent→纠偏/确认→挂断回聊天）全部落实，三案例分镜表与EVT-1插播保留，v2修订记录10条在文末；主agent抽查通过 | tokens≈335,735；tool_uses=19；时长≈1263s；额度未知 |
| SA-9 | 独立坏例复验评分器（误报/漏报/不确定） | general-purpose | eval-cli-r2.mjs（复审时为修复前版本）；SCHEMA_V2_CHANGES.md；R1 METRIC_DEFINITIONS.md；golden与inputs（只读对拍） | SCORER_ADVERSARIAL_REVALIDATION.md + evidence-r2/adversarial/adv1..8.json | **完成**：误报0/漏报3/不确定1；漏报中2项（未知字段走私决定、矛盾假覆盖无复核路由）由主agent当日修复并实测（evidence-r2/adversarial-fix-verify.txt），1项（homoglyph去重绕过）接受为已知局限；审查全程零污染（33文件sha256对拍） | tokens≈835,999；tool_uses=27；时长≈776s；额度未知 |
| 主 | STATUS、schema v2、eval-cli-r2.mjs（含SA-4审计修复、T4顺序无关修复、--pack、字段允许名单失败关闭、sidesCited与假覆盖复核路由）、metamorphic-test.mjs、map-adapter-to-candidate.mjs、SCN-3/4/5包、六golden、neg13–neg16、EVT-1 golden/场景、SCENARIO_COVERAGE、MORNING_REPORT、文档、evidence-r2 | 主agent | 四份任务/Goal文件 + R1/A批次（只读） | 见 MANIFEST.json | 全部实测验证（selftest 109/109、metamorphic 10/10、映射三态、探针对照、adv4/adv6修复验证、golden泄漏0） | 额度未知 |

## 限流事件记录（如实）

- [1302] 限速共3次：SA-2（写后自验阶段）、SA-3（回报阶段）——产出完整已采信；SA-5（启动早期）——零产出，主agent补写。
- 应对：Goal 覆盖后并发降至默认2；SA-4/SA-6/SA-7/SA-8 均单路顺序派发，未重试风暴、未嵌套绕过。
- 无产出丢失；无因限速降级验收项。

## 单writer核对

SA-1/2/3/4/6/7/8 各只写自己名下文件；SA-5 零产出无冲突；主agent未改任何 subagent 产出（MOBILE_DEMO_STORYBOARD.md 的 v2 修订.writer 为 SA-8，v1 为 SA-3，修订记录在文档内注明）。
