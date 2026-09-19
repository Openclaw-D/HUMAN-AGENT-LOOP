# 任务02 · 接口需求登记（来自任务04 Edge/装配/验收路）

登记人：任务04（Edge、运行装配与联合验收）。日期：2026-09-19。
依据：任务04 §二/§三（Connectors 服务令牌面逐资源授权审计 + 统一上传编排冻结）。
状态标记：OPEN（待任务02 owner 裁量/实施）/ CLOSED。

---

## IR-04-2A（高优先·安全）Connectors 服务令牌面缺逐资源客户/动作授权

**反例基础**（本轮已在 Back/Connectors/src/http/server.mjs 逐路由核对，反例已在 Edge 侧建立并通过隔离栈断言；Connectors 侧未改——不在任务04 writer 范围）：

服务端在 `server.mjs:70` 统一校验 `X-Service-Token` 后，全部 `/api/connectors/**` 路由信任调用方自报的 `tenantId/customerId/actor/evidenceId/taskId`，无逐资源归属校验：

| # | 路由 | 自报字段 | 缺口 |
|---|---|---|---|
| 1 | `POST /api/connectors/evidence/upload` | `body.customerId`、`body.invitationId` | `intake.checkUploadScope` 只校验邀请状态/kind/对象锚定，**不校验 `invitation.customer_id === body.customerId`**——持服务令牌者可用 A 客户的邀请把材料登记到 B 客户名下 |
| 2 | `GET /api/connectors/evidence/preview` | `?tid&eid&cid` | 不校验 `artifact.customer_id === cid`；`cid` 仅用于铸签名 URL——可为任意 (eid, cid) 组合铸出"合法"签名 URL（对照：`evidence/media-url` 有 `customerId !== art.customer_id` 对账，preview 没有） |
| 3 | `POST /api/connectors/evidence/verify` / `manual-entry` / `correct-fact` / `questions/answer` / `questions/verify` / `processing/pause` | `body.tenantId/customerId/actor/correctedBy` | 人工复核/更正/问答/暂停全部信任自报归属与 actor |
| 4 | `GET /api/connectors/processing/tasks/:id`、`/processing/status` | `?tid(&cid)` | 按自报租户/客户取数，无授权过滤 |

**影响**：Edge 是当前唯一持服务令牌的页面换权点，任务04 已在 Edge 侧补齐会话→逐资源授权（角色矩阵 + A checkCustomer + taskId 归属预检，见 `Back/Edge/src/channel-authz.mjs`），页面面已收敛。但 Connectors 是多消费方服务面：任何其他持令牌服务、或 Edge 侧未来回归，都绕过页面授权直接操作任意客户数据。服务令牌是服务间信任，不是资源授权。

**请求**（Connectors 服务端防御纵深；与 Edge 侧校验互为冗余，不冲突）：
1. `evidence/upload`：`checkUploadScope` 增加 `invitation.customer_id === customerId` 校验（W01 语义闭合）。
2. `evidence/preview`：对账 `artifact.customer_id === cid`（不一致 → `MEDIA_URL_CUSTOMER_MISMATCH` 同款 403/404）。
3. 其余写路由按服务令牌携带的调用方身份（或新增 `X-JW-Actor-Principal/Roles` 服务端头约定）做最小客户/动作校验；至少 `actor` 不得纯自报。
4. 明确"服务令牌面仅限服务端内网调用"的部署边界并写入 Connectors README（若已有请指路，本轮未检索到）。

**优先级**：高（任务书 §三 第5条点名的反例已建立）。

---

## IR-04-2B（中）处理驱动健康不可外部观测

`GET /healthz` 不含处理驱动状态（lastTick/interval/是否 startDriver）。任务04 §三要求健康检查分别报告"处理驱动"；当前 Edge 侧只能间接推断（进程 up + 处理面可达）。请求 `/healthz` 增加只读字段（如 `processing: {driverStarted, lastTickAt, intervalMs}`），不改变任何既有字段。

## IR-04-2C（高·需与任务02/03/04 冻结）统一上传编排：用户只提交一次原件

现状：页面（Front dist）同时存在两条提交路径——A 档案 `POST /api/jw/v2/actions/customers/:id/originals` 与通道 `POST /api/jw/v2/actions/connectors/evidence/upload`（邀请/接受/上传）。用户各提交一次 = 任务书 §三 禁止的"双写成功一半"形态。

请求任务02（与任务03/04 会签）冻结单一编排，任务04 候选方案（供裁量）：
- **方案 R（推荐）**：页面只提交通道面（Connectors 上传，邀请范围门 + 对象存储 + 处理入队原样保留）；A 档案工件由 Connectors aBridge 以服务身份回写登记（现有 `a_customer_links` + `a_links` 对账簿机制，`requestId` 确定性幂等，失败进 `unknown_reconcile_later` 由驱动恢复扫描收口）。A 侧无需新表；"系统持久记录并推动处理，结果回到同一客户"由 Connectors 驱动保证。
- **方案 A**：页面只提交 A（originals）；Connectors 订阅/轮询 A 新工件再拉取处理——需要 A→Connectors 的事件/拉取面（任务03 未交付，代价更高）。

任务04 已把通道上传 → 常驻驱动处理 → 任务详情 的链路在合成验收栈跑通（`docs/v02-remediation/task-04/evidence/assembly-smoke-result.json`），方案 R 的 A 回写支路待任务02 确认后联调。

## IR-04-2D（低）`GET /api/connectors/evidence/preview` 响应缺 `customerId`

预览响应不含工件归属客户，Edge 归属预检只能依赖 `cid` 自报 + 上游对账（IR-04-2A-2）。若 2A-2 落地，本条自动闭合。

---

# 任务02 owner 回应与冻结（2026-09-19，接上节 IR-04-2A..D 与任务01 IR-T01-*）

状态：IR-04-2A-1/2、2B、2D 本轮已落地（Back/Connectors）；IR-04-2C 冻结为方案 R；
IR-T01-3 落地；IR-04-2A-3 部分落地+边界声明；IR-T01-1 随方案 R 闭合。

## 对 IR-04-2A（服务令牌面逐资源授权）

- **2A-1 已落地**：`intake.checkUploadScope` 返回邀请归属 `customerId`；upload 路由逐一比对
  声明 `customerId`，不一致 → 403 `CUSTOMER_MISMATCH`（材料不落库、不入对象存储）。测试：
  `test/goal02-link-chain.test.mjs`（真实 A 内核）伪造客户用例。
- **2A-2 已落地**：`evidence/preview` 对账 `artifact.customer_id === cid`，不一致 → 403
  `MEDIA_URL_CUSTOMER_MISMATCH`（与 media-url 同款）；响应补 `customerId`（**2D 同时闭合**）。
- **2A-3 部分落地**：本轮把"缺失凭据/缺映射/A 不可达"一律改为可恢复等待态（见下"任务状态
  语义冻结"），不再信任自报归属推进；actor 纯自报问题属 Edge↔Connectors 头约定，需任务04
  提出 `X-JW-Actor-*` 服务端头规范后任务02 配合实施（本文件追加即可，任务02 义务跟进）。
- **2A-4**：部署边界声明见 `Back/Connectors/README.md` 补段（服务令牌面=服务端内网调用；
  页面身份裁决在 Edge）。

## 对 IR-04-2B（驱动健康可观测）

已落地：`GET /healthz` 增 `processing: {driverStarted, lastTickAt, lastTickError, intervalMs, lastResult}`
（svc.processing 未装配时 `{driverStarted:false, notWired:true}`），既有字段未动。

## 对 IR-04-2C（统一上传编排）——冻结为方案 R

1. 页面只提交通道面 `POST /api/connectors/evidence/upload`（邀请范围门+对象存储+处理入队不变）。
2. A 档案工件由 Connectors aBridge 以 A 凭据登记：材料=上传者映射凭据（客户上传恒 unverified）、
   派生解析件=registrar；运行/Gate 回执=findings=service；requestId 确定性幂等；失败进
   unknown/blocked 由驱动恢复扫描收口（绝不换 ID 重发）。
3. **新客户零配置接通（任务02 核心）**：customerId 沿用 A 建档原 ID 时，处理链自动经 A 权威
   `GET /api/v2/customers/:id` 核验（存在+租户一致）后落 `a_customer_links`
   （`auto_authoritative_same_id`）；页面/Edge 无需任何逐客配置。映射场景（本地 ID ≠ A ID）经
   `POST /api/connectors/customers/link` 受控登记（legalEntityRef 归属证明）。
4. 方案 A（A→Connectors 事件/拉取）不采用；如 A 后续提供事件面可再评估，当前不改。

## 对 IR-T01-3（按 requestId 查通道回执）

已落地：`GET /api/connectors/processing/receipts/:requestId?tid=…`（服务令牌面，只读 a_links
对账簿）→ `{ok, found, requestId, receipt}`；未命中 `{found:false}`。A 动作回执仍在 A 侧
`/receipts/:requestId`，前端可两路对账合一。

## 任务状态语义冻结（任务04/03 页面消费）

- 新增可恢复等待态：`blocked_link`（映射缺失/A 权威核验未过，failure_code=
  `A_CUSTOMER_NOT_IN_A|A_TENANT_MISMATCH|A_UNREACHABLE|A_UPLOAD_PRINCIPAL_MISSING`）、
  `blocked_a_unavailable`（A 未配置/凭据缺失；严格默认）。等待态保留游标，sweep 按退避自动重入，
  不消耗失败预算（max_attempts+1，attempts 单调作 G3 尝试代数）。
- `blocked_unknown` 修复：等待态保留游标（此前覆写 'done' 会使对账恢复后跳过全链直接"完成"——
  响应丢失恢复≠全链完成，诚实性缺陷已修，P09 现断言真实续跑）。
- 任务可见性：`GET processing/status` 与 `GET processing/tasks/:id` 每任务新增
  `aRegistered`（bool）与 `bridgeState`（registered|unknown|failed|none）。
  **`status='done'` 且 `aRegistered=false` 在严格模式不可达**；显式 `localOnlyCompletion=true`
  部署的 done 语义为"本地完成"，页面必须按 `bridgeState='none'` 呈现，不得渲染为全链完成。
- 四态分离：解析完成（G3 parsed/analyze analyzed）、待人工复核（needs_followup+manual 问题）、
  A登记完成（aRegistered=true）、桥接失败/未知（blocked_*+failure_code）。

## 对任务04 的反向请求

1. Edge 侧 `checkCustomer` 预检与 2A-1 形成双层；页面 journey 中 `blocked_link/blocked_a_unavailable/
   blocked_unknown` 请原样透出 failure_code 与 note，不吞不出"全部完成"。
2. 任务03 的 A 原件上传路径（uploadOriginal→A artifacts）在方案 R 下应收敛到通道上传；A 侧
   `artifact_processing` 显示由 G3 回执驱动。若页面短期内保留双入口，请在 IR 中标注过渡状态。

---

# 任务02 owner 增补（2026-09-19 board-round-02，接上节）

- **IR-04-2A-3 完全闭合（actor 可信来源）**：token→调用方绑定（`callerBindings`）已落地并有测试
  （`test/goal02-actor-trust.test.mjs`）——人类 actor 仅可由网关绑定令牌代理；非代理调用方自报
  → 403 ACTOR_NOT_DELEGABLE；未绑定令牌 fail closed；不引入仅凭存在性信任的 header。资源归属面
  同步补齐：manual-entry/correct-fact 跨客户 → 403 CUSTOMER_MISMATCH。
- 全链测试收口：Connectors 全量 88/88、link-chain（真实 A 内核）6/6、blocked-recovery 3/3、
  actor-trust 2/2、Back/C 101/101。本轮新增修复：CSV 声明表表头感知解析（Back/C）、runTask 游标
  先行（段后崩溃恢复语义）、correct-fact A 回写 from_artifacts 修复。
- 本轮后续登记与对齐移至 docs/codex-handoff/board-round-02/task-02/（INTERFACE_REQUESTS.md：
  IR-02-4A/4B/4C/4D、IR-02-3A、IR-02-1A）。
