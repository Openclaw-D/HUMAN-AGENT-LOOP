# A_ADAPTER_MAPPING｜A lane 适配器结果 → 候选格式（离线映射，接口冻结）

目的：主任务把 A lane 适配器（`PARALLEL_MODEL_ADAPTER_20260913/src/adapter.mjs`，接口 v1；R2 生命周期修复见 `../R2_MODEL_20260913/INTERFACE_R2.md`）的分析结果接入本评估器时，使用本冻结映射。**映射器不做语义判断、不喂 golden**；golden 仅在评分阶段由评估器读取。

## 映射器

`tools/map-adapter-to-candidate.mjs --adapter-result <file> --case CASE-X [--variant V] [--out <file>]`

- 零依赖；确定性；输出 `jw-eval-candidate@2`。
- caseId/variantId 必须显式提供：适配器结果不知道自己回答哪个评估案例（评估端信息不进请求，防泄漏）。

## 字段映射表（产品/协议字段 ↔ 候选字段 ↔ 缺失行为）

| A 适配器字段（ADAPTER_CONTRACT §3） | 候选字段（jw-eval-candidate@2） | 缺失/异常行为 |
| --- | --- | --- |
| `status` | 映射前置条件 | 仅 `succeeded`/`simulated` 可映射；`not_configured/failed/unknown/stale/cancelled` 一律拒绝（exit 2）——它们不是分析结果，失败关闭，不伪装 |
| `status=simulated` | `respondent.kind=adapter_simulated_output` + note 引用 `simulation.notice` | 缺 `simulation.notice` → 拒绝映射（不得伪装 succeeded） |
| `requestId` | `candidateId = "adapter-" + requestId` | 缺 requestId → "unknown-request"（评估侧可追溯性弱，人工复核关注） |
| `findings[].id` | `findingId` | 缺 → 按序号生成 `F-n` |
| `findings[].text` | `statement` | 缺/空 → 拒绝映射 |
| `findings[].type` | — | **A 无此字段**：统一映射为 `type:"note"`，并在 `unresolved` 注明"类型标注缺失，PROXY 缺口/矛盾覆盖按 note 不计"——诚实降级，不伪造覆盖 |
| `findings[].evidenceRefs[].id` | `evidenceRefs[].sourceId` | 缺非空 id → 拒绝映射 |
| `findings[].evidenceRefs[].version` | `evidenceRefs[].version` | 缺或非>=1整数 → 拒绝映射（不猜版本） |
| `findings[].evidenceRefs[].hash` | —（候选无对应字段） | 丢弃；完整性线索由产品层保留 |
| `questions[]` | `questions[]`（同上映射规则） | 同上 |
| （无对应源字段） | `conclusions[]` | 恒为空数组：适配器不产结论，评估器 conclusions 引用检查自然通过 |
| （无对应源字段） | `decisions` | 恒为空数组：适配器守门本就拦截越权批准（mutant-B/S4 对应） |
| `error/usage/timings/costLedger/warnings` | 不映射 | 过程遥测；评估只面向分析内容 |
| `mode/simulation` | `inputPackVersion` 摘要 + respondent.note | provenance 保留（simulated 必须可见） |

## 已知语义损失（如实）

1. `type` 全为 note → 新候选的 PROXY 缺口/矛盾覆盖为 0（分母不变）；这不是模型缺陷，是映射层类型标注缺失。补类型标注（产品映射层）后覆盖率才有意义。
2. hash 丢弃后，评估器无法核对引用完整性——由产品层守门负责（A 适配器已强制输出引用⊆输入清单）。
3. `conclusions` 恒空 → 结论层引用检查对映射候选无样本；待主产品"结论草稿"功能接入后再启用该路径。

## 复验证据

`evidence-r2/adapter-mapping-evidence.txt`：正常映射（fixture → CASE-B 候选 → 评分 exit 0，EXACT 无 critical，PROXY 0/7 如实反映 note 降级）；`status=stale` 拒绝（exit 2）；引用缺 version 拒绝（exit 2）。fixture：`tools/fixtures/adapter-result-fixture.json`（合成 SIMULATED 样例，非真实模型调用）。
