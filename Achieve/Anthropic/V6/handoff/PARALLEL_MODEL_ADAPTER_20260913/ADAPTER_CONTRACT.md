# ADAPTER_CONTRACT｜可替换模型适配器 · 接口 v1(2026-09-13)

本文冻结并行任务 A 交付的模型适配模块对外契约。实现位于 `src/`,协议常量唯一来源是 `src/codes.mjs`。所有输出语言为中文;role、purpose、错误码等协议标识一律英文。

## 1. 工厂与依赖注入

```js
import { createModelAdapter } from './src/adapter.mjs';

const adapter = createModelAdapter({
  transport,        // 必需(除模拟演示外):async (call) => TransportResult,见 §5
  mode,             // 结果回显的模式名;缺省:有 transport 为 'custom',无则 'none'
  clock,            // { now(), setTimeout(fn,ms), clearTimeout(id) };缺省系统时钟;测试可注入 createManualClock()
  ledger,           // 成本账本(接口见 §6);缺省为内部无上限 MemoryLedger(生产必须传入接预算的实现)
  roles,            // 角色配置表;缺省 DEFAULT_ROLES(六角色),可整体替换
  timeoutMs,        // 单次调用超时;缺省 30000
  estimateTokens,   // 预留估算 token;缺省 1000
  forbiddenPatterns,// 可选:收严/替换越权批准词表(正则数组)
});

const result = await adapter.analyze(request, context);
```

其他实例方法:`markSession/pauseSession/resumeSession`(实例内会话状态登记,见 §7)、`ledger`(账本句柄)、`registrySnapshot()`。

**角色与轮转边界**:六角色(见微 viewmicro、业务 business、政策 policy、信审 credit、商务 commerce、资产 asset)只是配置表(中英标签与允许用途);每次 `analyze` 恰好按 `request.role` 执行一次单一角色调用。**本模块没有任何"逐事件轮转六角色"的内置逻辑,也没有按角色拆分 provider 端点**——单一外部 provider 实例可以服务所有角色。

## 2. 请求(接口 v1 最小请求)

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| requestId | 非空字符串 | 是 | 请求身份;同实例内参与去重/冲突判定 |
| projectId | 非空字符串 | 是 | 项目归属 |
| sessionId | 非空字符串 | 是 | 会话归属;参与暂停/代次核对 |
| generation | 正整数 | 是 | 业务推进代次;快照变化后在途结果 stale |
| contextVersion | 非空字符串或正整数 | 是 | 证据/上下文版本;快照变化后在途结果 stale |
| role | 非空字符串 | 是 | 必须在 roles 表中(英文标识,大小写敏感) |
| purpose | 非空字符串 | 是 | 必须被该角色的 allowedPurposes 允许 |
| text | 字符串(可空串) | 是 | 经允许送出的合成/去标识文本;**脱敏责任在业务层**,本模块原样透传进载荷 |
| evidenceRefs | 数组(可空) | 是 | 每项必须含非空 `id/version/hash`;输出引用必须精确匹配此清单 |

未知字段不拒绝,记入 `result.warnings`(前向兼容)。

## 3. 响应(七状态显式区分)

```js
{
  contractVersion: 'v1',
  requestId, projectId, sessionId, generation, contextVersion, role, purpose,
  mode,               // 'none' | 'custom' | 'simulated' | 业务指定的 provider 模式名
  status,             // 见下表,七选一
  deduped,            // true = 本次实例内去重命中(非新调用)
  warnings: [],
  findings:           [{ id, text(中文), evidenceRefs: [{id,version,hash}] }],
  questions:          [{ id, text(中文), evidenceRefs }],
  evidenceRefs:       [ ... ],       // 输出实际引用(输入清单子集)
  error: null | { code, message(中文), details? },
  usage: null | { promptTokens, completionTokens, totalTokens, providerReported },
  usageUnknown,       // true = 外部调用可能已发生但 provider 未报告 usage
  costLedger:         { reservationState, reservationId? },
  simulation: null | { notice(中文,显著 SIMULATED 声明) },
  timings:            { startedAt, finishedAt },
}
```

### 状态语义(必须可区分,禁止互相伪装)

| status | 语义 | 外部调用是否已发生 | 成本处理 |
| --- | --- | --- | --- |
| not_configured | 未配置 provider,绝不调用,绝不回退模拟 | 否 | 不预留 |
| simulated | 受控模拟通道输出(必须显著标记,不得当 succeeded);同样通过输出守门 | 否(仅内存) | 不真实计费 |
| succeeded | 结构/引用/越权校验通过,且会话快照未变化 | 是 | usage 有→commit;缺→unknown_hold |
| failed | 请求非法、角色越权、transport 报错、输出校验失败、预算不足等 | 视路径:送出前失败不预留;送出后失败保留预留 | 见 §6 |
| unknown | **请求可能已送达外部但结果不可知**(送出后取消/超时/indeterminate);禁止自动重试,须人工核实 | 可能已发生 | unknown_hold(保留) |
| stale | 结果已取回但返回时 generation/contextVersion/暂停态已变化;仅供人工核对,不得当现行 | 是 | 照常结算 |
| cancelled | **确定**未送达外部(送出前取消、暂停拒绝、transport 证明 sent:false) | 否 | 不预留/释放 |

**取消语义(任务书第 4 条)**:只有能证明"请求未送达外部"才标 cancelled;无法证明时一律 unknown,**不声称取消等于未计费**。unknown 不做任何自动重试——重试是业务层的显式人工/持久化决策(见 INTEGRATION.md 的状态动作映射)。

## 4. 输出守门(验证失败不伪装成功)

provider 输出(`{findings, questions, evidenceRefs}`)必须通过:

1. **结构**:findings/questions 为数组;两者全空 → `EMPTY_OUTPUT` 拒绝;缺数组 → `MALFORMED_OUTPUT`。
2. **引用真实存在**:每条 finding 必须携带至少一个证据引用,且 `{id,version,hash}` 三元组**精确匹配**本次输入 evidenceRefs(防悬空引用、防版本/hash 混用)。违反 → `EVIDENCE_DANGLING`。
3. **无来源事实**:finding 无引用 → `UNSOURCED_FINDING` 拒绝。question 可不带引用(问句非事实断言),但带引用时同样必须合法。
4. **越权拒绝**:顶层出现 `decision/approved/approval/granted/...` 保留字段,或任何文本匹配决定性批准词表(默认含"审批通过/予以批准/同意放款/建议批准"等,可配置)→ `UNAUTHORIZED_OUTPUT` 拒绝。这是启发式护栏;**最终防线是产品层"模型 authority=none、意见无审批效力"**——拦截词表存在已知局限(无法覆盖全部表达、可能误伤引用性文字),不得据此宣称完备。
5. 任何违规 → 整体 `failed`(错误 details 列出逐条 violation),**不输出部分成功**。

## 5. transport 契约

```js
transport(call) => Promise<TransportResult>
// call = { payload, signal, deadlineMs, requestId, role, purpose }
// payload.protocol = 'jianwei.dd.analyze/v1',含完整请求字段+roleLabel+instructions
//   (authority:'none'、只允许引用清单证据、禁止批准输出——为提示词约束,真正防线是 §4)
```

| TransportResult | 适配器判定 |
| --- | --- |
| `{ ok:true, output, usage?, simulated?:true }` | 校验→succeeded / simulated / stale;校验失败→failed |
| `{ ok:false, sent?:false, error:{code,message}, usage? }` | sent 缺省按已送达:failed/TRANSPORT_ERROR;`sent:false`=证明未发送→cancelled |
| `{ ok:'indeterminate' }` | unknown |
| throw(默认) | 按可能已送达:failed/TRANSPORT_THROWN + unknown_hold;`err.notSent===true`→cancelled |

abort/超时发生时,适配器**停止等待且不采信迟到的 transport 结果**(防 unhandled:挂接空 catch)。

**provider 映射(最多两种,纯函数+fixture)**:
- 通用 HTTP 模型服务:`src/providers/http-json.mjs`(OpenAI Chat Completions 兼容形状)。格式来源:OpenAI API OpenAPI spec v2.3.0 `POST /v1/chat/completions`(platform.openai.com/docs/api-reference/chat/create),2026-09-13 检索。
- Dify Workflow:`src/providers/dify-workflow.mjs`(`POST /workflows/run`,blocking)。格式来源:docs.dify.ai → API Reference → Workflow Runs → Run Workflow,2026-09-13 检索。约定输出变量 `analysis_payload`(JSON 字符串);`partial-succeeded` 显式映射失败。
- 组装:`createProviderTransport({ buildRequest, parseResponse, modeName, fetchImpl })`——**适配器自身从不发网络请求**,fetch 实现由业务层注入;凭据只经 `getApiKey()` 回调进入 Authorization 头,绝不落入载荷、fixtures 或日志。
- `src/fixtures/provider-fixtures.mjs` 提供脱敏响应 fixture(结构取自上述官方文档,内容为合成尽调场景)。**未对真实服务端点做过兼容测试;fixture 一致 ≠ 真实兼容。**

## 6. 成本账本契约

```js
const ledger = createMemoryLedger({ maxReservedTokens });  // 业务层可提供同接口的持久化实现
ledger.reserve({ requestId, role, purpose, estimateTokens }) → { ok:true, reservationId } | { ok:false, code:'BUDGET_EXCEEDED' }
ledger.commit({ reservationId, usageTokens, note? })        // 结算实际用量
ledger.holdUnknown({ reservationId, note? })                // 外部可能已发生但 usage 未知:保留预留
ledger.release({ reservationId, note? })                    // 仅限确定未发生
ledger.totals() / entries() / get(id)
```

不变量:
- 预算上限约束 `reserved + committed + unknown_hold`;并发预留同样受控;拒绝时记录 rejected 条目可审计。
- **缺 usage 绝不记 0、绝不释放**:succeeded/stale/failed-after-send/unknown 一律 usage 有则 commit、缺则 unknown_hold(继续占用预算,后续请求会被 BUDGET_EXCEEDED 拦住,直到人工对账 commit 补录)。
- `unknown_hold → release` 被接口层拒绝(未知不得当未发生);`committed → release` 拒绝(冲销是业务账务流程,不在本模块)。
- promptTokens+completionTokens 之和可作计费依据;只有部分字段不可折算时同样进入 unknown_hold。

## 7. 暂停 / 代次 / 版本核对

- 快照来源优先级:`context.snapshot()`(业务层权威) > 实例内 `markSession/pauseSession/resumeSession` 登记。
- **发起时**快照 `paused:true` → 拒绝发起新调用(cancelled/SESSION_PAUSED),零调用零占用;恢复必须显式调用 `resumeSession`(通常同时推进 generation;留痕由业务层负责)。
- **返回时**(输出校验通过后)快照对比:generation 变化 → `stale/GENERATION_CHANGED`;contextVersion 变化 → `stale/CONTEXT_VERSION_CHANGED`;paused → `stale/SESSION_PAUSED`。stale 结果与 usage 如实返回,供人工核对,不得当现行。
- 校验失败优先于 stale 判定(错误信息更具体,不掩盖)。

## 8. 去重与幂等范围声明

- **本模块只保证:同一适配器实例、同一进程内存内**——同 requestId 相同载荷(规范化 JSON SHA256)→ 返回缓存/共享在飞调用(`deduped:true`);同 requestId 不同载荷 → `REQUEST_MISMATCH` 拒绝(载荷指纹在实例生命周期内保留,即使结果不缓存)。
- **持久化幂等与跨进程恰好一次不在本模块保证范围**:请求/结果的持久记录、崩溃恢复、多实例部署下的幂等由主业务层负责持久记录。
- 缓存策略:确定性结果(succeeded/simulated/stale/failed)缓存;unknown/送出后失败/取消**不缓存**——业务层人工核实后可用同一 requestId 重试完整调用。

## 9. 已知限制(NOT TESTED / 未保证)

- 真实模型推理质量、输出与金融判断的准确率:**NOT TESTED**(本模块只管协议与边界,不管 quality)。
- 真实 OpenAI 形状网关、真实 Dify 1.13.x 实例的端到端兼容:**NOT TESTED**(仅官方文档格式映射 + fixture)。
- 文本脱敏/允许出境判定:业务层职责,本模块透传。
- 越权批准词表是启发式,非完备护栏。
- 结果对象为深冻结快照;缓存返回为副本(可安全持有,篡改不影响后续)。
