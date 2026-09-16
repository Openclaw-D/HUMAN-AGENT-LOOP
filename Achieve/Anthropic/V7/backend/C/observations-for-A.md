# observations-for-A — C 路对 CONTRACT 实现的实测观察（2026-09-15，v4 = v0.2 消费轮更新）

来源：`src/run-contract-integration.mjs` 对运行中的 A 服务（隔离数据目录 + 端口 3622，`--principal-tokens` 合成测试身份）的 20 步真实 HTTP 集成，**20/20 全过**（`evidence/laneC-contract-integration.json`，含 upstream 字段记录 CONTRACT v0.2 与 A/src 三件套 hash）。C 路当前**无未决观察**。

## 已由 A 采纳并经 C 复验闭合

1. **resolved 意见门错误码**（C v3 观察 #4）：CONTRACT v0.2 明确 resolved → 409 `RUN_RESOLVED`（与人工动作终态保护同码），A 实现已改码。C 集成断言已收紧为精确 `RUN_RESOLVED`，复验实测命中（evidence 第 17 步）。**已闭合。**
2. **校验顺序**（C v3 观察 #7）：v0.2 已写入"状态门先于证据引用校验"（升级态上的伪造引用返回状态码而非 400）。C 实测与文本一致。**已闭合。**
3. v0.1 轮采纳项复验通过：evidenceRefs 字符串投影、四值枚举（need_more_evidence）、supersede 新实体语义、state body 形状、formalOutcome/stale 顶层投影。

## 确认性观察（非缺陷，无需动作）

4. REQUEST_MISMATCH 幂等保护正常：同 requestId 异载荷 → 409（重跑必须换 requestId）。
5. 凭据校验与终态保护两道门独立生效：匿名/伪造凭据在 resolved 态同样 403 PRINCIPAL_UNTRUSTED。

## C 路真实通道边界（持续，非 A 事项）

6. 真实 HTTP 模型调用保持阻断：环境 `ZAI_API_KEY` 未获"用途/成本已授权"确认，C 不读取；模型路径全部为注入 SIMULATION 桩（`provider: 'simulation'`）。principal token 为合成测试值（CLI 注入，非生产认证）。
