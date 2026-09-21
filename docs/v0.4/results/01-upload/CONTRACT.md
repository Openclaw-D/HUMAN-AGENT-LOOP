# 01 路 · 上传授权只读投影契约（V0.4-UPLOAD-AUTHZ-PROJ-1.0）

2026-09-21。本契约由 01 路冻结（writer：ZCode 01 路），是 `docs/v0.4/ZCODE_PARALLEL_04.md` 01 项的交付契约。共享 `Back/CONTRACT.md` 本轮不改；本契约独立生效，待四路交回后由 Codex 串行验收时可决定是否登记进共享契约。

## 0｜定位与边界

- **目标**：从 A 服务现有可信身份链与 `registerArtifact` 正式上传写门，派生一个**零写、只读**的上传授权投影，明确回答：本凭据对某客户能否读（`canRead`）、能否上传（`canUpload`）、受哪些材料种类限制（`allowedKinds`）。
- **不是**：不新建角色表、不以 `checkCustomer`（kernel-store）替代正式授权、不放宽也不收紧现有写门语义、不做对象存储/上传恢复整链装配。Edge/Connectors 本轮零修改。
- **唯一授权语义来源**（只读引用，本轮未改动）：
  - `Back/A/src/domain/credit.ts` `registerArtifact` 写门：verify → tenant → `requireHuman` → `lockCustomer` → `requireCustomerScope` → `customer_identities.allowed_kinds`（`roles` 含 `customer` 时强制）。
  - `Back/A/src/domain/principal.ts` `authenticate/authorizeTenant/authorizeCustomer`、`Back/A/src/domain/v2kit.ts` `requireHuman/requireCustomerScope`。
  - 身份链：合成目录 → `customer_identities`（kind=human，roles=['customer']，customers='grant'）→ `service_identities`（kind=service，customers='all'）（`identity.ts` `chainCustomerIdentityVerifier`）。

## 1｜模块契约（Back/A/src/domain/upload-authorization.ts，新建）

```ts
interface UploadAuthQuery {
  credential: unknown;          // 同现有 API：x-principal-credential 头（或 body.principalCredential）
  customerId: string;           // 目标客户（必须 string 1..64，否则 INVALID_INPUT 400）
  kind?: unknown;               // 可选：要验证的材料种类；与 registerArtifact 的 kind 同口径（含 material. 前缀别名）
  principalId?: unknown;        // 可选：调用方声明的主体；仅用于与会话身份一致性核验（防张冠李戴），绝非授权来源
}
interface UploadAuthGrant {
  ok: boolean;                  // = 完整授权（canRead && canUpload && (kind未提供 || kindAllowed)）
  principalId: string;          // 凭据派生的主体（伪造声明不改变此值）
  customerId: string;
  tenantId: string | null;      // 客户行租户；任何拒绝路径一律 null（不确认跨租户存在性）
  canRead: boolean;             // verify + 租户范围 + 客户 grant（customers='grant' 查 principal_customer_grants）
  canUpload: boolean;           // canRead && kind==='human' &&（提供 kind 时）种类白名单通过
  kind: string | null;          // 回显请求的 kind；未提供为 null
  kindRestricted: boolean;      // 该身份是否受种类白名单限制（roles 含 customer 且存在 active customer_identities 行）
  allowedKinds: string[] | null;// 白名单内容；不受限为 null（不受限≠空集，是不设限）
  kindAllowed: boolean | null;  // 提供 kind 时的判定；未提供为 null
  reason: ReasonCode;
}
type ReasonCode = 'OK' | 'PRINCIPAL_MISMATCH' | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_SCOPE_VIOLATION' | 'NOT_HUMAN' | 'KIND_NOT_ALLOWED';
buildUploadAuthorization(kernel): { authorizeUpload(query): Promise<UploadAuthGrant> }
```

### 1.1 判定顺序（镜像写门事实链，逐条对应 registerArtifact 实现序）

1. **身份**：`authenticate(verifierForV2(), credential)` + `requireVerified` — 无凭据/凭据无法验证/验证器异常 → 抛 `AppError('PRINCIPAL_UNTRUSTED')`（403，失败关闭，不回显凭据；验证器异常只回固定文案）。**与写门逐字同源**。
2. **输入**：`customerId` 非法 → `INVALID_INPUT`；提供 `kind` 时必须 string 1..64 → 否则 `INVALID_INPUT`（与写门 `reqString(frame.kind,…,64)` 同口径）。
3. **主体声明核验**：`principalId` 声明存在且 ≠ 凭据派生主体 → `PRINCIPAL_MISMATCH` 拒绝（防把 A 主体权限记到 B 头上；写门无此声明字段，见 §3.2）。
4. **客户行**：`SELECT tenant_id FROM customers WHERE customer_id=$1`；不存在 → `CUSTOMER_NOT_FOUND`（写门对应 `lockCustomer` NOT_FOUND）。
5. **租户范围**：`principal.tenants !== 'all' && !tenants.includes(行租户)` → `CUSTOMER_SCOPE_VIOLATION`（写门对应 `authorizeTenant` 403 / `lockCustomer` 期望租户不符 404，按声明租户不同而异；投影无租户声明，按行租户判）。
6. **客户 grant**：`customers === 'grant'` 时查 `principal_customer_grants`（principal_id+customer_id 精确匹配，与写门 `requireCustomerScope` 同一查询）→ 缺失 `CUSTOMER_SCOPE_VIOLATION`。
7. **人类门**：`principal.kind !== 'human'` → `canUpload=false, reason='NOT_HUMAN'`（写门 `requireHuman('artifact.register')` PERMISSION_DENIED 403；agent 与 service 一律不可正式上传）。
8. **种类白名单**：`roles` 含 `customer` 且存在 active `customer_identities` 行（`WHERE principal_id=$1 AND status='active'`，与写门同查询）→ `kindRestricted=true, allowedKinds=行.allowed_kinds`；提供 `kind` 时按写门同规则剥离 `material.` 前缀后精确比对 → 不在清单 `KIND_NOT_ALLOWED`（写门 PERMISSION_DENIED 403）。roles 不含 `customer` 或无 active 行 → 不受限（与写门遗留合成客户主体行为一致）。
9. **汇总**：`canRead = 到第 6 步全部通过`；`canUpload = canRead && 人类门通过 &&（kind 未提供 || kindAllowed）`；`ok = canUpload &&（未提供 kind || kindAllowed）`。

### 1.2 零副作用保证

- 全部数据访问为只读 SELECT：`customers`、`principal_customer_grants`、`customer_identities`（身份链认证另读 `customer_identities`/`service_identities` 凭据哈希）。
- 不经 `withCommandV2`：**不写** `v2_idempotency`、`audit_events`、`outbox_events`；不新建/续期邀请、不登记/更新材料、不触碰 `evidence_artifacts`。
- 上游（验证器/DB）异常**不伪装为"无权限"**：验证器异常→`PRINCIPAL_UNTRUSTED`（与写门一致）；DB 异常→异常原样上抛（HTTP 层 500 INTERNAL），绝不解析成 `ok:false`。

### 1.3 与写门的已知口径差（如实登记，非放宽）

| 差异 | 投影 | 写门 | 说明 |
| --- | --- | --- | --- |
| 租户 | 从客户行派生 | 以请求体 `tenantId` 声明为准，须同时过 `authorizeTenant` 与 `lockCustomer` 租户匹配 | 一致性命题：投影 canUpload=true ⟺ 以客户真实租户作声明时写门权限门全过（测试实证） |
| 主体声明 | `principalId` 声明不符 → 显式拒绝 | 无此字段，body 中同名键被忽略 | 投影专属防混淆门，收严不放宽 |
| 拒绝码 | 结构化 reason | HTTP 4xx + 错误码 | 映射见 §3.1；投影更明确（本口是授权探针，非浏览器资源面） |
| 内容校验 | 不评估 | factKey/grade/supersedes/provenance 等另行校验 | 投影只回答**权限**，不预判载荷合法性 |

## 2｜HTTP 只读入口（Back/A/src/http/server.ts，兼容现有 API）

```
GET /api/v2/customers/:customerId/upload-authorization[?kind=<kind>][&principalId=<声明>]
身份：X-Principal-Credential 头（现有机制，无新鉴权方案；body.principalCredential 同义不适用 GET）
```

- `200`：投影结果（`ok:true/false` 均为 200 —— 本口回答的是"权限是什么"，评估成功即 200；业务拒绝体现在 `ok/reason`）。
- `403 PRINCIPAL_UNTRUSTED`：凭据缺失/不可验证/验证器异常（与其他 A 端点同语义）。
- `400 INVALID_INPUT`：kind/customerId 非法。
- `500 INTERNAL`：DB 上游异常（不伪装为权限拒绝）。
- 响应不含凭据、凭据哈希、邀请码、token、provider 标识等任何秘密字段。

## 3｜reason ↔ 写门结果映射（正反例对照断言依据）

### 3.1 reason 映射表

| reason | 写门等价结果（registerArtifact） |
| --- | --- |
| OK | 放行（权限门全过；载荷校验另计） |
| PRINCIPAL_MISMATCH | （写门无此门；见 §3.2） |
| CUSTOMER_NOT_FOUND | 404 NOT_FOUND（lockCustomer） |
| CUSTOMER_SCOPE_VIOLATION | 403 CUSTOMER_SCOPE_VIOLATION（authorizeTenant，声明租户越界）或 404 NOT_FOUND（requireCustomerScope 无 grant；A10 不区分语义） |
| NOT_HUMAN | 403 PERMISSION_DENIED（requireHuman） |
| KIND_NOT_ALLOWED | 403 PERMISSION_DENIED（allowed_kinds） |

**对照验收标准**：同一组正反例上，`写门权限门放行 ⟺ 投影 canUpload=true`；拒绝侧 reason 落在上表对应行（写门 404 双关时投影取更明确 reason，如实记录）。

### 3.2 principalId 声明的性质

写门只认凭据（body 内伪造 `principalId` 不影响 registerArtifact 判定，测试实证）。投影的 `principalId` 声明参数是**调用方防混淆护栏**（如 Edge 适配器传入 session.principalId 做一致性核验），不是授权来源；声明缺失时投影照常按凭据判定。

## 4｜消费方接线示例（串行集成用，本轮不装配）

Edge `createUploadContextReader({ authorizeUpload })`（`Back/Edge/src/upload-context.mjs`）的 `authorizeUpload` 未来可接本投影：

```js
// Edge 侧包装（示意，串行集成时实施；要求 grant.ok=false 走 403 UPLOAD_FORBIDDEN 而非 503）：
async function authorizeUpload({ credential, principalId, customerId }) {
  const res = await fetch(`${A}/api/v2/customers/${customerId}/upload-authorization`, {
    headers: { 'x-principal-credential': credential },
  });
  // 403/400/500 → 抛错或按状态映射；200 → 返回 res.json()（含 ok/canRead/canUpload/tenantId/principalId/customerId）
}
```

适配器要求 `grant.customerId/principalId/tenantId` 精确匹配 + `canRead/canUpload` 同真 —— 本投影字段齐备（§1）。

## 5｜测试与验收口径

- 真实隔离 PG（本路专有容器）+ 真实 HTTP 内核进程（`utils.mjs startKernel`）跑主矩阵；`--faulty-verifier` 故障注入核验验证器异常失败关闭；DB 故障用显式替身池单测（唯一替身项，如实标注）。
- **零副作用**：GET 矩阵前后全库逐表快照（行集规范化哈希）逐字节一致；特别断言 `audit_events`/`outbox_events`/`v2_idempotency`/`customer_invitations`/`customer_identities`/`evidence_artifacts` 零行差。
- **读写一致**：每例投影判定与真实 `registerArtifact` 调用（真实 HTTP POST）正反对照；权限拒绝后工件计数零变化。
- GET 不新建邀请、不续期、不登记材料（快照覆盖）；伪造凭据/伪造主体声明拒绝且不泄露秘密字段。

## 6｜本契约不声明的事

- 不声明上传恢复整链已装配或可用（Edge/Connectors 未接线）。
- 不声明跨对象存储原子性、对象存储生产链已验证。
- 不改变 `Back/CONTRACT.md` 任何既有登记；四路交回后由 Codex 决定登记方式。
