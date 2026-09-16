# V7-CTLR｜Backend R1：四路并发实验包

状态：用户于 2026-09-15 明确授权交给 ZCode 执行。产品代码唯一 writer 为各 lane；首页 R1 前端继续其现有 owner，任何 backend lane 不得修改 `home/**`、3607、3467、`app/page.tsx` 或 CSS。

## 共同目标

实现一个**合成数据**的可重放单回合：规则限定输入范围 → 模型候选可调用计算工具 → 人工接管。模型 `authority=none`；没有正式审批、自动通过/拒绝、真实客户数据、密钥、部署、commit/tag/worktree。

所有 lane 先读 `V7/CONTEXT_LOG.md`。本轮只形成第一份可运行实验和证据；不扩展远程视频、行业规则或全量编排。

## 冻结接口 v0（跨 lane 只通过此接口协作）

`ExperimentRecord`：

```ts
{
  experimentId: string; projectId: string; ruleVersion: string; factVersion: string;
  requestId: string; state: 'pending'|'candidate_ready'|'human_required'|'unknown'|'failed';
  ruleScope: { indicators: string[]; allowedTools: string[]; humanEscalation: string[] };
  calculation?: { toolVersion: string; inputHash: string; output: Record<string, unknown>; assumptions: string[] };
  model?: { provider: 'real_http'|'simulation'; requestReceipt: string; candidate?: Candidate; uncertainty: string[] };
  human?: { action: 'pending'|'accept_candidate'|'return_for_evidence'|'take_over'; at?: string; note?: string };
}
```

`Candidate` 仅可含 `observations`、`evidenceRefs`、`assumptions`、`uncertainty`、`recommendedHumanAction`；不得含审批/额度/价格/批准结论。输入缺失、模型输出结构不合格、规则不覆盖均进入 `human_required`；发送后结果不可知进入 `unknown`，不得伪造失败或自动重试成功。

## Lane A｜实验记录与持久化（owner：A）

- Allowed writes：新建 `lib/v7/experiment-store.ts`、`app/api/v7/experiments/route.ts`、`app/api/v7/experiments/[experimentId]/route.ts`、`test/v7-experiment-store.test.mjs`。
- 工作：以现有 V5 JSON persistence 的失败关闭/幂等模式为参考（不改它），持久化 `ExperimentRecord`；POST 必带 `requestId`，重复提交返回同一 receipt；重启恢复；存储损坏返回显式错误、不静默重置。
- Excluded：不调用模型、不写 calculation/model lane 文件、不改 UI。
- Evidence：隔离 data dir 的单测覆盖创建、重复 request、重启恢复、损坏失败；列出 API 示例。
- Stop：接口/测试通过后停止，等待整合；不要跨 lane 补实现。

## Lane B｜真实 HTTP 模型候选网关（owner：B）

- Allowed writes：新建 `lib/v7/model-candidate-gateway.ts`、`test/v7-model-candidate-gateway.test.mjs`。
- 工作：复用既有 `lib/v5-preview/model-adapter/providers/http-fetch.mjs` 的 transport，不复制密钥逻辑。将合格 JSON 限制/校验为 `Candidate`；真实通道未配置必须明确 `human_required` 且表明未发送；发送后 abort/timeout 或结果不可知必须为 `unknown`；结构违规、越权措辞或 provider 错误为 `human_required`/`failed`，不回退伪模拟。
- Excluded：不读取/写入密钥、不改 env、不改 V5 transport、持久化或路由。
- Evidence：mock transport tests 覆盖 success、not configured、indeterminate、malformed/over-authoritative output；日志/错误不得泄露密钥或原始响应。
- Stop：交付纯模块和测试，不接入路由。

## Lane C｜可验证计算工具（owner：C）

- Allowed writes：新建 `lib/v7/calculation-tool.ts`、`test/v7-calculation-tool.test.mjs`。
- 工作：实现一个无行业审批含义的合成 cash-flow coverage calculation。输入含 `monthlyOperatingCashFlow`、`monthlyDebtService`、`currency`；输出 ratio、unit、assumptions、toolVersion、inputHash。缺失/非正 debt service/不支持币种必须显式拒绝，绝不生成“可审批”判断。
- Excluded：不改既有 remote calculation endpoint、持久化、模型或 UI；不从 01-Report 提取规则。
- Evidence：固定输入可重放；缺参/非法输入失败；结果仅是计算，不含风险结论。
- Stop：交付纯模块和测试，不接入模型或 API。

## Lane D｜独立契约与组合 QA（owner：D）

- Allowed writes：新建 `test/v7-experiment-contract.test.mjs`、`V7/QA_BACKEND_R1.md`。
- 工作：按本包冻结接口写 black-box contract tests 和验收记录模板；可在 A/B/C 交付后执行组合验证，但不写产品源文件。测试至少覆盖状态机禁止 `unknown → candidate_ready` 自动跃迁、Candidate 禁止审批措辞、来源区分、requestId 幂等的 API 契约。
- Excluded：不修改 A/B/C 文件、不改 UI、不得把执行者自报写成最终验收。
- Evidence：列明实际跑过的命令、通过/失败、阻断和视觉/真实 API 未验证范围。
- Stop：首轮 QA 报告后停止；缺陷只精确回报对应 owner。

## 统一停止与集成

各 lane 不互改文件、不提交、不抢前端。A/B/C 完成后，仅由用户随后授权的单一 integrator 接线；D 只验收。第一交付后最多 R1/R2 针对性修正，不自动扩大范围。
