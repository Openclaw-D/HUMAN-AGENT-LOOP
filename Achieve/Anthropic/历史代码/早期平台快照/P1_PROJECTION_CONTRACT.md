# 见微 P1：WorkProjection V1 冻结契约

日期：2026-08-27  
状态：`V1 CANDIDATE / SUPERSEDED FOR NEW P1`  
机器可读 Schema：`contracts/work-projection.v1.schema.json`

## 1. 契约目的与边界

P1 只建立一条轻量但真实的纵向闭环：不可变 Event 历史 → 唯一 `WorkProjection` → 关系/进度/矩阵三个只读 selector → 具名 Command → 新 Event → 新 Projection。

- 三个视图不得拥有独立接口、状态机、数据库、版本、owner、Gate、Action 或 Receipt。
- 前端一次读取完整 Projection；切换视图不发出业务 Command。
- `fixture: false` 表示数据由运行时 Event 重放所得，不代表客户或生产数据。演示种子必须同时标识 `dataOrigin: "sample"`。
- P1 后端只对前三个锚点场景提供可执行 Work 闭环：风控业务协同、需求开发协同、人机交互协同。其余七个只进入场景目录，不得伪造已运行事项。
- TAG、RelayOS 和 `127.0.0.1:4177` 只可读取为 legacy 证据，不是新 V1 运行时。
- 所有进入用户可见页面的 Projection 文本必须是简体中文；代码标识、接口字段与枚举值可以保留英文，但不得直接显示。名称、标题、目标、角色、阶段、详情、矩阵文案、Activity 标题/正文和错误信息均属于用户可见文本。

## 2. 单一快照身份

每个成功的 Projection 响应必须同时包含：

- `schemaVersion = "work-projection.v1"`
- `fixture = false`
- `projectionIdentity.workspaceId`
- `projectionIdentity.workId`
- `projectionVersion`
- `eventCursor`
- `generatedAt`

P1 中 `projectionVersion` 与 `eventCursor` 均为最后一个已应用 Event 的整数序号，并且必须相等。前端只能把一次完整响应作为一个快照；任一字段缺失、Schema 不兼容或版本不一致时 fail closed，显示“Projection 不可用/版本不一致”，不得拼接旧数据。

`currentActorId` 表示当前 Human 操作上下文，不是“最后一条 Event 的 actor”。P1 本地 sample 在没有认证/Actor 切换 UI 时默认等于当前 `work.ownerActorId`；只有具名 recipient 接受 Handoff，或未来引入明确且已验证的身份切换时才可改变。Agent、system、connector 写入 Artifact、Challenge、Gate、Action 或 Receipt 不得静默改变 `currentActorId`。`availableCommands` 必须按该 Human 操作上下文计算；命令真正的权限仍以 `X-Actor-Id` 与 Policy 校验为准，前端字段不能替代鉴权。

## 3. 最小 HTTP 接口

### 3.1 只读

- `GET /health`：仅报告进程与存储可读状态，不报告业务成功。
- `GET /api/v1/scenarios`：返回十个冻结名称、默认视图和 `runtimeAvailability`。前三个为 `active`，其余为 `catalog-only`。
- `GET /api/v1/workspaces/{workspaceId}/works?scenarioId=...`：返回真实存在的 Work 摘要；无事项返回空数组。
- `GET /api/v1/workspaces/{workspaceId}/works/{workId}/projection`：返回一个完整且符合 Schema 的权威快照。

P1 不拆分关系、进度、矩阵或 Activity 读取接口，避免跨请求混入不同版本。

### 3.2 写入

- `POST /api/v1/workspaces/{workspaceId}/works`：创建 Work；必须包含 `scenarioId`、Goal、初始 owner，并写入首个 Event。
- `POST /api/v1/workspaces/{workspaceId}/works/{workId}/commands`：唯一业务写入口。

Command 请求：

```json
{
  "commandId": "cmd-...",
  "idempotencyKey": "...",
  "expectedProjectionVersion": 18,
  "type": "append_message",
  "payload": {}
}
```

命令主体不可信任其声明的操作者。P1 本地运行时从 `X-Actor-Id` 读取具名 Actor，并在已知 Actor 与 Policy 中校验；缺失或未知 Actor 的写操作 fail closed。该本地身份头不是生产认证声明。

成功响应固定为：

```json
{
  "accepted": true,
  "eventIds": ["evt-..."],
  "projection": {}
}
```

同一 `idempotencyKey` 与同一规范化请求重复提交不得追加 Event，返回首次结果；同一 key 对应不同请求必须返回冲突。

## 4. P1 Command 集

| Command | 权威性 | 最小权限与语义 |
| --- | --- | --- |
| `append_message` | 否 | 已知 Human；只追加沟通上下文，不改变 Goal、owner、Gate、Action、Receipt 或 Work 状态 |
| `update_goal` | 是 | 当前 owner；产生新 Goal version |
| `request_agent_run` | 否（Run 请求） | 必须由显式 `@Agent`、选择 Agent 或“继续执行”触发；普通消息不得隐式创建 Run |
| `raise_challenge` | 是 | Human 或获准 Agent；只提出冲突，不作最终决定 |
| `resolve_challenge` | 是 | 当前 owner 或具名 Gate 责任人 |
| `propose_handoff` | 是 | 当前 owner；只创建待接受交接，不立即转移 owner |
| `accept_handoff` | 是 | 仅具名 recipient；接受后才转移 owner |
| `decide_gate` | 是 | 仅具名 Gate 责任人；请求必须包含依据、影响与 `approved/rejected/needs_evidence` |
| `create_action_intent` | 是 | 具名 authorizer；只能在所需 Gate 已通过后创建，不等于外部成功 |
| `record_receipt` | 是 | 仅对应 connector/system Actor；状态只能为 `succeeded/failed/unknown` |

Agent 的默认 authority 为 `none` 或 `propose`：可以产生 Artifact、Challenge 或 Handoff proposal，但不能自行改变 owner、通过 Gate、授权外部 Action 或把未知结果写成成功。

## 5. Event、Replay 与失败原子性

- Event 是唯一权威事实；Projection 可丢弃并仅凭 Event 顺序重建。
- 每个 Event 至少包含 `eventId`、`workspaceId`、`workId`、`sequence`、`type`、`actorId`、`occurredAt`、`payload`、`commandId` 与 `idempotencyKey`。
- 单个 Command 产生的 Event 和幂等记录必须原子提交；拒绝、验证失败、版本冲突和权限失败均为零写入。
- 重启后 Work、owner、Goal version、Challenge、Gate、Handoff、ActionIntent、Receipt 和 Event cursor 必须恢复一致。
- Projection 中 `relations`、`stages`、`matrix`、`signals`、`activities` 与 `availableCommands` 都由同一重放结果派生，不可作为第二事实源单独修改。

## 6. 错误契约

所有错误返回 `{ "error": { "code", "message", "details" } }`，且不得产生业务 Event。

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Schema、payload 或命令状态不合法 |
| 401 | `ACTOR_REQUIRED` | 写操作缺少具名 Actor |
| 403 | `AUTHORITY_DENIED` | Actor 已知但无权 |
| 404 | `WORK_NOT_FOUND` | Workspace/Work 不存在 |
| 409 | `PROJECTION_VERSION_CONFLICT` | `expectedProjectionVersion` 不是当前版本 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一 key 对应不同规范化请求 |
| 409 | `INVALID_TRANSITION` | 例如未通过 Gate 就创建 ActionIntent |
| 503 | `PROJECTION_UNAVAILABLE` | Event 读取或重放失败；不得回退到 fixture/成功状态 |

外部调用没有可验证 Receipt 时必须保持 `unknown`；timeout、断线或解析失败都不能渲染为 `succeeded`。

## 7. 三个锚点场景的真实闭环

- 风控业务协同：Goal → Evidence Artifact → Challenge → 具名 Human Gate → ActionIntent → Receipt（含 `unknown`）。
- 需求开发协同：Goal version → Agent Artifact → Review/Challenge → 具名 Handoff 接受 → Human Gate → 可追溯结果。
- 人机交互协同：普通消息不触发 Run → 显式 Agent Run → Artifact/Proposal → Human 接受、拒绝或补证 → 可恢复接续。

每个场景至少保留一个由真实 Event 重放生成的 `dataOrigin: "sample"` 演示 Work；样例不得标记为客户、生产或外部真实成功。

## 8. 后端 Gate

后端执行任务只有同时提交下列证据才可进入连调：

1. 三个锚点场景均能创建、读取、命令推进和重启恢复。
2. 删除 Projection 缓存后，Event-only replay 得到同一语义快照。
3. 普通消息零 Agent Run；显式 Run 恰好创建一次。
4. 非具名 recipient 不得接受 Handoff；非 Gate 责任人不得决定 Gate。
5. 版本冲突、幂等冲突、未过 Gate 的 ActionIntent 与无权限命令均零写入。
6. Receipt `failed/unknown` 不得使 Work 或 UI 变为成功。
7. 三个 selector 使用同一 Projection identity/version/cursor；不存在三套 API 或三份业务状态。
8. 无依赖安装、无 worktree、无 Git 提交/推送、无 legacy 写入。

达到本 Gate 后停止，等待总控创建连调任务；不得自行修改 P1 前端。
