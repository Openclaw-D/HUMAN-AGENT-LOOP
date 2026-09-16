# INTEGRATION｜主任务接入指南(R2,2026-09-13)

读者:R2 主任务执行者,把本批 adapter 接入 `jianwei-v3/site` 的远程尽调服务。**前端调用方式不变**(适配器在后端服务内部)。R1 版指南被本文件覆盖;接口细节以 `ADAPTER_CONTRACT.md`(R2 修订)为准。

## 1. 接入步骤

1. **拷贝**:主任务以单 writer 把 `src/` 拷入 `lib/v5-preview/model-adapter/`(或按仓库习惯)。本批 READY_FOR_REVIEW 冻结;原并行交付不改,接入后以产品仓为准。
2. **构造(服务级单例)**:

```js
import { createModelAdapter, createProviderTransport } from '.../model-adapter/adapter.mjs';
import { createSimulatedTransport } from '.../model-adapter/simulated.mjs';

// 未配置真实 provider:模拟通道(status=simulated,显著声明)
const transport = createSimulatedTransport({ script: ... });

// 真实 provider(需用户确认用途的产品凭据与预算,当前未具备):
// const transport = createProviderTransport({
//   buildRequest: (p) => buildChatCompletionsRequest(p, { baseUrl, model, getApiKey: () => cfg.readApiKey() }),
//   parseResponse: parseChatCompletionsResponse, modeName: 'http-chat-completions', fetchImpl: fetch,
// });

export const modelAdapter = createModelAdapter({
  transport,
  ledger: businessLedger,      // 必传:接产品成本账
  maxEntries: 512,             // 【R2】登记容量;满时显式背压而非淘汰在途
  timeoutMs: 20000,
});
```

3. **每次调用(与不可变请求/代次机制对齐)**:

```js
const result = await modelAdapter.analyze({
  requestId, projectId, sessionId,
  generation,        // 会话代次(见 §3 缺口1:产品 generation 从 0 起步,需 +1 偏移或协议放宽——主任务裁决)
  contextVersion,    // 【R2】建议取同一 store 读取内的 remoteVersion(防证据与快照撕裂)
  role, purpose, text, evidenceRefs,   // evidenceRefs 用 product-mapping.evidenceToRefs 生成
}, {
  signal,
  snapshot: () => sessionStore.snapshot(sessionId),  // 权威快照,决定 stale/暂停拒绝
  gate: { professionalReviewPassed },                // 【R2】false → 结果 scope='preprocessing_only',挡在正式判定通道外
});
```

4. **状态→产品动作**(统一语义;`product-mapping.statusToProductAction` 提供同表实现):

| status | 动作 |
| --- | --- |
| succeeded | 渲染 findings/questions/dissent;引用回链证据 |
| simulated | 显著展示 SIMULATION 声明(结果自带中文 notice,不得隐藏) |
| not_configured | 显示"未配置模型服务" |
| failed | 显示中文 error.message;重试按钮(新 requestId,或确定性校验失败类可同ID重放——见契约 §3 缓存细分) |
| unknown | "结果未知:外部调用可能已发生,需人工核实";禁止自动重试;人工核实后同ID同载荷重试是完整新调用 |
| stale | 不作现行结论;提示基于当前代次重新发起(stale 结果保留 findings 供人工比对) |
| cancelled | 提示已取消/会话暂停;恢复走显式人工动作(推进 generation 并留痕) |
| scope='preprocessing_only' | 【R2】附加条件:无论 status,不得进入正式判定通道 |
| dissent 非空 | 【R2】原意见/不同结论并列展示;冲突进待人决定列表(pendingDecisions 只列双方,不裁决) |

5. **多角色结果聚合**(如需):`aggregateResults(results)` 保留全部异议、问题去重不吞关键未解决项、冲突仅列待人决定。

## 2. R2 缺陷修复对主任务的影响(Codex 验收对应)

| Codex 点名 | R2 修复 | 主任务注意 |
| --- | --- | --- |
| 容量淘汰删在途请求 | in-flight 永不淘汰;满载背压 REGISTRY_AT_CAPACITY | maxEntries 按产品并发调;背压是显式 failed,UI 应可重试 |
| 缓存结果不复核 | cache-hit/join 返回前重新快照核对 | snapshot() 必须返回当前真实状态,否则复核失效 |
| 测试回写冻结证据 | 测试输出仅写 runtime/(可用 R2_MODEL_TEST_OUT_DIR 指定);verify-frozen-hash 前后核验 | 主任务复跑本批测试不会改变冻结 hash;接入后在自己仓内自建冻结流程 |

## 3. 缺口清单(接入前必须知道;详见 FIELD_MAPPING.md §5)

1. **generation 起点冲突**:产品 remote-session generation 初始 0(legacy 补 0),协议要求正整数 → 主任务裁决:接入层 +1 偏移,或放宽 validate-request(属产品契约变更,单 writer 决定)。
2. **contextVersion 供给**:产品无该字段;主任务须在同一次 store 读取内取 `remoteVersion` 传入,防证据清单与快照撕裂。
3. **证据映射**:id 取 `evidenceId`(不是可重复的 fixtureId);sha256→hash、version→version(String 化);superseded 证据是否进清单由主任务按 A3 语义过滤。
4. **真实 provider**:需用户确认用途的产品凭据与预算;既有 50 万 token 上限口径由业务层合并统计。
5. **NOT TESTED**:quality;真实端点兼容;真实 store 端到端(映射按源码静态核对)。
6. **不承诺零代码替换**:服务层约一个服务文件+状态映射表+两处裁决(generation/contextVersion)。

## 4. 复现与验收

```bash
cd V6/handoff/R2_MODEL_20260913
node test/run-all.mjs              # 192/192,退出码 0
node tools/verify-frozen-hash.mjs  # 冻结后退出码 0=未改任何冻结文件
```
