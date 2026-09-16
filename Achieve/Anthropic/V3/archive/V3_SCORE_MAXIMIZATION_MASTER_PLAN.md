# 见微 V3 比赛得分最大化总控计划

更新：2026-08-29  
状态：Gate 1–19 Direction 与 D1 Control contract 已冻结；进入 D2 受控实现，仍不授权生产化 Backend 或真实内网联调

## 1. 唯一目标

交付一个以中国大陆商业融资租赁小微事业部直接租赁 Golden Case 为载体、从商机到正式起租可重复跑通的企业 AI-Native 转型 Demo。

它必须同时向评委证明：

1. **有技术性**：不是聊天壳，而是共享 Context、异步多路运行、Authority、Evidence、Human Gate 和 Receipt 组成的真实闭环；
2. **有可落地性**：不推翻现有系统，能够通过 Adapter、Skill 与 Role Projection 接入，Demo 范围和生产化边界清楚；
3. **有业务价值**：围绕风险调整后净利润，解释时效、风险、成本、客户体验和厂商粘性如何改变经营结果；
4. **直接触达客户**：客户与供应商能够在外部协同 Web 中完成真实可见的材料、问题和确认；
5. **场景丰富但不发散**：领导、业务、风控四专业账号、客户、供应商围绕同一个 Case 协同，而不是制作多个互不相干的 Demo；
6. **能稳定演示**：固定输入、确定性结构化输出、三次连续完整回放、异常可恢复、证据可审查。

一句话定位：

> 见微不是替代融资租赁现有系统的超级应用，而是用同一 Case Context 把人、规则、既有系统和 Agent 组织起来，让小微直租从商机到起租更快、更准、更透明，并让每次关键判断都有 Evidence、Authority 与 Receipt。

## 2. 范围护栏

### 当前必须完成

- 小微融资租赁唯一经营域；
- 一个直接租赁 Golden Case 完整闭环；
- 少量直租 / 存回 / 新回背景 Case；
- 领导、业务、风控、外部协同四个 Role Application；
- 商机、政策、信审、商务、资产五路异步 Thread；
- 一个 Backend Authority Kernel 和一个前端代码库；
- Desktop / Mobile responsive；
- 固定合成 Scenario、最小 Demo Backend、真实可操作前端与严格本地验收。

### 当前明确不做

- 真实内网、真实客户或集团生产数据接入；
- 汽车融资租赁、中大事业部及其他经营域；
- 通用 OA、CRM、项目管理、绩效管理或企业战略执行平台；
- 完整生产数据库、生产 RBAC、高可用、全量规则开发平台和资产管理系统；
- 两条同等重量的直租 / 回租 Golden Case；
- 把 12 个组织角色建成 12 套应用或 12 个 Agent authority；
- 用静态内容伪装模型调用、系统回执或已落地经营收益。

## 3. 比赛主证明链

以下闭环顺序已由 Gate 18 冻结：

1. 领导 God View 发现某项小微 KPI / 组合偏差；
2. 下钻到影响偏差的 Golden Case，查看当前起租五格、五路状态和 Evidence 依据；
3. 切换业务视角，展示商机、现场采集、客户需求和供应商 / 设备信息如何进入 Case；
4. 一个有权事实确认形成新 Context Version，并同时触发五路 candidate run；
5. 客户或供应商通过外部 Web 完成被邀请的材料 / 问题 / 确认，内部不需要重复上传；
6. 政策、信审、商务、资产账号看到同一 `caseId` 的不同 Role Projection，并只对本专业 Gate 有权；
7. 新 Evidence 可以推进某些 Thread，也可以让某一路回退并产生补件；旧结果保留且标记 stale；
8. 商务条件、必要资产查验和专业 Human Gate 满足后，正式起租，Case 五格全黑；
9. God View 的 Case / Portfolio / KPI Projection 更新；领导追问、比较 Shadow 方案并下发管理要求，但不替专业人员作判断；
10. 展示 Event、Diff、Context Version、Action 与 Receipt，证明整个过程可回放、可审计、可接入现有系统。

## 4. 评分维度与必须出现的证据

| 评分维度 | 评委直接看到 | 后端 / 契约证据 | 不能采用的替代品 |
| --- | --- | --- | --- |
| 技术性 | 五路独立更新、Context 版本、旧结果被取代、Gate 与 Receipt | Event Ledger、统一 Trigger、run binding、idempotency、权限失败关闭 | 五段假进度、静态聊天气泡 |
| 可落地性 | 同一 Case 在四角色连续流转、界面说明可接入既有系统 | 单内核、Adapter interface、受控 Context Packet、确定性 Scenario | 宣称已经接入内网或建设完整生产系统 |
| 价值性 | KPI 偏差、Case 归因、起租时效、风险 / 成本 / 收益解释 | 版本化目标、Case actual Projection、净利润 driver 关系 | 未经验证的节省比例、准确率和利润数字 |
| 客户触达 | 客户 / 供应商实际打开 Web、提交材料、回答问题、确认事实 | external principal、invitation scope、Evidence Event、Receipt | 内部人员代替外部角色点击 |
| 场景完整度 | 领导、业务、四类风控账号、客户、供应商围绕同一 Case | 同一 `caseId`、一个 Context、Role Projection 与权限矩阵 | 多个互不相干的样板页面 |
| 创新性 | AI 自动协同但不越权，人只在高价值 Gate 介入 | candidate authority=none、targeted context、Human Gate | “用了大模型”或堆叠 Agent 名称 |

## 5. 分阶段交付

### D0：Direction 收口（已完成）

目标：把会导致大规模返工的产品问题全部冻结。

需要收口：

- 比赛主叙事的进入顺序与高潮；
- Golden Case 的宏观事实、角色和关键转折；
- 四 Role Application 的一级信息架构；
- 哪些能力属于真实演示，哪些只展示 extension path；
- 严格验收矩阵与停止条件。

产物：更新 `V3_DIRECTION_FREEZE.md`，不编写大规模产品代码。

### D1：Control 与契约冻结（已完成）

目标：让前端、后端、场景内容和验收可以独立执行且不会互相猜。

已形成并通过一致性检查：

- [x] `V3_DEMO_NARRATIVE_CONTRACT.md`：演示故事、页面顺序、每一步得分意图；
- [x] `V3_GOLDEN_CASE_SCENARIO_CONTRACT.md`：固定输入、事件节奏、角色确认、正式起租输出；
- [x] `V3_ROLE_PROJECTION_CONTRACT.md`：四应用、多 Case Panel、Workbench、权限和字段可见性；
- [x] `V3_API_AND_EVENT_CONTRACT.md`：Case、Context、Run、Gate、Action、Receipt 与 Projection；
- [x] `V3_ACCEPTANCE_MATRIX.md`：测试、HTTP、浏览器、演示回放和证据清单。

Gate 结果：`PASS`。五份契约使用同一个 `FinancingLeasingCase` Authority、同一 T1/T2/T3、同一 principal / Action boundary 与同一最终验收，不存在第二权威对象或阻断实现的未决架构问题。

### D2：受控实现（当前阶段）

目标：在现有 `jianwei-v3/site` 上完成 V3，不重新初始化项目、不复制后端。

执行原则：

- 主 Control task 保留产品方向、共享契约、集成与最终验收；
- 合格的大型编码工作按冻结契约拆成四个文件所有权互斥、可独立验收的 Z lane；
- 前端优先投入，后端只实现固定 Golden Case 演示所需 Authority 与稳定性；
- 先打通最小端到端，再完成视觉与角色差异；
- 不部署、不 Git 写入、不安装依赖，除非用户另行授权。

预计实现模块：

1. Case Repository、背景 Case 与 Portfolio Projection；
2. 共享 Case Shell、Case Panel 和四类 Role Workbench；
3. Golden Case Scenario runner、统一 Context Trigger 与五路 partial run；
4. Evidence / Event / Diff / snapshot、Human Gate、Action、Receipt；
5. Leader God View、KPI 下钻、Shadow 候选和非覆盖式 Management Action；
6. Business Mobile、Risk professional projection、External customer / supplier Web；
7. 演示控制、状态恢复与 evidence capture。

### D3：集成与严格验收

目标：由主 Control 独立复验，不以 worker 自报、代码静态检查或旧截图代替。

需要通过本文件第 6 节全部 Gate；失败则回到对应模块修复，不带缺陷进入演示打磨。

### D4：决赛演示打磨

目标：在不改变 Authority 和场景事实的前提下，提高 3–5 秒可读性、讲述节奏、角色切换连续性和现场容错。

产物包括：

- 正式演示脚本和备用短路线；
- Golden Case 固定初始状态与 reset；
- 现场提示卡；
- 关键页面截图 / 录屏与技术证据包；
- 三次连续完整演示记录；
- 已知限制与答辩口径。

## 6. 严格验收标准

### 6.1 范围与权威

- 运行时只有一个 `FinancingLeasingCase` Authority Kernel；
- 四个前端不得保存或维护第二份业务真相；
- 所有正式状态变更都能定位到 Event、Context Version、principal、Action / Gate 与 Receipt；
- 模型、规则候选、Chat 和前端均不能直接改写权威事实；
- 领导写专业 Gate、风控账号互相代签、外部访问内部 Context 均必须失败关闭。

### 6.2 Golden Case

- 固定直接租赁 Scenario 从商机开始，完整到正式起租；
- 客户、供应商、设备、材料、政策、信审、商务、资产预判断和起租输出彼此一致；
- 相同 Scenario version + 操作脚本产生相同的结构化 Event / Context / Receipt 序列；
- 至少三次连续 reset → full run 成功，中间不得人工改数据库或源代码救场；
- 背景 Case 拥有独立 `caseId` 和一致摘要，不复用 Golden Case 权威数据。

### 6.3 五路异步

- 一次已确认的 Context 更新触发商机、政策、信审、商务、资产五路运行；
- 五路可以 partial completion，不伪装同时完成；
- 新 Context 到来后旧 run 保留并标记 stale / superseded；
- 高风险或矛盾 Evidence 可以让单路 readiness 回退并提出补件；
- 正式起租后 Case 五格全黑；租后生命周期不反向阻塞起租完成度。

### 6.4 四角色与客户触达

- 四个 Role Application 都有多 Case Panel 和单 Case Workbench；
- 同一 `caseId` 进入不同 Role Projection，内容和动作真实不同；
- 业务与四类风控账号可见五路，但写权限严格区分；
- 客户和供应商只看到自己的 invitation、当前问题、有限进度与确认；
- 外部提交实际形成 Evidence / Event，并触发新的共享 Context，而不是仅改变页面本地状态。

### 6.5 领导闭环

- 支持小微 KPI 的目标、应达、实际、差值、趋势与 Case 归因；
- 时间颗粒度与组织下钻使用同一受控数据口径；
- Leader Agent 能解释偏差、提出多个候选和 Shadow 比较；
- 领导确认后形成管理 Action 与 Receipt；
- 管理 Action 不能把专业 Gate 直接改成通过 / 否决。

### 6.6 工程与浏览器

- 项目既有 tests、typecheck / lint、production build 全部通过；
- HTTP contract 覆盖正常、无效输入、404、权限拒绝、idempotent replay、同 key 异载荷冲突、模型失败 / 超时和并发；
- 真实浏览器至少覆盖 1920×1080 Desktop、常用笔记本宽度和约 390px Mobile；
- 四应用关键路径无整体横向溢出，主要动作键盘可达，fresh console error / warning 为 0；
- Case / role / process 切换后内容、权限和 Receipt 不串页；
- 本地服务来自最新 production build，PID / port / build artifact 一致，无 stale server 冒充。

### 6.7 真实性与比赛证据

- 合成来源与 Scenario version 保存在 Backend metadata；业务页面不必常驻水印；
- 不出现真实客户身份、集团秘密、生产凭据或未经授权材料；
- 不把本地规则、静态候选或未验证模型写成 live AI；
- 每个拟宣传能力至少有一个可操作页面证据和一个后端 / Receipt / test 证据；
- 未实现能力只列为 extension path，不进入“已完成”清单；
- 净利润、效率和风险价值通过因果链解释，不编造已实现百分比。

## 7. 只有这些情况需要暂停问用户

- 需要改变小微直接租赁 Golden Case、五路主链或四 Role Application；
- 需要新增第二类业务 Authority 或复制 Case 状态；
- 需要改变领导 / 专业 Gate 权力边界；
- 需要使用真实内网数据、真实客户材料、真实凭据或对外部署；
- 需要从 Demo 升级为生产系统或显著增加后端深度；
- 新证据证明已冻结方向不可行；
- 验收标准、演示时长或评委要求发生会改变方案的变化。

页面局部文案、组件布局、测试修复、稳定性修复、固定合成数据补齐和契约内实现，不再逐项请求确认。

## 8. 当前最近的三项 Direction 工作

1. [x] 冻结比赛叙事入口：从 `协同` God View 自上而下进入；
2. [x] 冻结 Golden Case 的宏观事件节奏和 T1 / T2 / T3 三次关键 Context 转折；
3. [x] 冻结比赛最终验收矩阵及证据呈现方式。

完成这三项后进入 D1 Control，不再继续无限讨论 Direction。
