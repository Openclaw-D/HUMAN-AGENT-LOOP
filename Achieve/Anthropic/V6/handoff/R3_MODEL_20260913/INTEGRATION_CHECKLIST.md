# INTEGRATION_CHECKLIST｜MAIN 接入核对单(R3,2026-09-13)

逐项核对,全部打勾后适配器能力从 **candidate** 升 **integrated**(凭据 = 合格回执)。任何一项失败:缺陷退回 A 路(本批次 owner),不在产品侧绕过。

## A. 拷贝与构造

- [ ] 1. `src/`(R3 批次)单 writer 拷入 `lib/v5-preview/model-adapter/`;不改本批交付,接入后以产品仓为准。
- [ ] 2. 服务级单例 `createModelAdapter`:transport(先 `createSimulatedTransport`)、ledger(接产品账)、`maxEntries`、`timeoutMs` 就位。
- [ ] 3. `storeReader` 实现为 remote-store 的**单次一致性读**(返回 `{version, sessions, evidence}`);确认没有分次拼接。

## B. 首次调用(用 sample/MAIN_CALL_SAMPLE.md 逐行对照)

- [ ] 4. `buildAnalyzeRequest` 返回 ok:true;`bridgeMeta.productGeneration=0`、`request.generation=1`、`contextVersion='rv{version}'`、`supersededFiltered` 计数正确。
- [ ] 5. `analyze(request, bridgeContext(snapshot,{signal}))` 返回七状态之一;`scope='preprocessing_only'` 时结果不进入正式判定通道。
- [ ] 6. `buildReceipt` 产出回执;`isIntegratedReady===true`;回执 JSON 与 `sample/expected-receipt-succeeded.json` 结构一致。
- [ ] 7. 回执副本交回 A 路批次目录(`R3_MODEL_20260913/received/`),A 路核对后标 integrated。

## C. 一致性断言(对应测试 16;MAIN 侧复验点)

- [ ] 8. 产品 generation 0 → 协议 1;generation 2 → 3(请求侧与快照侧同时核对)。
- [ ] 9. 暂停中发起 → `cancelled/SESSION_PAUSED` 零费用;在途期间暂停/换代/证据升级 → `stale`(usage 照常结算)。
- [ ] 10. 证据升级(remoteVersion+superseded):新请求清单不含被取代证据、contextVersion 推进;旧载荷同ID → `REQUEST_MISMATCH`。
- [ ] 11. 缺 version/generation → `MAPPING_MISSING_FIELDS`(无默认常数补齐);reader 异常 → `BRIDGE_READER_THROWN` 或快照保守停摆 → stale。

## D. 故障面(对应测试 17)

- [ ] 12. 跨会话并发:结果/缓存零污染(按 requestId 与证据集核对)。
- [ ] 13. 容量满:`REGISTRY_AT_CAPACITY` 显式背压、零调用零费用、在途零淘汰。
- [ ] 14. 延迟+取消 → `unknown` + 账本 unknown_hold 保留;**UI 无自动重试**;刷新重放:成功后同载荷命中缓存(deduped),unknown 后同载荷=完整新调用。
- [ ] 15. 账本守恒:`occupiedTokens === reserved+committed+unknownHold`;未知费用释放 0。

## E. 人控与分歧语义

- [ ] 16. 原始意见(findings)/异议(dissent)/待人决定(pendingDecisions)分别渲染;异议不因去重丢失;pendingDecisions 无决定性字段。
- [ ] 17. 提醒仅读已授权上下文;同 key 重复事件合并;动作仅 notify_human(无批准/自动升级类)。
- [ ] 18. 纠偏记录 `decidedBy` 仅 human;改进预案 status 恒 awaiting_human_decision(不自动训练/不改全局规则)。

## F. 边界声明

- [ ] 19. 未接真实 provider 前,界面按 `simulated/not_configured` 显著标注;quality 与真实端点兼容 NOT TESTED。
- [ ] 20. 复跑本批测试(`node test/run-all.mjs`,期望 212/212,退出码 0)只写 runtime/,不改冻结文件(`node tools/verify-frozen-hash.mjs` 退出码 0)。
