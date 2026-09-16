# 见微 V3 首个 Web 实现契约

状态：`FROZEN FOR P1-P3 IMPLEMENTATION`

## 范围与权威

- 唯一事项根对象：`FinancingLeasingCase`；本检查点仅使用合成事项 `FL-DEMO-001`。
- 顶层板块严格为 `policy`（政策）、`credit`（信审）、`commerce`（商务）、`asset`（资产），顺序不可变。
- 每个板块严格包含五个标准流程位置，名称是当前 UI 候选而非永久产品冻结，必须集中在 `projection.mjs` 配置，不得散落硬编码：
  - `policy`：前置核验、原文依据、适用范围、规则版本、人工发布。
  - `credit`：多模态解析、事实核验、现场尽调、证据回链、人工判断。
  - `commerce`：审批条件、合同任务、付款核验、交付查勘、人工验收。
  - `asset`：投放表现、异常信号、条件验证、旁路评估、结果反馈。
- 每个流程只提供少数合成核验字段：`status`、`owner`、`agent`、`evidenceCount`、`updatedAt`、`exception`、`receipt`。商机与尽调只可出现在政策“前置核验”的合成摘要，不增加顶层节点。
- Web 只消费 Projection，不拥有业务权威。模型与 Agent `authority=none`。
- `共创`、`协同`、`全域`、旧十场景和历史 `CollaborationCase` 不进入代码、导航、fixture 或文案。

## P1 前端契约

- 1920×1080 基准为约 10% / 70% / 20% 三列贯通布局：左列项目名与当前板块五槽；中列四板块导航与主工作区；右列事项操作与完整 Chatbox。
- 一次只展示当前板块五槽，非当前槽弱化；不得平铺二十槽或增加第二条横向时间轴。
- 主工作区可切换 `matrix`（矩阵）与 `graph`（关系图谱），两者读取同一 Projection。
- UI 必须有 projection 加载态、空态、错误态；Chatbox 有空输入禁用、提交加载、失败提示和成功消息。
- P1 `fake-adapter.mjs` 暴露异步 `sendChatMessage({ caseId, message })`，不得联网。成功 exact shape：

```json
{
  "caseId": "FL-DEMO-001",
  "messageId": "msg-<non-empty>",
  "status": "candidate",
  "answer": "<non-empty synthetic candidate answer>",
  "evidenceRefs": ["EV-SYN-001"]
}
```

- 输入 trim 后为空时抛出 `EMPTY_MESSAGE`；message 含 `[error]` 时抛出 `FAKE_ADAPTER_FAILURE`，用于可验证错误态。

## P2 候选 HTTP 契约

- 仅使用 Node.js 内置模块，不新增依赖，不访问网络外部地址，不读取环境密钥。
- `GET /api/cases/FL-DEMO-001/projection` 返回与前端 fixture 同一 Projection。
- `POST /api/cases/FL-DEMO-001/messages` 接收 JSON `{ "message": "..." }`，只追加到进程内合成会话，并返回与 P1 相同的候选响应 shape。
- 未知 case 返回 404；无效 JSON/空消息返回 400；非允许 method 返回 405；内部失败返回 500。所有错误返回 `{ "error": { "code", "message" } }`。
- 服务默认只绑定 `127.0.0.1`；静态文件只允许从项目根目录白名单提供；路径穿越 fail closed。
- 预留 `ModelAdapter` 接口说明，但本检查点不得实现 live ZAI、不得读取 coding runner 凭据、不得让前端持有密钥。

## P3 验收命令

```powershell
node --test test\frontend-contract.test.mjs
node --test test\server-contract.test.mjs
npm.cmd test
npm.cmd run build
node server.mjs --host 127.0.0.1 --port 4317
```

`build` 是零依赖静态完整性检查，不得伪装为 bundler 或生产部署验证。
