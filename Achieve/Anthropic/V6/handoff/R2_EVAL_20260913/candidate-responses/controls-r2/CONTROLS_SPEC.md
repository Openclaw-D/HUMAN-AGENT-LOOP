# R2 评估负控制样例说明（controls-r2）

- 位置：`V6/handoff/R2_EVAL_20260913/candidate-responses/controls-r2/`
- 生成日期：2026-09-13
- 适用对象：eval-cli selftest（schema v2，`jw-eval-candidate@2`）
- 基础案例：全部非 null 样例使用 CASE-C（无变体，`variantId: null`）

## 声明

这些文件是评估端人工样例（hand-written negative controls），不代表任何真实模型行为。每个文件人为注入一种特定错误，仅用于验证评估工具的 schema 校验与引用核查能力；不得计入任何真实候选的统计、排名或质量结论，不得作为模型输出的训练或对齐材料。样例中出现的业务语句（设备购置、收入口径等）为构造的中性示例文本，不构成对任何真实案件的事实陈述。

## 逐文件规格

### 1. neg7-null-candidate.json

- 注入的错误类别：顶层整体为 JSON 字面量 `null`（候选对象缺失，无任何字段）。
- 预期检测：schema 失败，exit code 2；评估进程绝不能因顶层为 null 而崩溃（不得抛出未捕获异常）。
- selftest 断言：
  - `assertSchemaFailure('neg7-null-candidate.json')`
  - `assertExitCode(2)`
  - `assertNoCrash()`（进程正常结束，输出结构化错误信息）

### 2. neg8-wrong-types.json

- 注入的错误类别：容器字段类型整体错误——`findings` 为字符串 `"two findings"`，`questions` 为对象 `{"q1":{}}`，`conclusions` 为布尔 `true`。顶层元字段（schema/candidateId/caseId/variantId）正常。
- 预期检测：schema 失败，exit code 2。
- selftest 断言：
  - `assertSchemaFailure('neg8-wrong-types.json')`
  - `assertExitCode(2)`
  - 建议附加：错误信息应能定位到 findings / questions / conclusions 三处的类型不符（断言错误列表同时覆盖三个字段名），防止只报第一个错误。

### 3. neg9-nested-malformed.json

- 注入的错误类别：数组容器类型正常，但嵌套元素畸形——`findings[0]` 为 `null`；`findings[1].evidenceRefs[0].sourceId` 为数字 `42`（应为非空字符串）且 `version` 为字符串 `"1"`（应为数字整数）；`conclusions[0].statement` 为数字 `123`（应为字符串）。
- 预期检测：schema 失败，exit code 2。
- selftest 断言：
  - `assertSchemaFailure('neg9-nested-malformed.json')`
  - `assertExitCode(2)`
  - 建议附加：错误路径至少覆盖 `findings[0]`、`findings[1].evidenceRefs[0]`、`conclusions[0].statement` 三处，防止嵌套校验被整体跳过。

### 4. neg10-zero-refs.json

- 注入的错误类别：结构完全合法（@2、CASE-C、variantId null、含 respondent 说明），findings 2 条（gap/note 各一）、questions 1 条、conclusions 1 条（kind=summary），但所有 `evidenceRefs` 均为空数组，整份候选零引用。
- 预期检测：critical `no_citations`。零引用不得因引用分母为 0 而获得完美质量分。
- selftest 断言：
  - `assertSchemaValid('neg10-zero-refs.json')`（结构必须通过，不得误报 schema 失败）
  - `assertCritical('neg10-zero-refs.json', 'no_citations')`
  - `assertScoreLessThan('neg10-zero-refs.json', 1.0)`（总分不为满分；零引用不因分母 0 得完美质量）

### 5. neg11-conclusion-fabricated-ref.json

- 注入的错误类别：conclusions 层捏造引用——`conclusions[0].evidenceRefs` 为 `[{"sourceId": "C-DOC-99", "version": 1}]`，C-DOC-99 不存在于 CASE-C 资料包。findings 层引用真实来源 C-VIS-02 v1，保证 findings 层无违规，用于验证 v2 新增的 conclusions 引用核查（R1 漏检点）。
- 预期检测：critical `fabricated_citation`，且该引用被归属到 conclusions（工具按 `owner=conclusion:C-1` 报告）。
- selftest 断言：
  - `assertCritical('neg11-conclusion-fabricated-ref.json', 'fabricated_citation')`
  - `critical 包含 fabricated_citation 且 citations.bySource.conclusions >= 1`
  - 建议附加：critical 条目 `owner == "conclusion:C-1"`；findings 层不得出现任何 critical（其引用真实）。

### 6. neg12-conclusion-stale-ref.json

- 注入的错误类别：conclusions 层引用过期版本——`conclusions[0].evidenceRefs` 为 `[{"sourceId": "C-DOC-02", "version": 1}]`。C-DOC-02 v1 在资料包中真实存在，但已被 v2 替代（当前版本为 v2），且未标注 `refRole: "historical"`，即把过期版本当作当前引用。findings 层引用 C-DOC-05 v1（真实且为当前版本），保证 findings 层无违规。
- 预期检测：critical `stale_version_as_current`（expectedCurrent=2）。
- selftest 断言：
  - `assertCritical('neg12-conclusion-stale-ref.json', 'stale_version_as_current')`
  - critical 条目 `owner == "conclusion:C-1"` 且 detail `expectedCurrent == 2`
  - 建议附加：findings 层不得出现 stale 类 critical（C-DOC-05 v1 为当前版本）；若工具支持，断言 findings 引用不计入违规。

## 负控制覆盖矩阵

| 文件 | 错误类别 | 预期检测 |
| --- | --- | --- |
| neg7-null-candidate.json | 顶层为 null | schema 失败（exit 2），不崩溃 |
| neg8-wrong-types.json | 容器类型错误（string/object/boolean） | schema 失败（exit 2） |
| neg9-nested-malformed.json | 嵌套元素畸形（null 元素、数字 sourceId、字符串 version、数字 statement） | schema 失败（exit 2） |
| neg10-zero-refs.json | 全部 evidenceRefs 为空数组 | critical `no_citations` |
| neg11-conclusion-fabricated-ref.json | conclusions 捏造来源 C-DOC-99 | critical `fabricated_citation`（owner=conclusion:C-1） |
| neg12-conclusion-stale-ref.json | conclusions 引用被 v2 替代的 C-DOC-02 v1 且未标 historical | critical `stale_version_as_current`（expectedCurrent=2） |

## JSON 可解析性验证记录

验证日期：2026-09-13。逐文件执行：

```
node -e "JSON.parse(require('fs').readFileSync('<path>','utf8')); console.log('ok')"
```

路径前缀 `C:/Users/22673/Desktop/Anthropic/V6/handoff/R2_EVAL_20260913/candidate-responses/controls-r2/`。结果：

```
neg7-null-candidate.json            -> ok
neg8-wrong-types.json               -> ok
neg9-nested-malformed.json          -> ok
neg10-zero-refs.json                -> ok
neg11-conclusion-fabricated-ref.json -> ok
neg12-conclusion-stale-ref.json     -> ok
```

neg7 附加解析值验证（要求结果为 null）：

```
node -e "const v=JSON.parse(require('fs').readFileSync('C:/Users/22673/Desktop/Anthropic/V6/handoff/R2_EVAL_20260913/candidate-responses/controls-r2/neg7-null-candidate.json','utf8')); console.log('parsed:', v)"
-> parsed: null
```

UTF-8 无 BOM 验证（读取各文件前 3 字节，均非 EF BB BF）：

```
neg10-zero-refs.json no-bom
neg11-conclusion-fabricated-ref.json no-bom
neg12-conclusion-stale-ref.json no-bom
neg7-null-candidate.json no-bom
neg8-wrong-types.json no-bom
neg9-nested-malformed.json no-bom
```

## 使用边界

- 以上 6 个 JSON 样例均为评估端人工构造的对抗输入，不代表任何真实模型行为，不参与任何真实候选的评分统计。
- 负控制样例文件本身不携带任何评估端 golden 预期标签；预期检测仅记录在本说明文档中，供 selftest 断言使用。
