# cases｜C路合成案例与材料类目核对（API OVERNIGHT 20260913）

- owner：C（V6-API-CASES）。接手时间：2026-09-13 23:08（北京时间）。只写本目录 `cases/**`；产品代码与既有材料只读。
- 接口依据：`V6/handoff/API_OVERNIGHT_20260913/CONTRACT.md`（A 于 2026-09-13 23:10 冻结）。本目录的机器可读文件按其 §2（enrich 形状）与 §5（analyze 路由语义）组织。

## 合成声明（先读）

1. **全部内容均为匿名合成**：企业、人物、设备、编号、金额、日期、银行、单据均为虚构，不影射任何真实公司或个人，不含任何真实客户资料或凭据。
2. **不声称用户提供过资料**：用户历史计划的"三套客户资料（好/中/坏）"**至今未收到**（V6/CONTEXT_LOG.md 2026-09-12 条目）。本目录案例是真实授权资料缺位期间的**替代演示材料**。
3. **案例不预设审批结果**：预期验证要点中没有任何"应批准/应否决/建议额度/建议价格"；金额、期限只是一致性测试用的合成数字，不是公司政策阈值。
4. **预期验证要点不得进入模型输入**：各 `*.model-input.json` 只含允许发给模型的内容（标注问题、客户陈述/人工回复原文、证据图形文字）；所有"预期信审应发现什么"只写在 `*.expected.md`，供人工演示核对与 D 路验收参考。
5. **未观察 ≠ 不存在**：案例内"现场画面"是合成设定，不得据此断言设备实际状况。

## 文件导航

| 文件 | 内容 | 消费方 |
| --- | --- | --- |
| `material-categories.md` | 材料类目核对：类别、来源路径、确认状态；客户上传后续输入约定 | A、用户 |
| `main-case.md` | 主合成案例 M1 全文（五阶段、原文与版本、预期验证要点分离标注） | A、演示操作者 |
| `main-case.model-input.json` | M1 机器可读模型输入（按 CONTRACT §2/§5 字段，可直接接入） | A（程序读取） |
| `main-case.expected.md` | M1 预期验证要点（仅供人工/评估端，**不给模型**） | 演示核对、D |
| `variant-insufficient.md` + `.model-input.json` + `.expected.md` | 变体 V1：资料不足 | 同上 |
| `variant-contradiction.md` + `.model-input.json` + `.expected.md` | 变体 V2：前后陈述矛盾 | 同上 |
| `pre-interview-outline.md` | 最简访谈前准备提纲（供 A 演示复用） | A、演示操作者 |
| `RESULT.md` | C 路交付结论与自检 | A、D、用户 |

## 与 A 路集成的最小说明

- 模型输入注入点 = CONTRACT §2 `enrich(call)`：`annotationQuestion`（来自标注 question 字段）+ `humanReplies`（标注下 kind=`business`/`domain` 的回复原文）+ 证据图形文字（fixture SVG 文本，产品内置）。本目录 JSON 的字段名与之逐字对应。
- 分析入口 = CONTRACT §5 `POST /api/v5-preview/remote-session/annotations/analyze`，信审单角色 `domainRoles:['credit']`；人工补充走既有 `annotations/replies`（kind=`business`），专业纠正走 kind=`domain` 或复核动作 `correct`；每步新 `requestId`，同 requestId 重放幂等。
- M1 的步骤序列（attach → annotate → analyze → reply → analyze → reply(domain) → analyze）即 MODEL_API_DEMO 的闭环：真实分析 → 人工补充/纠正 → 再分析 → 保存读回。JSON 每步给出可直接使用的 `requestId` 建议值与文本。
