# REPORT｜并行任务C交付报告

日期：2026-09-13。结论：**交付完成，READY_FOR_REVIEW**。全部命令证据在 `evidence/`；文件清单与哈希在 `MANIFEST.json`。

## 逐项完成情况（对应任务文件"产物"1–7）

| # | 要求 | 交付 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 三个明确合成的基础案例（一致/缺口/矛盾），匿名合成、不影射、不声称用户提供 | inputs/case-{A,B,C}/case.json（schema jw-eval-case@1），meta 内置 disclaimers | PASS | CASE_MANIFEST.md；`render` 输出（evidence/cli-extra-checks.txt） |
| 2 | 按阶段组织五类材料，每条事实带 sourceId/version、来源类型、声称与已核实区别、未观察≠不存在 | 每案例 S1–S5 五阶段；status 四级（claimed/recorded/observed/verified）+ observationScope；meta.observationRule 全案例写入 | PASS | case.json 全文；CASE_MANIFEST.md 表 |
| 3 | ≥6类有效变体，一变体一评估问题，不凑数 | VAR-1…VAR-6（缺核心文件/同源重复/编号时间矛盾/版本替代/专业分歧/经济性口径），mutation 派生 + derivationNote 区分度说明 | PASS | inputs/variants/*；`list` 输出 |
| 4 | inputs 只含事实与请求；golden 只含评估端预期；标签不进 inputs；案例不预设审批结果 | inputs/task-request.json + 案例包零预期字段；golden/ 九文件独立目录；golden notes 明示"不得作为提示" | PASS | 目录结构；golden/README 交叉引用 |
| 5 | 无新依赖评估 CLI，读候选结构化结果，计引用存在/版本正确/未授权批准/缺口漏报/矛盾覆盖/重复问题，区分精确与语义，不用关键词伪称准确率 | tools/eval-cli.mjs（~500行，仅 node: 内置模块）；EXACT/PROXY/ADVISORY 三层分离（METRIC_DEFINITIONS） | PASS | evidence/selftest-output.txt；evidence/score-runs.txt |
| 6 | 评估端 positive/negative controls：全空/捏造引用/复用旧版本/重复问题/流畅漏矛盾/绕过人工门，工具应暴露；模拟成绩只证明工具能工作 | controls/neg1…neg6 + 9份独立答案作 pos；selftest 49/49 通过；评分卡内置声明字段 | PASS | evidence/selftest-output.txt（exit 0）；neg2 exit=4（evidence/cli-extra-checks.txt） |
| 7 | 六分钟演示脚本草案：传统三例在前/远程同三例在后、同输入同问题、无稻草人、无编造收益、计时为录制预算、实控人现场+财务/生产参与、未接会议显著标示 | DEMO_SCRIPT.md（时间轴 0:00–6:00 + 六条演示纪律 + 物料清单 + 未决项） | PASS（草案） | DEMO_SCRIPT.md |

## 指标与边界要求

| 要求 | 落实 |
| --- | --- |
| 判分定义、分母、无法判定项、人工复核步骤 | METRIC_DEFINITIONS.md 逐指标给出；humanReviewRequired 清单随评分卡输出 |
| 不构造统一信用分/定价公式/多资料优惠 | 工具无综合分、无通过线；评分卡 declaration 明示；案例与 golden 均不编码该规则 |
| 不声称数据充分=风险低 | FORBID-COUNT 类禁用结论进全部 golden；VAR-2 专项测试同源重复 |
| 核算未配置输出缺口、不填默认值 | 三案例经济性口径缺口入 golden；VAR-6 专项测试；FORBID-DEFAULT-FILL/FORBID-DISCOUNT |
| 保留专业分歧与有价值下一问、允许暂停 | VAR-5 专项（分歧保留为期望结果）；acceptableFollowUps；全部 pos 答案含 unresolved/暂停表述且为 golden 接受 |

## 自测结果摘要

- selftest：**49/49 PASS，exit 0**（evidence/selftest-output.txt）
  - POS：3基础案例 + 6变体，critical=0、缺口/矛盾覆盖满格、无重复、无禁用表述线索
  - NEG1 空答案 / NEG2 捏造引用（exit 4）/ NEG3 过期版本 / NEG4 重复问题 / NEG5 流畅漏矛盾（EXACT 全绿仅 PROXY+人工层暴露，证明三层设计必要）/ NEG6 绕过人工门（结构违规+文本线索双暴露）全部被工具识别
- 确定性：同一候选双跑评分卡 sha256 完全一致（evidence/list-and-determinism.txt）
- 失败路径：缺参数 exit 2、--fail-on-critical exit 4、selftest 失败 exit 3（设计值）

## 已知限制（如实）

1. PROXY 层 matchKeys 是下界：假阴性/假阳性均可能，必须人工复核（正控制曾撞一次别名歧义，已记录在 METRIC_DEFINITIONS 作为该层只做线索的实证）。
2. 近似重复（Jaccard≥0.8）为 advisory，未做语义级问题等价判断。
3. SVG 测试图形为示意 fixture，无多模态评测通道；本轮候选全部为纯文本。
4. 会议页面镜头物料依赖主任务页面现状，DEMO_SCRIPT 已列为未决项。
5. 独立答案是人工撰写的参考实现，用于示范与工具验证；**不是**任何模型能力证据。
6. 本交付未运行共享 build/typecheck（无产品代码改动）；CLI 语法与行为由 selftest + 九次评分 + 失败路径实测覆盖。

## 冻结声明

本批文件自 READY_FOR_REVIEW 起冻结；续改须形成新的明确批次。候选接口 schema 冻结为 v1（README），主任务映射适配时若发现不符，按并行协调文件记录映射，不由本 lane 单方改接口。
