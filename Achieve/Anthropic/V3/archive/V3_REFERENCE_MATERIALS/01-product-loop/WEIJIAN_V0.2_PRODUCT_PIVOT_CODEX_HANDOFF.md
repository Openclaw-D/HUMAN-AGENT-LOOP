# 见微 V0.2｜Human–Model Shared Judgment System
## Product Pivot & Codex Development Handoff

> **用途**：本文件是见微 V0.2 的产品方向变更说明与 Codex 开发交接。  
> 它不是重新设计一个新项目，而是要求 Codex **继承当前 `Openclaw-D/signal-council` 代码与已验证能力**，在现有基础上完成 V0.2 的产品中心迁移。  
> 当本文件与旧的“AI 风控分析 / Agent 为中心 / 最终结论为中心”产品表述冲突时，**本文件中的 V0.2 产品定义优先**；当涉及代码、接口、测试、当前运行状态时，**当前仓库、Git 状态和实际测试结果优先于本文件**。

---

# 0. 开发启动要求

## 0.1 当前可见 GitHub 基线

- Repository：`Openclaw-D/signal-council`
- Default branch：`main`
- 本交接生成时 GitHub 最新可见 commit：
  - `3cbaa1a488d684e3160d5a87a5a97e4593228bda`
  - `release: finalize authenticated synthetic demo`
  - 2026-08-16

**注意：**  
该 commit 只作为本交接的远端可见基线。Codex 开工前必须重新读取：

1. `git status`
2. 当前 branch / HEAD
3. `Compare/AGENTS.md`
4. `Compare/STATUS.md`
5. `Compare/DECISIONS.md`
6. 当前 Front / Back README
7. 当前测试与运行结果

如果本地存在更新但尚未推送，以本地当前代码事实为准，不得为了匹配本文件回退真实更新。

---

# 1. V0.2 核心转向

## 1.1 旧中心

V0.1 的大量能力围绕以下逻辑建立：

> 材料 → AI/规则分析 → 风险结果 → 审批建议

它已经拥有较强的证据、规则、事实版本、人工边界、Agent advisory-only、审计与权限能力，但产品重心仍容易被理解为：

> **“一个更可靠的 AI 风控分析系统。”**

V0.2 不否定这些能力，但需要改变产品中心。

## 1.2 新中心

V0.2 正式定义为：

> **见微是一套面向融资租赁风险审批的人机共同判断系统。它不以自动输出审批答案为核心，而是把业务人员、风控人员、项目证据、制度规则、模型能力和系统状态组织到同一个持续演化的判断空间中，通过多轮取证、校正和判断更新，提高整个组织的风险判断质量。**

核心不是：

> AI 给出什么答案？

而是：

> **这个判断是如何一步步形成、被证据修正、被人理解、被系统保存，并最终由授权人员承担责任的？**

---

# 2. 核心方法论

V0.2 使用以下四层结构：

## 2.1 Shared Judgment Space｜共同判断空间

项目当前的共享认知状态。

它不是单纯聊天记录，也不是某个 Agent 的上下文，而是当前项目已经形成的：

- 已确认事实
- 证据与定位
- 异常与冲突
- 当前判断主张
- 业务解释
- 风险解释
- 制度边界
- 未解决问题
- 不确定性
- 可选方案
- 条件变化
- 当前送审成熟度
- 下一步最有价值动作
- 判断演化历史

**人通过前端理解这个空间；模型通过结构化后端状态读取这个空间；系统负责维护其真实性、版本和边界。**

## 2.2 Judgment Loop｜判断循环

不采用：

> 一次巨大输入 → 长程模型运行 → 一个最终答案

而采用：

> **Observe → Evidence → Update → Verify → Rejudge**

即：

> 发现 → 取证 → 更新 → 验证 → 再判断

一次模型调用应尽量解决一个明确认知问题，而不是一次性“分析整个项目”。

典型循环：

1. 当前判断存在不确定性；
2. 系统识别最大信息缺口；
3. AI 给出 Next Best Evidence / Action；
4. 业务人员在现场补材料、拍照片、询问客户或修正事实；
5. 系统验证并形成新的 Fact / Evidence 状态；
6. AI 更新倾向性判断；
7. Judgment Diff 展示“这次新信息改变了什么”；
8. 若仍存在关键不确定性，继续下一轮；
9. 当项目达到足够成熟状态，再进入正式送审。

该方法与敏捷开发 / Harness Looping Engineering 的哲学一致：

> **小步运行、快速验证、持续纠偏，而不是长程执行后才发现方向错误。**

## 2.3 Chain of Judgment｜判断链

最终产品不能只有：

> 通过 / 退回 / 否决

也不能只是：

> 结论 + 一段 AI 解释

V0.2 应让用户看到一条可理解、可回溯的判断形成路径，例如：

> 流水下降  
> → 与申报收入存在冲突  
> → 业务解释为季节性  
> → 新订单部分支持该解释  
> → 但回款周期仍然偏长  
> → 现金流承载仍偏弱  
> → 若融资成数降低，偿债压力下降  
> → 当前建议由“补充后再审”更新为“具备送审条件，但需附条件”

**路径本身就是解释。**

不展示模型隐藏 Chain of Thought；展示的是组织可验证的 **Chain of Judgment**。

## 2.4 Organizational Memory｜组织记忆

一次好的判断必须能够给下一次判断产生复利。

但不能：

> 案例结论 → AI 自动升级成正式规则

正确路径：

> Case  
> → Judgment  
> → Pattern  
> → Rule Candidate  
> → 风控验证 / 授权  
> → Versioned Rule  
> → Future Case

AI 可以发现模式、提出规则候选，但正式制度和 Hard Gate 仍必须经过人的授权和版本管理。

---

# 3. V0.2 第一用户：业务人员

## 3.1 产品立场

**风控应当为业务服务。**

风控专业能力最有价值的形态，不是每个项目都依赖真实风控人员高频介入，而是：

> **把风控经验、判断框架、制度边界和常见追问沉淀到系统中，让业务人员在客户现场就获得专业风险辅助。**

V0.2 的第一核心用户正式定义为：

> **正在客户现场进行尽调、取证和材料收集的业务人员。**

风控人员仍然重要，但角色从大量重复项目介入，逐渐上移到：

- 判断框架设计
- 制度边界
- Hard Gate
- 模型/规则校准
- 复杂例外
- 风险政策更新
- 最终授权与责任
- 组织经验沉淀

---

# 4. 现场核心场景

业务人员在手机端完成尽可能完整的现场循环：

```text
进入客户现场
↓
查看当前项目判断状态
↓
拍照 / 上传材料 / 补充业务解释
↓
系统建立或更新 Evidence / Fact
↓
AI 形成新的辅助判断
↓
Judgment Diff 显示“发生了什么变化”
↓
系统提示 Next Best Evidence / Action
↓
业务继续现场取证
↓
重复多轮
↓
Submission Readiness 达到足够水平
↓
业务主动送审
↓
正式审批流程继续由授权人员和正式规则承担
```

目标不是“规避风控”或“自动通过”。

目标是：

> **把风险发现、材料补全和大量低价值往返前移到客户现场，使进入正式审批的项目本身已经更加成熟，从而减少退回、补件、重复沟通和无效送审。**

---

# 5. Human × Model × System × Risk

## 5.1 Human / Business

负责：

- 真实客户语境
- 现场观察
- 客户沟通
- 新证据获取
- 业务解释
- 对 AI 候选事实进行确认或修正
- 决定何时正式送审

业务人员不是“材料搬运者”，而是：

> **AI 增强的现场调查者。**

## 5.2 Model / AI

定位：

> **Judgment Augmentation Layer｜判断增强层**

AI 不是正式审批者，也不能直接修改正式判断状态。

AI 可以持续产生：

- Candidate Fact
- Candidate Judgment Claim
- 风险提醒
- 异常/冲突
- 可能解释
- 替代解释
- 反证搜索
- 情景推演
- 条件变化分析
- Next Best Evidence
- Next Best Action
- Judgment Diff 候选
- Submission Readiness 倾向性估计
- 通过 / 退回 / 否决的辅助倾向

AI 输出是**动态辅助判断**，可随着新证据实时更新。

## 5.3 System

System 的职责不是固定字段，而是：

> **保存当前场景需要的共享状态、边界、历史和可执行流程，使人和模型能够围绕同一目标持续协作。**

在风险场景中主要承载：

- Material
- Evidence
- Fact / FactVersion
- Rule / Policy
- Review Event
- Permission
- Judgment Claim
- Judgment Diff
- Open Issue
- Submission Readiness
- Approval State
- History / Audit

## 5.4 Risk

风控人员不是被系统替代，而是把专业能力“上移”。

重点负责：

- 风险判断框架
- 必须判断什么
- 哪些风险不能补偿
- Hard Gate 与政策
- 哪些 AI 判断经常错误
- 如何修正规则 / Prompt / Context / Calibration
- 哪些项目必须人工介入
- 最终正式审批授权

---

# 6. AI 权限边界

## 6.1 禁止

AI **不得直接**：

- 修改正式 Fact；
- 覆盖人工确认的 FactVersion；
- 修改正式 Rule / Policy；
- 修改 Hard Gate；
- 修改正式 Approval State；
- 把自己的判断变成正式审批决定；
- 把未知信息伪装成事实；
- 把模拟/推断结果冒充真实证据。

## 6.2 允许

AI 可以：

- 生成 Candidate；
- 提醒；
- 提问；
- 预判；
- 给出倾向；
- 给出可解释的状态更新建议；
- 在明确规则范围内执行可验证的自动动作；
- 把候选变更提交给业务/风控确认。

正式状态写入必须满足至少一种：

1. 确定性系统规则可验证；
2. 有明确证据并经过授权流程；
3. 人工确认。

---

# 7. 新核心对象

V0.2 不要求一次性推翻现有数据模型。

优先复用：

- `EvidenceReference`
- `EvidenceLocator`
- `FactVersion`
- `HardConstraintResult`
- `CommonReviewEvent`
- `RiskDetermination`
- `ApprovalState`
- Agent message / execution provenance
- immutable history

新增对象应保持**最小化**。

## 7.1 Judgment Claim｜判断主张

解决：

> **“这些事实目前意味着什么？”**

建议最小字段：

```text
id
projectId
dimensionId / scope
statement
status: proposed | supported | disputed | resolved
supportingEvidenceRefs[]
contradictingEvidenceRefs[]
factVersionIds[]
assumptions[]
conditions[]
owner: business | risk | joint | system_candidate
confidence / strength (仅辅助)
createdAt
updatedAt
version
```

示例：

> “客户未来 6 个月收入持续性目前得到中度支持。”

它不是 Fact，也不是 Rule，更不是 Approval。

## 7.2 Judgment Diff｜判断变化

解决：

> **“这次新增信息到底改变了什么？”**

必须能够表达：

- 新增了什么事实；
- 哪个 Claim 被强化；
- 哪个 Claim 被削弱；
- 哪个风险没有变化；
- 哪个不确定性被消除；
- 哪个新问题被发现；
- Submission Readiness 为什么变化；
- 下一步应该做什么。

示例：

```text
新增证据：
2026-08~10 在手订单合计 680 万

变化：
收入持续性：弱支持 → 中度支持

未变化：
核心客户回款周期仍偏长

送审成熟度：
63 → 76

下一步：
核验两家核心客户近 6 个月真实回款
```

Judgment Diff 应成为业务人员非常容易理解的核心反馈。

## 7.3 Next Best Evidence / Action

解决：

> **“有限现场时间里，现在再做什么最值得？”**

V0.2 应尽可能从：

- 当前最大不确定性；
- 当前风险主张；
- 缺失证据；
- 制度要求；
- 可能改变判断的变量；

中生成 1–3 个优先动作。

示例：

1. 获取未来三个月在手订单；
2. 核验核心客户历史回款；
3. 补拍设备铭牌及当前运行状态。

未来可以引入 Value of Information 思想，但 V0.2 不需要硬做复杂数学模型。

---

# 8. Submission Readiness｜送审成熟度

V0.2 接受使用“倾向性分值 + 状态解释”。

暂时**不把它包装成统计意义上的真实通过概率**，除非未来拥有足够真实历史项目并完成概率校准。

建议：

```text
Submission Readiness: 0–100
```

它只作为 Navigation Signal，不是审批结论。

建议由以下因素构成：

- 必要材料完整度
- 关键 Evidence 可定位程度
- Fact 确认程度
- 关键冲突解决程度
- Hard Gate 状态
- 主要 Judgment Claim 稳定程度
- 未决问题数量与严重度
- 剩余不确定性
- 是否仍存在明显可能导致退回的缺口

用户必须能看到：

> **为什么是这个成熟度？什么动作最可能让它发生变化？**

示例：

```text
送审成熟度 78

✓ 必要材料基本完整
✓ 当前未发现制度阻断
✓ 主要交易事实已核实
△ 收入持续性仍有一项弱不确定性
△ 两项证据尚未精确定位

下一步最优动作：
补充核心客户回款记录
```

---

# 9. 辅助“概率 / 倾向”如何处理

业务现场需要即时预判，这是合理需求。

V0.2 可以显示：

- 当前支持送审倾向
- 当前退回风险倾向
- 当前否决风险提醒

但必须明确它们属于：

> **Model-assisted provisional tendency**

而不是正式审批概率。

如果要使用百分比，必须：

1. 明确“当前辅助估计 / 未校准”；
2. 给出影响该数值的主要因素；
3. 随 Evidence / Claim / Rule 状态动态更新；
4. 不得覆盖 Hard Gate；
5. 不得被用于自动审批；
6. 不得暗示统计校准能力尚未存在。

最终正式结论仍由人和正式流程承担。

---

# 10. Shared Judgment Space 的前端方向

## 10.1 原则

V0.2 **不是全面重做前端**。

应基于现有 UI 小步调整，先验证新产品中心。

当前三栏协作结构可以继续利用，但应改变层级：

### 旧理解

业务对话｜协作事实流｜风控对话

### V0.2 新理解

业务 / AI 输入  
→ **Shared Judgment Space（主空间）**  
← 风控 / 系统 / 规则输入

中间不再只是“三栏中的一栏”，而是整个项目最重要的共享状态。

## 10.2 V0.2 手机端第一屏优先信息

业务现场打开项目时，应优先看到：

1. **当前判断状态**
2. **Submission Readiness**
3. **当前 1–3 个主要风险 / 不确定性**
4. **最近 Judgment Diff**
5. **Next Best Action**
6. **是否存在 Hard Gate / 强提醒**
7. 快速拍照 / 上传 / 补充说明入口

避免首屏优先：

- Agent 设置；
- 大量模型 provenance；
- 大量评分表；
- 完整六维分析；
- 大篇幅最终报告。

这些能力仍可下钻查看。

## 10.3 评分定位调整

现有六维 Score / Grade 暂时保留。

但 V0.2 正式定义：

> **Score = Navigation Signal，不等于 Judgment。**

六维评分用于帮助用户快速定位重点，不再作为产品哲学中心。

---

# 11. Agent / Claude Tag 式交互方向

V0.2 不再强调“全局 focusRole”作为用户主要认知。

目标体验更接近：

> 大家在同一 Shared Judgment Space 中自然协作，需要某个模型能力时随时调用。

Agent / Model 应更自然地附着到：

- 当前问题
- 当前 Claim
- 当前 Evidence
- 当前 Diff
- 当前任务

而不是让用户理解一套复杂 Agent 路由机制。

现有 `focusRole`、Agent thread、execution provenance 暂时保留兼容，不要求本轮大规模删除。

**原则：先降级其产品可见性，再决定后续是否重构底层。**

---

# 12. Model Context 转向

现有上下文组织已经具备：

- 项目摘要
- Dimension
- Policy
- Selected Evidence
- Selected Fact
- Approval
- Recent Messages
- Citation Allowlist
- Hash / provenance / fail-closed

这些全部保留。

V0.2 需要逐步从：

> `recent messages + selected context`

转向：

> **Current Judgment State + Relevant History + Current Task**

建议未来模型上下文优先级：

1. Hard rules / system boundaries
2. Current authoritative facts
3. Current evidence state
4. Current Judgment Claims
5. Open conflicts / uncertainties
6. Current Submission Readiness factors
7. Relevant Judgment Diffs
8. Relevant recent interaction history
9. Current user instruction

即：

> **State > Relevant History > Message**

不要一次性塞入全部历史。

---

# 13. V0.2 最小业务闭环

V0.2 必须优先证明一个完整场景，而不是增加更多功能。

## 示例验收场景

### 初始状态

业务人员打开项目：

- Submission Readiness：55
- 最大不确定性：收入持续性
- 当前主要风险：流水下降且与申报收入不一致
- Next Best Evidence：在手订单 + 核心客户回款

### 第一次现场补充

业务上传订单。

系统：

- 建立 / 更新证据；
- 提供 Candidate Fact；
- 业务确认；
- Judgment Claim 更新；
- Judgment Diff：
  - 收入持续性：弱支持 → 中度支持
  - Readiness：55 → 68
- Next Best Action：核验真实回款。

### 第二次补充

业务上传核心客户回款材料。

系统：

- 核验并建立 Fact；
- AI 重新判断；
- Readiness：68 → 82；
- 判断显示主要风险已明显降低；
- 仍存在回款周期偏长，但可由融资条件部分补偿；
- 给出可送审状态解释。

### 送审

业务点击送审。

此时系统：

- 不自动审批；
- 将当前 authoritative Fact / Evidence / Claim / unresolved items / Judgment Diff / rules / readiness 状态带入正式审批；
- 风控或授权审批人员能够快速理解项目是如何走到当前状态的。

**该闭环是 V0.2 最重要的产品证明。**

---

# 14. 当前代码应保留的能力

以下能力与 V0.2 高度一致，不应为了新版本重写：

- Evidence 精确定位
- FactVersion
- Business Correction
- Hard Constraint / Policy Gate
- 正式 Review Event
- immutable / auditable history
- Agent advisory-only
- authentication / project membership / ACL
- idempotency
- context/input/output hash
- fail-closed provider
- explicit simulated / real boundary
- 人工审批责任边界
- 当前正式 Approval State
- Front / Back / Integration 独立验收思想

---

# 15. 需要降级的旧中心

以下能力不一定删除，但不再作为产品中心：

- “最终结论报告”作为主要产品入口
- Score / Grade 作为核心判断表达
- Agent 数量或 Agent 路由本身作为卖点
- 全局 `focusRole` 作为主要用户概念
- 一次大模型调用完成全项目分析
- 以“AI 给出的结论”为核心价值
- 以自动审批为目标

---

# 16. V0.2 暂不处理

避免范围膨胀，本阶段明确不做：

1. 自动正式审批；
2. AI 自动修改 Rule / Hard Gate；
3. AI 自动把案例升级为制度；
4. 未校准的“真实通过概率”承诺；
5. 大规模 Multi-Agent 架构重写；
6. 新增大量 Agent；
7. 全面前端重构；
8. 为视觉效果重做现有成熟模块；
9. 大规模数据库重写；
10. 自动训练 / Fine-tune；
11. 复杂统计贝叶斯引擎；
12. 真正生产级公网部署；
13. 用模型隐藏 Chain of Thought 作为产品输出。

---

# 17. 推荐开发拆分

## P0｜Control / Current-State Verification

唯一目标：

> 确认当前代码事实，并建立 V0.2 安全改造边界。

要求：

- 读取当前 repo / branch / status；
- 跑现有 Front / Back / Integration Gate；
- 标出 V0.2 可直接复用的数据模型和 UI；
- 不改业务功能；
- 输出最小修改清单。

验收：

- 没有因为 V0.2 文档误判当前代码；
- 当前 baseline 可重复运行；
- 明确哪些文件允许进入下一阶段修改。

## P1｜Judgment State Contract

唯一目标：

> 在不破坏现有 Fact / Evidence / Review / Approval 的情况下，建立最小 Judgment Claim / Diff / Readiness contract。

要求：

- 优先复用现有表和 event；
- 不为“架构漂亮”新增大量表；
- formal / advisory 边界清晰；
- 支持版本 / traceability；
- 建立 focused tests。

验收：

- 给定新增 Evidence，可以生成一个可验证的 Judgment Diff；
- AI candidate 不会直接修改正式 Fact / Approval；
- Readiness 能解释构成原因。

## P2｜Business Field Loop UI

唯一目标：

> 让业务人员在手机端真正完成一次“补证 → 更新 → Diff → 下一步”的循环。

要求：

- 基于现有页面最小调整；
- Shared Judgment Space 升级为主认知区域；
- 首屏显示：
  - readiness
  - current risk / uncertainty
  - latest diff
  - next action
  - upload / photo / explanation entry
- 不做全面视觉重构。

验收：

- 手机 viewport 可完成核心流程；
- 新 Evidence 提交后，用户明确看到“什么改变了”；
- 用户知道下一步应该做什么；
- 无横向溢出；
- Console 无错误。

## P3｜Model Context Pivot

唯一目标：

> 模型从“最近聊天驱动”转向“当前 Judgment State 驱动”。

要求：

- 保留 bounded context；
- 保留 citation allowlist；
- 保留 provider validation / fail closed；
- 新增当前 Claim / uncertainty / readiness / diff 上下文；
- recent message 只作为补充。

验收：

- 同一个项目在聊天历史较少时仍能基于 Judgment State继续；
- 模型不能引用未授权 Evidence；
- 模型不能修改 formal state；
- 新 Evidence 能改变辅助判断；
- 没有新 Evidence 时不能伪造变化。

## P4｜Submission Loop & Acceptance

唯一目标：

> 完成 V0.2 端到端演示案例。

必须证明：

```text
Initial Judgment
→ Next Evidence
→ Business Upload
→ Human/System Confirmation
→ Judgment Diff
→ Updated Readiness
→ Next Action
→ Second Evidence
→ Updated Judgment
→ Ready to Submit
→ Formal Human Workflow
```

并分别报告：

- Front Gate
- Back Gate
- Integration Gate
- Mobile Gate
- Permission Gate
- AI authority boundary Gate

---

# 18. Codex 工作原则

本次开发必须遵守：

1. **继承当前代码，不从零重写。**
2. 一次只解决一个主要问题。
3. 小步运行，小步测试，小步集成。
4. 每个阶段必须运行后再进入下一阶段。
5. 不因为 V0.2 是“大版本”就进行无方向重构。
6. 当前测试通过的能力优先复用。
7. Front / Back contract 先冻结最小变化。
8. AI candidate 与 formal state 必须保持物理或逻辑边界。
9. 所有重要 Judgment change 必须可追溯。
10. 新设计如果无法明显提升业务现场判断质量，不进入 V0.2。
11. 任何“更智能”设计都必须回答：
    - 输入是什么？
    - 根据什么判断？
    - 输出是什么？
    - 用户如何验证？
    - 错了如何修正？
    - 新证据如何改变结果？
12. 不追求一次模型调用“完美完成”；优先多轮可校正闭环。

---

# 19. V0.2 产品验收标准

V0.2 成功，不以“新增多少 AI 功能”为标准。

必须满足：

## 业务价值

- 业务人员可以在客户现场独立获得风险辅助；
- 系统能够告诉业务“现在最值得补什么”；
- 新材料能够明确改变当前判断状态；
- 用户能够看懂为什么判断发生变化；
- 送审前可以识别明显退回风险和材料缺口。

## 判断质量

- Fact / Inference / Claim / Rule / Decision 不混淆；
- 未知事项被显式保留；
- Hard Gate 不被模型覆盖；
- AI 可以探索，但不能创造正式事实；
- 结论可以回到证据。

## 协作价值

- 业务、AI、风控、系统围绕同一项目状态工作；
- 不依赖某一个人的私有聊天记忆；
- 换人、换时间、换模型后仍能理解当前判断；
- 重要判断能进入组织记忆。

## 工程价值

- 当前核心测试不回退；
- 所有新增状态有清晰 contract；
- 可回滚；
- 可审计；
- 本地可运行；
- 不依赖不必要的新基础设施。

---

# 20. V0.2 对外核心表达

不要把 V0.2 描述成：

> “AI 自动审批系统”

也不要只描述成：

> “用了 Agent / MCP / Skill / 大模型”

推荐表达：

> **见微不是让 AI 替公司做风险判断，而是把业务、风控、证据、规则、模型和系统组织进同一条持续演化的判断链。业务人员在现场不断补充新证据，系统实时展示判断发生了什么变化、下一步最值得做什么，并在项目足够成熟后进入正式人工审批。AI 提升的不是一个答案，而是整个组织形成高质量判断的能力。**

---

# 21. 本阶段正式结论

## 决定

见微 V0.2 从：

> **AI 风控分析工具**

正式转向：

> **Human–Model Shared Judgment System｜人机共同判断系统**

第一用户：

> **业务现场人员**

核心工作方式：

> **Evidence-driven Judgment Loop｜证据驱动的判断循环**

核心产品对象：

> **Shared Judgment Space｜共同判断空间**

核心解释结构：

> **Chain of Judgment｜判断链**

核心反馈机制：

> **Judgment Diff｜判断变化**

核心行动机制：

> **Next Best Evidence / Action**

核心送审信号：

> **Submission Readiness｜送审成熟度**

AI 定位：

> **Judgment Augmentation Layer｜判断增强层**

最终责任：

> **Human Accountable Decision｜人承担正式判断责任**

---

# 22. Codex 开工指令

> **将本文件视为 V0.2 产品方向事实，而不是要求立即重写所有代码。**
>
> 开工后第一步先读取当前仓库、Git 状态、AGENTS、STATUS、DECISIONS、当前测试和本文件，对照当前实现形成一份 V0.2 Gap Map。
>
> 然后从当前代码继续，不恢复旧 Demo、不扩大范围、不自行重构。
>
> 先完成 P0 Current-State Verification，再按 P1 → P2 → P3 → P4 小步推进。
>
> 每个 Phase 都必须：
>
> **Front → Back → Control / Integration → Acceptance Gate**
>
> 当前代码事实优先于本文中的工程假设；本文只冻结 V0.2 的产品目标、判断哲学、边界和验收方向。
