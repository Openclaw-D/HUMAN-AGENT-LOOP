# decisions taskKind 切片交付（2026-09-20，ZCode 串行单 writer）

## 任务

既有 decisions 接口显式区分 `next_action`（下一步行动建议）与 `path_forecast`（条件化未来状态预测）。本切片只做后端；CTRL 随后对一例真实 GLM 路径预测独立验收，通过后 FRONT 接画布。

## 变更文件（全部在授权 ownership 内，未 commit）

| 文件 | 变更 |
| --- | --- |
| `Back/Edge/src/decision-feedback-store.mjs` | 抽出共享 `baseCandidate`（规则与原逐字节等价）；新增 `validateForecastCandidates`：每个候选必须含完整 `forecast`，缺目标/条件/时间范围、空串、超长（targetState≤240、条件≤5项各≤240、horizon≤120）、伪引用一律 `INVALID_DECISION_OUTPUT` 422，不降级为行动建议；confidenceKind 继续 `model_estimate_uncalibrated` |
| `Back/Edge/src/assistant-model.mjs` | 决策提示词按 `context.decisionTask.taskKind` 分支：`ACTION_TASK_INSTRUCTION` 为原指令逐字节拷贝（含“行动短标题”label规则）；`FORECAST_TASK_INSTRUCTION` 为预测契约（含任务书 JSON 形状、不得断言批准/签约/补件已发生、label须为未来可能状态、confidence=当前证据对条件化判断的支持把握而非概率/违约率/校准置信度）；旧“仅行动建议”指令不叠加到预测分支。promptVersion：next_action 维持 `assistant-observe-v2`；path_forecast 新增 `assistant-decide-forecast-v1`（记录原因：next_action 指令原文与身份不变以保旧回执可复算，预测契约单独标识便于回执审计） |
| `Back/Edge/src/assistant-decisions.mjs` | ①分析 POST 追加 `taskKind` 枚举校验（缺省 `next_action`；未知值 400 `INVALID_TASK_KIND`，在校验顺序上先于任何模型调用与仓储写入）；②`requestHash` 按 kind 投影：path_forecast 进入摘要，next_action/缺kind 摘要组成与升级前逐字节一致；③冻结 decisionTask 仅在 path_forecast 携带 `taskKind` 字段（同上保身份可复算）；④pending 与最终 set 显式存 `taskKind`；⑤反馈复用同时匹配 question+taskKind；⑥候选校验按 pending 的冻结 kind 选择校验器；⑦GET 的 pending/latest 响应投影 `taskKind`（历史缺字段按 `next_action` 投影，不回写历史） |
| `Back/Edge/test/decision-feedback.test.mjs` | fixture mock 增加预测响应模式；新增 4 个 test：forecast schema 单元边界、缺省兼容+未知kind零发送、合法预测结构保留+缺字段/伪引用拒绝+材料变化失效、跨kind幂等冲突+未知pending不重发+反馈隔离+撤权拒绝 |
| `Back/Edge/test/assistant-model.test.mjs` | 新增 1 个 test：两类任务提示词分支互斥（行动契约无 forecast 结构；预测契约无行动建议指令与 option_1 示例） |

未触碰：Back/B transport、A 正式业务、Front、运行配置、成本账本、历史回执与事件、`v03-textile-policy-path-001`（保持行动建议语义，未升级标记）。隔离不变：scope 仍为 `{tenantId, customerId, principalId, assistant}`。

## 关键设计：taskKind 的“投影式进入”

任务书同时要求 taskKind 进入请求摘要/冻结上下文，又要求旧回执/事件哈希可核对、不因升级重复出站。两者同时成立的唯一做法是投影：

- **摘要/身份层（哈希敏感）**：`next_action` 与缺 kind 不改变哈希组成（已验证 `digest({question, baseHash, taskKind: undefined}) === digest({question, baseHash})` 为 true）；`path_forecast` 进入摘要与 decisionTask/身份，因此相同 operationId 换 kind 必然 `IDEMPOTENCY_CONFLICT`，且预测请求因 promptVersion+brief+context 差异获得全新 requestId。
- **记录/展示层（非哈希敏感）**：pending、最终 set、GET 响应显式携带 `taskKind`（`next_action`|`path_forecast`）；旧记录缺字段在响应层投影为 `next_action`，存储原文不动。

## 测试与退出码（全部离线 mock，零真实出站，未重启任何共享服务）

| 命令 | 结果 | 退出码 |
| --- | --- | --- |
| `node --test test/decision-feedback.test.mjs`（Back/Edge） | 9/9 pass | 0 |
| `node --test test/assistant-model.test.mjs`（Back/Edge） | 16/16 pass | 0 |
| `npm test`（Back/Edge run-all，串行全量） | 143/143 pass | 0 |

定向覆盖对照：旧客户端 next_action 兼容✓；未知 kind 400 零发送✓；同 operationId 跨 kind 幂等冲突（双向）✓；未知 pending 跨 kind/跨 operationId 不重发✓；两类反馈不混用（双向+提示词不带对方反馈）✓；forecast 缺字段/伪引用拒绝不降级✓；合法预测保留结构✓；材料变化失效✓；撤权拒绝✓。全部为隔离替身测试，不冒充真实模型质量。

## 请求/响应样本（真实 HTTP 捕获，mock 模型）

见同目录 `samples.json`。要点：

- `POST /api/jw/v2/actions/customers/:id/assistant/decisions` 带 `"taskKind": "path_forecast"` → 200，`latest.taskKind="path_forecast"`，候选含完整 `forecast{targetState,conditions,horizon}`、按 confidence 降序、`confidenceKind="model_estimate_uncalibrated"`。
- 缺 `taskKind` 的旧客户端 → 200，`latest.taskKind="next_action"`，行动候选契约不变。
- `taskKind:"path"` → 400 `INVALID_TASK_KIND`（零模型调用）。
- 同 operationId 换 kind → 409 `IDEMPOTENCY_CONFLICT`。
- 反馈 POST 地址与请求形状不变（绑定 decisionSetId）。

## Ownership 释放

以上 5 个文件本轮由 ZCode 独占写入，现已交回释放；无遗留未保存修改，未新增并发 writer 或任务。CTRL 验收提示：`taskKind` 回执仅证明使用了哪类任务契约，预测语义需读真实 GLM 输出验收（建议核对回执 identity.promptVersion=`assistant-decide-forecast-v1`）。
