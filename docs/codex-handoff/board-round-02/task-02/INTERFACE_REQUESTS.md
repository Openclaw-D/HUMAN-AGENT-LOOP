# 任务02 · 接口请求（board-round-02）

登记人：任务02（处理链）。日期：2026-09-19。本路只在本文件提请求；共接口以 Back/CONTRACT.md 为准。
状态标记：OPEN（待对方确认）/ CLOSED。历史轮记录见 docs/v02-remediation/task-02/（IR-04-2A..D、
IR-T01-3 及 owner 回应延续有效，其中 IR-04-2A-3 本轮完全闭合，见 §三）。

---

## IR-02-4A（高·阻塞装配）delivery 配置缺 A 上传凭据 → 任务将进入 A_UPLOAD_PRINCIPAL_MISSING

`Connectors/.run/config.delivery.json`（04 路 delivery-up 生成）的 `a.credentials` 目前只有
`service` / `registrar`。方案 R 下材料登记以**上传者身份**（客户上传恒 unverified）落 A，
凭据映射缺失时任务进入可恢复等待态 `blocked_a_unavailable`（failure_code=
`A_UPLOAD_PRINCIPAL_MISSING`），**不会**再像旧代码那样静默 skip 推进。

请求 04：在 delivery-up 生成/校验中为 `a.credentials` 补 `uploadFallback`（A 侧客户角色
principal token，须出现在 A principalTokens），可选 `upload: {customer_owner, customer_finance}`。
配置补齐后等待态任务由 sweep 自动重入，无需人工干预。

## IR-02-4B（高·语义变更告知）no_customer_link 静默跳过已废除；done≠无 A 登记

新语义（已测试钉住）：
- 缺映射 → `blocked_link`（failure_code=`A_CUSTOMER_NOT_IN_A|A_TENANT_MISMATCH|A_UNREACHABLE`）；
  同 ID 客户存在于 A → 自动权威核验接通（零配置，无需种子）。
- `status='done'` 恒 `aRegistered=true`；`bridgeState ∈ registered|unknown|failed|none`。
  显式 localOnly 部署的 done 仅为本地完成（bridgeState=none），页面不得渲染为全链完成。
- 旧 JOURNEY_RECORD 步骤5（done + A 登记 skipped(no_customer_link)）在新代码不可达；
  请求 04 复跑页面旅程：blocked_* 请原样透出 failure_code 与 note（与既有 IR 反向请求一致）。

## IR-02-4C（冻结确认）actor 可信来源 = token→调用方绑定（IR-04-2A-3 闭合）

实现与语义：
- `callerBindings: [{token, caller, mayDelegateActor}]`（运行配置透传；未配置时默认把唯一
  serviceToken 绑定为 edge-gateway、可代理）。每个绑定令牌都是独立服务间凭据，均可过服务令牌门。
- 人类动作路由（verify / manual-entry / correct-fact / questions-answer / questions-verify /
  pause / customers/link）：网关绑定令牌可代理页面会话 actor（actorSource=gateway_delegated，
  页面身份裁决仍归 Edge channel-authz）；非代理调用方自报人类 actor → 403 `ACTOR_NOT_DELEGABLE`；
  未自报 → 以 `svc:<caller>` 服务身份执行（审计可查）；显式绑定下未绑定令牌在门即拒
  （PRINCIPAL_UNTRUSTED）。
- **不引入任何仅凭存在性即信任的新 header**；若 04 后续提出带 MAC 的调用上下文头规范，
  Connectors 配合加验签（OPEN，非阻塞）。
- Edge 侧无需改动即可继续工作（共享 serviceToken=默认网关绑定）；如需为内部自动化发独立令牌，
  在 callerBindings 中显式登记即可获得 fail-closed 保护。

## IR-02-4D（中）人工动作资源归属收紧，Edge 透传错误码

manual-entry 现校验材料归属客户、correct-fact 现校验被更正事实归属客户（不一致 → 403
`CUSTOMER_MISMATCH`，零副作用）。Edge 通道透传请不吞此码（与 upload/preview 同款语义）。

---

## IR-02-3A（对 03 · 请确认）

1. **CSV 声明表解析 v2**（Back/C adapters，属本路所有权改动）：首行 key/value[/unit/caliber]
   表头按列提取，declared 事实携带行级 unit/caliber；值列不再吞并单位列。C 套件 101/101 通过。
   请确认 A/C 消费面（parse_results / declaredFacts）无依赖旧"整段字符串值"行为的断言。
2. **Gate 严重度消费确认**：冻结规则包 v1.0.0 中 SIM-CASH-COVERAGE-STRESSED-01 为
   nonWaivable=false → 命中产生 RULE_HIT_REVIEW=**HOLD_FOR_REVIEW**（人工复核），非 HARD_BLOCK。
   页面/业务面（01）应把该门呈现为"待人工复核"。本路测试已按此修正期望，未改制度阈值。
3. **错误结构对齐**：通道回执面 `GET /processing/receipts/:requestId` 只读 a_links
   （status ∈ registered|unknown|failed）；A 动作回执仍在 A 侧 `/receipts/:requestId`。
   处理任务详情 `aOps` 暴露 entity_type=material|derived|run|gate|finding|domain_result 与
   request_id——与 A 权威工件/run/Gate 回执投影的对账即 link-chain 全链测试（真实 A 内核），
   若 03 的投影字段与上述不一致请在本路 IR 提出。

## IR-02-1A（对 01 · 业务状态映射，替代内部阶段词）

页面/看板只需呈现以下少量业务状态（由 `processing/status` + 任务字段推导，不暴露 stage_cursor）：

| 页面状态 | 判定 |
|---|---|
| 处理中 | status ∈ queued/running |
| 已登记待复核 | status=done 且 aRegistered=true |
| 待补件/待回答 | status=needs_followup 或存在待答问题 |
| 重复材料已忽略 | status=skipped_duplicate |
| 客户档案待关联 | status=blocked_link（透出 note，运营经 /customers/link 受控登记后自动续跑） |
| 登记服务暂不可用 | status=blocked_a_unavailable（自动恢复中，无需用户操作） |
| 登记结果确认中 | status=blocked_unknown（对账后自动续跑） |
| 仅本地完成（特殊部署） | status=done 且 bridgeState=none（localOnly 显式声明时） |
| 处理失败 | status=failed（附 failure_code/note） |
