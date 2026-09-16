# STARS financing governance prototype

STARS 的最新产品定义是三个“人 + Agent”责任单元组成的融资治理流程：领导、业务、风控。

## Authoritative flow

```text
领导确定业务方向
→ 领导 Agent 拆解并分发
→ 业务人员 + 业务 Agent 调研、形成方案和证据
→ 风控人员 + 风控 Agent 独立审查
→ 通过 / 附条件通过 / 否决
```

风控拥有最终风险裁决和一票否决权；领导决定业务方向、资源与优先级，但不能覆盖风险否决。

允许两类回路：材料不足时退回业务补充；复杂业务背景需要调整时回到领导澄清，但最终仍回到风控裁决。

## Current code status

当前 P0 已接入本地 A2A 协作后端：监督、业务、风控三个逻辑 Agent 通过 A2A `1.0` 形状的 `AgentCard / Message / Task / Artifact` 和 JSON-RPC 方法协作。开发页直接读取后端投影，支持目标创建、业务补证、重新复核、风控人员最终裁决、SSE 更新和 hash-chain 审计。

这是一套 **A2A-aligned compatible subset**，尚未经过官方 TCK，不宣称完整 A2A conformance。Agent 当前使用确定性本地策略，没有接入模型 API，也不会执行真实融资审批。A2A 负责 Agent 互操作；STARS 自定义治理状态机负责权责、共同收敛门槛、人工 Gate 和风险否决。

### Runtime

```text
React UI :3003
  └─ /api、/a2a、/.well-known 由 Vite proxy 转发
Node A2A backend :8787
  ├─ Supervisor Agent
  ├─ Business Agent
  ├─ Risk Agent
  ├─ .stars-data/a2a-state.json   原子快照
  └─ .stars-data/audit.jsonl     追加式审计事件
```

后端不信任自然语言来执行权责：监督 Agent 无法写入风险裁决；风控否决后必须创建新 revision，旧决定不会被覆盖。

## Local commands

```powershell
npm ci
npm run dev
npm run lint
npm test
npm run build
```

`npm run dev` 同时启动前端 `http://127.0.0.1:3003/` 与后端 `http://127.0.0.1:8787/`。也可分别运行 `npm run dev:web` 和 `npm run server`。

### A2A surface

- `GET /.well-known/agent-card.json`：标准位置发布 Supervisor Agent Card。
- `GET /.well-known/agents/{agentId}/agent-card.json`：本地直接配置 Business/Risk Card；这是 STARS 私有发现路径。
- `POST /a2a/{agentId}`：JSON-RPC `SendMessage / GetTask / ListTasks / CancelTask`，必须发送 `A2A-Version: 1.0`。
- `GET /api/contexts`、`POST /api/contexts`：前端治理投影与目标创建。
- `POST /api/contexts/{id}/run|evidence|risk-decision|reconsider`：受控治理动作。
- `GET /api/events`：前端实时 SSE；它不是 A2A streaming binding。

研究、标准边界和后续安全要求见 `docs/A2A-ARCHITECTURE.md`。

详细边界见 `AGENTS.md` 和 `HANDOFF.md`。
