# FIELD_MAPPING｜R3 单一权威版(2026-09-13)

> 本文是 R3 批次的唯一字段映射权威(继承 R2 版全部产品源码定位,并在头部追加 R3 桥层增量的落地裁决)。
> R2 版 `../R2_MODEL_20260913/FIELD_MAPPING.md` 为历史,不再单独维护。

## R3 桥层增量(src/bridge/product-bridge.mjs 已实现,16/17 测试锁定)

| R2 遗留缺口 | R3 落地裁决 | 实现 |
| --- | --- | --- |
| 产品 generation 初始 0(legacy 补 0)vs 协议正整数 | **桥层 +1 偏移**:协议代次 = 产品代次 + 1;不改产品事实、不改协议;回执并列回显两个口径(`bridgeMeta.productGeneration` / `requestEcho.protocolGeneration`) | buildAnalyzeRequest;mutant-E1 反证 |
| contextVersion 供给需同一快照读取 | 桥仅接受 `storeReader()` **单次一致性读**(remote-store 单文件 JSON 读满足);一次读取同出 generation/contextVersion/evidenceRefs;缺 version/generation → `MAPPING_MISSING_FIELDS` 失败关闭,无默认常数 | readStoreOnce;mutant-E2 反证 |
| contextVersion 取值 | `rv${store.version}`(store.version 即 API remoteVersion;rv 前缀防与代次混淆) | 同上 |
| superseded 证据 | `supersededBy !== null` 显式过滤并计数(`bridgeMeta.supersededFiltered`),不静默 | 同上 |
| reader 异常/会话消失 | 快照保守停摆 `{generation:0, contextVersion:'', paused:true}` → 在途结果必 stale,绝不放行 | snapshot 回调 |

以下为 R2 版全文(产品源码定位仍有效):

---
---
# FIELD_MAPPING｜主产品远程尽调数据模型 ↔ jianwei.dd.analyze/v1 逐项映射(Agent-MAPPING,2026-09-13)

交付物:`src/integration/product-mapping.mjs`(纯函数、零依赖、零副作用)+ `test/unit/13-mapping.test.mjs`。
产品源码**只读静态核对**,核对基线:`C:\Users\Anthropic` 工作区 `jianwei-v3/site/lib/v5-preview/` 与 `app/api/v5-preview/`(2026-09-13 快照,下述行号以该快照为准)。
协议常量:`src/codes.mjs`(七状态);下游校验:`src/validate-request.mjs`。

## 1. 证据映射(evidenceToRefs)

产品结构:`EvidenceRecord`(lib/v5-preview/remote-types.ts:61-81);store 校验:remote-store.ts:158-177;创建:remote-service.ts:331-347(attachEvidence)、378-395(supersedeEvidence)。

| 产品字段(文件:行号) | 协议字段 | 缺失行为 |
| --- | --- | --- |
| `evidenceId`(remote-types.ts:62;创建 remote-service.ts:332 `newId('ev')`;store 必填非空 remote-store.ts:159) | `id` | 缺失/空串/非字符串 → **整体失败关闭** `MAPPING_MISSING_FIELDS`,missing 含 `id(evidenceId)` |
| `version`(remote-types.ts:74;创建恒为 1 remote-service.ts:344,391;store 必填有限数 remote-store.ts:171) | `version`(**String() 转换**) | 缺失/非有限数/负数 → **失败关闭**,missing 含 `version`。不转换类型、不用 0 或空串补齐。转换理由:协议要求 evidenceRefs 每项 version 为**非空字符串**(src/validate-request.mjs:63),产品为 number |
| `sha256`(remote-types.ts:73;创建=服务端实际返回原图字节 SHA256 remote-service.ts:329-343;store 必填非空 remote-store.ts:170) | `hash` | 缺失/空串/非字符串 → **失败关闭**,missing 含 `hash(sha256)` |
| `fixtureId`(remote-types.ts:65;同一 fixture 可多次采集 remote-service.ts:328,336) | **不映射为 id** | `fixtureId` 是合成图形"种类"标识(可重复),**不是唯一引用**。仅有 fixtureId 而缺 version/sha256 → **失败关闭**(fixtureId-only 拒绝);message 中显式提示该记录不构成完整引用 |
| `supersededBy`/`supersedes`(remote-types.ts:76-78;过期判定 remote-service.ts:266-268) | 不参与映射 | 映射层不过滤已被取代的过期证据(保持纯映射);调用方组装清单时应排除 `supersededBy !== null` 的记录(见缺口 #4) |
| `digestOf`(remote-types.ts:80) | 不参与映射 | 仅提示:`fixture_meta_legacy` 是历史元信息拼串摘要,**非原件摘要**(remote-types.ts:79);协议引用始终指向 `sha256` |
| 其余字段(projectId/sessionId/title/mime/width/height/capturedAt/receivedAt/sourceType) | 不在 evidenceRefs 内 | 请求级 projectId/sessionId 由主任务另行组装;sourceType 恒为 `simulation_fixture`(remote-store.ts:101) |

行为细则:空数组 → `{ok:true, evidenceRefs:[]}`(协议允许空引用清单,src/validate-request.mjs:58-60);多条记录逐条校验,**第一个**不合格项决定整体失败(index/missing 指向该项),失败时**绝不**返回部分清单;返回对象深冻结。

## 2. 会话快照映射(sessionToSnapshot)

产品结构:`RemoteSessionRecord`(remote-types.ts:44-55);store 校验:remote-store.ts:127-156;创建默认:remote-service.ts:182-200。

| 产品字段(文件:行号) | 协议字段 | 缺失行为 |
| --- | --- | --- |
| `generation`(remote-types.ts:49-50,注释"每次 pause_round +1";初始 0 remote-service.ts:187;pause_round/resume_round 各 +1 remote-service.ts:611-621;store 校验非负整数 remote-store.ts:132-137;legacy 记录缺 generation 由读侧内存补 0 并标 legacy remote-store.ts:289-294) | `snapshot.generation` | **缺失或非正整数(含 0)→ 失败关闭**,missing 含 `generation`。理由:(a) 协议要求正整数(src/validate-request.mjs:49-51);(b) 这正是 Codex 点名的"旧会话缺 generation"问题——映射层不猜默认值、也**不擅自 +1 偏移**;偏移或放宽协议是主任务的显式接入决定(缺口 #1) |
| `status`(remote-types.ts:48,枚举 `scheduled/live/paused/ended`;`paused` 为唯一暂停态;产品暂停执行门 remote-service.ts:162-167 requireNotPaused、849-857 stateRejection) | `snapshot.paused` = (`status === 'paused'`) | `status` **缺失** → 安全缺省 `paused:false`(理由见下);`status` **存在但非枚举值** → **失败关闭**(不能从非法值可靠推导暂停态) |
| (产品**无**对应字段) | `snapshot.contextVersion` | **无法取得 → 失败关闭**。解析顺序:`options.contextVersion` → `options.remoteVersion`(产品词汇别名)→ `remoteSession.contextVersion`(前向兼容)。理由见缺口 #2:产品会话记录没有 contextVersion 字段,唯一语义对应物是 `RemoteStoreState.version` |

**paused:false 安全缺省的理由**(唯一一处缺省,其余全部失败关闭):
1. 方向性:声称"暂停"会无依据虚构状态并阻断业务,"未暂停"是不虚构的方向;
2. 产品真正的暂停门在服务端强制执行(requireNotPaused 在模型推进/确认类路径调用,remote-service.ts:162-167、522-523;异步 provider 路径返回前再判定 849-857、863-870),不依赖映射层兜底;
3. 经产品 store 读出的记录必带 status(remote-store.ts:131 reqEnum 强制),该缺省只覆盖异常/前向兼容输入。

**contextVersion 的产品侧取值**:`RemoteStoreState.version`(remote-store.ts:44-53),每次成功写入 +1(create 会话 remote-service.ts:202、附证据 349、取代 399、标注 458、回复 501、模拟追问 541、复核 622、出席确认 652、核算 765),所有 API 响应以 `remoteVersion` 暴露(remote-service.ts:203、213、248、350、400 等)。产品自身的过期判定 F4 正是基于它(`basedOn.remoteVersion < state.version` → stale,remote-service.ts:238-242)。调用方必须在**同一次 store 读取**内取证据清单 + remoteVersion,一并传入,防快照撕裂。

## 3. 七状态 → 产品动作(statusToProductAction)

状态语义与 R1 契约冻结一致(ADAPTER_CONTRACT.md §3,66-78 行):unknown=可能已发生须人工核实、stale=不得当现行、simulated=显著标记、cancelled=确定未发生。`allowRetry` 定义:允许业务层在人工确认后以同一 requestId 重新发起完整调用;**任何状态下自动重试均为 0**。unknown 的"仅人工核实后重试"以 `allowRetry:false + mustHumanVerify:true` + 中文说明编码(布尔无法表达条件重试,取保守侧)。

| status | uiAction | zh(中文) | allowRetry | mustHumanVerify |
| --- | --- | --- | --- | --- |
| not_configured | configure_provider | 模型服务未配置:本次未发起任何外部调用、无费用;请先完成 provider 配置后再使用分析功能。 | false | false |
| simulated | show_simulated_banner | 结果来自受控模拟通道:界面必须显著标注"模拟",输出仅供参考,不得当作真实尽调结论或成功结果。 | false | true |
| succeeded | show_result_pending_review | 分析完成:模型输出无审批效力(authority=none),须经人工复核确认后方可采信。 | false | true |
| failed | show_failed_reason | 分析失败:请向人工展示失败原因;修复请求或配置后可由人工决定重试(重试为新的一次完整调用)。 | true | false |
| unknown | human_verify_before_retry | 结果不可知:请求可能已送达外部,禁止自动重试;须先人工核实外部是否实际发生,核实后方可决定是否重试。 | false | true |
| stale | show_stale_for_review | 结果已过期:返回时会话代次/上下文版本或暂停态已变化,仅供人工核对、不得当作现行结果;人工确认后可重新发起。 | true | true |
| cancelled | show_cancelled | 已取消:请求确定未送达外部,无外部调用与费用;可重新发起。 | true | false |

七状态之外(含非字符串)→ 抛 `TypeError`。

## 4. 确定性 requestId(canonicalRequestId)

格式:`r<sessionId>-g<generation>-<op>-<seq>`,纯字符串拼接、无随机/时钟,同参数恒同串。参数校验:sessionId/op 非空字符串、generation 正整数(与协议及 sessionToSnapshot 一致)、seq 非负整数,否则 `TypeError`。产品 `requestId` 幂等表容量 500、要求 requestId ≤64 字符(remote-store.ts:55;remote-service.ts:112-114)——超长由调用方自检,映射层不截断(截断=改写身份)。

## 5. 主任务需补齐的缺口清单

1. **generation 域冲突**:产品初始代次为 0(remote-service.ts:187)、legacy 读补 0(remote-store.ts:292-293),协议要求正整数(src/validate-request.mjs:49-51)。映射层对 0 **失败关闭**;主任务须二选一:接入层显式 `generation = product.generation + 1`(在调用 sessionToSnapshot/canonicalRequestId 之前),或放宽协议为非负整数(须改 src/validate-request.mjs 与 R1 契约,非 MAPPING 权限)。
2. **会话无 contextVersion 字段**:必须由调用方从同一次 store 读取的 `RemoteStoreState.version`(API 的 `remoteVersion`)经 `options.contextVersion`/`options.remoteVersion` 供给;不供给则失败关闭(空/常量 contextVersion 会让 stale 检测失效,无安全缺省)。
3. **fixtureId 不可当唯一引用**:同 fixture 多次采集可产生多条记录(remote-service.ts:328,336);产品旧 provider 契约 `evidenceRef:{fixtureId,sha256,version}`(remote-service.ts:783)与新协议 `{id,version,hash}` 不同,接入时 id 必须取 `evidenceId`。
4. **过期证据过滤在调用方**:`supersededBy !== null`(remote-service.ts:266-268)的证据仍可被映射(纯映射不过滤);主任务组装 evidenceRefs 前应排除,否则模型可能引用已取代原件。
5. **类型转换已内置**:evidence.version(number)→ 协议字符串(String());若产品未来改为字符串版本号,需重新核对该转换。

## 6. NOT TESTED 声明

- **未对真实产品 store 数据做端到端集成**:本模块仅与 `jianwei-v3/site/lib/v5-preview/` 源码做**静态**字段核对;未运行真实 Next.js 产品、未读写真实 `remote-store.json`、未调用任何产品 API。
- 产品记录在真实运行中的实际取值分布(如 legacy 记录占比、并发写时序)未验证。
- 字段名以源码静态核对为准(文件:行号见各表);若产品后续演进改字段,本模块按失败关闭暴露,不会静默错配。
