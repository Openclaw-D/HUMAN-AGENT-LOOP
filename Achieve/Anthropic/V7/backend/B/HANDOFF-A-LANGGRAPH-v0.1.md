# HANDOFF-A-LANGGRAPH-v0.1｜LangGraph 候选的 assembly 集成说明与复跑入口（2026-09-15）

读者:A 路 assembly。本文件是 B 范围内的交接说明;**B 不代写 assembly**。thin 候选已由
A assembly b-round 接线 PASS(`A/assembly/defects-to-B.md` 的 DEFECT-B1 修复后);
本文给 **LangGraph 候选**(对比验证用)同等的接线信息。当前对照合同 v0.1。

## 1. 与 thin 候选的差异(assembly 需要知道的全部)

| 维度 | thin(已接线) | LangGraph 候选 |
| --- | --- | --- |
| 工厂 | `createThinOrchestrator({ports, adapter, dataDir, sinks})` | `createLangGraphOrchestrator({ports, adapter, dataDir, checkpointer, sinks})` |
| 持久化 | journal.jsonl+snapshot(自包含) | **必须注入 checkpointer**:`new FileCheckpointSaver(<dir>)`(B 自研,真实落盘;目录按 thread 隔离) |
| 启动 | `start(input)` | `start(input)`(同签名;intake 幂等,重复 start 不重建) |
| 崩溃恢复 | `recover(id)` / `continueRun(id)` | `recover(id)`(投影)/ `continueRun(id)`(invoke(null) 重跑未完成节点) |
| 人工 resume | `resume(id, cmd)` 抛错表达拒绝 | `resume(id, cmd)` 经 `Command({resume})`;**拒绝不抛异常**,再次 interrupt,`view().pauseNotice` 承载拒绝原因 |
| 人工动作落库 | sinks 同 thin | 同 thin(sink 语义完全一致,含 v0.1 `submitHumanAction` principalCredential) |
| 运行时依赖 | 0 | @langchain/langgraph 0.2.62 + @langchain/core 0.3.68(锁版,见 B/package.json) |
| 业务语义 | — | **零差异**(同一 graph-def/resume-core/bridge/ports;等价测试 7 路径断言终态/步状态/authority/inputHash 一致) |

## 2. assembly 最小接线(示意,最终以 A 的单 writer 实现为准)

```js
import { createLangGraphOrchestrator } from '../../B/src/langgraph/orchestrator.mjs';
import { FileCheckpointSaver } from '../../B/src/langgraph/file-checkpointer.mjs';
// ports/aClient/sink 与 thin 完全相同(见 HANDOFF-A.md §2)

const lg = createLangGraphOrchestrator({
  ports: { factStore, receipts, tools },          // 与 thin 同一端口
  adapter,                                        // 与 thin 同一 adapter(V6 契约 v1)
  dataDir: '<lg 运行目录>',
  checkpointer: new FileCheckpointSaver('<lg-checkpoint 目录>'), // 真实落盘,重启可恢复
  sinks: [sink],
});
const view = await lg.start({ runId, projectId, eventType, evidenceRefs, toolInputs });
// 人工门:await lg.resume(runId, {actor, action, stepId?, payload?});
// 拒绝见 view.pauseNotice;凭据经 sink.submitHumanAction(显式传入,不落盘)。
```

**principal 边界(v0.1 D-6)对两候选同等**:编排层 resume 的身份/动作/版本校验在
`resume-core`(B 本地,授权角色表);A 侧正式动作凭据经 `sink.submitHumanAction` 显式
传入——合成测试 token 不是生产认证,部署无可信身份源时正式动作保持阻断(能力边界)。

## 3. 可复跑入口(assembly 对比验证用)

```bash
cd V7/backend/B
npm install                       # 锁版安装(仅 LangGraph 候选需要)
npm run test:langgraph            # LangGraph 恢复矩阵 10 项(checkpoint 落盘断言在内)
npm run test:equiv                # 等价性 7 路径(thin vs LangGraph 终态/步状态一致)
npm run test:bridge               # 桥接/边界转换 12 项(两候选共用)
npm test                          # 全套 43 项(v0.1 A 活集成含 principal 负例)
```

assembly 侧对比建议(供 A 参考,非 B 交付):同一事件输入分别经 thin 与 LangGraph
编排、同一 sink 落同一 A 服务(隔离数据目录),断言 A run 内 opinions/calculation/
state 投影一致——B 的等价测试已在 B 侧覆盖同断言(不含 A 落库环节)。

## 4. 已知边界(不伪称)

1. 真实模型 provider 仍未授权:两候选全部经 scripted/回环 transport 验证,0 次真实付费调用。
2. LangGraph 文件 checkpointer 为 B 自研(~230 行,镜像 MemorySaver 语义);依赖升级须复核
   复刻常量(详见 COMPARE.md 风险点)。
3. 节点名注册时 ':' 需转义(B 已在 orchestrator 内处理,assembly 无感)。
4. 人工 resume 拒绝语义差异(异常 vs pauseNotice)是两候选唯一可观测行为差异,已在
   测试与 COMPARE.md 记录;D 验收时按各自语义断言。
