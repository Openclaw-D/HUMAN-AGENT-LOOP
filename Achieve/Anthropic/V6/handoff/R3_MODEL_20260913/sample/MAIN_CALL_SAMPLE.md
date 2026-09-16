# MAIN_CALL_SAMPLE｜最小调用样例与回执协议(R3,2026-09-13)

读者:主任务(MAIN)执行者。本文给出把适配器接入 remote-session 服务的**最小可运行样例**与接入凭据(回执)协议。业务状态的唯一来源仍是产品 store——本桥与回执**不复制第二份业务状态**。

## 1. 最小调用样例(服务端,remote-service.ts 内接入点示意)

```js
// —— 一次性构造(服务级单例;transport 未配置真实 provider 前用模拟通道) ——
import { createModelAdapter, createSimulatedTransport } from '.../model-adapter/adapter.mjs';
import { createMemoryLedger } from '.../model-adapter/ledger.mjs';

export const modelAdapter = createModelAdapter({
  transport: createSimulatedTransport({ /* script 可注入固定应答;真实 provider 后续替换 */ }),
  ledger: createMemoryLedger({ maxReservedTokens: 50_000 }), // 生产换业务账本实现
  timeoutMs: 20_000,
  maxEntries: 512,
});

// —— 每次调用(remote-service 的模型分析入口) ——
import { buildAnalyzeRequest, bridgeContext } from '.../model-adapter/bridge/product-bridge.mjs';
import { buildReceipt } from '.../model-adapter/bridge/receipt-protocol.mjs';

// remoteStore 是你的单文件 JSON store(单次 read 就是原子读;分次拼接不得传入)
const built = buildAnalyzeRequest({
  storeReader: () => remoteStore.readProjection(),   // () => { version, sessions, evidence }
  sessionId,                                          // 当前会话
  op: 'risk_review',                                  // 操作名(进 requestId)
  seq: nextSeq++,                                     // 同代次内单调
  role: 'credit', purpose: 'risk_review',
  text: normalizedText,                               // 经允许的合成/去标识文本
});
if (!built.ok) {
  // 失败关闭:MAPPING_MISSING_FIELDS / BRIDGE_READER_* —— 向前端返回明确错误,不得补默认值
  return respond(422, { code: built.code, message: built.message });
}

const result = await modelAdapter.analyze(built.request, bridgeContext(built.snapshot, { signal: reqSignal }));

// 回执(纯结果投影;不落业务状态,可回传给 A 路作 integrated 凭据)
const receipt = buildReceipt({ result, request: built.request, bridgeMeta: built.bridgeMeta, ledgerTotals: modelAdapter.ledger.totals() });
// 按七状态 UI 动作映射渲染(receipt.uiAction;详见 §3),完成后把 receipt 副本交回 A 路批次。
```

**要点**:
- 请求载荷(generation/contextVersion/evidenceRefs)与快照来自**同一单次 store 读取**——桥内部保证;快照回调每次调用重新读取,专供适配器做发起前/返回时的 stale 核对。
- 产品 `generation 0 → 协议 1`(+1 偏移)由桥完成;**产品侧任何地方都不要自行加偏移**,对账时协议代次 = 产品代次 + 1(回执两个字段都带:`bridgeMeta.productGeneration` / `requestEcho.protocolGeneration`)。
- superseded 证据被桥显式过滤并在 `bridgeMeta.supersededFiltered` 计数(不静默)。
- 读不到 version/generation → 桥直接拒绝(`MAPPING_MISSING_FIELDS`),**绝不补默认常数**。

## 2. 回执协议(R3_BRIDGE_RECEIPT@1)

```json
{
  "schema": "R3_BRIDGE_RECEIPT@1",
  "generatedAt": null,
  "requestEcho":  { "requestId": "r...-g1-risk_review-1", "projectId": "2026PA21001", "sessionId": "sess-remote-001", "protocolGeneration": 1, "contextVersion": "rv7" },
  "bridgeMeta":   { "bridgeId": "jianwei.r3.product-bridge@1", "productGeneration": 0, "remoteVersion": 7, "evidenceCount": 3, "supersededFiltered": 0 },
  "outcome":      { "status": "succeeded", "errorCode": null, "errorMessage": null, "findingsCount": 1, "questionsCount": 1, "dissentCount": 0, "usageUnknown": false, "costLedgerState": "committed", "deduped": false, "scope": null },
  "uiAction":     { "uiAction": "...", "zh": "…中文动作…", "allowRetry": false, "mustHumanVerify": false },
  "ledgerTotals": { "reservedTokens": 0, "committedTokens": 30, "unknownHoldTokens": 0, "releasedTokens": 0, "occupiedTokens": 30 },
  "checks":       { "viaBridge": true, "generationOffsetApplied": true, "atomicReaderUsed": true, "sevenStatusUsed": true, "noSecondBusinessStateCopy": true }
}
```

- `expected` 样例:本批 `sample/` 下随附一份**已跑通的 fixture 回执**(`sample/expected-receipt-succeeded.json`,由测试同路径产出)。
- 判定:`isIntegratedReady(receipt)`(见 `src/bridge/receipt-protocol.mjs`)。规则:schema 正确 + 七状态合法 + 五项 checks 全 true + unknown 必须带 `mustHumanVerify:true`。
- **状态机**:适配器能力 = **candidate**(本批交付态)→ MAIN 用本样例跑通并回传合格回执 → A 路核对后标 **integrated**。回执是唯一凭据,口头/文档声明不算。

## 3. 七状态 UI 动作(实现见 `product-mapping.statusToProductAction`,回执直接携带)

| status | zh(产品侧动作) | allowRetry | mustHumanVerify |
| --- | --- | --- | --- |
| succeeded | 正常渲染发现/追问/异议;引用回链证据 | false | false |
| simulated | 显著展示模拟声明(SIMULATED),不得当真实结论 | false | false |
| not_configured | 提示"模型服务未配置",不展示任何模型结论 | false | true(需配置动作) |
| failed | 显示中文错误;允许重试 | true | false |
| unknown | "结果未知:外部调用可能已发生,需人工核实";**不自动重试** | false(仅人工核实后) | true |
| stale | 不作现行结论;基于当前代次重新发起 | true(新代次) | false |
| cancelled | 已取消/会话暂停;恢复走显式人工动作并留痕 | true(人工后) | false |

附加门:`scope === 'preprocessing_only'`(gate.professionalReviewPassed=false 时)→ 无论 status,结果只用于预处理,**不得视为通过前序专业复核**。

## 4. 故障语义速查(已在 16/17 测试锁定)

| 情形 | 表现 |
| --- | --- |
| 会话暂停中发起 | `cancelled/SESSION_PAUSED`(零调用零费用);恢复需显式人工动作(产品 resume_round,generation+1) |
| 在途期间暂停/换代/证据升级 | 返回 `stale`(结果数据保留供人工比对,usage 照常结算) |
| 送出后取消/超时 | `unknown`(账本 unknown_hold 保留,绝不视为未计费);人工核实后同ID同载荷重试=完整新调用 |
| 同ID变载荷(证据/版本/文本变化) | `REQUEST_MISMATCH`,不发调用 |
| 登记容量满 | `failed/REGISTRY_AT_CAPACITY`(在途零淘汰;稍后重试) |
| store 读取失败 | 桥拒绝(`BRIDGE_READER_THROWN`)或快照保守停摆(在途结果必 stale) |
