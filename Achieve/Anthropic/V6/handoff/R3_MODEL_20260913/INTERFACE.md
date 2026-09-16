# INTERFACE｜R3 产品接入桥(2026-09-13)

R3 目标:关闭"适配器 192 测试通过但真实产品没接上"的断点。本文件冻结桥与回执接口;适配器本体契约继承 R2 `ADAPTER_CONTRACT.md`(本批不改其语义,仅新增桥)。产品源码只读;全部形状定位见 `FIELD_MAPPING.md`(R2 版)与本文件 §4。

## 1. buildAnalyzeRequest(src/bridge/product-bridge.mjs)

```js
buildAnalyzeRequest({ storeReader, sessionId, op, seq, role, purpose, text })
→ { ok:true, request, snapshot, payloadHash, bridgeMeta:{ bridgeId, productGeneration, remoteVersion, evidenceCount, supersededFiltered } }
| { ok:false, code, message(中文), details }
```

- `storeReader: () => ({ version, sessions, evidence })` — **唯一入口形态**:单次一致性读(remote-store 单文件 JSON 读满足;分次拼接不得传入)。缺任一元(version 非整数/sessions 或 evidence 非数组/会话不存在/session.generation 非法)→ `MAPPING_MISSING_FIELDS` 失败关闭,**不用默认常数补齐**;reader 非函数 → `BRIDGE_READER_REQUIRED`;抛错 → `BRIDGE_READER_THROWN`。
- **generation 偏移**:协议代次 = 产品代次 + 1(产品初始 0、legacy 补 0 → 协议 1;不改产品事实、不改协议)。对账:`bridgeMeta.productGeneration` + `request.generation` 并列回显。
- **contextVersion** = `rv${version}`(store.version 即 API remoteVersion;rv 前缀防与代次数值混淆)。
- **superseded 过滤**:`supersededBy !== null` 的证据显式排除并计数(`supersededFiltered`),不静默。
- **快照**:`snapshot()` 每次调用重新单次读取,供适配器发起前/返回时核对;reader 失败 → 保守停摆 `{generation:0, contextVersion:'', paused:true}`(在途结果必 stale,绝不放行)。
- `payloadHash`:请求载荷指纹(观测用;适配器内部另有同值指纹)。

## 2. 回执协议(src/bridge/receipt-protocol.mjs,`R3_BRIDGE_RECEIPT@1`)

```js
buildReceipt({ result, request, bridgeMeta, ledgerTotals?, generatedAt? }) → frozen receipt
isIntegratedReady(receipt) → { ok:true } | { ok:false, reason(中文) }
```

- 回执是**纯结果投影**(计数/状态/动作),不含 findings 文本——业务状态唯一来源是产品 store,不复制第二份。
- 五项自验 checks:`viaBridge / generationOffsetApplied / atomicReaderUsed / sevenStatusUsed / noSecondBusinessStateCopy`。
- **状态机**:适配器能力 **candidate**(本批交付态)→ MAIN 按样例跑通并回传合格回执 → 标 **integrated**。回执是唯一凭据。
- 样例与 expected:`sample/MAIN_CALL_SAMPLE.md`、`sample/expected-receipt-succeeded.json`(端到端真实产出,status=simulated,isIntegratedReady=true——回执证明接入通路,不代表模型质量)。

## 3. 七状态语义(继承 R2;回执 uiAction 直接携带)

succeeded / simulated(显著 SIMULATED)/ not_configured / failed(可重试)/ unknown(**禁止自动重试**,mustHumanVerify=true)/ stale(不作现行结论)/ cancelled(确定未发生)。附加:**预处理不等于通过前序**——`scope='preprocessing_only'` 的结果不得视为通过专业复核门。

## 4. 产品形状定位(只读核对,2026-09-13)

| 产品 | 位置 | 映射 |
| --- | --- | --- |
| RemoteSessionRecord.generation(初始0,legacy 补0) | remote-types.ts:49-50;remote-store.ts:289-294 | +1 偏移 → request.generation/snapshot.generation |
| RemoteSessionRecord.status('scheduled'/'live'/'paused'/'ended') | remote-types.ts:6,48 | paused → 快照 paused |
| RemoteStoreState.version(API remoteVersion) | remote-store.ts:44-45 | contextVersion=`rv${version}` |
| EvidenceRecord(evidenceId/fixtureId/sha256/version/supersededBy) | remote-types.ts:61-81 | id=evidenceId(非 fixtureId)、hash=sha256、version=String(version);superseded 过滤 |

## 5. 已知限制(NOT TESTED)

未对真实产品 store 实例做端到端联测(产品代码只读;形状按源码静态核对);真实 provider 兼容与模型质量 NOT TESTED;越权词表启发式;提醒/纠偏协议未接产品事件流。**产品 API 真实调用 0**。
