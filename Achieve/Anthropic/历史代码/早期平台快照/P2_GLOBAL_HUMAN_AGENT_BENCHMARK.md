# 见微 P2：全球人机协同产品基准研究

状态：`CURRENT RESEARCH / OFFICIAL-SOURCE REVIEW / NOT A PRODUCT FREEZE`  
研究日期：2026-08-28  
研究问题：全球哪些公司在“企业内多人、多 Agent、共享上下文、事项状态、身份权限、接力、审计与轻量入口”上做得最好？见微应分别学习什么，剩余空间在哪里？

## 0. 结论先行

没有一家在所有维度上形成无争议的完整冠军。当前更准确的判断是：

| 领先维度 | 当前最强基准 | 核心理由 |
| --- | --- | --- |
| 轻量多人共享 Agent 入口 | **Anthropic Claude Tag** | 一个 Slack 频道内共享同一个 Claude，任何成员可接着上一位继续；有频道记忆、异步长任务、权限范围、预算和操作日志 |
| 正式工作对象上的 Human–Agent 协作 | **Asana AI Teammates** | AI Teammate 作为任务/项目成员参与，继承 Work Graph 上的目标、计划、任务与权限，能被分配工作并接受人工检查点 |
| 企业上下文图谱与组织工作关系 | **Atlassian Teamwork Graph + Rovo/Jira** | 连接人、目标、工作、知识、决定和多工具关系；Agent 可在 Jira 中接任务并读取完整工作上下文与审计轨迹 |
| Agent 身份、权限、负责人和生命周期 | **Microsoft Agent 365 + Entra Agent ID** | Agent 拥有一等身份、权限、Sponsor、条件访问、生命周期、审计与跨 Microsoft 365 表面参与能力 |
| 跨厂商 AI 资产治理、观测与价值衡量 | **ServiceNow AI Control Tower** | 发现、观测、治理、安全、关闭越权 Agent、成本与 ROI 衡量，覆盖第三方系统、模型、MCP 与非人身份 |
| 企业业务动作与 Slack 协作 | **Salesforce Agentforce + Slack** | Slack 会话上下文与 CRM 数据结合，Agent 可在频道中行动，支持权限、规则、业务动作和 Human Handoff |

**综合上最接近见微长期叙事的是 Atlassian；最接近见微轻量产品体验的是 Anthropic；最接近见微企业控制面叙事的是 Microsoft 与 ServiceNow。**

因此，“企业 AI 协同中枢”“AI Control Plane”“共享上下文”“Agent 像同事”“人机接力”都已被全球头部公司部分占据。见微不能再靠概念命名形成独特性，必须靠更窄、更真实的组合机制和本地企业适配成立。

## 1. 评价维度

本研究不按模型智力、公司估值或总营收排名，只评价与见微直接相关的六项产品能力：

1. **轻量入口**：是否能进入用户已有工作现场，而非要求先换平台。
2. **多人协作**：是否允许多名具名人员围绕同一 Agent 或工作对象连续参与。
3. **上下文与事项连续性**：是否知道目标、决定、所有权、当前状态和历史，而不只是读取聊天。
4. **身份与权限**：人和 Agent 是否有明确身份、可见范围、权限、Sponsor 或责任人。
5. **动作与接力**：Agent 是否能执行真实业务动作；人与 Agent 之间是否有明确交接或检查点。
6. **审计与治理**：是否有日志、策略、风险控制、生命周期、成本和结果衡量。

等级只表示官方公开资料支持的产品深度：`领先 / 强 / 中 / 弱 / 未证实`。它不是实验室实测分数。

## 2. 六家核心基准横向矩阵

| 公司 / 产品 | 轻量入口 | 多人协作 | 上下文与事项连续 | 身份权限 | 动作接力 | 审计治理 | 当前角色 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic Claude Tag | **领先** | **领先** | 强（频道/工具记忆，非正式业务事项） | 强（频道范围与独立 Agent 身份） | 强（委派、异步、主动跟进） | 强（预算与请求日志） | 最佳轻入口 |
| Asana AI Teammates | 强 | **领先** | **领先**（Work Graph 的任务/项目/计划） | 强（对象权限与角色） | **领先**（分派工作、人工检查点） | 强 | 最佳正式人机工作空间 |
| Atlassian Teamwork Graph + Rovo/Jira | 中强 | 强 | **领先**（人/目标/决定/工作/知识关系） | 强（权限感知、审计） | 强（Jira 任务可分派 Agent） | 强 | 最佳企业上下文底座 |
| Microsoft Agent 365 | 中强（Teams/Outlook/Word） | 强 | 中强（依赖 Microsoft 365 工作对象） | **领先** | 强（通知、OBO 与自主身份） | **领先** | 最佳身份治理控制面 |
| ServiceNow AI Control Tower | 中（治理工作台） | 中强（多治理角色） | 强（AI 资产/工作流生命周期） | **领先** | 强（策略、审批、越权关闭） | **领先** | 最佳跨平台治理与价值控制 |
| Salesforce Agentforce + Slack | **领先** | 强 | 强（Slack + CRM 记录） | 强（ABAC、Agent/用户范围） | **领先**（Slack/CRM 动作、Human Handoff） | 强 | 最佳业务系统内行动闭环 |

## 3. 逐家公司判断

### 3.1 Anthropic｜Claude Tag

**官方已公开**

- Claude 作为 Slack 团队成员进入指定频道；同一频道内所有人共享一个 Claude。
- 任何成员可从上一位的对话和工作继续，不必从头解释。
- Claude 可建立频道记忆、读取授权的其他频道与工具、主动跟进未解决事项，并异步运行长任务。
- 管理员控制频道、工具和信息范围，设置组织/频道预算，并查看 Claude 做过什么以及由谁请求。

**它为什么强**

- 把“大型 Agent 系统”藏在一个极轻的 `@Claude` 动作后面，用户迁移成本最低。
- 不是个人聊天，而是真正的 multiplayer shared agent。
- Anthropic 自述已在工程、数据、GTM、支持等团队内部高频使用，产品不是纯概念。

**它没有完全解决什么**

- 权威对象仍更接近频道和任务，而非一套正式企业协同事项。
- 未公开完整的人际责任接受、目标版本、人工决定权、外部回执和事件重放契约。
- 产品以 Claude 为中心，不是模型无关的企业协同内核。

**见微应学习**

> 大内核必须藏在小动作后面。用户第一眼看到的不是架构图，而是“把正确的人与 Agent 叫进来，并接着做”。

官方来源：

- https://www.anthropic.com/news/introducing-claude-tag
- https://www.anthropic.com/webinars/how-anthropic-works-with-claude-tag-in-slack

### 3.2 Asana｜AI Teammates + Work Graph

**官方已公开**

- AI Teammates 依托 Work Graph，围绕任务、项目、团队、计划和目标与人协作。
- AI Teammate 像同事一样加入私有对象，需要被明确添加；权限分为 Editor、Commenter、Viewer，且不能自行提权。
- AI 只可使用触发用户与自身都能访问的信息。
- 官方强调由人设定意图、提供清晰检查点并监督 Agent 创建计划、分配和完成工作。

**它为什么强**

- 它不是把 Agent 放进聊天，而是放进正式工作对象。
- 人和 Agent 共用同一任务、计划、负责人、状态和权限语义，协作可直接进入日常运营。

**它没有完全解决什么**

- 用户需要进入 Asana 的工作管理范式，部署和迁移感比 Claude Tag 重。
- 见微关注的私有/共享 Context Packet、具名责任接受和事件溯源是否同构，公开资料不足以证明。

**见微应学习**

> Agent 只有进入正式工作对象和权限体系，才真正成为企业同事；“共享聊天”远远不够。

官方来源：

- https://help.asana.com/s/article/understanding-access-control-for-ai-teammates
- https://investors.asana.com/news-releases/news-release-details/asana-unveils-operating-system-human-agent-teams

### 3.3 Atlassian｜Teamwork Graph + Rovo + Jira Agents

**官方已公开**

- Teamwork Graph 持续映射人员、目标、工作、知识、决定、代码和第三方工具关系。
- Atlassian 明确把“为什么作出决定、现在谁负责、过去哪里失败”视为 Agent 所需上下文。
- Graph 具有权限感知、细粒度范围和审计；可通过 CLI/MCP 向 Claude、Codex、Cursor 等外部 Agent 提供上下文。
- Jira 中可把任务直接分派给 AI Agent，Agent 读取目标、决定、评论历史和代码，并在权限与审计轨迹内工作。

**它为什么是最接近的战略竞品**

- 已经不只是知识检索，而是在建立“组织如何工作”的关系图谱。
- 已同时连接人、目标、决定、所有权、工作状态和 Agent，这与见微长期愿景高度重叠。
- 它拥有大量现存工作数据和集成生态，Context 会随日常使用复利。

**它没有完全解决什么**

- 深度依赖 Atlassian Cloud 与现有产品体系，形态和迁移都偏重。
- 公开重点是 context graph、work management 与开发/服务工作；跨任意中国企业系统的轻量责任接续仍有空间。
- 部分 Graph API 仍处于 EAP/Beta，不能把所有发布叙事视为全面 GA。

**见微应学习**

> 上下文不是摘要，而是人、目标、决定、所有权、工作和证据之间的关系；但见微不能试图从零复制一个 Teamwork Graph。

官方来源：

- https://www.atlassian.com/blog/company-news/teamwork-graph-team-26
- https://www.atlassian.com/blog/company-news/rovo-team-26
- https://www.atlassian.com/platform/teamwork-graph

### 3.4 Microsoft｜Agent 365 + Entra Agent ID

**官方已公开**

- 每个 Agent 可拥有独立的 Entra Agent ID、权限、凭据边界、Owner/Sponsor 和生命周期。
- 支持代表用户行动的 OBO 模式和 Agent 自主身份模式。
- 条件访问、最小权限、访问包、异常检测、审计、停用和退休延伸到 Agent。
- Agent 可通过用户账户获得 Teams、Outlook、Word、邮箱和组织目录中的可见存在。

**它为什么强**

- 把 Agent 从“某段程序”升级为企业可识别、可授权、可问责和可退休的非人主体。
- 复用 Entra、Defender、Purview 等成熟企业控制体系，治理深度很难由轻量创业产品正面复制。

**它没有完全解决什么**

- 核心强项是 Agent 治理控制面，不等于人与人之间围绕事项的连续协作产品。
- 能力主要依赖 Microsoft 365 与 Entra 生态，第一部署并不轻。

**见微应学习**

> Agent 必须有身份、Sponsor、权限边界和生命周期；“谁创建、谁负责、何时停用”应是数据模型，而不是备注。

官方来源：

- https://learn.microsoft.com/en-us/microsoft-agent-365/leadership/why-agent-365-for-enterprise
- https://learn.microsoft.com/en-us/microsoft-agent-365/leadership/entra-agent-365
- https://learn.microsoft.com/en-us/entra/agent-id/

### 3.5 ServiceNow｜AI Control Tower

**官方已公开**

- 跨 ServiceNow、AWS、Google Cloud、Microsoft Azure、SAP、Oracle、Workday 等发现 Agent、模型、MCP、数据集、Prompt 和非人身份。
- 对 Agent 运行进行观测、风险评估、合规控制、最小权限和异常检测；Agent 越权时可关闭。
- 跟踪成本、业务目标、部署前后评估与 ROI；覆盖 AI 资产从需求、审批、构建、部署到监控和退役的生命周期。

**它为什么强**

- 真正回答大型企业“已经有很多 AI 后怎么统一看见、控制、评估和停掉”的问题。
- 是全球最强的“AI 治理与价值控制塔”候选，而不只是 Agent Builder。

**它没有完全解决什么**

- 主要面向治理者和平台运营者，不是普通员工高频的人机协作入口。
- 产品体系重、许可和实施成本高；轻量协同体验不是核心优势。

**见微应学习**

> 除了过程审计，还必须回答 Agent 是否有效、花了多少钱、何时应关闭；但见微第一版不能复制一座完整控制塔。

官方来源：

- https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-expands-AI-Control-Tower-to-discover-observe-govern-secure-and-measure-AI-deployed-across-any-system-in-the-enterprise/
- https://www.servicenow.com/products/ai-control-tower.html

### 3.6 Salesforce｜Agentforce + Slack

**官方已公开**

- Agent 在 Slack 频道中以队友形态被 `@` 调用，结合 Slack 公开对话与 Salesforce CRM 数据。
- Agent 可创建/更新 Canvas 和频道、发送消息，并在规则边界内执行 CRM 或工作流动作。
- 支持用户与 Agent 范围权限、ABAC、运行时检查和 Human Handoff 主题。
- Agentforce 可在 Lightning、Mobile、Slack、消息与邮件等渠道运行。

**它为什么强**

- 不是只回答问题，而是把渠道上下文、客户记录和真实业务动作连起来。
- Salesforce + Slack 同时拥有系统记录与协作入口，天然比纯聊天 Agent 更接近闭环。

**它没有完全解决什么**

- 深度绑定 Salesforce/Slack 生态，跨任意既有系统的中立协同层不是产品主线。
- Human Handoff 更多围绕服务/员工 Agent 流程，不等于统一的人际责任接受协议。

**见微应学习**

> 协同价值必须最终进入真实业务动作和系统记录；如果只在自己的 Web 页面里结束，就没有闭环。

官方来源：

- https://www.salesforce.com/slack/agentforce
- https://www.salesforce.com/agentforce/agentforce-for-employees/

## 4. 次级基准：OpenAI Codex

Codex 在 Slack 中可以读取频道/线程上下文，创建独立云任务并把结果链接回传；也有环境控制、监控和管理能力。它是优秀的“从协作入口启动专业执行任务”基准，但当前公开形态仍以开发任务为中心，不是持续共享的多人 Agent，也不是正式的人际责任接续系统。

见微应学习它的任务隔离、可恢复执行、环境边界与结果回传；不能把 Codex 的 Thread/Fork/Handoff 体验直接当作企业业务协同内核。

官方来源：

- https://openai.com/index/codex-now-generally-available/

## 5. 全球格局的关键判断

### 5.1 头部公司正在从不同方向夹击同一空间

```text
Anthropic / Salesforce：从聊天入口进入协作
Asana / Atlassian：从工作对象和组织上下文进入协作
Microsoft：从身份与权限进入 Agent 治理
ServiceNow：从流程、风险和资产治理进入控制塔
OpenAI Codex：从专业任务执行进入团队入口
```

它们的交汇点就是：**Agent 正在成为企业中的可见参与者，工作重心从“生成一次输出”转向“持续参与组织工作”。**

### 5.2 已经不能安全使用的泛化定位

- “企业 AI 协同中枢”过于宽泛，Atlassian、Salesforce、Microsoft、ServiceNow 都能成立。
- “AI Control Plane”已是 Microsoft Agent 365 与 ServiceNow AI Control Tower 的直接叙事。
- “共享 Agent / 共享上下文”已被 Claude Tag、Asana 和 Atlassian 深度占据。
- “Agent 像团队成员”已成为多家头部公司的共同语言。
- “Human Handoff”在 Salesforce、服务管理与工作管理产品中并不新。

### 5.3 见微仍可能占据的窄组合

以下不是“全球无人实现”的结论，而是当前官方资料下仍值得验证的产品组合：

> **一个轻量、模型与业务系统中立的 Collaboration Case continuity layer：不替换 OA、IM、CRM 或项目管理系统，只围绕跨人、跨 Agent、跨入口的同一事项，维护经确认的共享状态、具名责任接受、人工决定和外部回执。**

它要与头部基准形成四个区别：

1. **比 Anthropic 更正式**：不止共享频道记忆，而有事项、责任、决定与回执。
2. **比 Asana/Atlassian 更轻**：不要求先迁移到完整工作管理或构建组织图谱。
3. **比 Microsoft/ServiceNow 更贴近一线协作**：不是管理员控制台，而是普通人每天可触发的接力动作。
4. **比 Salesforce 更中立**：不绑定单一 CRM、IM 或数据生态。

这四个差异必须由真实 MVP 证明，不能只写在架构文档中。

## 6. 见微的学习路线

| 学习对象 | 第一学习点 | 暂不复制 |
| --- | --- | --- |
| Claude Tag | 一个 `@` 动作背后的多人共享 Agent、频道范围和异步接续 | 主动监听全公司、长期自主任务 |
| Asana | Agent 进入正式工作对象、权限与人工检查点 | 完整项目管理平台 |
| Atlassian | 人/目标/决定/所有权/工作关系，而非长摘要 | 从零建设企业 Teamwork Graph |
| Microsoft | Agent ID、Sponsor、权限与生命周期 | 完整 Entra/安全产品体系 |
| ServiceNow | Agent 资产、风险、成本、价值和关闭条件 | 全企业 AI Control Tower |
| Salesforce | 协作上下文最终进入业务动作与系统记录 | 绑定单一 CRM 与 Slack 生态 |

## 7. 当前产品发现影响

- 长期愿景仍可以是重构人的工作模式，但全球头部公司已经在讲 AI-native organization，愿景不能成为独特性证明。
- 第一问应从“我们是不是协同平台”改为：**为什么企业在已经拥有 Claude Tag、Asana、Atlassian、Agent 365 或 Agentforce 之后，仍然必须多装见微这一层？**
- 若答案只是“共享上下文、权限、Agent 接力和审计”，不足以通过这一问。
- 可能成立的答案必须同时包含：**更轻的进入方式、跨现有系统的中立性、具名责任接受、同一事项连续性，以及中国大型企业连接器/部署/合规现实。**

## 8. 证据边界

- 本文优先使用厂商官方产品页、官方文档、官方新闻稿和投资者材料。
- 厂商使用量、准确率、节省时间和 ROI 数据属于厂商自述，未做独立复现。
- Beta、Preview、EAP 与 GA 明确区分；公开路线图不等于已普遍可用。
- “领先”表示在本文定义的单一维度上公开产品深度较强，不表示总体市场份额或商业成功排名。

中国生态的单独核验见 `P2_CHINA_HUMAN_AGENT_ECOSYSTEM.md`。该研究已修正“国内生态位为空”的宽泛判断：钉钉悟空、飞书与腾讯 WorkBuddy 已经占据企业 AI 工作平台、Agent 协作入口和组织级 Agent 能力底座；见微仅保留跨生态协同事项连续性、具名责任接受和权威回执历史这一窄组合待验证。
