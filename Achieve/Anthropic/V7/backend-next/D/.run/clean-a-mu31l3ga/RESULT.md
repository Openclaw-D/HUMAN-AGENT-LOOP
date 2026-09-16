# A 路 RESULT — 2026-09-16 夜间（截至 02:45 检查点，继续值守至 07:00）

任务：`V7/NIGHT_BACKEND_20260916.md` §A。唯一写面 `V7/backend-next/A/**` + 共享 `CONTRACT.md`。

## 结论（真实状态，不虚报）

**A 路合同目标全部达成，且 C 路组合提前完成**：目标协作内核（PostgreSQL 事务存储 + 真实 HTTP API + outbox + 租约 fencing + 可信鉴权 + 人工介入）已实现、已在真实本机 PostgreSQL 上通过 **21/21 集成测试**（含 SIGKILL 崩溃恢复与 PG 容器整机重启）与 **10/10 步 E2E 组合**；C 路两个模板（商业融资租赁 v1 + 非租赁反例）与 **8 份案例计划全部在 A 内核执行通过**，并完成 L1 目标的 claim→complete→accept 闭环。共享契约 **v1.2 FROZEN** 已发布。GLM-5.2 保持 0 真实调用。

## 交付清单（全部有落盘证据）

| 交付 | 位置 | 证据 |
|---|---|---|
| 共享契约 v1.2 FROZEN | `../CONTRACT.md` | manifest 内 sha256 |
| 迁移 SQL（10 业务表+幂等+投递簿） | `migrations/001_init.sql` | 已应用于 `v7next_a` |
| 内核源码（TS，~2000 行，运行时唯一依赖 `pg`） | `src/`（domain/db/http/outbox） | typecheck 干净 |
| HTTP API（契约 §4 全部 25 个端点） | `src/http/server.ts` | 测试黑盒覆盖 |
| CLI 人工介入客户端 | `scripts/goal-client.mjs` | E2E S7 实用通过 |
| 标准启动入口（48080+dispatcher+10 principal） | `scripts/start-kernel.mjs` | 当前 48080 常驻运行中 |
| 集成测试 22 用例（5 文件，串行） | `test/` | `evidence/test-run-final.log`：22 pass / 0 fail |
| E2E 组合（4 目标/2 角色/2 独立客户端+非租赁小模板） | `assembly/e2e-compose.mjs` | `evidence/e2e-result-final.json`：10/10 |
| C 路组合（2 模板+8 计划+L1 闭环） | `assembly/run-c-plans.mjs` | `evidence/c-plans-result-final.json`：全过 |
| 交付 manifest（传递源 35 文件+lockfile，D-11 教训） | `assembly/manifest.json` | `evidence/manifest-final.json` |
| 干净目录启动自验（D-29 预验证） | `scripts/verify-clean-start.mjs` | `evidence/clean-start-verify.log`：PASS |
| README（启动/停止/恢复/凭据表） | `README.md` | — |

## 核心机制验证（对应任务书逐条）

1. **PostgreSQL 持久化 HTTP API** ✅：模板/项目/目标/证据/取代/领取/完成/失败/人工待办/回应/验收/决定/暂停/接管/恢复/项目暂停。业务写+outbox+audit+幂等表**同事务**；行锁串行化并发。
2. **执行成功≠候选就绪≠验收通过≠正式决定** ✅：complete→candidate_ready；accept 仅人类验收角色且执行者≠验收者（测试断言 403）；decide 仅决定角色且仅 accepted 可决定；decided 终态 409 TERMINAL_STATE。
3. **幂等与载荷一致性** ✅：同 requestId 同载荷重放 `replayed:true`；异载荷 409 REQUEST_MISMATCH；回执查询可用。
4. **租约/fencing** ✅：过期租约写回 LEASE_EXPIRED；旧 token 写回 STALE_FENCING_TOKEN（零写入）；takeover 强制 token+1 fence 旧 worker；**过期租约可重领**（恢复语义）；门序=终态→fencing→状态→版本（B 可确定性区分"未执行"与"已变更"）。
5. **失效映射** ✅：取代→直接引用目标 invalidated→自动重绑新证据回 ready；下游沿依赖边级联 invalidated；accepted 只置 stale 投影；decided 审计留痕不改写；**无关项目逐字节不变（测试对比断言）**；历史证据永不删除（supersededBy 链）；模板查环 400 DEPENDENCY_CYCLE。
6. **outbox 至少一次** ✅：同事务插入；pull 通道+订阅推送独立投递簿；失败重投直到 2xx；同 eventId 重投载荷逐字节一致（消费方幂等依据）；不宣称 exactly-once（契约明示）。
7. **可信鉴权** ✅：可注入异步验证器；未配置=敏感写失败关闭；**验证器异常注入（--faulty-verifier）后 403 且响应体不含凭据/异常文本**（旧 D-10 教训）；审计只记 principalId。
8. **人工介入** ✅：人工待办挂起目标 waiting_human 期间**无关目标照常领取执行**（测试+E2E S5）；补证+回应后重算恢复；重启后待办/租约/任务/回执全部还在（同库重启测试）。
9. **崩溃与 DB 重启** ✅：SIGKILL 内核后同库重启，已提交数据完整、无半事务状态（leased 目标必有 claimed 回执的一致性断言）；**PG 容器整机重启后数据完好、内核连接池自动恢复**。此测试抓到并修复一个真实缺陷：pg Pool 空闲连接 error 事件未处理导致进程在 DB 重启时崩溃（pool.on('error') 已加）。
10. **同事务性（D-09）** ✅：任意失败命令（禁用键/版本冲突/404/越权）后 outbox/audit/业务行计数逐项不变（零孤儿写入断言）；成功命令事件可见。
11. **模型边界** ✅：real_http 结果 409 MODEL_NOT_CONFIGURED；health 恒显 not_configured；0 真实调用。
12. **上下文限额** ✅：result.output >64KB → 400（带限额提示），正常载荷不受影响。
13. **行业无关** ✅：A 参考模板（立项评估泛化流程）+ C 非租赁反例模板（维保服务采购，无租赁概念）在同一内核跑通；C 主模板 9 目标/6 角色配置化落库。

## 与其他路的交接状态（如实）

- **C**：已组合 ✅（见上）。C 自有 `run-contract-integration.mjs` 轮询 48080——常驻实例已就绪，凭据表见 README（若 C 脚本使用自定义凭据，其敏感写会被失败关闭拒绝，属预期行为；C 可改用 tok-business 或向 A 提接口请求）。
- **B**：接口就绪，接线进行中。B 已发布 `interface-change-request.md`（4 条观察，~02:40），**A 全部采纳并升 CONTRACT v1.1**：OBS-1 listHumanRequests 蛇形列名（实现缺陷已修+回归断言）；OBS-2 goal 投影补 projectId（加法字段）；OBS-3 requestedRole 必填写入契约 §4；OBS-4 无续租端点确认为设计（契约 §3.4 澄清：B 软超时应 < A lease TTL）。B 的 worker 与 `run-a-integration.mjs`（02:24 仍在迭代）就绪后对 48080 直接可用。
- **D**：可开测。入口 `README.md`；契约版本 v1.2；manifest 覆盖传递源+lockfile（sha256 可复算防漂移）。D 矩阵中"杀 worker 恢复"对应 A 侧=过期租约重领+STALE_FENCING_TOKEN（已测）；B worker 进程级恢复属 B 域。

## 未完成门（不掩盖）

1. **B worker 实际接线未发生**——A 只能证明消费面就绪，不能代替 B 的 LangGraph 执行器验证。
2. **真实模型通道未测**——GLM-5.2 按任务书 0 调用；transport 仅为接口预留，真实 endpoint/model/费用上限等用户后续授权。
3. **生产权限体系未接**——当前 principal 为合成 token 目录（明确合成、sha256 存储），非真实账户体系。
4. **第二机器/跨机恢复未测**——本机单实例；PG 容器跨机迁移路径未验证。
5. ** Dispatcher 为单进程轮询**——无分布式投递保障（至少一次语义内），多 dispatcher 并发去重未做（契约未承诺）。
6. 07:00 前继续值守：响应 B/C 的接入请求与缺陷报告，持续修复验证。

## 已修复的真实缺陷（过程坑，全记录于 STATUS.md）

`--lease-seconds` 未接线、过期租约卡 leased 不可重领、complete 门序掩盖 fencing 信号、respond 证据校验 SELECT 漏列、API 投影蛇形列名泄漏、证据投影缺 content、幂等表并发插竞态处理、**pg Pool idle error 未处理致 DB 重启时内核崩溃（测试抓到）**、测试套件文件级并行与 docker restart 互扰（改串行）、E2E 脚本版本硬编码。
