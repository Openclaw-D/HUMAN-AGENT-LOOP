# 见微 P1 轻量后端

这是前三个锚点场景的零外部依赖后端检查点。唯一权威事实是 SQLite 中的 append-only Event；每个 `WorkProjection` 都从 Event 顺序重放生成，不持久化 Projection 快照。

## 运行要求

- Node.js 22.5+，需要内置 `node:sqlite`。
- 不需要 `npm install`。
- `node:sqlite` 在当前 Node 22 运行时会打印 experimental warning，不影响本检查点运行。

## 启动

```powershell
cd C:\Users\22673\Desktop\Anthropic\runtime\p1
node src/server.mjs --port 4179
```

默认监听 `127.0.0.1:4179`，默认数据库为 `data\p1.sqlite`。也可显式指定：

```powershell
node src/server.mjs --port 4179 --db C:\path\to\p1.sqlite
```

`SIGINT` / `SIGTERM` 会停止 HTTP server 并关闭 SQLite。服务启动时会幂等检查三个 `dataOrigin:"sample"` 的演示 Work；如果同 ID 历史存在但终态不符合冻结 sample，启动会 fail closed，不覆盖历史。

## API

- `GET /health`
- `GET /api/v1/scenarios`
- `GET /api/v1/workspaces/{workspaceId}/works?scenarioId=...`
- `GET /api/v1/workspaces/{workspaceId}/works/{workId}/projection`
- `POST /api/v1/workspaces/{workspaceId}/works`
- `POST /api/v1/workspaces/{workspaceId}/works/{workId}/commands`

所有 JSON 响应使用 `application/json; charset=utf-8`。POST 必须使用 `Content-Type: application/json`，body 上限 1 MiB。

### 身份头

所有写请求必须提供：

```http
X-Actor-Id: named-actor-id
```

创建 Work 时，Header 必须等于 body 的 `currentActorId`，且必须存在于 body 的 `actors`。Command 时，actor 必须存在于当前 WorkProjection。缺失或未知身份会 fail closed，不产生业务 Event。

### Command envelope

```json
{
  "commandId": "cmd-unique-id",
  "idempotencyKey": "stable-retry-key",
  "expectedProjectionVersion": 7,
  "type": "append_message",
  "payload": { "body": "补充上下文" }
}
```

支持：`append_message`、`update_goal`、`request_agent_run`、`raise_challenge`、`resolve_challenge`、`propose_handoff`、`accept_handoff`、`decide_gate`、`create_action_intent`、`record_receipt`。

相同幂等键与相同规范化请求原样重放初始成功结果且不新增 Event；相同键不同请求返回 `IDEMPOTENCY_CONFLICT`。版本、权限、状态或验证失败均零业务写入。

## Sample 数据

固定 workspace：`sample-p1`。

- `risk-sample-001`：风控业务协同，最终 Receipt 为 `unknown`，不会显示完成。
- `dev-sample-001`：需求开发协同，最终 Receipt 为 `failed`，不会显示完成。
- `interaction-sample-001`：人机交互协同，普通消息零 Run，显式请求产生一个 Run，Gate 为 `needs_evidence`。

这些数据只表示本地 sample，不是客户、生产或外部真实成功。运行时 Projection 一律 `fixture:false`。

## 验证

```powershell
node --test
node scripts/verify.mjs
```

`node --test` 覆盖持久化、Event-only replay、Schema、幂等、版本冲突、普通消息/显式 Run、具名 Handoff、Gate、ActionIntent、Receipt、十场景、三 sample、HTTP 成功与负向路径、重启恢复和三 selector 同 Projection。

`node scripts/verify.mjs` 会使用临时 SQLite 重新 seed、Schema 验证、关闭/重开并比较重放结果，完成后删除临时数据。

## 当前限制

- 只实现前三个 active 场景；其余七个仅返回 `catalog-only` 元数据。
- 不包含认证服务、TLS、CORS、浏览器 UI、外部 connector、部署或生产运维配置。
- `ArtifactRecorded` / `ProposalRecorded` 仅供受控 sample seed 使用，不暴露为 HTTP 绕过 Command policy 的接口。
- 外部执行结果没有可核验证据时必须记录为 `unknown`；不得由 ActionIntent 或模型输出推断成功。
