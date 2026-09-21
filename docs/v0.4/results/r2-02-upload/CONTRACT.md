# R2-02 路 · 上传恢复适配装配契约（V0.4-UPLOAD-ASSEMBLY-R2-1.0）

2026-09-21。本契约由 R2-02 路冻结（writer：ZCode R2-02 路），是 `docs/v0.4/tasks/ZCODE_R2_02.md` 的交付契约。共享 `Back/CONTRACT.md` 本轮不改；输入契约 `docs/v0.4/results/01-upload/CONTRACT.md`（V0.4-UPLOAD-AUTHZ-PROJ-1.0）的授权语义继续有效，本装配只组合、不改写任何一段既有授权/恢复语义。

## 0｜定位与边界

- **目标**：把三段既有能力注入合成为一个**可注入的装配模块**，并给出隔离 HTTP/PG 链实证：
  1. A 上传授权投影（`GET /api/v2/customers/:customerId/upload-authorization`，正式 HTTP 面）——唯一授权裁决方；
  2. Edge 恢复 reader（`Back/Edge/src/upload-context.mjs` 的 `createUploadContextReader`）——双重授权检查与响应 allowlist 的既有载体（本轮零改动）；
  3. Connectors 恢复模块（`Back/Connectors/src/intake/upload-context.mjs` 的 `makeUploadContextService().read`）——唯一恢复上下文来源（本轮零改动）。
- **不是**：不改共享 `server.mjs`（挂载留串行集成，示例见同目录 [MOUNTING.md](MOUNTING.md)）；不改 A/Connectors 源码；不做上传写路径/对象存储原子性；不自创权限政策；不宣称共享运行实例的恢复已启用。
- **未装配的真实缺口（如实登记）**：真实部署入口（server.mjs 路由）尚不存在；分进程部署下 Connectors 无 upload-context 只读 HTTP 口（现仅进程内模块）。本装配通过注入两条路径（`aBaseUrl`/`connectorsStore` 或直接注入 `authorizeUpload`/`fetchContext`）为串行集成留出选择，不伪造任何生产入口。

## 1｜模块契约（Back/Edge/src/upload-context-assembly.mjs，新建）

### 1.1 工厂

```js
await createUploadContextAssembly({
  sessionOf,            // 必填 (req) => session|null（server.mjs 同款：sessionStore.resolve(req.headers['x-jw-session'])）
  authorizeUpload,      // 二选一：现成 A 授权适配（reader 既有注入点签名）
  aBaseUrl, fetchImpl,  // 二选一：给 aBaseUrl 时由工厂构造 A HTTP 适配（fetchImpl 默认全局 fetch）
  fetchContext,         // 二选一：现成恢复读适配（({tenantId,customerId,principalId}) => context）
  connectorsStore, now, // 二选一：给 connectorsStore（需 .query）时进程内组装 makeUploadContextService
}) // => { reader, authorizeUpload, fetchContext }
// reader: async ({ req, customerId }) => { status, body }（与 createUploadContextReader 同签名）
```

- 依赖缺失在**装配期抛 TypeError**（配置期失败关闭）；不靠运行期 503 兜底掩盖配置错误。
- async 工厂：`connectorsStore` 分支动态 import Connectors 源（`../../Connectors/src/intake/upload-context.mjs`）——仅直连形态加载该依赖；分进程部署可改注入 `fetchContext`，不拖入源级耦合。

### 1.2 A 授权 HTTP 适配（createAuthorizeUploadViaA）

| A 响应 | 适配行为 | reader 最终结果 | 语义 |
| --- | --- | --- | --- |
| `200` 任意 JSON（含 `ok:false` 拒绝） | 原样返回投影 | `ok:false` → **403 UPLOAD_FORBIDDEN** | 结构化授权拒绝，不伪装成上游故障 |
| `403 PRINCIPAL_UNTRUSTED` / `400 INVALID_INPUT` 等其余 4xx | 映射为 `{ok:false, reason:<A错误码>, tenantId:null, …}` 拒绝形状 | **403 UPLOAD_FORBIDDEN** | 凭据失效/入参非法=失败关闭拒绝 |
| `5xx` | 上抛 `A_AUTHZ_UPSTREAM_FAILURE` | **503 UPLOAD_CONTEXT_UNAVAILABLE** | A 内部故障如实上抛，不解析成"无权限" |
| 网络不可达 / 200 畸形 JSON | 上抛 `A_AUTHZ_UNREACHABLE` / `A_AUTHZ_UPSTREAM_FAILURE` | **503 UPLOAD_CONTEXT_UNAVAILABLE** | 真上游故障 |

- credential 经 `x-principal-credential` 头**原样转交** A（会话身份绝不作为授权来源）；`principalId` 作查询声明传 A 做一致性核验（01 路契约 §3.2 的防混淆护栏）。

### 1.3 Connectors 恢复读适配（createFetchContextFromConnectors）

- `makeUploadContextService(connectorsStore, { now }).read` 直通；只读 SELECT（`participant_bindings` JOIN `intake_invitations`），不新建/续期/接受邀请、不触碰对象存储。
- 歧义（`AMBIGUOUS_UPLOAD_BINDING`）/撤销/过期/范围非法（`INVALID_UPLOAD_SCOPE`）→ `available:false` 结构化回报（reader 200 + `available:false`），失败关闭。

## 2｜保持的既有安全性质（装配不改写，测试实证）

1. **双重授权检查**：reader 的读前/读后两次 `authorizeUpload` + 读后会话复查（撤权/会话变化即断）。
2. **可信身份传递**：仅服务端会话持有凭据；`fetchContext` 收到的 tenantId 是 A 按客户行判定的权威租户（仅全门通过时返回），客户端无任何租户/主体声明通道。
3. **租户白名单**：A 侧 `tenants` 范围 + `principal_customer_grants`；Connectors 侧查询按 `(tenant_id, customer_id, provider='jw_principal', provider_user_id=会话主体)` 精确作用域。
4. **响应 allowlist**：输出仅 `ok/customerId/available/reason/bindingRef/invitationId/allowedKinds/allowedObjects/expiresAt`；token/凭据/哈希/provider 标识不出浏览器面。
5. **GET 零写**：A 库与 Connectors 库全表快照逐字节一致（审计/幂等/邀请/绑定/工件表零行差）。

## 3｜测试与验收口径

- **真实链**（v04-upload-assembly.test.mjs，11 例）：真实 A 内核进程（随机端口）+ 真实 Connectors store（隔离 PG 独立测试库）+ 真实 reader/会话存储，装配实例挂隔离 HTTP（随机端口，仅 loopback）。A 与 Connectors 数据以同一 `(tenant, customerId, principalId)` 三元组对齐——A 联系人凭据派生主体即 Connectors `jw_principal` 绑定的 `provider_user_id`。
- **边界套件**（v04-upload-assembly-boundaries.test.mjs，9 例）：A 适配层状态映射（200/4xx/5xx/畸形/网络错）、工厂配置校验、畸形上下文 502、歧义分支。
- **替身边界（全部单列）**：
  1. Edge 会话 exchange 的 `verifyCredential`（会话建立层注入点，真实授权仍逐请求转交真实 A 复核——伪造凭据会话被真实 A 拒绝有专例）；
  2. 歧义用例的行形状内存 store（真实 schema 唯一索引 `uq_binding_scope` 使双 active 绑定不可构造，该分支是 Connectors 防御代码；只验证装配链行为，不验证 SQL）；
  3. 边界套件的 `fetchImpl` 状态替身（模拟 A HTTP 码）。
  其余零替身。无隔离 PG 时运行器退出码 2（阻点），跳过不计通过。

## 4｜串行挂载

具体最小清单与代码示例见同目录 [MOUNTING.md](MOUNTING.md)。本路**未改** `server.mjs`；挂载后须由独立验收确认"拒绝不伪装成故障"（403/503 语义）在生产入口保持。

## 5｜本契约不声明的事

- 不声明共享 Edge 运行实例的上传恢复已启用/可用（未挂载）。
- 不声明分进程部署形态已定（Connectors 只读 HTTP 口是否存在属 CTRL 决策）。
- 不声明上传写路径（`withAuthorizedUpload`）、对象存储原子性已验证（本轮未触碰）。
- 不改变 01 路契约任何登记；邀请过期仅挡兑换的既有口径如实继承（未加严）。
