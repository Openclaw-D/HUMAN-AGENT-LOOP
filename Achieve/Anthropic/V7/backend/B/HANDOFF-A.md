# HANDOFF-A｜B 路交付给 A assembly 的集成输入（2026-09-15,对照合同 v0.1）

读者:A 路(assembly 组合)与 D 路(黑盒验收)。B 只写 V7/backend/B/**,本文件是交接说明,不是合同。
**v0.1 增量**:正式人工动作需 `principalCredential`(D-6 失败关闭)→ 用 `sink.submitHumanAction`
(凭据显式传入,仅内存缓存,零落盘);意见状态门(D-4)/引用失败关闭(D-5)/resolved 终态(D-3)已在
sink 与测试适配;LangGraph 候选的专门集成说明见 `HANDOFF-A-LANGGRAPH-v0.1.md`。

## ★ D-9 可信恢复身份接口（0625 心跳,两候选同等;assembly 必读）

两个编排器的 `resume(runId, command)` 现在要求**注入验证器**,缺省完全失败关闭:

```js
const orch = createThinOrchestrator({ /* ...原有参数... */,
  principalVerifier,  // 必配(否则所有 resume 拒绝): (credential, ctx) => {ok, principalId, role}
                      // ctx = {runId, projectId, action, stepId};同步;role 必须 'human'
  authorizer,         // 可选业务策略: (verdict, ctx) => {ok:true}|{ok:false, reasonZh}
});
// 恢复命令:{principalCredential, action, stepId?, payload?}
// ⚠️ command.actor 字段已废弃且被忽略(自声明不构成授权);身份只来自验证器 verdict。
// 拒绝码:PRINCIPAL_UNTRUSTED(身份失败,含未配置验证器)/AUTHORIZATION_DENIED(策略拒绝)。
// 凭据只在 resume 调用体内消费:不落 journal/checkpoint/日志;入档的是 verdict.principalId。
```

LangGraph 候选的额外保证:身份门在编排器包装层执行,**凭据不进入图**——Command(resume)
载荷只含盖章后的 `{gateStamp:{principalId,role}, action, stepId, payload}`,checkpoint 内
无凭据(测试含 checkpoint 目录零命中断言)。A assembly 如需在组合层直接调用图的
app.invoke(绕过包装层),必须自行先做同等身份门;建议只走 `orch.resume()` 公共入口。
D-9 对称正反例与零落盘断言:`npm run test:d9`(4 项,thin/LangGraph 各半)。

## 1. 交付物清单(全部在 V7/backend/B/**,hash 见 evidence/b-lane-file-hashes.txt)

| 文件 | 作用 | A 集成方式 |
| --- | --- | --- |
| `src/graph-def.mjs` | 冻结用例:事件→角色策略表/依赖 DAG/就绪判定/终态裁决/候选汇总(纯函数) | 直用(单测已覆盖) |
| `src/resume-core.mjs` | 人工 resume 三重校验+效果计算(两候选共用,纯函数) | 直用 |
| `src/codes.mjs` | B 协议常量(运行/步状态、人工动作、候选白名单) | 对账参考 |
| `src/adapter-bridge.mjs` | V6 七状态→编排步结果;候选白名单;A/C 边界转换 | 直用 |
| `src/thin/orchestrator.mjs` | **候选1(建议默认)**:零依赖 journal 编排器 | `createThinOrchestrator({ports, adapter, dataDir, sinks})` |
| `src/langgraph/orchestrator.mjs` + `file-checkpointer.mjs` | 候选2(平行比较基线) | `createLangGraphOrchestrator({ports, adapter, checkpointer, sinks})` |
| `src/ports.mjs` | factStore/receipts/tools 端口 + B 本地文件实现(**仅隔离实验用,不是产品事实源**) | 端口接口对合同;实现替换为 A service 直连/HTTP |
| `src/a-sync.mjs` | A 合同 v0 HTTP 客户端 + `createARunSink`(意见/计算/升级落库,幂等重放缓存) | assembly 组合点 |
| `src/c-tools.mjs` | C 计算工具适配(注入 C 模块) | assembly 注入 `../../C/src/calculation-tool.mjs` |
| `test/*.test.mjs` ×6 | 43 项测试(thin 11 / langgraph 10 / bridge 12 / 等价 7 / 回环 1 / A 活集成 2) | `npm test`(npm install 后) |

## 2. 集成形状(建议)

```js
import { createThinOrchestrator } from '../../B/src/thin/orchestrator.mjs';
import { createARunSink } from '../../B/src/a-sync.mjs';
import { createAClient } from '../../B/src/a-sync.mjs';
import { createCToolsAdapter } from '../../B/src/c-tools.mjs';
import { calculateCashFlowCoverage } from '../../C/src/calculation-tool.mjs';

const aClient = createAClient({ baseUrl: 'http://127.0.0.1:3601' }); // 或 assembly 直连 service
const sink = createARunSink({ aClient, aRunId }); // A run 由 assembly 先创建
const orch = createThinOrchestrator({
  ports: { factStore: /* A 事实源适配(参照 a-live-integration.test.mjs 的 HTTP 适配) */,
           receipts: /* A 幂等表或 B 本地文件 */, tools: createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } }) },
  adapter: /* V6 adapter(真实 transport 凭据注入由用户授权后提供) */,
  dataDir: 'B 编排 journal 目录(可恢复,非事实源)',
  sinks: [sink],
});
const view = await orch.start({ runId, projectId, eventType, evidenceRefs, toolInputs });
```

A 活集成可复跑样例:`test/a-live-integration.test.mjs`(起 A 临时实例→项目/证据/规则/run→
编排→意见+计算落库→人工 accept→resolved)。

## 3. B 对 A 合同的消费点(已验证)

- `POST /runs/:id/opinions`:provider=real_http|simulation;`requestReceipt`=B 网关请求
  标识(`orchRunId::model:role:purpose::a{attempt}`);candidate 经 `toACandidate` 转换
  (数组→字符串;'none' 省略以兼容 A 枚举);`basedOnEvidence` 来自编排证据引用。
- `POST /runs/:id/calculation`:toolVersion/inputHash 来自 C 工具真实输出。
- `POST /runs/:id/state`:B 的 waiting_evidence→human_required;unknown/failed 原样;
  **completed 不发 state**(留 candidate_ready,正式决定必须走 human-actions)。
- 幂等:B 的每个落库 requestId 确定性生成;同 requestId 重放**重发原始载荷**(缓存于
  sink 内存)以满足"同 requestId 同载荷才 replay"(第一次集成实测 409 后修正)。
- expectedVersion:sink 内缓存 run.version 并随响应推进;冲突上抛不自动重试。

## 4. B 对 C 交付的消费点

- `calculateCashFlowCoverage`(C/src/calculation-tool.mjs,hash d9e9fdb1…):
  输入 `{value, caliber, source:{evidenceId,version}}` 对 + currency(+periodMonths);
  ok→步 succeeded(output 含 ratio/unit/formulaVersion/inputHash);
  MISSING_INPUT/MISSING_CALIBER/INVALID_CURRENCY/NONPOSITIVE_DEBT_SERVICE/INVALID_PERIOD
  → 步 **waiting_evidence**(缺输入不补造,升级人工);未知工具→failed。
- C 的 `HUMAN_ACTION_ENUM` 与 A 的 `RECOMMENDED_ACTIONS` 存在枚举分歧(见
  `interface-change-request.md`),B 以边界转换兼容,不动双方原件。
- C 的 INTERFACES.md 未发布;B 按 C 源码对账(2026-09-15),C 发布后请 D 复核差异。

## 5. 已知边界(接入前须知)

1. 模型意见 `authority=none` 结构强制:adapter §4 越权词表 + B 白名单 + A 服务端禁用键,
   三层独立拦截;均非完备(启发式),最终防线是人。
2. 真实 provider 凭据未授权:B 不读取/检测密钥;回环 socket 证据≠真实 provider 兼容
   (evidence/REAL_PROVIDER_BLOCKED.md,含解除阻断的一条命令验证法)。
3. B 的 receipts/factStore 本地文件实现只用于 B 隔离实验;接入 A 后事实源唯一=A。
4. LangGraph 候选依赖 34 包(@langchain/langgraph 0.2.62 锁版);thin 零依赖。
   选型比较与建议见 COMPARE.md(thin 为默认候选的建议,由 A/用户裁决)。
5. 端口签名与 A 合同字段的对账矩阵:见 `src/ports.mjs` 头注;差异走
   `interface-change-request.md`,B 不改合同。

## 6. 复跑方法(干净目录)

```bash
cd V7/backend/B
npm install        # 锁版安装(package-lock.json)
npm test           # 43 项全绿;零真实付费调用;A 活集成自动起 127.0.0.1 随机端口临时实例
```
