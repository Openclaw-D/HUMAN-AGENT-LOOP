# 路04 · Edge 接线方案（现状核对后定稿）

日期：2026-09-20。依据：Back/Edge/src 全量源码核对（server/proxy/readproxy/channel-authz/kernel-store/session/messages/message-store/version/static/store/audit/probes）、04_BACKEND_ADAPTATION §3–§6、02路 INVENTORY §6。

## 1. 现有 Edge 面盘点（复用，不改语义）

| 面 | 现状 | TAKEOFF 用途 |
|---|---|---|
| 会话交换 `POST /api/jw/v2/session` | 凭据/principalId→不透明会话；身份目录+A目录探针双重校验；凭据不落浏览器 | 直接复用（客户+内部有权人员均走此入口） |
| CSRF 写守卫 | 全部 POST/DELETE 过 Origin/Sec-Fetch-Site | 直接复用 |
| 可信 actor | `trustedActorHeaders` 服务端派生 x-jw-actor-*，body 自报 actor 被覆写 | 直接复用（T12 假角色不可写） |
| 动作代理 `POST /api/jw/v2/actions/**` | 白名单转发 A/Connectors，requestId 强制，上游错误原样透传，502+同号重试语义 | 在 ACTION_ROUTES 增量登记预评估确认族 |
| 读透传 GET 白名单 | assessments 清单/详情、decision-status、artifacts(清单/processing/content)、reports、findings、decision-packages、domain-exemptions、my/materials | 二十格/材料/发现/方案的读源；front takeoff-projection 消费 |
| 处理通道代理 | Connectors IR-02-C 读/写面 + 逐资源授权（角色边界/客户归属/task/receipt 归属预检） | 统一上传链、补证问答、人工录入复用 |
| 消息线程 | audience 路由 + 外发守卫 + node:sqlite 持久化（--messages-file），重启可恢复 | 六助手共用消息区直接复用（T11 恢复） |
| 回执对账 | GET /receipts/:requestId 透 A，(tenant,principal) 归属过滤 | T07/T11 对账 |
| SSE 事件 | at-least-once + Last-Event-ID + resync + 会话复检 | 看板实时刷新 |
| 同源前端 | --serve-front Front/dist，CSP connect-src 'self' | 唯一主入口形态 |
| 原件上传 | /actions/customers/:id/originals → transformOriginals（≤512KB base64 信封） | T02 统一上传链入口（一份原件只走一条链） |

**确认结论：Edge 现状没有"独立预评估确认"路由（全库 grep 无 confirm-preassessment）；也没有任何 TAKEOFF 专用投影。** 现有 `assessments/:id/(candidate|submit-review|decide)` 中 `decide` 只有 reject/withdraw 语义（A 侧），`facilities/:id/approve` 是正式授信批准——按基线纪律，TAKEOFF 确认不得复用该路由。

## 2. 接线缺口（01契约 §13 已冻结；03协议 v1.0 已冻结 → 除 G4 写侧外全部落地）

| # | 缺口 | Edge 侧动作 | 状态 |
|---|---|---|---|
| G1 | 正面预评估确认（T09） | ACTION_ROUTES 新增 `POST /api/jw/v2/actions/assessments/:id/confirm-preassessment` → A §13.1；鉴权/门序/幂等 A 裁决 | **已实现**（proxy.mjs；测试 takeoff-surface.test.mjs） |
| G2 | 行政撤回/负面终结（T10） | 复用既有 `decide=withdraw_assessment`；负面走 confirm-preassessment `outcome=not_support`（硬门不适用） | **已覆盖**（无需新路由） |
| G3 | 读投影 | `GET /api/jw/v2/assessments/:id/candidates`（§13.3 候选历史）+ workspace.snapshot.admission（Edge 侧二十格聚合，01契约 §7 责任边界；新模块 src/admission-projection.mjs 纯函数） | **已实现**（kernel-store 附 admission；投影纪律=分母未知null/不产生100%绿/霜冻仅投影） |
| G4 | 分析代理（六助手受控分析） | 读侧：`GET /api/jw/v2/connectors/analysis/finalization`（03协议 §7，cid/tid→customerId/tenantId 映射+逐客户校验）已实现。写侧：上传/问答/人工录入走既有 CONNECTORS_ACTION_ROUTES；若03后续新增写面再增量登记 | **读侧已实现**；写侧复用既有面 |
| G5 | 首次回租需求登记 | 复用 `POST /actions/customers/:id/assessments`；01契约未新增字段要求 | **已覆盖**（既有路由） |

已登记消费面快照：Back/Edge/contract/consumed-surface-v1.json（edgeFacing.takeoff + workspace.admission 说明）。测试：Back/Edge/test/takeoff-surface.test.mjs（6项）+ 全套件 78/78 绿（2026-09-20）。

## 3. 明确不做

- 不删/不停用既有 `facilities/:id/approve`、`financing-requests/*` 路由：它们是 A 消费面既有契约（历史测试/正式链在用）；TAKEOFF 约束落在**页面默认路径不含这些入口**（02路 T01 断言），Edge 不新增、不诱导调用。
- 不做第二个业务真相：Edge 不建业务表、不缓存授权结论、不修改上游错误语义。
- 不为走通而放开 CSRF/外发/actor 覆写/白名单任意性。

## 4. 装配形态（最终快照）

- 端口段：Edge 48214 / A 48194 / Connectors 48114 / PG 容器 jw-takeoff-pg@15446（启动前逐一核对占用，被占即换段不抢占；详见 RESOURCE_INVENTORY.md）。
- 启动：`node Back/Edge/src/server.mjs --port 48214 --kernel-port 48194 --connectors-url http://127.0.0.1:48114 --connectors-token-file <本轮令牌> --auth-file <本轮合成身份目录> --messages-file <本轮run目录>/edge-messages.db --serve-front Front/dist --marker <takeoff-marker> --heartbeat <run目录>/edge-heartbeat.json`。
- 全部本轮资源写入新 run 目录 `Back/Edge/.run/takeoff/`（.run Git 排除），不覆盖旧 delivery 登记。
- 冻结项：git 工作区 hash、Front/dist 构建 hash、Edge versionz buildId、A 迁移版本、依赖 lock（T 执行前采集入 TEST_RESULTS.md）。
