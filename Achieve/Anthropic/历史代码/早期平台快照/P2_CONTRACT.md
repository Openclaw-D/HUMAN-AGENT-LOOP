# 见微 P2 产品与交付契约

状态：`SUPERSEDED HISTORICAL CANDIDATE / NO IMPLEMENTATION AUTHORIZATION`  
日期：2026-08-27  
权威范围：本文件只约束独立的 `runtime/p2`、`prototype/p2-frontend`、`integration/p2`。P1 保留为候选资产与回归证据，不再决定 P2 产品结构。

> 2026-08-28 控制说明：本文件中的旧“AI 项目共创 / 通用 CollaborationCase”方向已被最新产品发现和融资租赁后端 B1 冻结取代。当前权威入口为 `P2_PRODUCT_DISCOVERY.md` 与 `P2_BACKEND_PRODUCT_FREEZE.md`；本文件只作历史候选，不得据此启动实现。

## 0. 领导体检版

一句话：**见微是一套以“协同事项”为中心的 Human–AI Continuity Runtime，让 GPT、GLM、具名人员和既有系统在同一事实链上接力，人工保有最终决策权。**

第一演示：业务人员提出“客户经理拜访助手”需求；GPT 与 GLM 基于同一压缩上下文独立研判；系统显式呈现分歧与缺口；任务携带完整接力包转给数据/安全负责人；人工决定后 Agent 从新状态继续，不重开对话；外部动作只有收到回执才算成功。

主屏只回答五件事：

1. 目标是否冻结；
2. 事实是否有来源；
3. GPT 与 GLM 在哪里不同；
4. 下一棒是谁、谁有权决定；
5. 外部结果是否已被回执证明。

## 1. P2 转向

### 保留

- 三个已认可视图：`关系`、`推进`、`责任`；
- append-only Event、Event-only replay、幂等、版本冲突零写入；
- Human Gate、ActionIntent 与 Receipt 分离；
- 关系图可拖拽、画布可平移缩放；
- 本地零依赖 Node.js + SQLite 路线。

### 停止继承

- 十场景同时做深；
- Dashboard 式全量信息常显；
- 右侧常驻高密度聊天流；
- “Agent 越多越先进”的叙事；
- 没有真实证据的客户、生产、效率或 ROI 成果声明。

### 新的竞争焦点

| 评委追问 | P2 的可见答案 |
| --- | --- |
| 你到底解决什么？ | AI 能产出，但组织无法低损耗接力并承担责任。 |
| 为什么不是普通聊天/工作流？ | 同一协同事项包含目标版本、共享事实、分歧、权限、接力、回执和事件链。 |
| 为什么需要两个模型？ | 只在独立判断有价值时并行；分歧是待处理对象，不伪装成共识。 |
| 人的独特位置？ | Human 是可路由、具权限、可接收接力、对决定负责的一等节点。 |
| 如何接入企业？ | 模型与 connector 都走 Adapter；核心运行时不绑定供应商或行业。 |
| 如何防止幻觉和越权？ | 候选产物不改权威状态；来源缺口常显；只有具名 Human Gate 可批准高影响动作。 |
| 如何证明不是概念？ | 本地 API、SQLite 事件链、双模型 Adapter、负向权限测试、重启重放和浏览器实测。 |

## 2. 本期范围

### 主场景：AI 项目共创

固定闭环：

`需求冻结 → 上下文压缩 → GPT/GLM 独立研判 → Decision Diff → 具名人工接力 → Human Gate → Agent 续跑 → ActionIntent → Receipt → 复盘`

参与者最小集：

- 业务负责人：事项 owner；
- AI 架构师：接收技术方案接力；
- 数据安全负责人：批准数据边界；
- GPT：独立候选，`authority=propose`；
- GLM：独立候选，`authority=propose`；
- CRM Adapter：只返回真实、失败或 unknown 回执；
- Harness：路由与状态控制，不替人作业务决定。

### 证明场景：业务风险联审

使用同一对象、命令、权限和 UI，只替换场景包。用来证明核心不是“AI 项目管理专用页面”。P2 不继续扩展第三个场景。

### 明确排除

- 企业级 SSO、TLS、生产部署、高可用与多租户计费；
- OA、Agent 市场、组织知识图谱、通用流程设计器；
- 自动执行真实 CRM 写入；
- 声称客户或生产验证；
- 为展示而引入微服务、消息队列或新增 npm 依赖。

## 3. 核心对象与权威边界

唯一根对象为 `CollaborationCase`：

```text
Identity        workspaceId + caseId
Goal            text + goalVersion
ContextPack     snapshotId + facts + gaps + conflicts + sourceRefs + tokenBudget
Actor           human | model | system | connector
ModelRun        requested → running → completed | failed | unknown
Candidate       proposal only; never authoritative
DecisionDiff    convergence + disagreements + unresolved
HandoffPackage  goalVersion + facts + gaps + decisionNeeded + constraints + sourceRefs
HumanGate       named decider + basis + impact + decision
ActionIntent    intended external effect; not success
Receipt         succeeded | failed | unknown
Event           immutable, hash-chained source of truth
Projection      rebuilt only by replaying Events
```

不可破坏的规则：

1. Model 的 authority 只能是 `none` 或 `propose`。
2. 普通消息不创建 ModelRun，不改变 Goal、Gate、owner 或外部状态。
3. Candidate 没有来源时必须暴露缺口，不能自动成为事实。
4. 只有被点名的 Human 接受 Handoff 后，owner 才转移。
5. Gate 只能由具备对应 authority 的具名 Human 决定。
6. 目标版本变化会使旧 Candidate、Handoff 与 Gate 失效。
7. ActionIntent 不能推断成功；无可核验结果时 Receipt=`unknown`。
8. 版本、身份、权限、状态、Schema 或幂等冲突失败时零业务 Event 写入。
9. Event 表与成功幂等收据只追加，禁止 update/delete。
10. 删除 Projection 后必须能由 Event 完整重建；服务重启前后结果一致。
11. API key 只从环境读取，不进入事件、日志、响应、样例或截图。
12. `demo` 与 `live` 模式始终常显；缺 key 不得静默回退到 demo。

## 4. 三页信息架构

共同外壳：一屏完成，不允许页面级滚动。

- 顶部：弱品牌、事项选择、三视图、`demo/live`、证据链状态；
- 体征条：最多五项，18px 级可读文本；
- 主画布：只保留当前结论；
- 行动台：只保留“下一棒、决定权、一个主操作”；
- 详情抽屉：ContextPack、模型候选、Decision Diff、Handoff、Event chain 等低频内容。

### 关系

- 中心是当前协同事项，不是模型；
- 节点只显示名字、角色、状态；
- 线表达上下文、接力、权限或系统回执；
- 节点可拖拽，空白画布可平移，滚轮可缩放；
- 点击节点打开详情，不在节点内堆字。

### 推进

- 五阶段：需求、研判、接力、续跑、回执；
- 当前阶段使用最大卡片，其余阶段压缩；
- 分支失败、unknown 或回退就地可见；
- 一个阶段只显示 owner、状态和下一步。

### 责任

- 行是关键参与者，列是五阶段；
- 单元格只显示 `主责 / 建议 / 审批 / 执行 / 旁观 / 禁止`；
- 点击后才显示依据、权限和等待关系；
- 模型的 `审批` 与外部系统的 `业务决定` 永远为禁止。

### 响应式基线

- 主要 Gate：1366×768 CSS viewport；
- 补充 Gate：1920×1080；
- 宽度低于 1100 时行动台收成底部栏；
- 手机只要求可读和可操作，不作为比赛视觉 Gate；
- 尊重 `prefers-reduced-motion`。

## 5. HTTP 与模型 Adapter 契约

同源服务默认：`http://127.0.0.1:4180`。

### 读取

- `GET /health`
- `GET /api/v1/config`
- `GET /api/v1/cases`
- `GET /api/v1/cases/{caseId}`
- `GET /api/v1/cases/{caseId}/events`

### 写入

- `POST /api/v1/cases/{caseId}/commands`
- `POST /api/v1/cases/{caseId}/model-runs`

写请求必须包含 `X-Actor-Id`，并使用：

```json
{
  "commandId": "cmd-unique",
  "idempotencyKey": "stable-retry-key",
  "expectedVersion": 12,
  "type": "accept_handoff",
  "payload": {}
}
```

公开命令：

- `append_message`
- `accept_handoff`
- `decide_gate`
- `resume_agent`
- `create_action_intent`
- `record_receipt`

双模型运行请求显式选择 providers，不由普通消息触发：

```json
{
  "commandId": "run-unique",
  "idempotencyKey": "run-stable",
  "expectedVersion": 4,
  "providers": ["openai", "zai"]
}
```

Adapter：

- OpenAI：Responses API；`OPENAI_API_KEY`、`OPENAI_MODEL`、可选 `OPENAI_BASE_URL`；
- Z.AI：Chat Completions API；`ZAI_API_KEY`、`ZAI_MODEL`、可选 `ZAI_BASE_URL`；
- `P2_MODEL_MODE=demo|live`，默认 `demo`；
- demo 产物必须标注 `synthetic:true`；
- live 任一 provider 失败时记录 `failed` 或 `unknown`，不得用 demo 结果替代；
- 同一进程中的 Z.AI 调用使用串行 mutex；OpenAI 与 Z.AI 可并行；
- 不把模型 reasoning 内容当作产品输出或审计事实。

## 6. 量化指标

主界面只显示可由当前事件链计算的体征；商业数字单独标记为“试点目标”。

### 本地实测

- Replay：重启前后 Projection 全等；
- Authority：越权命令零业务写入；
- Continuity：Handoff 接受后同一 caseId、goalVersion、snapshotId 续跑，`restartCount=0`；
- Traceability：Candidate 的关键断言都能指向 sourceRef，缺失则计入 gap；
- Context compression：`1 - compactChars/rawChars`，展示计算口径；
- Failure visibility：ModelRun/Receipt 的 failed 与 unknown 不会显示完成；
- View consistency：三视图共享相同 identity、version、eventCursor 与 chainHead。

### 试点目标（不是已实现业绩）

- 找到正确评审人时间下降 ≥ 50%；
- 人工重建上下文时间下降 ≥ 60%；
- 高影响动作具名审批覆盖率 = 100%；
- 无来源关键判断进入正式状态 = 0；
- 外部动作无回执却显示成功 = 0；
- 同一事项因跨人/跨模型而重新开始次数下降 ≥ 70%。

## 7. P2 Gate

### Gate A：运行时

- SQLite append-only + hash chain；
- 两个场景可重放；
- 权限、版本、幂等、目标漂移、Handoff、Gate、Action/Receipt 负向测试；
- demo/live 双模型 Adapter；
- API 与静态前端同源运行。

### Gate B：产品闭环

- 主场景可从双模型研判走到人类接力、Gate、Agent 续跑和 Receipt；
- 证明场景复用同一运行时与 UI；
- 三视图共享同一 Projection；
- 详情只在抽屉展示；主屏无高密度聊天流。

### Gate C：比赛证据

- 1366×768 与 1920×1080 无页面级滚动、无横向溢出；
- 浏览器 console error=0；
- API、负向安全、重启 replay、静态检查、浏览器交互全部有真实结果；
- README 明确 demo/live、启动、环境变量、限制；
- 所有目标值与已测事实分开。

## 8. 验收命令与停止条件

```powershell
cd C:\Users\22673\Desktop\Anthropic\runtime\p2
node --test
node scripts\verify.mjs
node src\server.mjs --port 4180
```

完成条件：Gate A/B/C 全部通过，P1 未被改写，4177/4178/4179 未被占用，没有安装新依赖，没有生产或客户成功误报。达到后停止在 P2，不启动 P3。
