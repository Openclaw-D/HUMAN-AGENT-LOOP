# V7-B RESULT｜模型协作与可恢复编排（v0.1 + D-9 可信恢复身份轮,2026-09-15）

执行: ZCode（GLM-5.3-Flash · 最高 thinking）。写面仅 `V7/backend/B/**`；A/C/D 与 site/V6/home/**、3607/3467 只读；无 commit/push/tag/worktree；**真实付费模型 API 0 次**；未读取任何密钥；合成测试 principal token 不称生产认证。

## 本轮（0625 心跳）修复与交付：D-9 可信恢复身份

Codex 静态复核确认:validateResumeCommand 仅检查 command.actor.id/role 自声明——未验证身份
可自称 coordinator,不满足原 Goal 的可信 resume。B 修复(两候选对等,全部在 B 写面):

1. **可注入可信验证器**:`principalVerifier(credential, ctx) → {ok, principalId, role}`,
   ctx={runId, projectId, action, stepId};同步;验证器可拒绝错项目/越权动作。缺省未配置=
   失败关闭;authorizer 为可选业务策略注入点(B 不发明真实岗位授权制度)。
2. **command.actor 废弃并忽略**:身份只来自验证器 verdict;入档 verdict.principalId。
3. **失败关闭矩阵(两候选对称,全部拒绝且零外部调用、attempt 不推进)**:无验证器/缺凭据/
   错凭据/验证器异常/role≠human → PRINCIPAL_UNTRUSTED;策略拒绝项目或动作 → AUTHORIZATION_DENIED。
4. **凭据不落盘**:凭据只在 resume 调用边界消费;LangGraph 身份门在包装层执行,Command 载荷
   只含盖章净化命令——checkpoint 内零凭据(测试含目录级扫描断言);thin journal/snapshot 同。
5. **保留门不受影响**:事实/规则版本门(provide_evidence 显式重锚)、unknown 不自动重试、
   requestId 幂等——既有 43 项测试持续绿。
6. **接口说明已提 A**(HANDOFF-A.md「D-9 可信恢复身份接口」):assembly 需注入验证器,
   建议只走 orch.resume() 公共入口;不改 A/C/D 文件。

测试:`npm test` = **47 pass / 0 fail**;D-9 专项 `npm run test:d9`(4 项,两候选各半)。
原始输出: evidence/test-run-all-20260915-d9.txt。

## 前轮（0425 心跳）修复与交付


Codex 独立复跑 `test/a-live-integration.test.mjs` 得 1/2,首例第 90 行正式人工动作被 A v0.1
拒以 403 PRINCIPAL_UNTRUSTED——消费方仍按 v0 准备环境所致。**B 已按新合同修复,未回退 A 安全门**:

1. **合成可信 verifier 注入**:测试经 `startServer({principalTokens:[合成token]})` 注入
   (A 参考实现,仅 sha256 存内存);合法动作经 `sink.submitHumanAction` 显式携
   `principalCredential` → resolved + formalOutcome 顶层投影 + principalId 服务端指纹留痕。
2. **负例齐备(全部 403 失败关闭)**:匿名(无凭据)/错误凭据/**未注入 verifier 的实例**
   (带凭据也拒);run 不因无效凭据进 resolved。
3. **凭据隔离**:token 明文在 B 全部落盘文件(journal/snapshot/回执)扫描零命中(测试断言);
   sink 载荷缓存仅内存;adapter 模型通道凭据注入(getApiKey)与业务凭据物理分离。
4. **D-4 意见状态门**:escalation 后意见落库 409 RUN_ESCALATED 已断言(B sink 语义=SINK_ERROR
   留痕,不伪装成功)。
5. **sink 语义修复(本轮实测发现,反哺幂等纪律)**:403/400 确定性拒绝(A 未写回执)自动逐出
   载荷缓存,修正凭据可复用同 requestId 重试;absorb 单调保护防 replay 历史 runVersion 回退
   (回退会让后续写命令 409)。ICR-4 裁决(维持严格幂等)以此落地。
6. **ICR-1～4 台账关闭**(interface-change-request.md v3):全部按合同 v0.1 裁决适配,无未决请求。
7. **HANDOFF-A-LANGGRAPH-v0.1.md**:LangGraph 候选给 A 的 v0.1 集成说明(工厂/checkpointer/
   恢复与拒绝语义差异/复跑入口);不代写 assembly,不伪称真实 provider 成功。

## 交付声明（对应 LONG_RUN_GOALS §B 逐项,持续有效）

| §B 要求 | 交付 | 验证 |
| --- | --- | --- |
| 业务事件→按需选四域角色→模型与计算工具→补证等待/人工中断→恢复 | `src/graph-def.mjs`（4 事件策略×≤3 步）+ 两候选编排器 | 等价测试 7 路径 |
| LangGraph JS 优先候选 vs 直接薄编排，同一用例 | 两候选共享 graph-def/resume-core/bridge/ports；COMPARE.md 比较与建议 | `test/equivalence.test.mjs` 7/7 |
| 六角色不强制全跑；依赖允许并发；正式前序不得越过 | 策略表按事件选步；Promise.all/超步并发；blocked 显式留痕且不调用 | thin T3、lg L3、等价 dep |
| 接入现有 provider adapter；未发送/失败/发送后未知分别处理 | `src/adapter-bridge.mjs` 映射 V6 七状态；sentFlag=false/null/true 三值；violation→human_violation | `test/adapter-bridge.test.mjs` 12/12 |
| checkpoint 真实落盘；中断重放副作用幂等 | thin: journal.jsonl+snapshot 原子写；lg: 自研 FileCheckpointSaver；回执端口 intent/receipt 两相,重放零外部调用 | thin T7/T8/T12、lg L1/L10/L11 |
| 人工 resume 校验身份/版本,不靠前端按钮 | resume-core 三重校验(身份→授权动作→事实版本),两候选同源;越权/漂移/匿名全部拒绝 | thin T6/T7、lg L5/L6/L7 |
| 可恢复待执行工作不依赖浏览器连接 | 全状态落盘;`recover`/`continueRun` 系统续跑(unknown 必须人工核实) | thin T7、lg L11 |
| 真实 HTTP 接入证据或明确凭据阻断 | 回环 socket 全链路证据 + 凭据阻断记录 + 解除方法 | `test/loopback-http.test.mjs`;evidence/REAL_PROVIDER_BLOCKED.md |
| 资源/维护成本比较 | COMPARE.md(14 维度表+4 条判断;建议 thin 默认、LangGraph 平行基线) | 见 COMPARE.md |
| 代码与依赖交 A 集成;模型意见 authority=none | HANDOFF-A.md;候选白名单+adapter 词表+A 禁用键三层拦截 | A 活集成:opinions.authority='none' |

## 与他路集成（本轮实测）

- **A 合同 v0**：起 A 临时服务(127.0.0.1 随机端口+隔离数据目录)全链路：项目/证据/规则/run→编排→`opinions`(provider/requestReceipt/authority)+`calculation`(C 工具 toolVersion/inputHash)落库→重复同步 replayed 零重复记账→人工 `accept_candidate`→resolved。A run.version 精确 3。
- **C 计算工具**：`calculateCashFlowCoverage` 注入接入；成功路径 toolVersion=`calc:cash-flow-coverage@1`、inputHash 64hex 跨候选/跨运行一致；缺输入 MISSING_INPUT→waiting_evidence(不补造)。
- **D**：其 RESULT 已列"B 入 assembly 后扩展验收"；HANDOFF-A §6 提供干净目录复跑法。

## 测试总量

`npm test`：**43 pass / 0 fail**（thin 11 + langgraph 10 + bridge 12 + 等价 7 + 回环 1 + A 活 2）。
原始输出: `evidence/test-run-all-20260915-v0.1.txt`（v0.1 断言版；首轮版留存 test-run-all-20260915.txt）；依赖锁版: package.json(`@langchain/langgraph` 0.2.62 / `@langchain/core` 0.3.68)。

## 诚实边界（未验证/非本轮）

1. **真实模型 provider 兼容与推理质量 NOT TESTED**（凭据未授权,0 次真实调用;回环 socket 证据仅证传输接线）。
2. 模型输出金融判断正确性不在 B 范围（C 路评估管线+D 反证）。
3. 越权词表/白名单/禁用键均为启发式,非完备护栏;最终防线是人的正式决定权。
4. LangGraph 候选的文件 checkpointer 为 B 自研(~230 行),官方缺位;依赖升级须复核复刻常量(见 COMPARE.md 风险点)。
5. A/C 枚举/引用形状:C 实现侧已于 2026-09-15 对齐(B 边界转换适配并实测);合同文本记录待 A 处理,见 `interface-change-request.md`(ICR-1～4)。
6. C 的 INTERFACES.md v2 已发布并含给 B 的接口点(§2);B 按其源码+INTERFACES 对账(2026-09-15)。

## 恢复/复跑方法

```bash
cd V7/backend/B
npm install && npm test   # 43 项;隔离临时目录;127.0.0.1 随机端口;零真实付费调用
```
单套: `npm run test:thin` / `test:langgraph` / `test:bridge` / `test:equiv`。

## 下一步（心跳接续点）

1. 等 A assembly 发布组合产物(hash 固定)→ 通知 D 第二组合轮；B 按缺陷清单定向修复。
2. A 对 ICR-1～4 裁决 → B 只动边界层适配。
3. 用户授权真实凭据 → REAL_PROVIDER_BLOCKED.md 一条命令小流量实测(1 次起,unknown 不盲重试)。
