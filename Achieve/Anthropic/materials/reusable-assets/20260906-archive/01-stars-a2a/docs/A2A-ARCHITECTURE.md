# STARS A2A 三 Agent 架构

更新日期：2026-08-09

## 结论

截至本次实现，A2A 规范最新补丁发布为 `v1.0.1`，线协议兼容版本仍写 `A2A-Version: 1.0`。STARS 将 A2A 用作 Agent 之间的能力发现、消息、任务和产物交换协议，将组织权责和审批规则放在独立的确定性治理层中。

MCP 不承担 Agent 间治理总线。它适合未来作为单个 Agent 内部的工具与上下文接入层，例如读取证据、规则、数据库或外部系统。

## 标准与扩展边界

A2A 官方语义：

- `AgentCard`：身份、skills、接口、版本、认证和真实 capabilities。
- `Message`：通信回合；不等于正式交付物。
- `Task`：有状态、可跟踪的 Agent 工作单元。
- `Artifact`：任务正式产出，应与一般消息区分。
- `contextId`：将同一目标下多个 Task 关联起来。
- JSON-RPC、gRPC、HTTP+JSON 三种 binding；轮询、SSE、push notification 三类更新机制。

STARS 工程扩展：

- Supervisor / Business / Risk 组织角色。
- 领导发起、监督 Agent 委派、业务提交、风控独立质询与最终裁决。
- 共同 yield、证据所有权、挑战—补证—复核循环。
- 风控否决不可覆盖、重新审议 revision、人工 Gate、审计 hash chain。

因此项目对外应称为 “A2A-aligned compatible subset”，通过官方 TCK 之前不能称完整 A2A conformant implementation。

## 三 Agent 权责

```text
Leader human
  → Supervisor Agent：拆解、委派、监控；无风险裁决权
      → Business human + Agent：方案、证据、补件
      → Risk human + Agent：独立质询、最终通过/附条件通过/否决
```

共同目标不代表三个角色等权。Business 与 Risk 都围绕同一目标工作，但 Risk 是独立硬门槛，不参与平均投票；即使 yield 得分达到门槛，Risk 的拒绝仍终止当前 revision。

## 双层状态

A2A Task 状态描述 Agent 工作是否完成。融资治理状态描述案件是否通过。二者不能混用：Risk 完成审查并否决融资时，Risk A2A Task 是 `TASK_STATE_COMPLETED`，治理状态才是 `REJECTED`。

P0 治理状态：

```text
DIRECTED
→ RISK_REVIEW
  ├→ CHANGES_REQUIRED → BUSINESS_SUBMITTED → RISK_REVIEW
  └→ RISK_HUMAN_APPROVAL_REQUIRED
      ├→ APPROVED
      ├→ CONDITIONALLY_APPROVED
      └→ REJECTED
```

重新审议不会修改被否决的记录，而是创建 `revision + 1`，用 `supersedesContextId` 引用旧 revision，并重新进入风控复核。

## 共同 yield

当前 P0 将 yield 作为透明的工程收敛分，不把它当作真实财务收益、模型置信度或风险决定：

- `goalAlignment`：目标与成功指标是否明确。
- `evidenceCompleteness`：独立证据数量。
- `governanceReadiness`：硬约束与可定位证据。
- `openChallenges`：证据、定位、约束或得分缺口。

`readyForDecision` 只表示机器条件已齐备；只有风控人员通过或附条件通过后，`achieved` 才为真。正式产品应把单一分数进一步拆成确定性指标公式、mandatory artifacts、hard gates 和 policy version。

## 当前 API 与数据流

```text
React fetch / EventSource
  → STARS Context API
  → deterministic governance engine
  → A2A tasks/messages/artifacts
  → atomic JSON snapshot + append-only JSONL audit
  → SSE projection update
```

JSON-RPC endpoint 支持：

- `SendMessage`
- `GetTask`
- `ListTasks`
- `CancelTask`

`SendMessage.messageId` 已实现进程内及快照级幂等：相同 ID 和相同 payload 返回首次结果，相同 ID 搭配不同 payload 会被拒绝。

## P0 安全边界

当前只绑定 `127.0.0.1`，未实现登录、OAuth、mTLS、Agent Card JWS、租户隔离或正式数据库。它适合本地框架验证，不适合生产或真实客户材料。

生产前至少需要：

- 从已验证身份推导 actor，不信任请求正文里的角色。
- Supervisor、Business、Risk 使用独立 scopes；Risk decision 仅允许 Risk service identity 写入。
- Evidence URL 防 SSRF，限制大小和 media type，校验 hash，并把材料内容视为不可信输入。
- 不透传 access token；不在 Message、Artifact、日志或审计事件中保存密钥。
- 数据库事务内提交状态事件与 outbox；支持 expected version、消息去重、重试退避和 dead-letter。
- 保留模型、prompt、policy、tool 版本；保存结论与证据引用，不保存 chain-of-thought。
- 正式 append-only/WORM 审计与备份。当前 JSONL 是单机 P0 证据，不是防篡改存储。

## 主要一手资料

- A2A v1.0 Specification: https://a2a-protocol.org/latest/specification/
- A2A releases: https://github.com/a2aproject/A2A/releases
- A2A v1.0 changes: https://a2a-protocol.org/latest/whats-new-v1/
- A2A Agent Discovery: https://a2a-protocol.org/latest/topics/agent-discovery/
- A2A Life of a Task: https://a2a-protocol.org/latest/topics/life-of-a-task/
- Linux Foundation governance announcement: https://developers.googleblog.com/google-cloud-donates-a2a-to-linux-foundation/
- MCP architecture: https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture
