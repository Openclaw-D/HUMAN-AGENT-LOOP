# V0.4 任务04 · 统一事件读接口与跨页同步基础 — 交付报告

2026-09-21 · writer：ZCode 路04 · ownership：`Back/Edge/src/server.mjs`（独占）＋新建 `Back/Edge/src/customer-activity.mjs`＋新测试 `Back/Edge/test/v04-activity-*`；报告与契约在 `docs/v0.4/results/04-activity/`。

## 1. 交付物与文件清单

| 文件 | 状态 | 说明 |
|---|---|---|
| `docs/v0.4/results/04-activity/CONTRACT.md` | 新建 | 来源盘点＋接口契约（本路冻结 v1） |
| `Back/Edge/src/customer-activity.mjs` | 新建（330 行） | 三源只读聚合：游标编解码、k 路归并、条目映射 |
| `Back/Edge/src/server.mjs` | 修改（独占） | 新增 `GET /api/jw/v2/customers/:id/activity` 路由＋鉴权链；`modelReceiptsDir` 依赖提升并传入；knownRead 补 `/activity`（POST→405）。净增约 61 行，未动任何既有路由语义 |
| `Back/Edge/test/v04-activity-http.test.mjs` | 新建 | 真实本地 HTTP 回归 12 例（见 §4） |
| `docs/v0.4/results/04-activity/frontend-consumption-example.mjs` | 新建 | 前端消费示例（文档用途，未接入 Front） |
| `docs/v0.4/results/04-activity/input-hashes-start.txt` / `hashes-end.txt` | 新建 | 轮始/轮末源码 hash |

## 2. 接口与语义（摘自 CONTRACT.md，细节以契约为准）

`GET /api/jw/v2/customers/:id/activity?limit&cursor&sources&audience`，只读聚合三源并分列标识：

- **thread**（页内消息，复用 `messageStore.list`）：`activityId=thread:<messageId>`、可信 actor（发送时会话落库）、`at`、`delivery.state`（取自 message_receipts，缺失=unknown）、`state=completed`（仅表示投递成功已留档）。
- **kernel**（业务事件，复用 `store.pageEvents` 逐请求凭据）：`activityId=kernel:<A eventId>`、A 原始 `occurredAt`、事件无 actor→unknown、`state=completed`（仅表示 A 已记录发生）；fixture 无分页源→`sources[]` 如实 `NOT_SUPPORTED`，不伪造历史。
- **model_receipt**（模型回执，直接只读 `assistant-receipts` 落盘 JSON）：`activityId=model_receipt:<requestId>`、回执 `at`/`tenantId`、INTENT 无 TERMINAL/损坏/未知状态一律 `state=unknown`；回执无 principalId→actor unknown，不以当前会话人填补。

分页与权限：每源按自身服务端游标升序、k 路归并只弹各源前缀 → `perSourceCursors` 续读不漏不重；复合游标为 opaque base64url（非法/版本不符/形状错→400，不静默重置）；页序明确披露"展示提示，非全局总序"；`activityId` 带来源命名空间去重（同 eventId 重放只出一次）。每次请求全量重验：会话（过期/撤销→401）→ `activity:read`（403）→ `store.checkCustomer`（A 逐请求裁决，撤权翻页即 403/404，存在性不泄露）；customer-only 会话强制 customer 受众、排除 model_receipt（显式点名→403，默认排除在 `sources[]` 显式标注 `excludedByAudience`）。

## 3. 未接入事件类别（明确列示，未伪造统一流）

- **审计条目**：进程内存非持久，继续走既有 `GET /api/jw/v2/audit`；
- **决策反馈库**（decision-feedback-store）：无按客户列举接口；
- **处理通道进度/回执**（Connectors）：继续走 `/api/jw/v2/connectors/**`；
- **消息投递回执**：不单列条目，作为 thread 条目 `delivery.state` 附注；
- **kernel 事件 actor / thread 租户列 / 纯 `.claim` 残留**：来源本身缺失 → `occurredAt:null` / `actor.trusted:false` / 不入列（契约 §4 已披露时钟回拨边界）。

## 4. 测试证据（真实本地 HTTP，随机端口，全自足）

命令与退出码（工作目录 `Back/Edge`；日志在 `.local/v04-04/`）：

| 命令 | 日志 | 结果 |
|---|---|---|
| `node --test test/v04-activity-http.test.mjs`（第 1 轮） | `v04-activity-run2.log`（第 2 轮） | **12/12 PASS，EXIT=0，两轮可重复** |
| `node --test --test-concurrency=1 <24 个既有测试文件> test/v04-activity-http.test.mjs` | `edge-regression-excl-others.log` | **158/158 PASS，EXIT=0**（含 g03e 消息线程、t4-assembly、s3-harness/csrf、s1-*、takeoff-surface 等全部既有面） |
| `node test/run-all.mjs`（全目录） | `edge-test-run.log` | EXIT=1：**6 个失败全部位于他路 writer 在途文件 `v04-message-idempotency.test.mjs`**（本路未创建/未修改；该文件在开工盘点时不存在，属 03 路回执围栏范围）。本路对 messages.mjs/message-store.mjs/assistant-receipts.mjs 零改动（hash 见 §6），不做代修，按并行纪律只报告 |

12 例覆盖任务书全部要求场景：三源分列与字段契约、刷新一致（同事件稳定 activityId/occurredAt/actor）、重复投递去重（requestId 重放＋A eventId 重放）、limit=2 逐页续读不漏不重、相同时间确定性 tiebreak、晚到事件（旧时间高 seq）不丢、游标非法/版本不符/形状错 400、线程保留窗口裁剪过期游标 truncated+retentionBase 披露、缺失身份（actor null+untrusted）与缺失时间（occurredAt=null）、intent-only 回执 unknown、提问不推导模型成功（无回执无条目；failed 如实 failed）、跨客户/租户 404、内部受众 403/排除披露、翻页中撤权 403、会话过期 401（含借旧游标续读）、fixture 降级 NOT_SUPPORTED、全未配置 501、POST→405。

**GET 零副作用断言**（结构性＋实证双保险）：测试实例不装配模型/上传/审批面；对替身 A 的请求逐条断言"仅 GET `/api/v2/customers/:id` 与 `/events`，无 assessments/financing/invitations/inspections/originals 路径"；审计 sink 计数、线程存储 stats、回执文件数 GET 前后不变。

## 5. 替身边界（诚实声明）

- 唯一替身是"Back/A 持久数据库"（本测试内可控 HTTP 上游，实现 A 的 events/customer 只读端点与凭据 ACL）；Edge 侧聚合链（kernel-store.pageEvents/checkCustomer、message-store sqlite、回执文件读写、路由/鉴权）全部为真实代码经真实 HTTP。
- 回执文件由测试按 assistant-receipts 落盘形状直接写入（不装配真实模型；模型真实调用不属本路授权）。
- 因此本回归证明"Edge 聚合＋sqlite 线程＋回执文件＋替身 A"整链语义，**不**声称真实 A 持久数据库整链通过；真实 A 链的 events-page/messages 面已由 V0.3 backend-qa-r2（auth-upload / evidence-chain 报告）另行覆盖。

## 6. 源码 hash（轮始→轮末漂移核对）

- `server.mjs`：`1f7307b7…` → `8858a62d…`（本路独占改动，预期内）
- `kernel-store / messages / message-store / assistant-model / assistant-receipts / session / audit / store.mjs`、`V0.4_KANBAN.md`、`ZCODE_PARALLEL_04.md`：**轮末与轮始 hash 逐一相同，零漂移**（并行 writer 的改动仅出现在其自有文件：`assistant-evidence-provider.mjs`、`assistant-evidence-scope.mjs`、`test/v04-evidence-*`、`test/v04-receipts-*`、`test/v04-message-idempotency.test.mjs`、`test/v04-readiness-check.test.mjs`、`scripts/v04-readiness-check.mjs`、`config/takeoff-runtime.example.json`）

## 7. 资源与遗留

- 本路未启动任何共享实例/容器/端口；测试全用随机端口＋`os.tmpdir()` 临时目录并自清理；日志仅落 `.local/v04-04/`（Git 排除区）。无 skip、无删除失败测试、无降低权限断言。
- 遗留（移交串行集成，非本路 ownership）：
  1. Front 四页/聊天的实际接线（消费示例已给，前端由 Codex 保留）；
  2. 他路在途 `v04-message-idempotency.test.mjs` 6 失败（03 路回执围栏范围，本路零改动相关源码）；
  3. `model_receipt` 排序键的时钟回拨边界（契约 §4；如需硬保证须上游给回执分配序列，已列接口需求建议）；
  4. audit/决策反馈/处理通道三类来源未聚合（理由见 §3），如需接入须先冻结各自列举契约。
