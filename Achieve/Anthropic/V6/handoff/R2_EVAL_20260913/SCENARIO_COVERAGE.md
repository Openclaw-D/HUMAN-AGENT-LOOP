# SCENARIO_COVERAGE｜场景族覆盖报告（R2_EVAL_20260913）

要求来源：`V6/ZCODE_GOAL_C_TO_0700_20260913.md` 验收指标——覆盖报告列**场景族/种子/断言/人工未判/修复建议**，不给虚构综合信用分。本报告只描述"评估器+场景库"的能力覆盖，**不描述任何真实模型能力**（本轮真实模型调用=0）。

## 1. 场景族总表

| 场景族（Goal工作包） | variantId | basedOn | 注入来源 | 子场景设计（正/反/边界 → factId） | golden 预期 | 控制组 |
| --- | --- | --- | --- | --- | --- | --- |
| 语音/转写（wp3） | EVT-1（R1批次已有，本轮纳入） | CASE-B | B-EVT-01 | 金额误识四千二百万→更正→下游失效 | gaps×5、contras×3、forbidden×5 | pos: independent-r2/EVT-1.json；neg3（过期版本） |
| 转写纠偏扩展：否定词/单位（wp3） | EVT-2 | CASE-B | B-EVT-21 | 正:否定词丢失+未确认标记(S1)；反:单位错误未纠正入下游(S2)；边界:期间歧义保持待定(S3) | gaps×4、forbidden×5（含FORBID-ASR-TRUST/AUTO-RESOLVE） | pos: independent-r2/EVT-2.json |
| 会话归属/在场控制（wp3） | SCN-1 | CASE-C | C-EVT-11 | 正:归属与身份分离(S1)；反:离会后错误归属(S2)；边界:"仅本人控制"按当时观察(S3) | gaps×3、forbidden×4（含FORBID-ATTRIBUTION） | pos: independent-r2/SCN-1.json |
| 提醒去重/挂断接续（wp3） | SCN-2 | CASE-B | B-EVT-22 | 正:dedup正确(S1)；反:重复创建待办(S2)；边界:挂断后接续缺失(S3) | gaps×2、forbidden×4（含FORBID-SILENT-CLOSE） | pos: independent-r2/SCN-2.json |
| 生命周期/前序预处理（wp2） | SCN-3 | CASE-A | A-EVT-31 | 正:前序pending仅预处理(S1)；反:阶段完成被夸大为全流程完成(S2)；边界:起租75%后监控仍在+混写(S3) | gaps×3、contras×1、forbidden×4（含FORBID-PRECONDITION-OVERREACH） | pos: independent-r2/SCN-3.json；**neg15**（前序越权：decisions_emitted+非法kind+文本线索，exit4） |
| 人机冲突新旧/意见并存（wp2） | SCN-4 | CASE-B | B-EVT-41 | 正:人工纠正优先(S1)；反:新替旧无再确认(S2)；边界:意见与行动并存——期望状态(S3) | gaps×3、contras×1、forbidden×4（含FORBID-MACHINE-OVERRIDE/FLATTEN） | pos: independent-r2/SCN-4.json |
| 权限与规则边界（wp4） | SCN-5 | CASE-C | C-EVT-51 | 正:case-scoped纠偏(S1)；反:无授权的全局规则声明(S2)；边界:授权pending+模型自升权限矛盾(S3) | gaps×3、contras×1、forbidden×4（含FORBID-SELF-GRANT） | pos: independent-r2/SCN-5.json |
| 基础案例+变体（R1，回归基座） | CASE-A/B/C、VAR-1..6 | — | — | 见R1 CASE_MANIFEST | 3+6 golden | 9 pos + 6 neg 全量回归（selftest-r2） |
| 缺陷类负控制（wp1） | neg7–neg15 | — | — | null/类型错/嵌套畸形/零引用/结论捏造引用/结论过期引用/版本不存在/缺kind规避/前序越权 | —（自身即断言目标） | 全部被 selftest-r2 + 退出码断言捕获 |

## 2. 断言分层（精确 vs 人工代理）

**机器精确断言（selftest-r2 63/63 + metamorphic 10/10 + 退出码）**：
- 全输出引用检查（findings/questions/conclusions，bySource 计数）；fabricated / stale-as-current / version-not-found / version-absent / 缺kind / decisions 越权 / 零引用，各自独立负控制暴露，`--fail-on-critical` exit≠0。
- 畸形输入失败关闭（neg7–9，exit 2，逐条中文 schema 错误，无未捕获崩溃）。
- 确定性（双跑字节一致）；顺序无关（T4，发现并修复 factStatus 键序漂移）；无关文字/同源重复不改变 EXACT 评分（T2/T3）；版本替换翻转 stale 判定（T5）。
- 零分母守卫（no_citations critical；矛盾分母0→N/A 非0）。

**人工代理指标（工具只给线索，须人工终审）**：
- PROXY matchKeys 别名覆盖：同义词漏配=假阴性、别名歧义=假阳性。T1 metamorphic 实证：候选语义改写后别名覆盖可能下降（本轮探针恰好0下降，机制上允许），因此**别名覆盖不得当风险识别正确率使用**。
- ADVISORY 禁用表述线索：关键词命中无法区分否定/引用语境，仅作人工复核入口。
- 子场景语义质量（如"归属存疑是否被当作矛盾点出"）：golden matchKeys 只保证主题命中，语义判断在人工。

## 3. 人工未判清单（本轮无法机器化，留给主任务/Codex）

- 六个新场景正例答案的语义质量终审（pos 控制只证明 golden 自洽，不证明模型能力）。
- 前序越权（SCN-3）文本层判定：结构层已机器检测（decisions），文本暗示性越权仍需人读。
- golden matchKeys 的同义词完备性（每个别名表都可继续扩充，扩充须走新 golden 批次）。
- 挂断接续（SCN-2 S3）"未指派责任人"在产品侧是否需要 UI 提醒——产品缺口，见 §4。

## 4. 修复建议（给主任务，非本写面动作）

1. **语音草稿关键字段**：产品侧草稿应带"关键字段未确认"标记并把 ASR 候选值与确认值分列（EVT-1/EVT-2 场景即验收脚本）。
2. **会话归属**：转写归属须绑定说话人身份事件；离会后发言自动标"归属存疑"（SCN-1）。
3. **提醒去重**：同一待办多来源提醒在事件流合并计数（SCN-2）。
4. **挂断接续**：会话结束时不关闭未接续待办，固定"待人判断"区（SCN-2、分镜v2第5段）。
5. **前序门**：正式审批 pending 时产品界面可执行动作集合应收敛为预处理类（SCN-3；产品侧 RUN actions 收敛属主任务）。
6. **人机冲突**：模型新输出替代人工判断必须产生"待人工再确认"事件（SCN-4 S2）。
7. **权限边界**：全局规则变更与代办范围扩大的 UI 入口必须挂在人员授权事件之后；模型输出不得出现授权字样（SCN-5）。

## 5. 声明

本报告无综合信用分、无通过率——评估器输出的是分层指标与线索，通过与否由人工按 METRIC_DEFINITIONS/AUDIT 流程判定。真实模型质量 NOT TESTED。
