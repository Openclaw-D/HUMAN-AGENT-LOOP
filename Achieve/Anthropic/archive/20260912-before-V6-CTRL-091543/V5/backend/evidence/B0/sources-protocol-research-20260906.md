# B0 协议研究来源索引（读取日期 2026-09-06）

两个只读研究 lane 的在线核验结果索引。全文要点见各 lane 原始报告（主控持有）；本文件为可核查来源清单与结论分类。

## A2A 官方协议（lane：A2A 官方协议能力核验）

- 规范主源（main 分支，文本标注 Latest Released Version 1.0.0；最新 Release tag **v1.0.1**，published 2026-05-28）：
  - https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md （页面版 https://a2a-protocol.org/latest/specification/ ）
  - 权威 proto（package lf.a2a.v1）：https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto
  - spec.md 最新 commit：`f63dbb48271940ca5bd421f87e27e4d6ec002795`（2026-08-28）
- v0.3.0（任务书所引方法名 `message/send`/`tasks/cancel`/`tasks/resubscribe` 属该版；v1.0 改抽象操作名 SendMessage/CancelTask/SubscribeToTask）：
  - https://raw.githubusercontent.com/a2aproject/A2A/v0.3.0/docs/specification.md
  - 类型源（TaskState/Task/Message 注释）：https://raw.githubusercontent.com/a2aproject/A2A/v0.3.0/types/src/types.ts
- 归属：Linux Foundation 开源项目（Google 捐赠），README 原文核验。
- 未核验项：v0.3.0 proto 文件本体（normative 类型以 types.ts 形式核验）；v1.0 JSON-RPC wire 方法名字符串逐字核对。

### 能力分类结论（相对本任务四能力点）

| 能力点 | 分类 | 依据（规范原文要点） |
| --- | --- | --- |
| 任务身份（Task id/contextId/kind/status/artifacts/history/metadata；contextId 聚合多任务多消息） | 标准原生 | proto v1.0 Task 字段注释；spec §3.4.1 contextId 语义 |
| 消息往返（Message role/parts/messageId/taskId/contextId/referenceTaskIds；SendMessage/SendStreamingMessage；artifacts；同 taskId+contextId 追问） | 标准原生 | proto v1.0 Message 字段；v1.0 §3.4.3、v0.3.0 §3.5.6 映射表 |
| 状态（TaskState 枚举 SUBMITTED/WORKING/COMPLETED/FAILED/CANCELED/INPUT_REQUIRED/REJECTED/AUTH_REQUIRED）、取消（CancelTask 幂等、TaskNotCancelableError）、SSE 订阅/重订阅、push notification（at-least-once） | 标准原生（resubscribe 的历史事件补发语义为实现层） | proto v1.0 TaskState；v1.0 §3.1.5/§3.1.2/§3.1.6、§4.3 |
| 人输入与恢复（INPUT_REQUIRED 为 interrupted 态；同 taskId+contextId 续发即继续；AUTH_REQUIRED；幂等仅为 MAY 级 messageId 建议；无原生 resume 操作） | 语义=标准原生；恢复执行与幂等保证=需应用层实现 | v1.0 §3.4.3/§7.6/§3.3.1 |
| 传输绑定（HTTP(S) MUST；JSON-RPC 2.0 / gRPC / REST 三选一必实现；A2A-Version 头）、Agent Card（well-known agent-card.json）、扩展机制（AgentExtension） | 标准原生 | v0.3.0 §3；v1.0 §3.6/§8.2/§4.6 |

## Microsoft 官方 Agent 协作资料（lane：Microsoft Agent 协作资料核验）

全部来源 learn.microsoft.com（agent-framework 文档集，读取时 updated_at 2026-08-25，checkpoints 页 2026-09-04）：

1. Orchestrations 总览（sequential/concurrent/handoff/group-chat/magentic）：https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/ （ms.date 2026-02-12）
2. Framework Overview（**Agent Framework 是 Semantic Kernel 与 AutoGen 的官方后继**，同一团队）：https://learn.microsoft.com/en-us/agent-framework/overview/ （ms.date 2026-07-29）
3. Handoff（接收方全量接管；mesh 拓扑；triage→专家官方示例）：https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff
4. Concurrent（同输入并行+聚合；差异化输入需自定义 executor/fan-out——**应用层**）：https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/concurrent
5. Human-in-the-loop（request/response、RequestPort、工具审批、checkpoint 连 pending requests 一起保存）：https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop
6. AgentSession（会话状态容器、序列化、AgentSessionStore）：https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/session
7. Checkpoints（superstep 粒度；InMemory/File/Cosmos storage；恢复要求拓扑与 executor 身份一致）：https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints
8. A2A 官方支持（host：.NET MapA2A / Python agent-framework-a2a / Go a2aprovider；client A2AAgent；contextId→session_id 映射）：https://learn.microsoft.com/en-us/agent-framework/hosting/self-hosting/a2a/server （ms.date 2026-07-23）

### 分类结论

| 能力点 | 分类 |
| --- | --- |
| 多 Agent 编排模式（含 concurrent/handoff/magentic）、HITL request/审批、checkpoint 持久恢复、AgentSession 序列化、A2A host/client | 框架原生 |
| 每 Agent 差异化输入（concurrent 默认同输入）、自由文本纠偏的多轮往返控制 | 需应用层（官方明示需自定义 executor/自定义 WorkflowBuilder） |
| **与本仓库技术栈的适配** | Microsoft Agent Framework 语言为 .NET/Python/Go，**无 Node/TypeScript 运行时**——不能作为本仓库直接依赖；其价值为模式参照（orchestration/HITL/checkpoint 语义）与 A2A 对端互操作参考 |

## 对 B0 设计的直接含义（一句话级）

- A2A 协议层能力对本任务四能力点大部分为标准原生，Node 侧可按协议自实现（HTTP+JSON 形态）而不依赖 SDK（本轮禁止安装依赖；B1 是否引入社区 TS SDK 属用户依赖决定 Gate）。
- 差异化输入、纠偏版本化、权威写入（authority=none）三件事协议与框架都不直接提供——均为应用层，正好落在 v4life 既有事件/命令权威边界上扩展。
