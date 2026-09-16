# SCHEMA_V2_CHANGES｜候选与评分卡 schema v2（本轮冻结）

R2 批次唯一接口变更说明。R1 批次（PARALLEL_EVAL_20260913）文件只读，不回写；R2 CLI 对 v1 保持向后兼容。

## jw-eval-candidate@2

相对 @1 的唯一结构变化：**conclusions[] 新增可选 `evidenceRefs` 字段**。

```jsonc
{
  "schema": "jw-eval-candidate@2",          // @1 与 @2 均接受
  "candidateId": "string（必填）",
  "caseId": "CASE-A|CASE-B|CASE-C（必填）",
  "variantId": null | "VAR-n" | "EVT-n",
  "findings":  [ { findingId, type: gap|contradiction|note, statement, evidenceRefs: Ref[] } ],   // evidenceRefs 必填（数组，可为空数组）
  "questions": [ { questionId, text, evidenceRefs: Ref[] } ],                                     // evidenceRefs 必填（数组，可为空数组）
  "conclusions": [ { conclusionId, kind, statement, evidenceRefs?: Ref[] } ],  // v2新增可选引用；kind 必填
  "decisions": [] ,                          // 必须省略或空数组；非空=越权违规
  "unresolved": ["string"]
}
// Ref = { "sourceId": string非空, "version": 整数>=1, "refRole"?: "current"|"historical" }
```

规则：

0. **字段允许名单（失败关闭）**：候选顶层仅允许 schema/candidateId/caseId/variantId/inputPackVersion/respondent/findings/questions/conclusions/decisions/unresolved；findings 项仅允许 findingId/type/statement/evidenceRefs；questions 项仅允许 questionId/text/evidenceRefs；conclusions 项仅允许 conclusionId/kind/statement/evidenceRefs；引用仅允许 sourceId/version/refRole。出现任何未知字段（如把决定走私进自造的 `decision` 字段）→ schema 失败 exit 2。

1. **引用统一检查**：findings + questions + conclusions 三处 evidenceRefs 全部进入同一 collectRefs。
   fabricated（sourceId 不存在）/ stale-as-current（版本存在但非当前）/ version-not-found / version-absent
   分别报告；refRole=historical 合法引用旧版本说明替代关系，单独计数不入错分母。
2. **严格类型（失败关闭）**：候选顶层必须为 JSON 对象；findings/questions/conclusions/unresolved 必须为数组；
   每个 ref 必须为非 null 对象、sourceId 为非空字符串、version 若存在必须为数字整数≥1（字符串 "1" 不接受）。
   任何畸形 → 明确 schema 失败（exit 2），**不部分评分、不未捕获崩溃**。
3. **零分母守卫**：findings+questions+conclusions 非空但全输出引用总数为 0 → critical `no_citations`。
   空答案维持 emptyResponse 标记；二者都不因分母为 0 获得完美质量。
4. conclusions[].kind **必填**：缺失或不在枚举内都判 critical `invalid_conclusion_kind`（不可借省略规避）；schema 层不做类型硬拒（畸形类型由通用规则拒绝）。
5. findings/questions 的 `evidenceRefs` **必填**（数组，可为空数组——空引用由 `no_citations`/`unsupportedFindings` 兜底）；conclusions 的 `evidenceRefs` 为 v2 可选新增（v1 候选兼容）。
6. `no_citations` / `fabricated_citation` / `stale_version_as_current` / `version_not_found_as_current` / `decisions_emitted` / `invalid_conclusion_kind` 均为 critical；`--fail-on-critical` 时 exit 4。

## jw-eval-scorecard@2

相对 @1 新增：

- `candidateSchema`：记录被评候选实际 schema（@1/@2）。
- `exact.citations.bySource`：{findings, questions, conclusions} 各处引用计数（审计"全输出覆盖"）。
- `exact.degenerate`：{emptyResponse, zeroCitations}。
- `exact.criticalViolations` 新增可能值 `no_citations`。
- `determinismNote`：固定说明"工具无随机源，同输入重跑字节一致"。

## 兼容与回归承诺

- R1 九份独立答案（v1、conclusions 无引用）在 R2 CLI 下必须零 critical（不得误伤）。
- R1 六个负控制（neg1–6）在 R2 CLI 下必须仍被识别。
- R1 批次文件零改动；R2 全部输出写 `R2_EVAL_20260913/evidence-r2/`，测试不写冻结路径。
- 工具无随机源：同一候选重跑输出字节一致（固定 seed 的等价实现，双跑断言替代）。
