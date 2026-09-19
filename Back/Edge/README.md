# Back/Edge · JW 任务04：实时工作台 Edge、版本协议与独立验收

写入边界：`Back/Edge/**`（新增）、`Back/D/**`（验收侧）、登记过的启动/停止脚本、`docs/customer-next/acceptance/**`。任务书：`JW_customer_credit_backend_tasks/04_REALTIME_INTEGRATION_AND_ACCEPTANCE.md`。零运行时依赖（Node ≥22，标准库）。

## 当前状态（S1 全量 + S2 传输语义 E0 + S3 骨架与判据；内核集成 BLOCKED 待任务01）

- **S1 已交付**：版本封存协议（`/versionz` + CLI）、liveness/readiness 拆分、D01–D28 独立验收矩阵（`docs/customer-next/acceptance/D01_D28_ACCEPTANCE_MATRIX.md`）、安全启停、E0 自检全绿。
- **S2 部分（E0）**：`/api/jw/v2/customers/:id/workspace|events` 以 fixture store 证明 SSE 传输语义（至少一次、Last-Event-ID 补取、游标过期 resync、scope 403/404）。**不冒充内核集成**——真实投影待任务01冻结契约后替换 `src/store.mjs` seam。
- **S3 已交付（E0）**：动作代理（`/api/jw/v2/actions/**`：固定上游+显式白名单、会话→上游凭据服务端映射、requestId 必带不代生成、上游未知 502 回显原 ID 不自动重试）、消息受众路由（`/api/jw/v2/customers/:id/messages`：customer/internal 分离、内部外发默认 403、显式确认+强制审计）、审计 sink（`/api/jw/v2/audit`）、browser-harness 最小操作页（`/harness/`，源码 `Back/D/browser-harness/`）。
- **S4/S5 其余**：未开始或 BLOCKED，见矩阵 §4。

## 运行

```bash
cd Back/Edge
node scripts/edge-start.mjs          # 默认 127.0.0.1:48200；JW 部署形态探测 A@48180、PG@15442
  # --port N / --kernel-port N / --db-port N 可覆盖（或环境变量 JW_EDGE_PORT / JW_A_PORT / JW_PG_PORT）
  # --connectors-url URL --connectors-token-file F [--connectors-tenant t1]  # 处理通道消费面（live）
  # --messages-file <path>        # 消息+幂等回执持久库（node:sqlite；缺省=进程内，E0 兼容）
curl http://127.0.0.1:48200/versionz        # 版本封存（buildId/gitSha/sourceDirty/dist/contract/migration/能力位/规则包/依赖锁）
curl http://127.0.0.1:48200/healthz/live    # liveness：只表示进程存活
curl http://127.0.0.1:48200/healthz/ready   # readiness：逐依赖独立结果，DB down 不包装为就绪
node scripts/edge-stop.mjs           # 三证复核（pidfile+heartbeat+命令行 marker）后才停；不符拒杀 exit 5
node scripts/version-seal.mjs --probe  # 版本封存 → docs/customer-next/acceptance/evidence/
```

端口被占→exit 24 不抢占；双开→exit 23；停止不删除任何数据。运行态文件在 `.run/`（Git 排除）。

## 任务04 §三/§四 增量（2026-09-19）

- **处理通道装配闭环**：`scripts/delivery-up.mjs --config config/delivery-runtime.acceptance.json` 完整启动
  PG→A 迁移/播种→A 内核→**Connectors（常驻处理驱动+对象存储+A bridge；合成配置写 Connectors/.run/config.delivery.json，
  经 CONNECTORS_CONFIG 指向，绝不覆盖既有 .run/config.json）**→Edge（透传 --connectors-url/--connectors-token-file）。
  未透传通道配置时，页面 `/api/jw/v2/(actions/)?connectors/**` 显式 503 `CHANNEL_NOT_CONFIGURED`
  （修复此前落入 A 面代理误报 `PROXY_ROUTE_NOT_DECLARED` 的根因链）。`--without-connectors` 显式豁免（全链结论降级 NOT_RUN）。
- **逐资源授权**（`src/channel-authz.mjs`）：Connectors 上游只认服务令牌，Edge 换权点转发前裁决——
  customer-only 会话仅可 上传/问答/接受邀请（`access: 'customer'|'open'`），内部动作（邀请签发/人工转录/更正/获准复核/暂停）403 `ROLE_FORBIDDEN`；
  带目标客户的读写先经 A `checkCustomer` 裁决（缺失 400 失败关闭）；仅持 taskId → 服务端取回任务归属（`customer_id`）再校验，不可读统一 404 不泄露存在性。
- **健康检查分项**：readiness = kernel-a（A 内核 db=up）/ db（TCP）/ connectors（进程）/ connectors-channel（服务令牌+处理面）
  独立报告；未配置通道=advisory 检查（如实显示，不参与聚合）；聚合就绪由 delivery-up 全链把关。
  驱动 lastTick 与桥接业务链路无法由 Edge 外部观测——不冒充已验证（IR-04-2B）。
- **资源台账**：delivery-up 写 `.run/delivery/resources.json`（实例名/端口/PID/marker/日志/归属；B 执行器不常驻的判定记录）。
  delivery-down 停止顺序 Edge→Connectors→A（Connectors 多证复核=pidfile+heartbeat+`service=jw-connectors`+命令行 marker）。
- **消息与恢复**：`--messages-file`（node:sqlite，WAL）持久化页内线程与发送 requestId 幂等回执；重启后线程/回执可查，
  重放 `replayed:true` 不二次入栈。分页语义：增量 `after=N` 返回 seq>N 的**最早**一页（升序），cursor=本页最后一条
  （空页=N 本身）——修复"after=0、limit=2 返回 4,5、cursor=5 后 1..3 永久丢失"；保留窗口裁剪显式 `truncated:true+retentionBase`。
- **权威清单消费**（问题8，CONTRACT §12）：workspace 的 assessments/financing-requests 改由
  `GET /api/v2/customers/:id/{assessments,financing-requests}` 权威清单投影（`refsSource='authoritative_list'`），
  事件窗口引用仅作上游未升级回退（如实标注）；读面路由同步开放（limit/cursor 透传）。

## 任务04 board-round-02 增量（2026-09-19 晚）

- **新增通道路由代理（消费任务02 已落地面上游）**：
  - `GET /api/jw/v2/connectors/processing/receipts/:requestId?tid=`（IR-T01-3 通道回执对账）：Edge 转发前
    真实取回上游回执行做归属预检——命中且 `customer_id` 不可读 → 404（不泄露存在性），未命中透传
    `found:false`。**回执不能凭 requestId 越权查询**。
  - `POST /api/jw/v2/actions/connectors/customers/link`（IR-04-2C 方案 R 映射场景受控登记）：internal 角色 +
    目标客户 checkCustomer 裁决；legalEntityRef 归属证明由上游 Connectors 核验。
- **可信调用上下文**（与任务02 token→调用方绑定配套，IR-04-2A-3）：
  - 转发服务令牌面一律附加 `x-jw-actor-principal` / `x-jw-actor-roles`（`channel-authz.mjs trustedActorHeaders`
    由会话派生；浏览器请求头不透传，伪造同名头无效）；
  - 6 个人工动作路由转发前以会话 principal **覆写 body actor 字段**（correct-fact→correctedBy、manual-entry→
    enteredBy、pause→actor、questions/verify→verifiedBy、questions/answer→answerer、customers/link→requestedBy）
    ——Edge 令牌在上游是 mayDelegateActor 网关，不覆写则浏览器伪造 body actor 会被采信。
- **必需域政策受控入口**（`scripts/delivery-up.mjs` §5.5）：仅当运行配置显式声明 `requiredDomainsPolicy`
  （annotation 必须含"非公司制度"或"经公司批准"标注）才播种 `domain_requirement_policies` 并向 A 透传
  `--required-domains-policy`；未声明维持 POLICY_PENDING fail-closed。不 SQL 补业务状态、不伪造 Gate 回执。
- 测试：`test/t4-trusted-actor.test.mjs`（5 组）；全量套件 72/72。

## live 模式（任务三 C2：真实内核投影）

```bash
node scripts/edge-start.mjs --live --auth-file config/edge-auth.json --kernel-port 48180
  # 或整栈编排（PG→迁移→A→矩阵播种→Edge）：node scripts/delivery-up.mjs（config/delivery-runtime.json）
```

- `--live`：workspace/events 改由 `src/kernel-store.mjs` 从 A 内核实时投影（消费面契约：
  `contract/consumed-surface-v1.json`；上游漂移原样报错，不伪装）。无会话读 workspace → 403 SESSION_REQUIRED；
  客户/租户/角色授权由 A 每请求裁决，Edge 不缓存结论。customer 角色受限（A 侧 B13）时快照可见、
  事件流如实标注"受限"（`projection.notes`）。
- `--auth-file`：身份目录 JSON（示例 `config/edge-auth.example.json`，Git 排除真值）。会话交换 = 目录匹配 +
  A 只读探针双重校验；凭据原文只存服务端会话记录，浏览器只持不透明 sessionId。
- 动作代理白名单扩展至 v2 客户授信面与检查会话面（v1 goals/projects 保持）；`requestId` 必带，
  上游未知 502 UPSTREAM_UNKNOWN 回显原 ID 不自动重试；回执对账 `GET /api/jw/v2/receipts/:requestId`。
- SSE：`event: cursor|business|resync`；订阅以 workspace 基线游标起步（先补缓冲再收实时），客户端按
  eventId 去重（至少一次投递）。Edge 进程重启后旧游标 → resync。
- CORS：仅 `--allowed-origin`（可重复）/`JW_EDGE_ALLOWED_ORIGINS` 列出的源返回许可头并应答 OPTIONS
  预检；缺省跨域零许可头（同源部署无需配置）。
- 不带 `--live`：fixture 语义自检形态（E0 测试兼容，能力位如实报 not_wired）。

## E0 语义接口（真实内核接入前）

```
GET  /api/jw/v2/customers/:id/workspace    → { snapshot, snapshotVersion, eventCursor }
GET  /api/jw/v2/customers/:id/events       → SSE；?cursor=<eventId> 或 Last-Event-ID 头补取
                                              游标失效 → event:resync 后收流结束（绝不静默续播）
                                              无游标 → event:cursor 基线后只收实时
POST /api/jw/v2/session                    → {credential} 换不透明会话（默认失败关闭；--fixture-auth 启用合成演示身份 harness-demo-cred）
POST /api/jw/v2/actions/**                 → 白名单动作代理（goals: claim/complete/fail/accept/decide/pause/resume/takeover；projects: pause/resume）
                                              必带 requestId(1..128)；上游未知 → 502 UPSTREAM_UNKNOWN+原ID；不自动重试
POST /api/jw/v2/customers/:id/messages     → {requestId, audience: customer|internal, text, internalContent?, confirmExternalSend?}
                                              内部内容外发默认 403 AUDIENCE_MISMATCH；确认后放行+审计 confirmed
GET  /api/jw/v2/audit                      → 审计只读（会话+audit:read）
GET  /harness/                             → browser-harness 操作验证页（Back/D/browser-harness）
事件信封：eventId, scope{tenant,customer}, aggregateVersion, schemaVersion, occurredAt, payloadRef, payload
鉴权：默认失败关闭（PRINCIPAL_UNTRUSTED/SESSION_REQUIRED）；无权限零回放
```

读路径方法白名单仅 GET；写路径仅显式登记的 POST，且全部 POST 先过 CSRF 守卫（Origin 同源或允许列表；Sec-Fetch-Site 存在必须 same-origin；无浏览器头客户端放行；跨站/null origin/不一致组合 → 403 CSRF_ORIGIN_REJECTED）。staging 域名用 --allowed-origin（可重复）或 JW_EDGE_ALLOWED_ORIGINS 配置。客户端按 eventId 去重（至少一次投递，服务端保证不漏、不承诺不重）。

## 测试

```bash
node test/run-all.mjs   # 27 用例：版本封存 3 + 健康/方法白名单 3 + SSE 语义 7 + 动作代理/会话/受众/审计 5 + harness 3 + CSRF 守卫 6；退出码 0/1/2/3
```

## 已知边界

- `/versionz`/封存输出经出口自检：不包含绝对路径与凭据样字段（fail-closed，命中即抛错）。
- A 内核 `/healthz` 的 `ok` 字段含 liveness 混淆（db down 时也 ok:true）——已登记缺陷语义，Edge 侧 readiness 判据显式要求 `db==='up'`（`probes.mjs aKernelReadyPass`），不透传 ok。修正 A 侧属任务01 writer。
- 能力位（video/recording/policy/credit/model）逐一独立报告，永不汇总为 all_ok。
