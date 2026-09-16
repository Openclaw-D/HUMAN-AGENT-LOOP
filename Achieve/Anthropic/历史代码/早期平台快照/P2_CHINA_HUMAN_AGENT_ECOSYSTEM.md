# 见微 P2：中国企业人机协同生态与产品空位

状态：`CURRENT RESEARCH / OFFICIAL-SOURCE REVIEW / NOT A PRODUCT FREEZE`  
研究日期：2026-08-28  
研究目标：核验中国是否已经出现类似 Claude Tag、Human–Agent work platform、Agent Team、Agent control plane 的产品；判断见微在国内是否仍有可成立的生态位。

## 0. 最终判断

### 0.1 大逻辑成立，但赛道不是空白

“企业内部会出现越来越多 Agent，因此需要上下文、权限、状态、接力、治理和真实工作入口”这一逻辑已经被国内外头部公司的真实产品投入共同验证。

但以下说法已经不成立：

> 中国还没有企业人机协同平台，见微只要做一个协同中枢就能占据空白。

2026 年国内已经形成明显的五层生态：

1. **协作入口与 AI 工作平台**：钉钉悟空、飞书、腾讯 WorkBuddy；
2. **企业 Agent 构建与多 Agent 平台**：扣子企业版、阿里云百炼、腾讯云智能体平台；
3. **垂直 Agent Team / Harness**：华为云 CodeArts Agent Team、Qoder Agent Teams、飞书 CodeM；
4. **组织权限、审计与多端交付**：钉钉、飞书、腾讯、华为各自依托原有企业生态提供；
5. **私有化与开源底座**：Dify、FastGPT、MaxKB、RAGFlow、AgentScope 等提供局部构建能力。

见微仍可能成立，但必须从“新品类宣称”转为“头部平台之间尚未标准化的窄层”。

### 0.2 当前国内生态位候选

> **面向中国大型、受监管、异构系统企业的轻量协同事项接续层：不替换钉钉、飞书、企业微信、OA、CRM 或 Agent 平台，只保证同一件事在换人、换 Agent、换系统以后仍然接得上，并明确现在谁负责、依据是什么、外部动作是否真的完成。**

它不是一个更大的 AI 工作平台，而是一个更小的运行协议与控制微内核。

这一生态位仍是**待客户验证假设**，不能写成“国内无人做”或“已经证明有采购需求”。

## 1. 国内领先者：按维度而非公司总排名

| 领先维度 | 当前基准 | 公开能力摘要 | 对见微威胁 |
| --- | --- | --- | --- |
| 企业 AI 原生工作平台与钉钉执行入口 | **阿里巴巴 / 钉钉悟空** | 单一界面协调多个 Agent；钉钉 CLI 化后可调用组织、沟通和业务能力；账号、权限、应用系统接入；长期记忆；独立 App + 钉钉内嵌 | **极高**：直接占据“企业 AI 工作平台、Agent 团队、沟通即执行”叙事 |
| 团队协作现场与 Agent 原生项目工作 | **飞书** | 豆包企业版 Agent、群聊/文档/会议入口、OpenClaw 多 Agent 团队、飞书项目 MCP/CLI/AI 节点、CodeM 群内启动并回写项目状态 | **极高**：轻入口、团队上下文、项目状态和 Agent 协同均有产品覆盖 |
| 企业 Agent 统一管理、多端交付与腾讯生态 | **腾讯 WorkBuddy Enterprise** | CodeBuddy、WorkBuddy、托管 Agent；统一身份权限、企业 Skill/专家/Agent、审计、OpenAPI、腾讯文档/网盘/乐享/企微接入 | **高**：已经把组织级 Agent 能力底座和企业微信入口组合起来 |
| 多 Agent 持续协作运行时 | **华为云 CodeArts Agent Team** | Agent 持续独立上下文、双向通信、共享任务池、自主认领、动态组队、故障恢复、事件驱动可视 | **中高但垂直**：机制接近，公开范围主要是软件研发 |
| Agent / Skill / Workflow 企业协同开发 | **扣子企业版** | 多成员企业工作空间、资源与数据隔离、多 Agent 协作、模型自定义、项目空间、专业技能和多端协同 | **中高**：构建平台和资源协作强，正式业务责任接续未证实 |
| Coding Agent Team 与会话交接 | **Qoder Agent Teams** | Named teammate、共享 Task owner/status/dependency、SendMessage、成员间交接；另有跨会话消息 | **中但垂直**：技术机制强，Agent Team 跨 TUI 不持续，范围是 coding |

## 2. 核心产品逐项分析

### 2.1 阿里巴巴 / 钉钉悟空

**官方公开状态**

- 2026 年 3 月发布企业级 AI 原生工作平台“悟空”，当前公开资料标记为邀请 Beta。
- 独立桌面 App 与钉钉内嵌 Agent 两种入口，官方称后续支持 Slack、Teams、微信等通信平台。
- 钉钉将底层能力 CLI 化，使 Agent 可原生调用钉钉上千项能力，主张“沟通即执行”。
- 悟空支持多 Agent 协调、任务执行、长期记忆、电脑操作、Skill 生态和“一人团队”行业方案。
- 官方表示可连接钉钉账号、安全权限和企业应用系统。

**为什么是最大战略威胁**

- 见微过去使用的“企业 AI 协同中枢、Agent 统一入口、轻入口大能力、人和 Agent 共事”等叙事，悟空已经大面积占据。
- 钉钉本身拥有 IM、组织、审批、文档、项目和开放平台，天然拥有见微最难获得的分发、身份和动作入口。
- 其 CLI 化路线直接解决“Agent 如何可靠调用企业协作能力”，不是简单聊天插件。

**仍未被官方资料充分证明的部分**

- 多名具名人员围绕同一事项的正式责任接受与转移；
- 私有上下文和经确认共享上下文的分层；
- 一个跨人、跨 Agent、跨外部系统的权威事件历史；
- 外部动作回执为 unknown 时的失败关闭与事件重放。

**结论**

见微不能与悟空正面竞争“企业 AI 工作平台”或“一人拥有一支 Agent 团队”。若保留独立 Web，必须证明它是跨现有平台的责任接续层，而不是另一个入口。

官方来源：

- https://www.alibabagroup.com/zh-HK/document-1971078136456019968
- https://www.dingtalk-global.com/zh/news/activity/dingtalk-cli-ai-agent-support-260319
- https://wukong.dingtalk.com/docs/about/

### 2.2 飞书

**官方公开能力组合**

- 飞书已把自身定位为 Agent 协作平台，并将豆包企业版以 Agent 形态接入群聊、文档、搜索、会议等工作现场。
- 飞书 OpenClaw 支持在同一群中创建多个专职 Agent，由主管 Agent 拆解、派发、审核和交付。
- 飞书项目通过 CLI、MCP、AI 节点和 AI 字段向 Agent 开放安全读写、流程节点执行与实践沉淀。
- CodeM 可在群聊中被 `@` 启动，读取群聊、项目文档和项目信息，编码、验证、留痕，经确认后提审，并回写飞书项目状态。
- 飞书的既有优势包括组织目录、文档、会议、项目、多维表格、审批、aPaaS 和集成平台。

**为什么威胁极高**

- 它已经同时具备 Claude Tag 式轻入口、Atlassian 式项目对象、Agent 执行和中国企业协作分发。
- 群聊、文档、会议和项目数据天然构成组织上下文，用户不需要额外迁移。
- “群里 @ 一下 → Agent 执行 → 人确认 → 回写项目状态”已经接近见微想演示的基本接力。

**仍有空间的部分**

- 官方公开重点仍是飞书生态内部的 Agent 协作与业务流程。
- 跨钉钉、企业微信、传统 OA、核心业务系统的中立事项权威层未被证明。
- 具名责任接受、局部上下文边界与 event-only canonical projection 仍非公开产品主线。

**结论**

若见微只做“Web 页面 + Agent + 群聊/项目状态”，很容易被飞书现有组合覆盖。见微必须以跨生态中立、责任语义和受监管部署形成差异。

官方来源：

- https://www.feishu.cn/
- https://www.feishu.cn/content/article/7629286303804329160
- https://project.feishu.cn/home/news/feishu-project-open-day-new-platform
- https://project.feishu.cn/home/news/feishu-codem

### 2.3 腾讯 WorkBuddy Enterprise

**官方公开能力组合**

- 以 CodeBuddy、WorkBuddy、Managed Agents 覆盖研发、通用办公和云端 Agent 托管。
- 统一身份、组织架构、成员用量、企业 Skill、企业专家、企业 Agent、模型、安全审计与 OpenAPI。
- 腾讯文档作为共享上下文，网盘作为 AI 资产存储，乐享作为组织知识空间。
- 支持腾讯会议、腾讯文档、企业微信和外部行业系统；提供专享部署与数据不出域选项。
- 企业微信机器人和远程终端可发起 Agent 任务、查看对话与产物并继续处理。

**为什么威胁高**

- 对中国企业最现实的“微信/企微入口、统一身份、国产生态、私有数据、安全审计”已经形成产品化组合。
- 相比见微自研连接器，腾讯拥有原生渠道和客户基础。

**仍有空间的部分**

- 产品主线偏 Agent 工具、统一管理与内容/任务执行；正式的人际责任转移协议未见公开证据。
- 腾讯文档“文档即上下文”不等于同一协同事项的权威事件与 Projection。

**结论**

企业微信连接本身不能构成见微壁垒；真正壁垒必须在跨平台责任接续和事项状态契约。

官方来源：

- https://cloud.tencent.com/product/workbuddy-enterprise
- https://cloud.tencent.com/document/product/1759/132562
- https://cloud.tencent.com/document/product/1831/137051

### 2.4 华为云 CodeArts Agent Team

**官方公开能力组合**

- Leader 智能编排与 Teammate 自主执行。
- 每位成员有持续独立上下文，跨任务积累知识。
- 成员双向通信、共享任务池、自主认领、动态组队、故障成员自动恢复替换。
- 角色、场景、任务列表、To-Do 和事件驱动可视化均有明确对象。
- 企业、团队、项目和个人级自定义 Agent 具有不同作用域。

**为什么技术上最接近**

- 它已经把持续上下文、任务 owner、动态角色、Agent 间通信和故障恢复做成真实运行时对象。
- 说明“多 Agent + 持续上下文 + 共享任务”在国内不是空白。

**边界**

- 公开产品范围是研发，且强调无需人工干预；不能等价为高风险业务中的具名人工 Gate 和责任接收。
- 人类多人围绕同一事项的私有/共享上下文、业务权威和外部回执仍未覆盖。

官方来源：

- https://support.huaweicloud.com/usermanual-codeartsagent/codeartsagent_ug_0022.html
- https://support.huaweicloud.com/intl/zh-cn/usermanual-codeartsagent/codeartsagent_ug_0051.html

### 2.5 扣子企业版

**官方公开能力组合**

- 企业、组织和工作空间；成员共同开发智能体、应用、Skill 和 Workflow。
- 不同空间资源与数据权限隔离。
- 企业版公开权益包含多 Agent 协作、模型自定义、项目空间、专业技能与多端协同。
- 有 RBAC、OBO 动态权限、访问审计和消息/Trace 日志等企业能力。

**判断**

- 它是国内重要的企业 Agent Builder 与资源协同平台，但公开协同对象主要是 Agent/应用/工作流资源。
- 它没有公开证明一个业务事项在换人、换 Agent 和外部系统后完成具名责任接力。

官方来源：

- https://docs.coze.cn/guides_team_and_enterprise_overview
- https://docs.coze.cn/coze_pro_enterprise_plan
- https://docs.coze.cn/guides_data_security_capability

### 2.6 Qoder Agent Teams

**官方公开能力组合**

- Main Agent 创建具名 teammate，共享 Task list 记录 owner、status 和 dependency。
- Main 与 teammate、teammate 之间通过 SendMessage 沟通和交接。
- 适合研究、实现、测试和独立 Review 分工。
- 支持同一机器、同一用户下不同 CLI 会话的发现与消息投递。

**关键限制**

- Agent Team 当前为 Beta；退出 TUI 后 teammate 与团队状态被清除，`resume` 只恢复主会话历史。
- 它是 coding runtime，不是企业业务协同产品。

官方来源：

- https://docs.qoder.com/zh/cli/agent-teams
- https://docs.qoder.com/zh/cli/cross-session-messaging

## 3. 国内生态分层

### 3.1 入口层已经拥挤

```text
钉钉：悟空 + 组织/审批/文档/应用 + CLI
飞书：豆包 Agent + 群聊/文档/会议/项目 + MCP/CLI
企业微信：智能机器人 + 腾讯 WorkBuddy/智能体平台
```

结论：见微不能把“在群里 @Agent”或“接入中国办公平台”当作核心创新；这些应当只是 Adapter。

### 3.2 Agent 构建层已经商品化

```text
扣子 / 百炼 / 腾讯云智能体 / Dify / FastGPT / MaxKB
```

结论：Agent 编辑器、Skill 市场、Workflow Builder、知识库和模型路由都不应成为见微主产品。

### 3.3 Multi-Agent Team 已经快速成熟

```text
华为 CodeArts Agent Team / Qoder Agent Teams / 飞书 OpenClaw / 扣子多 Agent
```

结论：Agent 分工、共享 Task、成员通信和并行执行也不能成为独特性。

### 3.4 企业治理正在被平台原生吸收

```text
钉钉账号权限 / 飞书应用与数据权限 / 腾讯统一身份审计 / 华为企业与团队 Agent 作用域
```

结论：见微不可能在通用 IAM、组织目录或平台级安全上正面超过头部厂商，只能复用并补充事项级语义。

## 4. 仍未被标准化的空位

### 4.1 从 Agent 协作转向“责任协作”

现有产品大多能回答：

- Agent 做什么；
- Agent 能访问什么；
- Task 当前状态；
- 谁发起了 Agent；
- 结果回到哪个频道或项目。

仍缺少统一产品语义的问题是：

- 哪位具名人类正式接收了下一棒；
- 接收前是否看过完整的 Context Packet；
- 谁拥有当前业务责任与最终决定权；
- 人的决定如何更新 Agent 后续状态；
- 外部动作没有真实回执时，为什么不能宣称完成；
- 多个入口看到的关系、进度和责任是否来自同一权威历史。

### 4.2 从生态内上下文转向跨生态事项连续性

头部平台的优势也是边界：它们倾向以自己的聊天、文档、项目、CRM 或云资源为上下文中心。中国大型企业往往同时存在：

- 钉钉 / 飞书 / 企业微信中的一种或多种；
- 自建 OA、CRM、风控、财务、流程与数据系统；
- 国产模型、海外模型、私有模型与垂直 Agent；
- 不能整体迁移、不能把原始数据集中复制的合规要求。

一个只保存必要协同状态、来源指针、责任变化和真实回执的中立微内核，理论上比复制全部数据更轻。

### 4.3 从管理员治理转向一线高频接力

治理平台解决“有哪些 Agent、权限是什么、是否合规”；一线员工需要的是：

> 我现在要接哪一棒？我必须知道什么？我有权做什么？完成后交给谁？Agent 能否从我的决定继续？

这可能成为见微最小可见产品，而不是大而全控制塔。

## 5. 见微在国内的候选定位

### 5.1 不建议继续使用的主定位

- 企业 AI 工作平台；
- 企业 AI 协同中枢；
- Agent OS / Agent Control Plane；
- 多 Agent 协作平台；
- Agent 与 Skill 市场；
- 企业统一 AI 入口。

这些位置已被钉钉、飞书、腾讯、华为、扣子等明显占据。

### 5.2 推荐继续验证的主定位

产品语言候选：

> **见微是一层企业协同接续层，让同一件事在换人、换 Agent、换系统以后仍然接得上，并明确谁负责、依据是什么、结果是否真实完成。**

技术语言候选：

> **A vendor-neutral Collaboration Case continuity runtime for regulated enterprises.**

它只自研最小语义：

- `CollaborationCase`
- `Participant / AgentIdentityRef`
- `ContextItem / EvidenceRef`
- `Responsibility / HandoffOffer / HandoffAcceptance`
- `HumanGate / Decision`
- `ActionIntent / Receipt`
- `Event / Projection`

其他全部通过 Adapter 接入：身份、IM、项目、文档、Agent、模型、MCP、审批和业务系统。

### 5.3 第一目标企业假设

尚未冻结，但国内更可能需要这一层的不是所有企业，而是：

- 已经拥有多个 Agent 或多个 AI 项目；
- 同时存在多套办公与业务系统；
- 业务跨部门且需要具名责任和人工决定；
- 数据不能整体迁移到单一 SaaS；
- 有私有部署、国产模型、审计和失败关闭要求的金融、保险、制造、能源、医药或大型集团。

经济买方更可能是 AI 转型办公室、科技管理、数字化运营、企业架构或高风险业务流程负责人，而不是普通员工个人。

这是市场假设，必须通过访谈验证。

## 6. 商业价值是否成立

### 成立的部分

- 国内外头部厂商都在投资企业 Agent 的身份、上下文、工作对象、治理和协作入口，说明问题真实存在。
- Agent 数量上升会带来重复建设、权限碎片、上下文割裂、责任不清和监控成本。
- 在监管行业，“AI 做不了时找谁、人的决定如何回到系统、动作是否有真实回执”有明确风险价值。

### 尚未证明的部分

- 企业是否愿意单独采购一个中立接续层，而不是等待钉钉、飞书、腾讯、ServiceNow 等平台补齐功能。
- 见微能否以足够低的集成成本连接现有系统。
- 接力损耗是否足够高频、可量化，能支撑独立产品预算。
- 平台厂商是否会通过原生功能快速覆盖第一版。

因此，当前正确结论不是“市场已被证明”，而是：

> **问题价值已被验证，独立产品形态和支付意愿仍需验证。**

## 7. 对竞赛与学习目标的影响

### 对竞赛

- 不能再用“国内没人做”作为高风险论断。
- 可以说：头部平台都在证明 Agent 会进入组织，但大型企业仍缺跨系统、可问责、可接续的轻量机制。
- 内部十个参赛项目仍大多是垂直能力节点；见微可以站在它们之间的接续层，但必须用一个真实闭环证明，不靠宏大架构图。

### 对学习

这个方向仍非常适合形成成熟能力体系，因为它会迫使项目同时学习：

- 产品发现与竞争定位；
- 企业身份、权限与责任；
- Event、State、Projection 与持久化；
- Agent/MCP/系统 Adapter；
- Human Gate、失败关闭和审计；
- 指标、评估、ROI 与试点设计；
- 中国企业部署、合规和组织采购。

即使最终市场定位继续调整，这套学习资产仍具有高职业价值。

## 8. 下一步验证 Gate

在决定产品冻结前，需要完成三个现实 Gate：

1. **用户 Gate**：访谈 5–8 位来自大型企业 AI/数字化、业务和治理角色的人，确认接力损耗是否高频且足够痛。
2. **替代 Gate**：分别用钉钉悟空、飞书、腾讯 WorkBuddy 的已公开能力回答同一协同事项，明确它们何处已经足够、何处仍断裂。
3. **MVP Gate**：用户亲自完成一次跨两个人、两个 Agent、一个外部系统的具名责任接力；任何入口刷新或 Agent 替换后，权威状态不能丢。

三个 Gate 未通过前，不冻结“大平台”路线，也不扩大实现。

## 9. 证据边界

- 本文使用官方产品页、官方帮助文档、官方新闻与厂商集团公告。
- 悟空仍处邀请 Beta；Qoder Agent Teams 为 Beta；飞书/腾讯/华为不同能力的 GA 状态按各官方页面分别理解。
- 厂商宣传的使用量、客户案例、效率和商业结果未独立复现。
- “未见公开证据”不等于产品内部不存在，也不等于未来不会快速补齐。

