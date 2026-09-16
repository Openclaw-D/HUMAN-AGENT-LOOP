# R3-A-INT 笔记｜R2_MODEL 冻结候选真实接入产品（2026-09-13 夜间）

执行者：R3-A-INT（ZCode 子代理）。工作目录：`C:/Users/22673/Desktop/Anthropic/jianwei-v3/site`。
候选：`V6/handoff/R2_MODEL_20260913/`（冻结，接入后复验 `tools/verify-frozen-hash.mjs` 46/46 全匹配，冻结源未被改动）。

## 1. 接入方式（一句话）

把候选 `src/` 原样拷入 `lib/v5-preview/model-adapter/`（15 个 .mjs，零第三方依赖，`diff -r` 逐字节一致），新建桥接层 `lib/v5-preview/remote-model-adapter-bridge.ts` 包装出与产品 `createModelProviderAdapter` 同形状的 `createBridgedModelAdapter()`（真实 import 并执行候选 adapter，默认走候选 simulated 通道），并在 `remote-service.ts` 文件尾追加一行 re-export 暴露入口；产品既有 fixed_stub 行为与 B 项测试零改动。

## 2. 允许写入清单（实际改动）

| 文件 | 动作 |
| --- | --- |
| `lib/v5-preview/model-adapter/**`（15 文件） | 新建：候选 src 原样拷贝（adapter/simulated/codes/validate-request/validate-response/dedupe/ledger/clock/aggregate/providers/integration/fixtures/human-feedback/reminders），零第三方依赖（仅 node:crypto） |
| `lib/v5-preview/remote-model-adapter-bridge.ts` | 新建：产品桥接层（生成转换 + contextVersion 供给 + 七状态→四状态映射 + 多角色聚合 + probe 门） |
| `lib/v5-preview/remote-service.ts` | 仅文件尾追加 1 行：`export { createBridgedModelAdapter } from './remote-model-adapter-bridge.ts';`（不改任何既有行为） |
| `test/v5-preview-model-bridge.test.mjs` | 新建：14 项测试 |

## 3. 接入映射表

### 3.1 请求/快照转换（两处主任务裁决）

| 产品侧 | 候选协议侧 | 说明 |
| --- | --- | --- |
| `session.generation`（初始 0） | `generation = 产品 generation + 1` | INTEGRATION §3 缺口1 裁决：接入层 +1 偏移；请求与 `snapshot()` 用同一常量 `GENERATION_OFFSET=1`；快照每次重新读权威 store |
| （无字段） | `contextVersion = 同一次 store 读取的 RemoteStoreState.version` | INTEGRATION §3 缺口2：证据解析与 contextVersion 取自同一次 `readRemoteStoreState()`，防撕裂；候选每次 `snapshot()` 再读最新 store（推进/暂停→stale/取消由候选 staleness 判定捕获） |
| `evidenceRef{fixtureId,sha256,version}` | `evidenceRefs[{id: evidenceId, version: String(version), hash: sha256}]` | 经候选 `product-mapping.evidenceToRefs`；解析顺序：annotationId 回链 evidenceId（校验 sha256 一致）→ 否则按 (sessionId,fixtureId,sha256,version) 匹配取最新；fixtureId 不当唯一 id；`supersededBy!==null` → rejected |
| `annotation.question`（无标注则空串） | `text` | 候选允许空串 |
| `domainRoles[]` | 每角色一次 `adapter.analyze`（候选契约：每次恰单一角色） | 默认角色表 = 候选六域 + `coordinator` + 用途 `follow_up_generation` 登记；未登记角色/用途由候选 UNKNOWN_ROLE / PURPOSE_NOT_ALLOWED 失败关闭 |
| `requestId` | 派生 `brid-sha256(requestId|sessionId|annotationId|role|generation|contextVersion|purpose).slice(0,32)` | contextVersion 入身份：同上下文重放→候选缓存复核命中；版本推进→完整新调用，不落 REQUEST_MISMATCH 陷阱（F4 教训） |

### 3.2 候选七状态 → 产品 ModelProviderResult（INTEGRATION §3/§4 对齐）

| 候选 status | 产品 status | providerKind | 附加行为 |
| --- | --- | --- | --- |
| succeeded | ok | real | reply 标注"模型输出、authority=none、须人工复核" |
| simulated | ok | simulation | 首条 reply 携带候选 SIMULATION 中文声明（不得隐藏）+ 结果 `notice` 字段 |
| failed | failed | 同通道 | failureReason = 候选中文 error.message |
| not_configured | failed | 同通道 | failureReason 前缀"未配置模型服务" |
| unknown | failed | 同通道 | failureReason 前缀"结果未知"；productAction.mustHumanVerify=true / allowRetry=false（禁止自动重试） |
| stale | rejected | 同通道 | 保留候选 findings 于 `candidate.preservedFindings` 供人工比对；errorCode（GENERATION_CHANGED/CONTEXT_VERSION_CHANGED/SESSION_PAUSED）透出 |
| cancelled | rejected | 同通道 | failureReason = 候选中文 message（确定未送达） |
| partial（部分角色失败） | partial | — | failureReason = "部分角色结果未采纳（role=status）+ 候选中文 message" |

附加保留（不改变状态）：`scope/scopeNotice`（preprocessing_only 人控边界）、`dissent`/`pendingDecisions`（经候选 `aggregateResults`：异议全量保留、冲突只列双方不裁决）、`deduped`（缓存复核命中）、`productAction`（候选 `statusToProductAction` 原样输出，含 uiAction/allowRetry/mustHumanVerify）。

Probe 门（与产品 stateRejection 同语义同文案）：调用前预判（证据版本过期优先于暂停，未调用候选，candidate.status='state_gate'）；ok/partial 返回前再判定，改判 rejected 并标 `candidate.downgrade='post-await…'`。

## 4. 测试计数与验证证据

- 新套件 `test/v5-preview-model-bridge.test.mjs`：**14/14 通过**（MB0 隔离 env 放首个测试；simulated 真实调用+缓存复核 deduped、generation +1（0→1 与暂停恢复 2→3）、contextVersion=remoteVersion、stale/cancelled/unknown/failed/not_configured（PURPOSE_NOT_ALLOWED）映射、dissent 保留×2+pendingDecisions 不裁决、probe 预判 0 次候选调用、probe 迟到改判、unknown-evidence rejected、partial）。
- 合并回归（11 个 v5-preview 文件 + 新文件，isolation=none 同进程）：**137/137 通过，exit 0**（基线 123 + 新 14；含既有 `v5-preview-remote-repair.test.mjs` B 项——未改一行仍通过，ok 52）。
- `npx tsc --noEmit`：**exit 0**。
- `node tools/verify-frozen-hash.mjs`（候选仓）：**exit 0，46/46 匹配**（冻结源未被本任务触碰）。
- `diff -r` 拷贝目录 vs 冻结 src：**逐字节一致**。

## 5. 环境干预记录（非代码变更）

基线首跑 123/123 全挂，原因是两个残留进程（与本次改动无关）：
1. PID 22688：残留 `next start --port 3399`（前次测试运行遗留）——已终止；
2. PID 28568/8604：`next dev --port 3311`（2026-09-12 01:56 启动、约 28 小时旧）——Next.js 同目录单 dev server 锁导致所有套件的 dev-server 自举失败；确认连接方仅为本机 ZCode 网络服务的陈旧 keepalive 后终止。
清理后基线 123/123 通过。建议后续夜间任务前置检查 3399/3311 端口残留。

## 6. 未决差异 / 移交主任务与验收方

1. **产品 generation=0 的会话无法不经偏移直接过协议**：已按裁决在桥接层 +1（请求/快照一致）；候选协议本身未放宽（属产品契约变更，未动）。
2. **product `ModelProviderResult.replies.kind` 枚举仅 `model_simulation`**：真实 succeeded 结果（自定义 transport，非模拟通道）也只能以 `model_simulation` 标注呈现，以 author 文案区分"模型输出、authority=none、须人工复核"；如需区分需产品侧扩枚举（本次未动）。
3. **SIMULATION 声明的呈现通道**：产品四状态结构无 notice 字段，声明以首条 reply（in-band，author="模型通道声明"）+ 结果 `notice` 元数据双通道承载；页面展示层接入（标注横幅）属后续 UI 任务，不在本次允许写入范围。
4. **requestId 派生策略**：候选侧 requestId 由桥接散列派生（contextVersion 入身份），产品 requestId 仅作散列输入并回显在结果 `requestId`；候选 REQUEST_MISMATCH 防护在同身份变载荷路径仍然生效，但桥接常规路径以"新上下文=新身份"规避陷阱——验收如要求显式透传产品 requestId，需复核 drifting-retry 语义。
5. **候选 not_configured → 产品 failed**：产品四状态无 not_configured，映射为 failed + 专属中文文案 + `productAction.uiAction='configure_provider'`（元数据可区分）。
6. **NOT TESTED（继承候选声明）**：真实模型推理质量、真实 OpenAI/Dify 端点兼容、真实并发压力（桥接测试为确定性单进程）；`options.ledger` 产品级成本账本未接（用候选内存账本），50 万 token 口径合并统计属业务层后续任务。
7. **服务级单例**：INTEGRATION 建议服务级单例 adapter；当前 `createBridgedModelAdapter()` 由调用方持有实例（测试均按套件内单实例），产品 API 路由接线时请按服务级单例构造。
