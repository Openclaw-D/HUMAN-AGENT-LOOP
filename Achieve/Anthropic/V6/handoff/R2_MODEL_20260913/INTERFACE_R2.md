# INTERFACE_R2｜共享接口冻结(2026-09-13,主线程唯一 writer)

本文件冻结 R2 各 subagent 之间的共享接口。各 agent 在自己 owner 文件内实现,不得改他人文件;接口不匹配时在交付说明中提出,由主线程串行整合。R1 拷贝基线的输入 hash 见 `evidence/r1-baseline-input-hashes.txt`。

## 1. RequestRegistry(src/dedupe.mjs,owner:Agent-DEDUPE)

lookup 返回值枚举(消费方 adapter.mjs 按此分发):

```js
{ kind: 'register', payloadHash }                 // 新请求(含 settled-uncached 的同ID重试;复用既有条目,不新增)
{ kind: 'mismatch', registeredHash, payloadHash } // 同ID不同载荷
{ kind: 'cache-hit', result, payloadHash }        // 确定性结果已缓存
{ kind: 'in-flight', promise, payloadHash }       // 在飞共享
{ kind: 'capacity', payloadHash }                 // 容量满且无可安全淘汰项 → 明确背压
```

容量策略(修复 Codex 点名的"淘汰在途"):

- 条目分类:`in-flight`(promise 未 settle)/ `cached`(settled 且确定性结果已缓存)/ `uncached`(settled 且非确定性,仅 payloadHash 指纹)。
- 淘汰只允许按优先级:`cached` 最老优先,其次 `uncached` 最老优先;**in-flight 条目在任何情况下不得淘汰**。
- 容量满且只剩不可安全淘汰条目(全是 in-flight)→ `track()` 返回/`lookup` 返回 `kind:'capacity'`,**不静默淘汰、不挂起**;adapter 转为显式 failed(见 §2)。
- `maxEntries` 缺省仍为 512;行为必须在小容量(2/3)下确定性可测。

Mutation 锚点(与 Agent-TESTINFRA 约定,逐字):

```js
// MUTATION-ANCHOR:EVICTION-SELECT
```
该注释必须紧邻"淘汰候选选择"的判定表达式所在行上方;TESTINFRA 的 mutant-C 将把该表达式替换为"无条件选中最老条目(含 in-flight)"以复现 R1 缺陷,协议场景 S11 必须抓住它。DEDUPE 只负责放置锚点并保证正确实现;变异由 TESTINFRA 生成。

## 2. adapter.mjs R2 修改点(owner:Agent-LIFECYCLE)

0. **maxEntries 透传**:`createModelAdapter` 新增可选 `maxEntries`(缺省 512)并传给 RequestRegistry——协议套件 S11/S13 需要以 maxEntries=2 构造 adapter。
1. **capacity 消费**:`registry.lookup` 返回 `kind:'capacity'` 时返回 `quickResult(request, warnings, startedAt, { status: FAILED, error: { code: 'REGISTRY_AT_CAPACITY', message: '适配器请求登记已满且无在途请求可释放:为保护在途去重不新增请求;请稍后重试或提高 maxEntries', details: { maxEntries } } })`,不调用 transport、不预留。
2. **缓存返回复核(修复"缓存结果有效性")**:`cache-hit` 与 `in-flight` join 拿到结果后,**必须先执行 `stalenessOf(request, context)` 复核当前快照**;快照已变化 → 以缓存结果数据为基础返回 `status:'stale'` + 对应 error.code(GENERATION_CHANGED / CONTEXT_VERSION_CHANGED / SESSION_PAUSED)+ `deduped:true`,不得以 succeeded/simulated 呈现旧结果。快照未变化 → 现行为不变。
3. **Mutation 锚点(逐字)**:缓存复核分支上方:
```js
// MUTATION-ANCHOR:CACHE-REVALIDATE
```
mutant-D 将跳过该复核(直接返回缓存结果)以复现 Codex probe 行为;协议场景 S12 必须抓住。

## 3. 新错误码(src/codes.mjs——**owner 例外:由主线程统一写入**)

`REGISTRY_AT_CAPACITY` 已由主线程直接加入 codes.mjs(唯一共享常量文件,不走 agent,避免多 writer)。其余错误码沿用 R1。

## 4. 测试输出目录(owner:Agent-TESTINFRA)

- 解析顺序:`process.env.R2_MODEL_TEST_OUT_DIR` → 缺省 `<交付根>/runtime/`。
- `runtime/` 属运行时可变产物,**不进 MANIFEST 冻结清单**(gen-manifest 排除);测试一切可变输出(汇总文本、mutant 文件、adversarial-results.json)只写该目录。
- 冻结核验:`tools/verify-frozen-hash.mjs` 读 MANIFEST.json 逐文件重算 SHA256,报告匹配/不匹配;`node tools/verify-frozen-hash.mjs` 退出码 0=全部匹配,1=有不匹配(列出差异)。

## 5. contract-assertions 新场景(owner:Agent-TESTINFRA;语义冻结,实现须与 §1/§2 一致)

- **S11 容量淘汰**:maxEntries=2 的 registry;a 在途期间注册 b、c;b/c 均成功;随后 a 的同ID同载荷仍必须 `in-flight`/命中同一 transport 调用(transport 对 a 恰好 1 次),a 的同ID变载荷必须 mismatch。违规即抓 mutant-C。
- **S12 缓存复核**:成功调用缓存后,snapshot 推进 generation,同ID同载荷再次调用 → 必须 `stale`(非 succeeded);快照未变时第二次调用仍 `succeeded` + `deduped:true`。违规即抓 mutant-D。
- **S13 明确背压**:maxEntries=2,两个永久 in-flight,第三个新请求 → `failed/REGISTRY_AT_CAPACITY`,transport 未被调用;任一在飞完成后重试成功。
- **S14 unknown 不缓存**:indeterminate 后同ID同载荷重试必须产生新的完整调用(保持 R1 语义,防回归)。

## 6. 产品映射模块(owner:Agent-MAPPING)

`src/integration/product-mapping.mjs` 导出(纯函数,零副作用):

```js
evidenceToRefs(productEvidence, { source = 'unknown' }) → { ok:true, evidenceRefs:[{id,version,hash}] } | { ok:false, code:'MAPPING_MISSING_FIELDS', message(中文), details:{ index, missing:[...] } }
sessionToSnapshot(remoteSession, { source = 'unknown' }) → { ok:true, snapshot:{ generation:int, contextVersion, paused:bool } } | { ok:false, code:'MAPPING_MISSING_FIELDS', ... }
statusToProductAction(status) → { uiAction, zh(中文), allowRetry:boolean, mustHumanVerify:boolean }   // 七状态全覆盖
canonicalRequestId({ sessionId, generation, op, seq }) → 'r<sessionId>-g<generation>-<op>-<seq>'   // 确定性 requestId 建议
```

原则:缺字段**失败关闭**(不猜默认值、不把 fixtureId 当完整证据引用);字段名以产品源码实际为准(只读 `jianwei-v3/site/lib/v5-preview/**` 与 `app/api/v5-preview/**`,引用处注明文件与行号);逐项映射表写入 `FIELD_MAPPING.md`(含"产品字段↔协议字段↔缺失行为"三列)。

## 7. mutation 清单与报告格式(owner:Agent-TESTINFRA)

| ID | 变异目标 | 语义 | 抓捕场景 |
| --- | --- | --- | --- |
| mutant-A | validate-response 悬空检查 | 跳过(沿用 R1 锚点) | S3 |
| mutant-B | validate-response 批准拦截 | 跳过全部四处(沿用 R1 锚点) | S4 |
| mutant-C | dedupe EVICTION-SELECT | 无条件选中最老(可淘汰在途) | S11 |
| mutant-D | adapter CACHE-REVALIDATE | 跳过缓存复核 | S12 |
| wrapper-E | unknown 自动重试(沿用 R1) | 重试至多5次 | S9 |
| wrapper-F | 缺usage记0释放(沿用 R1) | commit 0 | S10 |
| wrapper-G(新) | 缓存命中无条件 deduped 标记成功 | stale 也标 succeeded | S12 |

报告只允许格式:`mutation 捕获 M/N(分母 N=注入缺陷数)`,并列出每个缺陷的抓捕场景;禁止用测试总数代替分母。好实现必须零违规。

## 8. 不变量(各 agent 自查,全量测试最终由主线程串行验证)

- 同ID并发 transport 调用恰 1(任意容量/调度)。
- 在途条目零淘汰(任意容量/调度)。
- 变载荷拒绝 100%(指纹未淘汰前提下)。
- 旧结果当现行 0(stale/暂停组合全覆盖)。
- unknown 自动重试 0;预算未知释放 0。
- 测试不写 `runtime/` 以外的任何路径;不回写 `PARALLEL_MODEL_ADAPTER_20260913/`。
