# ADAPTER_CONTRACT｜可替换模型适配器 · 接口 v1(R2 修订,2026-09-13)

本文冻结 R2 批次交付契约,覆盖 R1 版(`PARALLEL_MODEL_ADAPTER_20260913/ADAPTER_CONTRACT.md`,历史保留)。**R2 覆盖点以【R2】标注**;未标注部分继承 R1 语义。协议常量唯一来源 `src/codes.mjs`。输出语言中文,role/purpose/错误码英文。

## 1. 工厂与依赖注入

```js
const adapter = createModelAdapter({
  transport,         // 必需(除模拟演示):async (call) => TransportResult(契约同 R1 §5)
  mode, clock, ledger, roles, timeoutMs, estimateTokens, forbiddenPatterns,  // 同 R1
  maxEntries,        // 【R2】请求登记容量,缺省 512;满且无可安全释放条目时明确背压
});
const result = await adapter.analyze(request, context);
```

context:`{ signal?, snapshot?(), gate? }`。
- `snapshot()` 返回 `{ generation, contextVersion, paused }`(业务层权威;缺省用实例 markSession/pauseSession/resumeSession 登记,同 R1)。
- `gate.professionalReviewPassed`【R2·人控边界】:显式 `false` 时 payload.instructions 声明 `preprocessingOnly:true`,成功类结果(succeeded/simulated)附加 `scope:'preprocessing_only'` 与中文 `scopeNotice`——业务层据此把结果挡在正式判定通道外;缺省/true 行为不变。

**角色与轮转边界(继承)**:六角色只是配置表;每次 analyze 恰好单一角色一次调用;无逐事件轮转六角色的任何内置逻辑;单一 provider 实例服务所有角色。

## 2. 请求与响应

请求 schema 同 R1 §2(requestId/projectId/sessionId/generation(正整数)/contextVersion/role/purpose/text/evidenceRefs 三元组)。

响应在 R1 结构上新增/修订:

| 字段 | 说明 |
| --- | --- |
| `dissent: []` | 【R2】provider 输出的异议候选结构(position:'original'\|'dissenting'、text、evidenceRefs(核查过)、conflictsWith);校验非法即整体 failed;合法则原样透传,聚合层绝不抹除 |
| `scope` / `scopeNotice` | 【R2】人控边界标记(见 §1 gate) |
| 其余 | 同 R1 §3(七状态、deduped、usage/usageUnknown、costLedger、simulation、timings) |

## 3. 去重与缓存(【R2】重大修订)

- **容量安全淘汰**:条目三分类 in-flight / cached / uncached;淘汰只允许 cached 最老优先、其次 uncached 最老优先;**in-flight 任何情况不得淘汰**。lookup 只读判定;实际淘汰在注册时执行。
- **明确背压**:容量满且无可安全淘汰条目 → `failed/REGISTRY_AT_CAPACITY`(中文提示,不调用 transport、不预留、不静默、不挂起)。优先级:**保护在途 > 保留指纹 > 接受背压**。
- **缓存结果复核**:cache-hit 与 in-flight join 返回前**重新执行快照核对**;generation/contextVersion/paused 已变化 → 以缓存数据为基础返回 `stale` + 对应 error.code + `deduped:true`(findings 等数据保留供人工核对)——**旧结果被当现行 0**。
- **确定性缓存细分(审计裁决)**:succeeded/simulated/stale 恒缓存;`failed` 仅当 error.code ∈ DETERMINISTIC_ERROR_CODES(校验类:REQUEST_INVALID/UNKNOWN_ROLE/PURPOSE_NOT_ALLOWED/REQUEST_MISMATCH/EMPTY_OUTPUT/MALFORMED_OUTPUT/FINDING_TEXT_MISSING/UNSOURCED_FINDING/EVIDENCE_DANGLING/UNAUTHORIZED_OUTPUT)才缓存;**送出后失败(TRANSPORT_ERROR/TRANSPORT_THROWN)、背压、预算拒绝属非确定性,不缓存**——业务层人工核实后同ID同载荷重试是完整新调用。
- 范围声明(继承):实例内存内去重;持久化幂等与跨进程恰好一次由业务层负责。

## 4. 生命周期(继承+强化)

取消/超时/unknown 语义、暂停(发起拒绝+迟到 stale)、成本结算(缺 usage 不记0不释放)全部继承 R1 §3/§6。R2 新增组合保证(协议套件 S1–S14 锁定):暂停→恢复→旧响应 stale;证据修订→旧缓存 stale;不同项目相同文本天然隔离(payload 含 projectId,同ID变载荷→REQUEST_MISMATCH);重复回调受深冻结保护;同ID并发 transport 恰 1(任意容量/固定seed随机调度,在途淘汰 0)。

## 5. 输出守门与聚合

守门规则同 R1 §4(结构/引用三元组精确匹配/无来源事实拒绝/越权批准拦截),新增:
- **dissent 校验**:position 枚举、文本非空、引用同 findings 规则、越权表述同样拦截;合法 dissent 不影响 succeeded。
- 【R2】聚合层 `src/aggregate.mjs`:`aggregateResults(results)` —— findings/dissent 全量保留(**异议丢失 0**);questions 按 text 精确重复合并(合并保留 sources;引用证据或 mustResolve 的追问进入 unresolvedQuestions,**去重不吞关键未解决项**);pendingDecisions 只列冲突双方 id,**绝不裁决、无任何决定性字段(越权决定 0)**。

## 6. 点名提醒与人工纠偏(【R2】候选协议层,非授权)

- `src/reminders.mjs`:`planReminders` —— 仅授权上下文提醒(未显式授权→空计划/TypeError);普通事件不打断;白名单外事件类型即使声明 important 也降级不进计划(事件源不能自升重要度);点名(human_mention)例外;同 key 重复合并(计数/重要度取最高)+跨批继承;动作白名单仅 `notify_human`——**协议层不存在 approve/decision/retry 自动动作,不因模型输出自升权限,不产生正式批准**。
- `src/human-feedback.mjs`:纠偏记录 `decidedBy` 仅 `'human'`(传 'model'/'ai' → TypeError,模型不自升权限的结构化表达);`canPromoteToGlobalRule`:scope 非 global、样本<2、不同情形<2、无反例 → 一律 false(**局部纠偏与全局规则分离,单例不能触发规则替换**);`buildImprovementPlan` 四要素(样本/反例/影响/人工决策),`status` 恒 `'awaiting_human_decision'`,无自动训练/自动执行入口。样例见 `PROTOCOL_NOTES.md`。

## 7. 产品映射(【R2】)

`src/integration/product-mapping.mjs`(纯函数)+ `FIELD_MAPPING.md`(逐项三列表,含产品源码定位):evidence(fixtureId-only 拒绝;缺 version/hash 失败关闭)、session(generation 缺失/为 0 → 失败关闭,不猜默认;contextVersion 供给路径:options.contextVersion → options.remoteVersion → 前向兼容字段,皆无 → 失败关闭;paused 缺省 false 为唯一安全缺省)、`statusToProductAction`(七状态→UI 动作/是否可重试/是否必须人工核验)、`canonicalRequestId`(确定性)。**缺字段失败关闭,不把 fixtureId 当完整证据引用**。

## 8. 账本与 provider(继承)

账本接口与不变量同 R1 §6;R2 增 500 步固定 seed 压力与 30 交错验证(12 测试):committed/unknown_hold 永不 release、occupied 恒等式、上限按 estimate 计量不破(commit 按 usage 如实结算可瞬时超限,属"结算不可拒绝现实"的正确语义,硬上限熔断属业务层策略)。provider 映射同 R1 §5(OpenAI Chat Completions 形状 spec v2.3.0;Dify Run Workflow blocking;partial-succeeded→failed);R2 补 fixture:悬空引用/无 usage/部分失败/错误体带 usage/dissent,全路径(parse→validate→adapter→ledger)状态明确。**可重放 mock 只证明协议,不证明真实服务兼容。**

## 9. 对抗验证(【R2】)

协议断言套件 S1–S14(对任意实现可运行,好实现必须零违规)+ mutation 分母 7(mutant-A/B/C/D + wrapper-E/F/G),**捕获 7/7**;独立审查(AUDIT_REPORT.md,PASS-WITH-NOTES)后已补:deduped 负向断言、simulated 显著标记断言、stale 数据保留断言、无守卫式错误码断言。变异产物与结果 JSON 只写运行时目录(`R2_MODEL_TEST_OUT_DIR` 环境变量可指定,缺省 `runtime/`),**复跑不改冻结源**;`tools/verify-frozen-hash.mjs` 退出码 0=全部匹配/1=差异。

## 10. 已知限制(NOT TESTED)

真实模型推理质量;真实 OpenAI 形状网关与 Dify 1.13.x 端点兼容;真实产品 store 端到端集成(字段名以源码静态核对为准);越权批准词表为启发式;提醒/纠偏协议未接产品事件流。本轮真实产品 API 调用 0,未使用任何真实凭据。
