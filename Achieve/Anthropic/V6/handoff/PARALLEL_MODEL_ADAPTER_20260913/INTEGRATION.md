# INTEGRATION｜主任务接入指南(不改变前端调用方式)

读者:主任务(远程尽调返修)的执行者,要在 `jianwei-v3/site` 的 `lib/v5-preview` 后端服务里接入本模块。**前端调用方式不需要变化**:本模块是后端服务内部的可替换 provider 层,替换的是"fixed stub → 结构化边界"这一层,前端看到的仍是产品 API 的响应(由主任务服务层映射)。

## 1. 接入步骤(建议)

1. **拷贝**:主任务以单 writer 身份把 `src/` 拷贝到 `jianwei-v3/site/lib/v5-preview/model-adapter/`(或按其目录习惯放置)。本批交付为 READY_FOR_REVIEW 冻结件:原并行交付不修改,接入后以产品仓为准。
2. **角色映射**:产品内的角色标识(展示中文)映射到协议 role:`viewmicro/business/policy/credit/commerce/asset`(标签:见微/业务/政策/信审/商务/资产)。如产品已有英文标识,直接复用;不一致时在服务层做一张静态映射表,不修改本模块默认表也可(传入自定义 `roles`)。
3. **构造适配器(服务级单例)**:

```js
import { createModelAdapter, createProviderTransport } from '.../model-adapter/adapter.mjs';
import { buildChatCompletionsRequest, parseChatCompletionsResponse } from '.../model-adapter/providers/http-json.mjs';
import { createSimulatedTransport } from '.../model-adapter/simulated.mjs';

// 未配置真实 provider 时:继续用模拟通道(状态=simulated,前端显著展示 SIMULATION)
const transport = createSimulatedTransport({ script: ... });

// 配置真实 provider 时(需要用户确认用途并提供的产品凭据与预算,当前未具备):
// const transport = createProviderTransport({
//   buildRequest: (payload) => buildChatCompletionsRequest(payload, {
//     baseUrl: cfg.baseUrl, model: cfg.model,
//     getApiKey: () => cfg.readApiKey(),   // 凭据由业务层保管,禁止硬编码/落日志
//   }),
//   parseResponse: parseChatCompletionsResponse,
//   modeName: 'http-chat-completions',
//   fetchImpl: fetch,                       // 注入业务层可信 fetch
// });

export const modelAdapter = createModelAdapter({
  transport,
  mode: 'http-chat-completions',           // 与所用 provider 对应;模拟期可不传
  ledger: businessLedger,                  // 必传:接产品成本账(接口见 ADAPTER_CONTRACT §6)
  timeoutMs: 20000,
});
```

4. **服务层调用点**:把原来"每个事件固定问句"的调用点改为按需调用:

```js
const result = await modelAdapter.analyze({
  requestId,            // 已持久化的请求 ID(与返修 F1 的不可变请求对齐)
  projectId, sessionId,
  generation,           // 与产品会话代次一致(返修 A2 的暂停代次)
  contextVersion,       // 证据集版本(返修 A3/F6 的证据版本)
  role, purpose,
  text,                 // 经允许的合成/去标识文本
  evidenceRefs,         // 证据三元组清单
}, {
  signal: reqAbortSignal,                     // 客户端断开/用户取消
  snapshot: () => sessionStore.snapshot(sessionId),
  // 返回 { generation, contextVersion, paused }——业务层权威,决定 stale/暂停拒绝
});
```

5. **状态→产品 UI/动作映射**(服务层负责,前端不感知适配器):

| result.status | 产品侧动作(与返修口径一致) |
| --- | --- |
| succeeded | 正常渲染 findings/questions;引用必须回链证据(id/version/hash) |
| simulated | 渲染并**显著标记 SIMULATION**(本模块已带中文声明,前端不得隐藏) |
| not_configured | 显示"未配置模型服务",不显示任何模型结论 |
| failed | 显示中文 error.message;允许用户"重试"(新 requestId 或按 §3 语义) |
| unknown | 显示"结果未知:外部调用可能已发生,需人工核实";**禁止自动重试**;提供"人工核实后重试"(同 requestId 同载荷可完整重跑)与"放弃"动作;成本侧保留预留待对账 |
| stale | 不作为现行结论;提示"结果已过期,请基于当前代次重新发起" |
| cancelled | 提示已取消/会话暂停;恢复按钮走显式人工动作(推进 generation 并留痕) |

6. **持久化幂等(业务层职责)**:对每个 requestId 持久保存完整载荷与结果状态(与返修 F1/A4 的不可变请求/REQUEST_MISMATCH 机制合并设计)。本模块的去重只是实例内存级,重启或多实例下以业务层持久记录为准。

## 2. 与主返修各项的对应

| 返修条目 | 本模块提供 |
| --- | --- |
| A2 暂停有服务端约束 | 快照 paused → 拒绝新调用;在途结果 stale,不越过暂停代次 |
| A3 证据失效/版本 | contextVersion 快照变化 → stale;输出引用三元组精确校验 |
| A4 核算幂等 | REQUEST_MISMATCH(同ID变载荷);同输入重放稳定 |
| B provider 契约 | 本模块即该契约的实现:未配置 not_configured,真实异常 failed/unknown,绝不回退 model_simulation 冒充成功 |
| B 故障注入 | 本地可控 transport + 手动时钟已覆盖:超时/畸形/空输出/悬空引用/暂停中返回/过期版本/重复结果/部分失败 |
| F1 不可变请求 | analyze 契约以 requestId+载荷规范化哈希为身份 |

## 3. 重试语义(重要,与"未知状态禁止自动无限重试"对齐)

- unknown/超时/送出后失败:**适配器内部零自动重试**。业务层如需重试,必须经人工动作(界面按钮)触发。
- 同 requestId 同载荷:unknown 结果不缓存,可完整重跑;确定性结果(succeeded/simulated/stale/failed)重放直接返回缓存(`deduped:true`),不会重复计费调用。
- 换载荷:必须换新 requestId,否则 REQUEST_MISMATCH。

## 4. 缺口清单(接入前必须知道)

1. **quality NOT TESTED**:本模块验证协议与边界,不验证模型输出的正确性/金融准确率;评估由主任务组合并行 C 的工具进行。
2. **真实服务兼容 NOT TESTED**:OpenAI 形状网关与 Dify 1.13.x 实例只做过"官方文档格式映射 + fixture"验证(来源与版本见 ADAPTER_CONTRACT §5);接通真实端点时须先小流量实测。
3. **凭据与预算**:当前未获任何真实密钥;接入真实 provider 前需用户明确用途确认、提供产品凭证与预算上限(接 businessLedger)。既有 50 万 token 上限口径由业务层合并统计,本模块不重置。
4. **文本脱敏**:送入 `text` 的内容必须由业务层保证为合成/去标识文本。
5. **持久化**:见 §1 第 6 步,本模块不落盘。
6. **不承诺零代码替换**:服务层需要上面的构造与状态映射代码(估计一个服务文件 + 一张状态映射表);这是"接入边界",不是即插即用组件。

## 5. 复现与验收

```bash
cd V6/handoff/PARALLEL_MODEL_ADAPTER_20260913
node test/run-all.mjs     # 91 项全绿;零依赖、零网络、零真实模型调用
```

协议细节以 `ADAPTER_CONTRACT.md` 为准;交付批次与文件校验见 `MANIFEST.json`。
