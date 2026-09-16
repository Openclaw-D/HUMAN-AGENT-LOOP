# V7-B STATUS｜模型协作与可恢复编排

Lane: B　Owner: V7/backend/B/**　更新: 2026-09-15（D-9 可信恢复身份轮）
Goal 入口: V7/LONG_RUN_GOALS.md + HEARTBEAT_20260915_0625.md（B 节+共同边界）。GLM-5.3-Flash 最高 thinking；不操作 Codex；不写 site/home/V6/他路；无 commit/push/tag；真实付费 API 0 次；不读真实密钥；合成测试凭据不称生产认证。

## 当前状态：D-9 已修（两候选对称），47/47 全绿，待 A assembly(lg-round) + D 扩展验收

**本轮（0625 心跳指令,D-9）已完成：**
- [x] resume-core 重构：身份与命令校验分离——`validateResumeAccess`（可注入同步 `principalVerifier(credential, ctx)` + 可选 `authorizer`；ctx 带 runId/projectId/action/stepId，验证器可拒绝错项目/越权动作）+ `validateResumeCommand`（须持边界盖章 trustedPrincipal，防绕过）
- [x] **command.actor 字段废弃并忽略**（自声明不构成授权）；身份只来自验证器 verdict；入档 verdict.principalId
- [x] 缺省失败关闭：未注入验证器/缺凭据/错凭据/验证器异常/role≠human → PRINCIPAL_UNTRUSTED；策略拒绝 → AUTHORIZATION_DENIED
- [x] thin 与 LangGraph 对等接入；LangGraph 身份门在包装层执行，凭据**不进图**→Command 载荷只含盖章净化命令，checkpoint 零凭据（测试断言）
- [x] 对称正反例 4 项（npm run test:d9）：无验证器/错凭据/伪造 actor/验证器异常/错项目/错动作 → 全部拒绝且**零外部调用、attempt 不推进、LangGraph 零 checkpoint 写入**；合成可信正例可恢复
- [x] 保留：事实/规则版本门、unknown 不自动重试、requestId 幂等、provide_evidence 重锚——全部不受影响（既有 43 项持续绿）
- [x] HANDOFF-A.md 增补「D-9 可信恢复身份接口」（assembly 必读）；不修改 A/C/D

**前轮交付（持续有效，摘要）：** v0.1 消费适配（principal 注入/负例/D-4 门/凭据零落盘）；thin（建议默认，A assembly b-round PASS）+ LangGraph（HANDOFF-A-LANGGRAPH-v0.1.md 已交）；等价性 7 路径；C 工具接入；回环 HTTP 证据；真实 provider 凭据阻断如实记录。

## 测试与证据

`npm test` = **47 pass / 0 fail**（D-9 版：原 43 + d9 对称正反例 4；D-9 专项 `npm run test:d9`）。输出：evidence/test-run-all-20260915-d9.txt；
依赖与上游文件 hash：evidence/dependency-file-hashes.txt（CONTRACT v0.1 在列）；B 全部源文件 hash：evidence/b-lane-file-hashes.txt。

## 与其他路接口状态

- A：v0.1 已消费；LangGraph 集成说明已交；**D-9 恢复身份接口说明已增补 HANDOFF-A.md（assembly 需注入验证器，建议只走 orch.resume() 公共入口）**；等 lg-round/最终组合固定 hash。
- C：calculation-tool 接入有效；C 已按 v0.1/v0.2 自适配其 lane。
- D：0625 D 节清单（LangGraph 实际候选的 unknown/kill-recover/可信 resume/副作用幂等）——B 修复已就位，D 可开测；含 B 实际依赖的干净目录检查由 D 执行。

## 下一步

1. A：按新 resume 接口适配 assembly（仅改 A 侧）→ 固定最终组合 hash。
2. D：LangGraph 实际候选黑盒验收（不可外推 thin 结果）。
3. 生产身份/授权与真实岗位权限 = 用户确认事项，B 不暗设制度（authorizer 为注入点）。
4. 用户授权真实 provider 凭据后按 REAL_PROVIDER_BLOCKED.md 小流量实测（1 次起）。
5. 心跳接续：每小时读四路 STATUS/diff；新缺陷清单到达即定向修复。
