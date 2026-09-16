# 见微 V4 产品与运行契约

状态：`FROZEN FOR V4 P0 / P1`

冻结日期：2026-08-31；算力稀缺增补：2026-09-02

上位权威：当前用户明确决定

历史边界：`v3.0.0-archive` 及 `docs/v3-archive/` 只作历史证据，不约束 V4。

## 1. 产品定义

见微是一套以真实业务事项为中心，把业务与专业人员、管理人员、系统部门、智能部门、既有系统和智能能力连接起来，使企业能够持续作业、管理和演进的人机协同运行体系。

V4 不是单一看板、单一 Agent、单一信审工具或另一套重型业务系统。它要同时形成三个闭环：

1. 作业闭环：完成真实 Case；
2. 管理闭环：观察状态、偏差、责任、延误、返工与影响；
3. 演进闭环：业务、系统、智能共同发现问题、验证方案、发布版本、观察效果与回滚。

## 2. 术语硬约束

### 2.1 三条业务线

所有用户可见页面、演示、任务包和沟通只使用以下短称：

- 直租
- 存回
- 新回

禁止在用户可见内容中展开或改写为全称。代码使用稳定枚举：

```ts
type BusinessMode = 'direct' | 'existing_return' | 'new_return';
```

### 2.2 人与能力资产必须分开

- 系统部门：负责传统系统、规则、数据、API、集成、发布和运维的人；
- 智能部门：负责模型、Agent、prompt、Harness、evaluation 和部署的人；
- 系统资产：既有系统、规则、数据、API 和 Adapter；
- 智能资产：模型、Agent、Skills、Harness、evaluation set 和版本。

不得把“系统部门”和“智能部门”画成纯技术组件，也不得把模型或 Agent 写成组织成员或正式审批人。

### 2.3 算力稀缺与低功耗大产出

租赁侧本地 GPU 算力是稀缺、受预算约束的组织资源。见微不得以持续重推理、常驻 Agent loop、空转 heartbeat 或无边界并发换取表面智能；它必须是轻量、事件驱动的控制与路由层，用尽量少的推理放大业务变化。

固定执行顺序：

```text
new business Event
  → Context / Evidence hash + idempotency deduplication
  → trusted cached result replay when exact identity matches
  → deterministic validation / authorized rule / retrieval
  → incremental invalidation of only affected outputs
  → compute budget and admission Gate
  → smallest eligible capability first
  → controlled escalation only for high-impact unresolved uncertainty
  → Candidate (authority none)
  → named Human Gate or authorized deterministic rule
  → canonical business Receipt + Compute Receipt
```

硬约束：

- `compute-by-exception`：推理是经准入的例外，不是每个流程节点的默认动作；
- 没有新 Evidence 或 Context 变化时，模型调用数必须为零；相同 `Context + Evidence hash + CapabilityVersion` 精确复用，不重复推理；
- 新 Evidence 只失效受影响的派生产物，不得默认重跑完整 Case；
- 结构化校验、确定性规则、检索、缓存和增量计算优先于模型推理；满足质量边界的最小能力优先，只有高影响且仍有不确定性时才允许升级；
- 预算不足、队列拥塞、timeout 或资源 unknown 时进入排队、人工处理或 fail closed，不静默重试、不乐观成功；
- 每次真实推理必须产生可审计 `ComputeReceipt`，至少绑定调用原因、Case/Attempt/Context、Evidence hash、Capability/Model version、cache hit、输入输出用量、GPU/wall time、结果、failure/fallback；
- Model、Agent 和 Harness 仍然 `authority=none`；节省算力不得绕过 Authority、Evidence、Decision 或 Receipt 边界；
- 具体 GPU 数量、并发上限、单 Case 预算和能耗目标只能由真实资源清单与 benchmark 冻结，不提前编造。

## 3. V4 P0 / P1 范围

### 3.1 首个活细胞

V4 第一个端到端活细胞固定为：

> 直租 + 信审规则命中后的非标例外 Case

它从业务已形成初始事实包开始，覆盖规则命中、人工信审、补证回流、信审结论、Receipt 和向商务移交。它不要求在 P1 内实现完整商务、资产或正式起租动作，但必须证明“信审通过不等于起租”。

### 3.2 本期纳入

- 三条业务线进入 domain contract；
- 标准路径与非标例外路径成为独立维度；
- 直租例外 Case 跑通 Evidence → Candidate → Human Gate → Receipt → Handoff；
- 自动信审通过与商务、资产、起租状态彻底分离；
- 退回、驳回、否决成为不同动作；
- 政策作为贯穿 Case 的规则、例外和版本服务；
- 当前宏观骨架升级为 V4 管理总览；
- 信审入口提供真实 Case 工作面。

### 3.3 本期排除

- 真实集团数据、内网系统、生产身份源和生产 Adapter；
- 三条业务线的完整页面与全部场景；
- 商务、资产的完整生产工作流；
- 未来非线性正式权威编排；
- 价值评价的完整指标系统；
- 生产级多租户、安全认证、灾备和 SLA。
- 未经真实 H20 资源清单与 benchmark 支持的容量、吞吐、能耗或 SLA 声明。

## 4. 业务建模维度

业务线、来源、审核路径和尽调方式必须正交建模，禁止继续用一个 `leaseMode` 字段承载全部差异。

```ts
type AcquisitionSource =
  | 'supplier_referral'
  | 'existing_contract_list'
  | 'market_acquisition'
  | 'relationship_maintenance'
  | 'other';

type ReviewPath = 'standard' | 'exception';

type DueDiligenceMode =
  | 'business_site'
  | 'joint_business_credit_site'
  | 'remote_plus_site';

type V4CaseClassification = {
  businessMode: BusinessMode;
  acquisitionSource: AcquisitionSource;
  reviewPath: ReviewPath;
  dueDiligenceMode: DueDiligenceMode;
};
```

规则：

- 业务线不直接等于审核路径；三条业务线都可能存在标准或例外；
- 新回必须支持业务与信审共同现场尽调，P1 contract 不把它简化为普通远程路径；
- 直租与存回可共享部分事实与流程能力，但不得被合并为同一种业务；
- 来源只描述 Case 如何进入，不决定最终风险结论。

## 5. 当前流程与未来方向

V4 当前采用：

> Parallel intelligence, linear authority（智能并行准备，正式权威线性）

AI、规则和系统可以并行解析材料、识别缺口、准备候选判断和下一动作；正式状态只按当前真实组织流程线性推进。未来非线性协同只能作为版本化演进方向，不能提前伪装成当前已运行流程。

当前权威主线：

```text
商机进入
  → 业务沟通与尽调
  → 业务层级流转
  → 信审规则筛查
      ├─ 标准：组织授权规则形成信审通过 Receipt
      └─ 例外：具名信审人员介入
             → 退回补证 / 继续审查 / 驳回 / 否决
             → 信审结论 Receipt
  → 商务
  → 资产
  → 起租
```

## 6. 状态模型

禁止用一个 `approved` 或一个百分比代表完整生命周期。

```ts
type CreditStatus =
  | 'not_started'
  | 'rule_screening'
  | 'pending_human_review'
  | 'returned_for_supplement'
  | 'resubmitted'
  | 'approved_by_rule'
  | 'approved_by_human'
  | 'rejected_current_attempt'
  | 'vetoed_final';

type ReadinessStatus = 'not_started' | 'pending' | 'ready' | 'blocked';
type CommencementStatus = 'not_started' | 'pending' | 'commenced' | 'failed' | 'unknown';

type V4LifecycleState = {
  creditStatus: CreditStatus;
  commercialStatus: ReadinessStatus;
  assetStatus: ReadinessStatus;
  commencementStatus: CommencementStatus;
};
```

硬约束：

- `approved_by_rule` 与 `approved_by_human` 都只表示信审阶段通过；
- 信审通过不得自动写入 `commercialStatus=ready`、`assetStatus=ready` 或 `commencementStatus=commenced`；
- 起租只有收到真实、可验证 Receipt 后才能成为 `commenced`；
- failure、timeout 和 unknown 都失败关闭，不得乐观成功。

## 7. 退回、驳回、否决

### 7.1 退回

- code：`return_for_supplement`
- 语义：缺少事实、说明或材料；补充后继续同一个 Case；
- 终止性：非终止；
- 状态：`returned_for_supplement`；
- 必须记录要求补充什么、由谁补、截止时间和 Evidence lineage。

### 7.2 驳回

- code：`reject_current_attempt`
- 语义：本次申请或本次审查尝试终止；
- 终止性：终止当前 attempt，但允许按组织规则重新发起新 attempt；
- 状态：`rejected_current_attempt`；
- 新 attempt 必须拥有新标识，同时保留与原 Case、原 Evidence 和原决定的关系。

### 7.3 否决

- code：`veto_final`
- 语义：极少数高权威终局决定；
- 终止性：终局；
- 状态：`vetoed_final`；
- 不得由模型、普通规则命中或普通页面按钮直接产生。

具体岗位到动作的最终权限矩阵仍需组织确认。P1 backend 必须使用可注入 policy 和具名 Actor，不得先把未经确认的岗位层级写死。

## 8. Authority 模型

```ts
type AuthoritySource =
  | 'candidate_model'
  | 'authorized_rule'
  | 'confirmed_human';
```

- `candidate_model`：`authority=none`，只能提出候选、解释、缺口和建议；
- `authorized_rule`：仅限组织已批准、版本明确、适用范围明确、可审计和可回滚的确定性规则；
- `confirmed_human`：具名人员在权限范围内作出的正式决定；
- Agent authority 永远为 none；
- 系统可以执行低风险确定性动作，但必须基于授权规则并返回 Receipt；
- 高影响或正式动作必须由具名人员或组织授权规则 Gate 产生。

四个基本分离：

- Evidence 不等于 confirmed fact；
- Candidate 不等于 decision；
- UI click 不等于 action success；
- model change 不等于 organizational learning。

## 9. 四能力循环

每个活细胞必须同时提供：

| 能力 | 产物 | 最低要求 |
| --- | --- | --- |
| 感知 | Evidence | 来源、时间、Actor、范围、内容哈希和版本 |
| 判断 | Candidate | 规则/模型版本、理由、缺口、置信边界、authority none |
| 行动 | Receipt | 具名 Actor 或授权规则、动作结果、幂等键、失败状态 |
| 学习 | Version | evaluation、批准、发布、观察、rollback |

## 10. 人与组织

V4 区分三类组织角色：

- 普通员工：完成 Case、查看权限范围内信息、提出改进建议、发起议事；
- 团队长：管理团队作业与质量，但不能绕过系统发布和专业权威；
- 总监：拥有更高组织视角和正式治理责任，但技术变更仍需要系统部门实施。

系统演进采用业务/专业 + 系统 + 智能的铁三角：

- 业务/专业人员说明真实需求、例外与业务后果；
- 系统部门理解既有系统、规则、数据、接口与发布；
- 智能部门负责模型、Agent、prompt、Harness、evaluation 与智能版本。

任何影响规则、模型或工作流的配置变更都必须形成 proposal、evaluation、批准、发布 Receipt 和 rollback 信息。普通作业人员有建议权和议事发起权，不直接修改生产配置。

## 11. 三个产品表面

### 11.1 作业面

回答：现在这个 Case 发生了什么，我要做什么，依据是什么，做完交给谁。

最小内容：Evidence、Candidate、当前 Gate、动作、Receipt、下一 handoff。

### 11.2 管理面

回答：哪些 Case 偏离、为什么、谁负责、延误多久、返工多少、影响什么。

最小内容：events、receipts、owners、delays、rework、versions 和影响。

### 11.3 演进面

回答：系统哪里有问题，谁提出方案，怎么验证，哪个版本发布，效果如何，如何回滚。

最小内容：problem、proposal、evaluation、approval、version、observation、rollback。

## 12. 前端冻结契约

### 12.1 管理总览

- 保留 V3 当前宏观骨架和视觉语言，不进行大幅风格重做；
- 根页面固定为多事项管理总览，不再把一条单事项流程当作页面主角；
- 回答事项规模、异常、延误、返工、责任人、组织负荷和改进效果；
- 支持按事业部、部门、团队、人员、业务线和时间范围切换观察范围；
- 从异常、延误或返工入口可下钻到经过筛选的事项，再进入单个事项作业面；
- 演示数据必须明确标注，不得伪装成真实经营指标；缺失数据使用“未提供”或“未知”；
- 价值不删除，但从第一可见层隐藏，后续由演进和经营评价承载；
- 不把系统组件画成组织成员，不把 Agent 画成审批人。

### 12.2 信审 Case 工作面

- 首屏对象固定为 V4 P1 直租例外 Case；
- 清楚展示规则为什么无法自动覆盖、当前 Evidence、Candidate、具名 Gate 和下一 handoff；
- 退回、驳回、否决必须有不同文案、不同确认层级和不同结果状态；
- 自动信审通过必须显示“仅信审通过，待商务/资产”，禁止显示“自动起租”；
- loading、empty、error、success、disabled、retry 和 stale Context 必须可见；
- 1920×1080 为桌面验收基线，移动端本期只保证可用，不作为主设计目标。

### 12.3 三页面与共享入口

V4 第一可见层固定为三个页面，禁止继续把三种问题压进同一张图：

1. `/` 管理总览：面向多事项与组织范围，负责发现问题和下钻；
2. `/work` 事项作业：面向一个直租信审例外事项，负责完成 Evidence → Candidate → Human Gate → Receipt → Handoff；
3. `/evolve` 体系改进：面向跨事项重复问题，负责 proposal → evaluation → approval → version → observation → rollback。

三个页面必须共享同一组三入口导航，中文名称固定为“管理总览、事项作业、体系改进”。融合来自共享的 Case、Actor、组织范围、Context Version、Event、Receipt 和 Version，不来自把全部内容画在一个页面。

第一可见层采用中文优先：除 AI、API 等必要缩写外，不显示装饰性英文大标题。Evidence、Candidate、Gate、Receipt、Handoff、Event、Proposal、Evaluation、Approval、Observation 和 Rollback 在页面上分别使用“证据、建议、人工确认、结果凭证、后续承接、过程记录、改进建议、验证、批准、效果观察、回退”。

### 12.4 三页面的展示主线

三个页面不是三个独立信息筐，而是一条由大到小、再由小回到系统的理解路径：

1. **管理总览先讲架构**：先回答“谁在管理什么、事项经过哪些专业环节、系统部门和智能部门如何支撑且不越权”，再展示多事项异常、延误、返工、责任与影响；
2. **事项作业再讲流程**：只沿一个事项回答“从哪里来、现在到哪里、为什么停住、依据是什么、谁决定、结果是什么、交给谁”；
3. **体系改进最后讲系统改造**：从多个事项的重复问题出发，明确本轮改造对象、业务/专业 + 系统 + 智能三方责任，以及验证、批准、发布、观察和回退。

复用 V3 早期架构图的有效原则，而不是复刻旧九模块：

- 先展示关系和主从，再展示指标与卡片；
- 先给一条可复述的主脊线，再允许下钻细节；
- 架构、流程、系统改造分别有唯一主页面，不在每页重复全部内容；
- 每个首屏只回答一个主问题，无法服务该问题的内容不得堆入首屏；
- 三页融合依靠可追溯身份、链接和结果凭证，不依靠视觉上把所有模块塞在一起。

## 13. Backend 边界

- V4 domain 放在 `lib/v4/**`；
- V4 API 放在 `app/api/v4/**`；
- V4 tests 使用 `test/v4-*.test.mjs`；
- V4 不修改 `lib/v3/**`、`app/api/v3/**` 或 V3 archive contract；
- 可以复用经过验证的 neutral primitive，但不得导入 V3 Golden Case、五路 process IDs、旧 Role Projection 或旧权威假设；
- P1 允许使用独立本地 SQLite demo store，但数据库、runtime epoch、schema version 和 reset namespace 必须与 V3 分开；
- Event 和 Evidence append-only；Projection 可重建；Receipt 是动作结果证据，不是前端乐观状态。

## 14. V4 P1 最小对象

```ts
type V4Case = {
  caseId: string;
  attemptId: string;
  classification: V4CaseClassification;
  lifecycle: V4LifecycleState;
  currentStage: 'business' | 'credit' | 'commercial' | 'asset' | 'commencement';
  contextVersion: string;
  authorityState: 'waiting' | 'candidate_ready' | 'gate_required' | 'decided';
};

type V4Decision = {
  decisionId: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  action: 'approve_credit' | 'return_for_supplement' | 'reject_current_attempt' | 'veto_final';
  authoritySource: AuthoritySource;
  actorId: string;
  policyVersion: string;
  rationale: string;
  evidenceReceiptIds: string[];
};
```

## 15. V4 P1 API 方向

以下是 P1 contract surface；具体 DTO 在 V4-BACK 内以 tests 冻结：

- `GET /api/v4/cases/:caseId`
- `GET /api/v4/cases/:caseId/events`
- `POST /api/v4/cases/:caseId/evidence`
- `POST /api/v4/cases/:caseId/candidates`
- `POST /api/v4/cases/:caseId/decisions`
- `GET /api/v4/cases/:caseId/receipts/:receiptId`

所有 POST 必须有 bounded body、stable error、idempotency key、Context Version 和 fail-closed mapping。

## 16. 演进阶段

- P0：认知地图、contract、未知清单与第一个实验；
- P1：信审活细胞；
- P2：大风控组织，逐步引入政策、商务、资产；
- P3：小微业务系统，引入商机、业务、多 Case 管理；
- P4：真实人员、既有系统、智能部门与受控 Adapter 试点；
- P5：企业级持续运营、安全、模型治理、价值评价与持续演进。

每一期只增加一个主要复杂度维度。认知自上而下，工程自下而上，展示从微观到宏观，治理贯穿全程。

## 17. Stop Conditions

出现以下情况必须停止写代码并回到 Control：

- 需要展开三条业务线全称；
- 需要让模型或 Agent 获得正式权威；
- 需要把自动信审通过写成自动起租；
- 需要恢复 V3 五路并行作为正式当前流程；
- 需要猜测未经确认的岗位权限矩阵；
- 需要读取或接入真实集团数据、凭据或内网系统；
- 前后端需要同时修改同一 contract 或同一文件；
- 当前实现无法用 Receipt、Event 或测试证明。
