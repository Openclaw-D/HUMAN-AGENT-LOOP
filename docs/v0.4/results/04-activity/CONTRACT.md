# V0.4 任务04 · 统一事件读接口契约（customer-activity）

2026-09-21 · writer：ZCode 路04（独占 `Back/Edge/src/server.mjs` 与新建 `Back/Edge/src/customer-activity.mjs`）
状态：本路冻结（最小契约 v1；如串行集成需扩展，先回 CTRL 修订本文件）。

## 0. 目标与非目标

为工作台、材料清单、决策树、时间轴四页与纯聊天助手提供**同一个客户活动读接口**：谁在什么时间做了什么/问了什么/回复什么，缺失身份或时间明确未知，请求/完成/失败/未知分别保留。

非目标：不写任何业务数据；不接全局事件总线；不做未来路径预测/概率；不替代既有 `/events` SSE（实时）与 `/events-page`（大历史分页）——本接口是四页共用的**历史/同步读聚合**，与它们读同一批持久来源。

## 1. 现有持久来源盘点（只读复用，不新建存储）

| 来源 | 持久化 | 排序键（服务端游标） | 身份 | 服务端时间 | 复用读取面 |
|---|---|---|---|---|---|
| `thread` 页内消息线程 | node:sqlite `message-store.mjs`（customer_id, seq） | 每客户单调 `seq` | senderPrincipalId/senderRoles（发送时由会话落库） | `at`（落库时刻 ISO） | `messageStore.list()`（既有 GET /messages 同源） |
| `kernel` 业务事件 | Back/A outbox（经 `kernel-store.mjs` 逐请求凭据拉取） | A 分配 `seq`（字符串承载 BigInt） | **事件本身不含 actor** → unknown | `at`（A 原始 occurredAt） | `store.pageEvents()`（既有 GET /events-page 同源） |
| `model_receipt` 模型回执 | `assistant-receipts.mjs` 落盘 JSON（`<dir>/receipts/*.json`） | 无序列 → 用落盘 `at`+requestId 复合键（见 §4 限制） | **回执不含 principalId** → unknown | `at`（INTENT/TERMINAL 落盘时刻） | 直接读回执文件（assistant-receipts 无列举接口，本路不越权改它） |

明确**未接入**本聚合的类别（继续走各自既有入口，不伪造统一流）：
- **审计条目**（audit sink）：进程内存、非持久；既有 `GET /api/jw/v2/audit` 不变。
- **消息投递回执**（message_receipts 表）：作为 thread 条目的 `delivery.state` 附注呈现，不单列条目。
- **决策反馈库**（decision-feedback-store）：无按客户列举接口，未接入。
- **处理通道进度/回执**（Connectors）：读面在 `/api/jw/v2/connectors/**`，未接入。
- **上游事件缺 `at`/actor 的记录**：如实 `occurredAt:null` / `actor.trusted:false`，不用当前时间或当前会话人填补。

## 2. 接口

```
GET /api/jw/v2/customers/:id/activity
    ?limit=50                 可选，1..200，默认 50
    &cursor=<opaque>          可选，上一页响应的 nextCursor
    &sources=thread,kernel,model_receipt   可选，缺省=全部可用源
    &audience=customer|internal            可选，仅 thread 源；默认 all（customer-only 会话强制 customer）
```

鉴权（每次请求全量重验，含后续页）：
1. 会话必需（`x-jw-session`；无/过期/撤销 → 401 `SESSION_REQUIRED`）；
2. Edge 权限点 `activity:read`（失败关闭 → 403）；
3. `store.checkCustomer(customerId, {credential})`：A 逐请求裁决目标客户可读（403/404/502 原样映射；撤权/跨租户即失败）；
4. 受众边界：customer-only 会话强制 `audience=customer`（显式 `audience=internal` → 403，不静默过滤）；`model_receipt` 属内部辅助观察面，customer-only 会话一律排除（显式点名 → 403），默认请求在 `sources[]` 里显式标注 `excludedByAudience:true`。

成功响应（200，`Cache-Control: no-store`）：

```jsonc
{
  "ok": true,
  "customerId": "cust-1",
  "ordering": "per_source_sequence_asc; merged page order is presentation hint, NOT a global total order",
  "items": [
    {
      "activityId": "thread:msg-uuid",        // = source + ":" + sourceRecordId，跨页稳定，去重键
      "source": "thread",                      // thread | kernel | model_receipt（来源命名空间）
      "sourceRecordId": "msg-uuid",            // 该源内的原始记录 ID（messageId / A eventId / 回执 requestId）
      "eventType": "message.posted",           // thread=message.posted；kernel=payloadRef.type 原样；model_receipt=model.observe.receipt
      "customerId": "cust-1",
      "tenantId": null,                        // thread/kernel 无权威租户 → null；model_receipt=回执内 tenantId（可能 null）
      "occurredAt": "2026-09-21T..Z",          // 服务端原始时间；源缺失 → null（绝不取当前时间填补）
      "actor": { "principalId": "p-biz", "roles": ["business"], "trusted": true },
                                                // 仅 thread 有可信 actor；kernel/model_receipt= {principalId:null,trusted:false}
      "requestId": "m-1",                      // 请求关联（无 → null）
      "state": "completed",                    // completed|failed|unknown（本接口不产生 processing：持久层只见结果或未知，见 §4）
      "text": "请补传银行流水",                 // 仅 thread 源；其余源无正文
      "delivery": { "requestId": "m-1", "state": "sent_local_sink" },
                                                // 仅 thread 源：message_receipts 投递回执态；回执缺失 → "unknown"
      "refs": { "seq": "12", "audience": "customer", "threadId": null }
                                                // 依据引用：seq/回执版本/hash/事件载荷引用，按源给全
    }
    // kernel 条目：refs={seq, payloadRef, payload}；state="completed"（A 已记录的发生事实）
    // model_receipt 条目：state=outcome.status 映射（succeeded/simulated→completed，failed→failed，
    //   unknown→unknown，仅 INTENT→unknown+refs.phase="intent"）；refs={assistant,contextVersion,
    //   receiptVersion,configHash,contextHash,analysisRunId}
  ],
  "perSourceCursors": { "thread": "12", "kernel": "103", "model_receipt": "2026-..Z|reqId" },
  "nextCursor": "<base64url({v:1,...perSourceCursors})>",   // 所有源读到头 → null
  "exhausted": { "thread": true, "kernel": false },
  "sources": [
    { "source": "kernel", "kind": "business_event", "available": true },
    { "source": "model_receipt", "kind": "model_receipt", "available": false,
      "reason": "AUDIENCE_FORBIDDEN", "excludedByAudience": true }   // customer-only 会话时
  ],
  "incomplete": [ { "source": "kernel", "code": "UPSTREAM_UNAVAILABLE", "note": "..." } ]
                                                // 单源读取失败不拖垮整页；失败如实列示，不伪装空页
}
```

状态语义（请求/完成/失败/未知分开，提问不推导成功）：
- `thread` 条目的 `state` 只表示"该消息投递成功并已留档"（threadStore 只在投递成功后入栈——服务端事实，非推导）；它**不**表示任何模型回答或业务办理完成。
- `kernel` 条目的 `state="completed"` 只表示"A 已记录该事件发生"，事件载荷内的业务状态原样留在 payload。
- `model_receipt` 条目按回执三分语义映射；INTENT 无 TERMINAL、回执损坏、claim 无回执一律 `unknown`，**绝不伪装 completed**。

## 3. 分页与去重

- 每页：各源从自身游标起**升序**取最多 `limit` 条，k 路归并按 (occurredAt asc → nulls last, source, sourceRecordId) 弹出共 `limit` 条。每源弹出的必是自身升序前缀 → `perSourceCursors[源]=该源本页最后一条的排序键`，不漏不重可续读。
- 跨源无全局序列：页内合并序只是展示提示；晚到事件（后落盘、时间更早）会出现在后续页——本接口明确**不声称总序**，`ordering` 字段固定披露。
- `activityId` 带来源命名空间（`thread:`/`kernel:`/`model_receipt:`），跨页/跨源去重以它为键；同页内出现重复 activityId 视为聚合缺陷。
- 非法 cursor（非 base64url/未知版本/缺字段）→ 400 `INVALID_CURSOR`；不静默重置。

## 4. 已知限制（如实披露）

- `model_receipt` 无服务端序列，游标=落盘 `at`+requestId 复合键；写入口时钟回拨到已读水位之前会造成该回执漏读（当前部署单进程、时钟单调场景不触发；列出以示边界）。纯 `.claim` 残留（无 `at` 无内容）不入列——在途请求在 intent/terminal 落盘后可见。
- `kernel` 信封 `scope.tenant` 是常量 `kernel`（非权威租户）→ 条目 `tenantId:null`；租户隔离由 A 按凭据过滤保证，不由本接口重述。
- thread 保留窗口裁剪（maxPerCustomer）后，`afterSeq<base` 的旧游标按 messageStore 既有语义返回 `truncated:true+retentionBase`——缺失区段显式提示，不静默续读。

## 5. 替身边界（测试声明）

回归测试使用真实本地 HTTP（随机端口）：Edge 全接线 + **真实** `createKernelStore`/`createMessageStore`/`createReceipts` 文件落盘 + **替身 A 上游**（可控 `/api/v2/customers/:id/events`、`/customers/:id`）。替身只替代"Back/A 持久数据库"，不替代 Edge 聚合代码；因此本回归证明的是"Edge 聚合链 + sqlite 线程存储 + 回执文件 + 替身 A"整链语义，**不**声称真实 A 持久数据库整链通过（真实 A 链已由 V0.3 backend-qa-r2 既有报告另行覆盖 events-page/messages 面）。测试实例不装配模型/上传/审批面 → GET 前后零此类调用为结构性保证，并以替身 A 请求日志（仅允许的 GET）+ 审计 sink 计数 + 线程存储 stats 双重断言。
