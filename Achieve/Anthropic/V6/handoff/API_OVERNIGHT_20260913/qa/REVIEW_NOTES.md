# D路独立源码/接口审查记录（基线：A改动前）

审查时间：2026-09-13 23:10–23:30。文件hash见 `source-baseline-sha256.txt`。
范围：remote-service.ts / remote-model-adapter-bridge.ts / remote-request-registry.ts / remote-store.ts / remote-types.ts / model-adapter（simulated、http-json）/ annotations/simulate route / remote-session/page.tsx。

## 架构事实（验收时对照）

1. **幂等与版本门**：所有写路径 `requestId` 幂等（先于版本门）+ `expectedVersion` 乐观并发；同requestId换载荷 → REQUEST_MISMATCH；重放返回缓存响应。attemptCalculation 的幂等摘要刻意不含 expectedVersion（合法版本推进后原样重试仍同一请求）。
2. **模拟通道现状**：`simulateFollowUps` → `createBridgedModelAdapter()`（无transport=模拟通道）→ 所有回复 kind=`model_simulation`，author 带"模拟"字样。每标注仅一轮（已有 model_simulation 回复则跳过）。
3. **存储**：`.v5-preview-data/remote-store.json`（或 `V5_PREVIEW_DATA_DIR`），schema `v5-preview-remote-store@1`，失败关闭校验；**reply kind 白名单= `['model_simulation','business','domain']`**（remote-store.ts validateAnnotation）。新增真实模型kind必须同步扩展该白名单与 `remote-types.ts#ReplyKind`，否则落盘/读回即 REMOTE_STORE_CORRUPT。
4. **UI标签映射**（page.tsx~581）：`kind === 'model_simulation' ? '模型（模拟）' : kind === 'business' ? '业务' : '专业域'` —— 新kind若不改映射，会错误显示为"专业域"（误导性标签，R1失败点）。
5. **桥接层状态门**：调用前probe预判（版本过期优先于暂停）+ 返回后再probe复核（ok/partial才复核，改判rejected，绝不过期结果当成功）；bridge stale保留findings供人工比对。
6. **http-json provider**：纯映射不发请求；系统提示要求引用清单内证据；`response_format: json_object`；usage带出；非JSON→PROVIDER_CONTENT_NOT_JSON。
7. **正文缺口（R2）**：桥接 `CandidateAnalyzeRequest.evidenceRefs` 仅 `{id,version,hash}`，`text`=标注问题。**证据正文（客户陈述/材料内容）当前不进请求**。真实路径必须把实际正文送入provider请求（合同§3），验收时核对A的请求构造源码或脱敏payload。
8. **真实/模拟可区分（R1）**：桥接层现状把succeeded（真实）与simulated的findings/questions**都**推为 kind='model_simulation'（bridge L365-388，author区分但kind相同）。A的真实路径需兼容分支：真实结果须有可区分类型/标注，且"不得把model_simulation改成真实显示文字但仍保存错误类型"（合同§4）。存储白名单与UI映射同步。
9. **UI防重复**：`runWrite` 用 `busy` state + registry（unknown不覆盖、同载荷原样重试复用requestId）。NETWORK→保留unknown可原样重试；确定失败→resolve dropped。
10. **暂停门**：服务端 `requireNotPaused` 阻断simulateFollowUps（SESSION_PAUSED 409）；createReview 暂停中阻断 confirm/escalate_human；UI按钮 `disabled={busy||paused}` 双保险。
11. **证据取代链**：旧证据 `supersededBy` 指针，新证据 `supersedes` 反指；被取代证据上不可新建标注/确认；annotation.expired 现算显示"证据已过期"。基于旧证据的旧分析结果**不会自动失效**（replies留存在标注上，标注expired显示）——R6验收以"标注/证据过期标识可见 + 新分析引用新版本"为准。

## 候选缺陷

### F-001（高，23:55 深化）：simulateFollowUps 在 await 后用过期 state 快照持久化，并发请求互相整包覆盖
- 位置：`lib/v5-preview/remote-service.ts#simulateFollowUps`（当前版本 L535-613；基线即存在）。
- 机理：L540 `readRemoteStoreState()` 取快照 → L562 `await bridge.generateFollowUps(...)`（多个微任务边界，**可与并发请求的执行链交错**）→ 链尾 L607-611 用**本请求开局时的旧 state 对象**追加回复、`state.version += 1`、`persistRemoteStoreState(state)` 整包落盘。
- 两条数据丢失路径：
  1. **并发同类请求**：两个并发 simulate（不同 requestId、同一标注、无既有模拟回复）→ 两条链各自从同一 store 版本出发、各自通过"无 model_simulation 回复"检查 → 交错执行后**后 persist 者用旧快照覆盖前者已落盘的回复**；两请求都返回 200，但一方回复凭空消失。每次 simulate 都新建 bridge 实例（候选registry按实例隔离），跨请求不去重不去飞。
  2. **桥拒绝路径也写库**：等待期间 store 被推进（并发写/另会话写）→ 候选 snapshot()（contextVersion=store.version）判 stale → 桥返回 rejected → 外层仍把"模拟通道失败"回复追加进**旧快照**并 persist → 把正确的拒绝判定变成一次覆盖性写入，并发写丢失。与 CONTRACT §7"过期/拒绝结果不写入"精神相悖（§7字面只约束 analyze 路由，但覆盖写问题通用）。
- 已排除的相邻疑虑（23:55 复核）：新的 `analyzeAnnotation`（analyze 路由）**没有**此问题——候选 staleness 以 store.version 判过期 → MODEL_RESULT_STALE 且不落库；ok 路径从桥最后一次 fresh probe 到 persist 全程同步无窗口；probe 还带证据取代 -1 哨兵。模拟通道纯微任务链虽快，但**两个并发请求的链可以互相交错**，无需真实延迟即可触发路径1。
- 复现步骤（D将在A声明可测试后于3467执行，或A可自测）：
  1. 新建[D-QA]会话→附证据→建标注（无任何回复）；
  2. **同时**发两个 `POST annotations/simulate`（requestId 不同，如 `dqa-race-a`/`dqa-race-b`，same annotationId）；
  3. 两者都 200 后 `GET detail`：预期两个请求的 model_simulation 回复并存；实际（基线）仅剩一侧回复，且两请求返回的 remoteVersion 相互矛盾。
  4. 判定通过条件（修复后）：并发同标注模型类请求必须互不覆盖——后返回者要么按版本门拒绝（不落库），要么合并写入。
- 建议修复方向（供A参考，不改产品）：模型类写路径在 persist 前重读最新 store 并按 annotationId 重新定位标注后合并（analyze 已是此模式）；或将"失败说明"改为仅响应不落库。
- 状态：**已修复，D 复测通过（F-001-RETEST ✅ 2026-09-14 00:15）**。三层证据：
  1. 代码结构复核：await 期间回复仅收集到本地 `pendingReplies`，链尾"重读最新 store → 按 id 重定位标注 → 合并追加 → persist"为无 await 的同步原子块（进程内不可能被穿插）；标注消失则不写入。
  2. A 的单测 RA11b（`test/v5-preview-remote-real-analysis.test.mjs:330`）真实命中进程内并发窗口（Promise.all 同 expectedVersion 双 simulate），断言两次写入版本各 +1、回复并存——该测试对旧实现是失败的（判别性成立）。
  3. D 的 HTTP 集成复测（regress_api.py T10，26/26 通过）：并发双发迟到者被入口版本门 409 拒绝（设计行为）、顺序双发第二发如实 no-op（每标注一轮 stub 语义保留），任何排序下无丢写。
  残余说明：analyze 路由并发同标注（不同 requestId）按 CONTRACT §7 依赖候选 staleness 判 MODEL_RESULT_STALE，此路径未在真实模式实证（见未测清单）。

## 其他观察（非缺陷，验收口径）
- `simulateFollowUps` 幂等payload含 expectedVersion（与 attemptCalculation 不一致）：同requestId在版本推进后重放会 REQUEST_MISMATCH。属既有语义，不在本轮缺陷范围，仅记录。
- UI "模拟追问（SIMULATION）"按钮每标注仅一轮是产品语义（确定性stub），不算重复请求缺陷。
