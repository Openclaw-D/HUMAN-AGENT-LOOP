# interface-change-request｜B 路向 A 的接口请求与裁决台账（2026-09-15，v3·v0.1 后终态）

依 CONTRACT.md 变更规则提交,B 不自行修改合同。**本版为台账:ICR-1～4 已全部获 A 裁决
并落入合同 v0.1**(见 A/RESULT.md:"CONTRACT v0.1:ICR-1/2/3/4——全部明示"),B 已按裁决
完成适配;下文保留原请求摘要与裁决结果,供 D 复核追溯。

## ICR-1｜candidate.recommendedHumanAction 枚举 — ✅ 已裁决并入合同

- 请求:统一四值枚举并明确"省略=无建议"。
- 裁决(v0.1 §2/candidate 字段约定):`accept_candidate/return_for_evidence/take_over/
  need_more_evidence`;**省略该键 = 无建议**(B 的 'none' 哨兵在 B 边界省略即可)。
- B 适配:toACandidate 省略 'none'(已实现);toCCandidate 经 whenNone 投影(C v1.1.0)。

## ICR-2｜candidate.evidenceRefs 形状 — ✅ 已裁决并入合同

- 请求:明确字符串数组约定与结构化引用承载位。
- 裁决(v0.1 §2):`"evidenceId"` 或 `"evidenceId@vN"` 字符串数组(显示引用);
  **结构化有效性引用一律由 `opinion.basedOnEvidence` 承载**;且 D-5 失败关闭——
  basedOnEvidence 须指向同项目存在且版本一致的证据,否则 400。
- B 适配:toACandidate 投影 `id@vN`;sink basedOnEvidence 从 A 读回的真实证据构建
  (a-live-integration 已验证)。

## ICR-3｜runId 生成方 — ✅ 已裁决并入合同

- 裁决(v0.1 §2):runId 服务端生成;外部请求标识经 `requestReceipt` 关联
  (B 编排 runId 与 A runId 是两个标识)。
- B 适配:sink 以 requestReceipt 携带 B 网关请求标识(`orchRunId::model:role:purpose::aN`)。

## ICR-4｜escalate 幂等重放的 expectedVersion 语义 — ✅ 已裁决:维持严格幂等

- 裁决:escalate **维持**"同 requestId 必须同载荷(含 expectedVersion)才 replay"。
- B 适配:sink 缓存每个 requestId 的原始载荷重发(满足严格幂等);replay 响应携带历史
  runVersion,sink absorb 加**单调保护**防版本回退(本轮实测发现并修复:回退会导致后续
  写命令 409 VERSION_CONFLICT);403/400 确定性拒绝(A 未写回执)自动逐出缓存,允许修正后
  重试(如换上合法 principalCredential)复用同一 requestId;409/网络错误保持缓存,由调用方
  显式决策;缓存丢失=换新 requestId(升级语义重复留痕,可审计)。

## v0.1 新增消费点(B 已适配)

- **D-6 可信 principal**:正式人工动作必须携带 `principalCredential`,经服务构造注入的
  同步 `principalVerifier` 验证;未注入=默认失败关闭 403 PRINCIPAL_UNTRUSTED。
  B 适配:`sink.submitHumanAction`(凭据显式传入,仅内存载荷缓存,零落盘——测试含
  token 零落盘扫描断言);负例(匿名/错凭据/无身份源实例)全部 403 失败关闭。
- **D-4 意见状态门**:escalation 期间意见落库 409 RUN_ESCALATED(B sink 语义=SINK_ERROR
  留痕,不伪装成功;a-live 测试已断言)。
- **D-3 resolved 终态**:重处理=以当前项目事实新建运行(B 编排新 runId,无业务重开)。

## 无新增未决请求

v0.1 下 B 无阻塞项。若 A 后续引入异步身份源(v0.1 后升级项)或 site 接线 diff proposal
获批,B 届时按新合同版本对账。
