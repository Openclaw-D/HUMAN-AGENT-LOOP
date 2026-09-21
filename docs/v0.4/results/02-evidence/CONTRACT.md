# CONTRACT · V0.4-02 指定材料范围与证据完整性（证据选择模块）

- 路线：docs/v0.4/ZCODE_PARALLEL_04.md 路02
- 日期：2026-09-21
- ownership：`Back/Edge/src/assistant-evidence-provider.mjs`、`Back/Edge/src/assistant-evidence.mjs`（本路可写）；新增 `Back/Edge/src/assistant-evidence-scope.mjs`；新测试 `Back/Edge/test/v04-evidence-*`；报告本目录。
- 只读依赖：`Back/Edge/src/assistant-receipts.mjs`（digest/stable）、`Back/Connectors/src/processing/assistant-evidence.mjs`（上游语义）、`Back/Edge/src/assistant-model.mjs`、`Back/Edge/src/server.mjs`。

## 1. 现状（改动前的真实行为）

- `server.mjs` 以 `assistantEvidence({ snapshot, tenantId, customerId, revision })` 调用 provider（无 scope 概念）；provider 把 snapshot 内全部 artifactIds 一次性发给 Connectors。
- Connectors `readAssistantEvidence`（内部服务面）：`artifactIds` 为空数组→返回 `[]`；无法解析、被取代（`superseded_by` 非空）、缺 a_link 的 ID **静默省略**（SQL join 掉，不报错）；>100 个或含非字符串→`EVIDENCE_INPUT_INVALID`（非 2xx）。
- Edge provider 旧校验仅两条：响应材料必须在请求集内（`EVIDENCE_MAPPING_INVALID`）；`prepareEvidence` 逐件校验 tenant/customer/hash∈allowedHashes/parserVersion/current（`EVIDENCE_NOT_AUTHORIZED`）。
- 旧语义缺口（本路要闭合的）：**请求了 N 件但上游只回 M<N 件时，旧 provider 静默用子集继续**——对显式选择这是"默默回退"，必须拒绝。

## 2. 接口契约

### 2.1 provider 调用签名（向后兼容）

```js
const provider = createAssistantEvidenceProvider({ baseUrl, token, policy });
const pack = await provider({ snapshot, tenantId, customerId, revision, scope? });
```

- `scope` 省略或 `null` → **legacy 语义，与改动前逐字节等价**：请求 snapshot 全部 artifactIds（保持 snapshot 原顺序）、接受上游返回子集、返回包不附加任何新字段（pack 与 `prepareEvidence` 直接输出 deepEqual，`pack.hash` 不变，因此 `contextHash`/requestId 与历史一致）。
- `scope: { artifactIds: [...] }` → **显式选择**：
  1. `artifactIds` 必须是非空数组且元素全为非空字符串，否则 `EVIDENCE_SCOPE_INVALID`（整次拒绝）。
  2. 去重并按字典序标准化为 canonical 顺序；输入乱序/重复不影响结果与摘要。
  3. 每个 ID 必须属于当前 snapshot 中已授权可读材料集合（`artifactsReadable===true` 且 `artifacts[].artifactId`）；任一不在集合内 → `EVIDENCE_SCOPE_UNAUTHORIZED`（整次拒绝，detail 携带越权 ID，**绝不回退全部材料**）。
  4. 请求正文只含 canonical 后的所选 ID。
  5. 上游返回后逐件校验：每件 artifactId 必须在所选集内（多返 → `EVIDENCE_MAPPING_INVALID`）；显式模式要求**返回集=所选集**（缺一件，如已被取代/解析缺失 → `EVIDENCE_SCOPE_INCOMPLETE`，整次拒绝）；随后 `prepareEvidence` 继续逐件授权校验（tenant/customer/hash/current/parser），不以"上游说有"为准。
- `scope` 为其他类型（字符串/数组/缺 artifactIds 的对象）→ `EVIDENCE_SCOPE_INVALID`。
- `snapshot.artifactsReadable !== true` → `EVIDENCE_INVENTORY_UNAUTHORIZED`（先行检查，显式/legacy 一致）。

### 2.2 选择摘要（回执绑定用）

显式模式在返回包上附加 `pack.selection`（legacy 模式不附加，保证旧包不变）：

```js
pack.selection = {
  mode: 'explicit',
  artifactIds: [/* canonical 升序、去重 */],
  summary: digest({ v: 1, mode: 'explicit', artifactIds }),  // sha256，顺序不敏感、重复不敏感
};
```

- `summary` 由 `Back/Edge/src/assistant-receipts.mjs` 的 `digest`（规范化 JSON 的 sha256）计算，仅依赖 canonical ID 集，可用于回执/日志绑定本次分析的证据范围。
- 显式模式的 `pack.selection` 参与 `contextHash`（server 侧把整个 pack 放进 context），因此不同选择→不同 requestId，同选择同上下文→同 requestId；这是摘要随包自然进入回执身份的机制。
- **pack.hash 不含 selection**（prepareEvidence 未改哈希基），避免 legacy 兼容性分叉。

### 2.3 错误码一览

| 错误码 | 触发 | 阶段 |
|---|---|---|
| `EVIDENCE_INVENTORY_UNAUTHORIZED` | snapshot 不可读（`artifactsReadable!==true`） | 进入即拒 |
| `EVIDENCE_SCOPE_INVALID` | scope 形状非法（非对象/非数组/空串/非字符串元素） | 进入即拒 |
| `EVIDENCE_SCOPE_EMPTY` | 显式 `artifactIds` 去重后为空 | 进入即拒 |
| `EVIDENCE_SCOPE_UNAUTHORIZED` | 任一所选 ID 不在当前已授权可读集合 | 进入即拒（零上游调用） |
| `EVIDENCE_UPSTREAM_UNAVAILABLE` | 上游非 2xx / 网络失败 | 上游阶段 |
| `EVIDENCE_MAPPING_INVALID` | 上游 `ok!==true`、materials 非数组、返回越界件（不属于请求集） | 响应校验 |
| `EVIDENCE_SCOPE_INCOMPLETE` | 显式模式下上游静默省略任一所选 ID（取代/解析缺失/无链接） | 响应校验 |
| `EVIDENCE_NOT_AUTHORIZED` | `prepareEvidence` 逐件授权校验失败（跨户/跨租户/过期/哈希未获准/解析版本缺失） | 逐件校验 |
| `EVIDENCE_MISSING` / `EVIDENCE_TEXT_INVALID` / `EVIDENCE_CONTEXT_LIMIT` | prepareEvidence 既有语义，不变 | 组包 |

进入即拒类错误发生在任何上游调用之前（零网络出站）。

## 3. 兼容性保证（验收基准）

1. **旧调用零变化**：无 scope 时，请求体、返回包（含 hash）、错误行为与改动前一致；由测试以"直接 prepareEvidence 对照 + deepEqual"证明。
2. **显式范围不扩大**：显式模式请求正文只含所选 canonical ID；未选材料的文本不出现在返回包任何字符串中（即不进入模型上下文）。
3. **越权失败关闭**：无效/越权/空选择进入即拒且零上游调用；上游静默省略在显式模式下拒绝整次请求。
4. `assistant-evidence.mjs` 的 `prepareEvidence`/`validateCitations` 签名与语义不变（本路未发现需要改动该文件的缺陷；该文件保持原状也是交付的一部分）。

## 4. 边界与未接线声明（不得宣称）

- **server/模型入口未接线**：`server.mjs` 当前不解析请求体中的 scope，也不透传给 provider；用户页面尚无组合分析入口。显式 scope 目前只能由直接调用 provider 的代码（或未来 server 小改）使用。
- **回执摘要接线待串行集成**：`pack.selection.summary` 尚未写进回执持久化字段的专门列/键（回执身份经 contextHash 间接包含它）；接线属后续串行任务。
- **模型缓存未按 scope 隔离**：assistant-model 的重放缓存按 contextHash 键控，本路不改其代码；"不同 scope 产生不同 requestId"是 contextHash 的自然结果，**不等于**已验证缓存按 scope 显式隔离。
- 不改 assistant-model、assistant-receipts、server、B transport、Front、Connectors。
- 本契约不构成组合分析的产品验收，也不宣称用户页面已支持。

## 5. 上游依赖契约（只读核验，非本路产出）

Connectors `POST /api/connectors/internal/assistant-evidence`（服务令牌）：输入 `{tenantId, customerId, artifactIds}`；输出 `{ok:true, materials:[{tenantId,customerId,artifactId,evidenceId,hash,parserVersion,current:true,text,pages,facts,limitations}]}`；不可解析/被取代 ID 静默省略；错误统一 `{ok:false,error}` 非 2xx。Edge 侧显式模式以"返回集=请求集"消化其静默省略语义。
