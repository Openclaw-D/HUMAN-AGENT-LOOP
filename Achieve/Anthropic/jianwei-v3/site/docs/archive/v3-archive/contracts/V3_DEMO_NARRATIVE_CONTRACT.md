# 见微 V3 Demo Narrative Contract

更新：2026-08-30  
状态：`FROZEN MACRO ORDER / DETAIL CONTENT OPEN`  
上位权威：`V3_DIRECTION_FREEZE.md` Gate 1–19

## 1. 目的

本契约只冻结比赛现场的进入顺序、关键状态变化、演示高潮和收口证据。它不冻结五路内部内容槽、具体政策条款、信审规则、商务清单、资产模型或生产接口。

唯一故事：

> 小微事业部的经营偏差被协同驾驶舱发现并归因到一个直接租赁 Case；业务、客户、供应商、政策、信审、商务与资产围绕同一 Context 协作，新增信息触发五路异步更新并暴露一次真实风险回退；专业人员完成各自 Gate 后正式起租，系统再把可追溯结果汇总回经营 Projection。

## 2. 固定进入与收口

- **固定进入**：从 `协同` God View 的小微经营偏差开始，而不是从材料上传或技术架构页开始。
- **固定聚焦**：从 Portfolio / KPI 偏差下钻到唯一完整 Golden Case `FL-DEMO-001`。
- **业务高潮**：专业条件满足并形成正式起租 Receipt；正式起租意味着项目开始计息，不等于租后全生命周期结清。
- **技术高潮**：一个具名 `ContextCommit` 将已确认的逻辑 Evidence 批次形成新的 Context Version，五路同时收到 trigger；至少一路推进、一路保持 partial、一路回退或提出补件，旧 run 保留为 stale / superseded。
- **固定收口**：回到 `协同` Projection，展示 Case 状态、起租落地和预计经营影响的变化，再以 Event / Diff / Gate / Receipt 回放证明可审计与可接入。

## 3. 主演示路径

| Beat | 页面 / 角色 | 现场动作 | 评委必须看到的变化 | 得分证据 | Authority 护栏 |
| --- | --- | --- | --- | --- | --- |
| 0 | Demo Control | reset 到固定 Scenario 起点 | 同一 Scenario version、同一初始 Context、无残留操作 | 可重复性 | reset 不伪造业务 Receipt |
| 1 | 协同 God View | 从净收入、单位资产产出效率 / 起租偏差定位异常组合与 Golden Case | 当期 / 当年 / 全周期口径、目标、应达、实际或预测、预实偏差与主要 Case 归因 | 价值性、管理价值 | 只读 Projection；forecast / scenario 不冒充 actual，不直接改专业状态 |
| 2 | 协同 → Golden Case | 下钻 `FL-DEMO-001` | 同一 caseId、当前目标、五路状态、正式起租端点、当前阻断与 Owner | 场景完整度 | 背景 Case 不加载完整 Context |
| 3 | 业务 | 确认初始商机事实包 | `Context T1`；商机推进，政策 / 信审 / 商务 / 资产生成首轮 partial candidate | 技术性、可落地性 | 普通聊天不能触发；必须具名事实确认 |
| 4 | 外联客户 | 回答订单 / 回款关键问题并确认一项风险事实 | `Context T2`；信审 readiness 回退或新增补件，其他路按影响独立变化 | 客户触达、真实异步 | 外部只见 invitation scope；模型 authority=none |
| 5 | 外联客户 + 供应商 → 业务 | 客户补充履约依据；供应商确认设备、交付和付款边界；业务具名确认同一 pending batch | 两份外部 Evidence Receipt 后只形成一次 `Context T3`；五路重新运行，旧 T1/T2 run 可回看 | 客户触达、厂商粘性、Context diff | 外部操作先进入 staging；只有业务 `ContextCommit` 推进版本，不是本地 UI 状态 |
| 6 | 风控四账号 | 政策、信审、商务、资产查看同 Case 的不同 Projection；有权人员确认本专业 Gate | 各账号全局可见、本专业可写；越权动作失败关闭 | 权限、Human Gate | 协同角色和其他专业账号不能代签 |
| 7 | 商务 + 资产辅助 | 满足付款、设备 / 物流查验及必要条件 | 商务进入可起租；资产建议绑定但不复制商务权威 | 业务真实性 | 项目次序由 Scenario 条件路由，不硬编码为通用顺序 |
| 8 | 正式起租 | 有权商务动作生成正式起租 Receipt | 起租五格全黑、Case 转为已起租 / 已起息；Receipt 绑定上游 Gate | 业务高潮、技术闭环 | 不把起租写成租后结清、已实现全周期利润或完整财务对账 |
| 9 | 协同 God View + 技术回放 | 返回组合视图并查看影响；打开 Event / Diff / Receipt 证据 | Case / Portfolio / KPI Projection 更新；主显示本期 / 本年预计净收入贡献与单位资产产出，辅助显示全周期利润预测；能解释谁、基于哪个版本、做了什么 | 价值性、技术性、可审计 | 预计经营影响是 Projection；明确 actual / forecast / scenario，不冒充已实现收益 |

## 4. 三次关键 Context 转折

1. **T1 · 商机事实成立**：业务具名确认初始商机与设备融资事实，生成首轮共享 Context，触发五路 partial run。
2. **T2 · 风险事实暴露**：外联客户确认一项会改变判断的事实，信审必须回退或补件，证明系统不是只会正向推进的假进度条。
3. **T3 · 外部证据补强**：客户与供应商分别完成受邀补充，Evidence Receipt 先进入同一 pending batch；`business-owner` 具名确认将该逻辑批次一次性 commit 为新共享 Context，五路重跑并为专业 Gate 提供最新依据。

专业 Human Gate、Management Action 与正式起租 Action 必须绑定 T3，但它们是独立 Authority Event / Receipt；不得为了制造更多版本而让普通聊天持续递增 Context Version。

## 5. 演示叙事优先级

1. 先让评委理解业务问题和经营影响；
2. 再让评委看到人、Agent 与既有能力如何围绕同一 Case 协作；
3. 用一次回退证明它不是静态流程图；
4. 用外联客户 / 供应商实际操作证明直接触达；
5. 用 Gate、Receipt 与 replay 证明技术不是聊天壳；
6. 最后说明 Adapter / Skill extension path，不在主路径展示未实现系统。

## 6. 不进入主路径

- 第二条完整回租 Case；
- 二十个专业流程逐页讲解；
- 集团全部组织层级、完整 KPI 库或通用战略执行；
- 生产数据库、完整 RBAC、规则开发平台、模型训练平台；
- 静态 Agent 对话、虚假百分比、未经执行的 Receipt 或已实现收益数字。

## 7. Narrative 验收

- 任一 Beat 都能回答：当前 caseId、Context Version、角色、动作、可见变化与下一接续；
- 从 Beat 1 到 Beat 9 始终是同一个 Golden Case Authority；
- T2 必须产生可见回退 / 补件，而不是所有路同步变好；
- 外联客户和供应商至少各有一次真实受邀操作；
- 专业 Gate 与正式起租都有具名 Receipt；
- 收口同时出现业务结果、经营 Projection 和技术 replay，三者引用同一事件链。
