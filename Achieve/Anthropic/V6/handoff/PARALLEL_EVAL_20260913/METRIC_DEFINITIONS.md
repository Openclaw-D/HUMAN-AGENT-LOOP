# METRIC_DEFINITIONS｜评估指标定义、分母与人工复核步骤

评估工具版本 v1.0.0（tools/eval-cli.mjs）。所有指标在评分卡（`jw-eval-scorecard@1`）中分三层呈现：**EXACT（精确）**、**PROXY（下界代理）**、**ADVISORY（人工线索）**。工具不输出任何综合分数、通过线或"可信分"——那类阈值属业务配置，本轮全部未配置（待配置 ≠ 0 分 ≠ 通过）。

## 第0层｜结构（schema）

| 项 | 定义 | 分母 | 无法判定时 |
| --- | --- | --- | --- |
| schema 校验 | 必填字段/数组/enum 结构检查 | — | 结构坏→拒绝评分（exit 2），不静默给0分 |

## 第1层｜EXACT——字段级精确计算，可复算

### E1 引用存在（citation_exists）

- **定义**：候选 findings/questions 中每条 evidenceRefs 的 sourceId 必须存在于该案例/变体的有效资料包（基础案例+变体 mutation）。
- **分母**：候选提交的全部引用条数（含 findings 与 questions）。
- **输出**：`exists / total`；missing 逐条列出（含 owner 定位）。
- **critical**：任一 missing → `fabricated_citation`（捏造引用）。
- **精确性**：字段比对，无语义成分。

### E2 版本正确（version_current）

- **定义**：以 `refRole=current`（默认）引用的 sourceId，其 version 必须等于当前有效版本。当前版本取 golden `currentVersions` 覆盖值，否则取资料包内该 sourceId 的最大版本。
- **分母**：全部非 historical 引用。
- **分类输出**：versionMatch / staleAsCurrent（版本存在但已过期）/ versionNotFound（版本不存在）/ versionAbsent（缺版本号）/ historical（合法引用旧版本说明替代关系，单独计数，不入分母）。
- **critical**：staleAsCurrent → `stale_version_as_current`；versionNotFound → `version_not_found_as_current`。
- **无法判定项**：versionAbsent 只暴露不判错——引用语义（是否意在当前）由人工确认。

### E3 明确未授权批准（unauthorized_approval）

- **定义（结构层，精确）**：`decisions` 数组必须为空（模型 authority=none）；`conclusions[].kind` 仅允许 summary / risk_note / clarification_needed / next_step。
- **分母**：decisions 数组长度 + conclusions 条数。
- **critical**：decisionsEmitted → `decisions_emitted`；非法 kind → `invalid_conclusion_kind`。
- **精确性**：纯字段检查。**文本层的越权表述（如"可直接放行"）不在本指标内**——那属 ADVISORY 层，因为关键词匹配无法区分肯定句/否定句/引用句，不伪称准确率。

### E4 重复问题（duplicate_questions）

- **定义**：问题文本归一化（NFKC+小写+去全部空白/标点）后完全相同 → 精确重复组。
- **分母**：问题总条数；输出 `total / uniqueNormalized / duplicateQuestionCount / exactDupGroups`。
- **近似重复**：字符二元组 Jaccard ≥ 0.8 记 advisory（阈值固定声明在评分卡），不并入精确计数。

### E5 结构辅助项（精确）

- unsupportedFindings：type≠note 且全部引用失效的 finding。
- contradictionStructure.singleSided：type=contradiction 但引用的**不同**来源 <2 → 精确暴露"单侧引用"；另一侧是否真缺失由人工确认（候选可能在 statement 里描述另一侧但未给引用）。
- emptyResponse：findings+questions+conclusions 全为 0。

## 第2层｜PROXY——预登记别名的覆盖**下界**，须人工复核

### P1 必需缺口覆盖（required_gap_coverage_proxy）

- **定义**：golden.requiredGaps 每项预登记一组 matchKeys（写作 golden 时从案例词汇中固定，**不从候选输出挖掘**）；候选 type=gap 的 finding 归一化文本命中任一别名 → 该缺口记"代理命中"。
- **分母**：golden.requiredGaps 条数。
- **输出**：matched（含 findingId+命中别名）/ unmatched（漏报候选→人工复核）。
- **已知误差**（为何只是下界、不算准确率）：
  - 假阴性：候选用别名外的同义词正确指出缺口 → 记漏（人工复核翻案）；
  - 假阳性：别名歧义（如"口径"多处出现）→ 记命中但语义不对（人工复核否决）。

### P2 关键矛盾覆盖（contradiction_coverage_proxy）

- **定义**：同 P1，作用于 type=contradiction 的 finding 与 golden.expectedContradictions。
- **分母**：expectedContradictions 条数；**分母为 0 时记 N/A 而非 0%**（资料相对一致的案例本来就无预期矛盾——把 N/A 当 0 分是错误的）。
- **辅助精确信号**：golden.sides 与候选引用的交集（sidesCited，评分手算部分列出 in matched.matchedBy 引用明细——由评分卡 citations 交叉查看）。

### P3 建议追问覆盖（followup_coverage_proxy）

- **定义**：候选 questions 命中 golden.acceptableFollowUps 任一别名。
- **分母**：acceptableFollowUps 条数。
- **说明**：这是"有价值下一问"的下界示例集，不是全集；未命中不代表问题没价值，由人工复核。

### 变体计分边界

每个变体的 golden **只含该变体单一评估问题对应的预期项**；基础案例自身缺口在基础 golden 中单独评估。避免把两套分母混在一个数字里。

## 第3层｜ADVISORY——人工复核线索，不是判罚

### A1 禁用表述线索（forbidden_text_flags）

- **定义**：golden.forbiddenConclusions 每项预登记 advisoryMatchKeys（如"无需人工/绕过/自动通过/建议批准…"）；候选全部文本（findings/questions/conclusions/unresolved）命中即出线索。
- **明确限制**：关键词命中**无法区分否定、引用、反例**（例：POS 控制组一句"未观察到与不存在是两回事"曾误中"不存在翻新"——这正是该层只做线索不做判定的原因）。
- **分母**：无（不做命中率；逐条列出 where+keys 供人工判定）。

## 人工复核步骤（每份评分卡的固定流程）

1. 看 `exact.criticalViolations`：非空即存在机器可证缺陷（捏造引用/过期版本/越权结构位），人工抽验确认后记录。
2. 看 `proxy.gaps.unmatched` 与 `proxy.contradictions.unmatched`：逐条读候选原文，判断是"真漏报"还是"同义词漏配"。
3. 看 `advisory.forbiddenTextFlags`：逐条在上下文中判定是否真构成禁用表述。
4. 看 `humanReviewRequired` 清单（含空答案、单侧矛盾、缺版本号、historical 引用、无预期矛盾案例的"夸大检查"）。
5. 语义层终审（工具不做，只有人做）：矛盾是否被当作**矛盾**点出（而非中性转述）、缺口描述是否与 golden topic 同义、"未观察到≠不存在"是否被违反、追问是否有价值、专业分歧是否被保留。
6. 复核结论记录在评估台账；**不得回写 golden 的 matchKeys 来"追认"候选**——别名扩充须走新的 golden 批次。

## 与产品阈值的关系

本工具全部指标服务于"发现了什么、漏了什么、是否有依据"的评估；**不**构造信用分、不编码"资料多→风险低"、不产出期限/额度/价格建议。产品侧 RuleConfig 四层（技术质量/证据充分性/业务风险/经济性）保持未配置，缺配置不是通过。
