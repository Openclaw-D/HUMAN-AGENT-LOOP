# 见微 V3 Golden Case Scenario Contract

更新：2026-08-30  
状态：`FROZEN MACRO RHYTHM / PAYLOAD CALIBRATION OPEN`  
上位权威：`V3_DIRECTION_FREEZE.md` Gate 1–19  
配套契约：`V3_DEMO_NARRATIVE_CONTRACT.md`、`V3_ROLE_PROJECTION_CONTRACT.md`、`V3_API_AND_EVENT_CONTRACT.md`、`V3_ACCEPTANCE_MATRIX.md`

## 1. Scenario Identity

| 字段 | 冻结值 |
| --- | --- |
| `scenarioId` | `JW-V3-DL-GOLDEN-001` |
| `scenarioVersion` | `1.0.0-macro` |
| `businessItemType` | `FinancingLeasingCase` |
| `caseId` | `FL-DEMO-001` |
| 经营域 | 中国大陆商业融资租赁 · 小微事业部 |
| 交易模式 | 直接租赁 |
| 完成节点 | 正式起租 / 开始计息 |
| 数据等级 | 固定合成、去标识、可重置 Demo Scenario |

公司名称、融资金额、设备型号、材料文件名、专业规则与五路内容槽的精确名称尚未完成业务校准，不在本 macro version 中冻结。前端当前示例值只是 Scenario content，不得反向升级为 Direction Authority。

## 2. 固定业务骨架

- 客户因真实的购机 / 扩产动机产生设备融资需求；
- 租赁公司向设备供应商购买设备，再出租给客户；
- 初始商机包至少能证明客户、设备锚点、供应商、交易意图与预计交付 / 起租窗口存在；
- 商机与信审同等重要：商机负责形成可继续判断的事实，信审负责穿透还款能力、订单与风险；
- 政策负责准入 / 例外边界，商务负责交易条件、查验、付款与起租，资产在起租前提供辅助预判与查验建议；
- 当前 Scenario 使用“首次合作供应商 + 货到付款”作为可演示条件分支，用于证明流程顺序由业务条件决定，而不是全局硬编码。

## 3. 固定输入包边界

`ScenarioPackage` 只冻结下列类别，不冻结内部字段表或材料模板：

1. 商机与购机动机摘要；
2. 客户主体与经营背景的合成事实；
3. 设备清单 / 报价与设备锚点；
4. 供应商主体、合作关系与交付 / 付款条件；
5. 下游需求、订单、交付与回款的合成 Evidence；
6. 拟采用的直接租赁结构、期限与起租窗口；
7. 现场 / 物流 / 设备一致性的合成查验 Evidence；
8. Scenario metadata、reset seed 与 truth-source 标记。

所有输入都必须由固定 seed 或版本化文件生成。页面手工改字、临时注入数据库或调用真实内网材料不属于可接受输入。

## 4. 起始状态

- Portfolio 中存在一个 Golden Case 和少量独立背景 Case；
- Golden Case 已建立但尚未正式起租；
- 当前 Context 为 reset 后的 baseline，只含 Scenario identity 与最小 Case shell；
- 五路未全部完成，专业 Gate 均不存在成功 Receipt；
- `协同` Projection 能看到小微经营偏差及 Golden Case 归因，但不能替专业人员写 Gate；
- 客户和供应商 invitation 已准备但尚未全部完成；
- reset 后不得残留上一次演示的 Evidence、Context Version、run、Gate 或 Receipt。

## 5. 三次 Context 转折

### T1：商机事实包确认

**Actor**：具名业务人员。  
**动作**：确认初始商机、设备锚点、供应商报价与直接租赁意图进入 Authority Kernel。  
**Authority output**：Evidence/Event 接受回执；具名业务确认把本逻辑批次 commit 为新 Context Version。  
**系统效果**：同一个 trigger 向商机、政策、信审、商务、资产创建五个 candidate run；允许不同完成速度，不要求同时结束。

方向性结果：

- 商机明显推进；
- 政策形成首轮准入 / 例外候选；
- 信审识别下游订单稳定性缺口；
- 商务形成首次合作供应商与货到付款的条件候选；
- 资产形成到货查验窗口与租后风险观察候选。

### T2：风险事实确认

**Actor**：受邀客户 principal。  
**动作**：回答关键问题并确认一个会改变判断的事实：主要下游订单的覆盖期 / 集中度与拟定租金计划存在需要解释的偏差。具体阈值与文件内容留待业务校准。  
**Authority output**：外部 Evidence Event + Receipt；该受邀事实被明确确认后 commit 为新 Context Version。  
**系统效果**：五路再次收到 trigger；旧 T1 run 保留但标记 stale / superseded。

不可变结果：

- 信审 readiness 至少回退一档或维持未完成并新增补件；
- 商务不得因为信审风险事实自动显示付款 / 起租完成；
- 商机、政策、商务、资产各自根据影响更新，不能复制同一段状态文案；
- 前端明确显示“新增信息可能让进程后退”，证明 readiness 不是 KPI 百分比。

### T3：外部证据补强

**Actor**：受邀客户 principal + 受邀供应商 principal 提交 Evidence；`business-owner` 对逻辑批次具名确认；必要现场查验由对应内部人员确认。  
**动作**：客户补充订单履约、交付与回款依据；供应商确认设备、交付窗口、货到付款条件与设备一致性信息；业务确认两份 Evidence 属于同一 T3 batch。  
**Authority output**：至少两个 principal-scoped Evidence Receipt；客户、供应商与必要查验材料先进入同一 T3 pending batch，再由 `business-owner` 一次性 `ContextCommit` 为新的共享 Context Version。  
**系统效果**：五路基于 T3 重跑；T1/T2 history 可回看；专业账号得到最新 Role Projection。

方向性结果：

- 商机事实链具备进入正式交易的充分候选；
- 政策与信审进入各自 Human Gate ready 状态；
- 商务能够核验付款 / 查验 / 起租前提；
- 资产查验与预判建议绑定 T3，不拥有付款或起租 Authority。

## 6. Human Gate 与正式起租

- 政策、信审、商务、资产 Gate 只能由对应有权 principal 确认；资产 Gate 是否作为正式起租硬前提由后续专业校准决定，本 contract 不擅自固定。
- `协同` 可以追问、要求复核、确定优先级和形成 Management Action，但不能代签专业 Gate。
- 各 Gate Receipt 必须绑定 `caseId + contextVersion + principal + decision + rationale/evidence refs + timestamp`。
- 商务只有在 Scenario 所需专业 Gate、设备 / 物流查验、付款与合同条件满足后，才能提交正式起租 Action。
- 正式起租 Receipt 必须引用所有必要上游 Gate / Evidence Receipt，并把 Case 的 commencement 状态改为完成；不得把聊天回复、模型候选或前端按钮状态作为起租证据。

## 7. 固定最终输出

完成一次 full run 后，至少存在：

1. 一个仍为 `FL-DEMO-001` 的 Golden Case；
2. T1、T2、T3 三个可区分 Context Version 及各自 Diff；
3. 每次 Context transition 对应的五路 candidate run binding；
4. 至少一次信审回退 / 补件与旧 run stale 证据；
5. 客户和供应商各自的受邀 Evidence Receipt；
6. 具名专业 Human Gate Receipt；
7. 正式起租 Action / Receipt；
8. Case 五格全黑、lease lifecycle 进入已起租 / 已起息；
9. 更新后的 Case / Portfolio / KPI Projection；
10. 从 reset 到起租的有序 Event replay。

“预计净收入贡献”“单位起租金额净收入率”和“本季起租落地”是本期 / 本年经营主 Projection；全周期利润预测只作辅助校验。所有经营数字必须保留时间范围、公式版本、数据覆盖、Scenario version 与推导依据。当前外网 Demo 未接通财务、费用、人力和风险系统，不得把 forecast / scenario 展示为真实已实现利润或已完成财务对账。

## 8. Determinism 与 reset

- 上传 / 回答先形成 Evidence Receipt，不必立即递增 Context；只有明确的 `ContextCommit` 将一个逻辑批次的已接受 Evidence / confirmed facts 写入新 Context Version。这样既保留每条来源与 Receipt，又避免每个文件都制造版本和五路重跑。
- T1、T2、T3 每个逻辑批次最多推进一次 Context Version；batch 内重复 Evidence 按 idempotency 规则 replay，缺少必要来源时不得提前 commit。
- 相同 `scenarioVersion + reset seed + action script` 必须产生结构相同、顺序一致的 Event 类型、Context transition、run binding 与 Receipt 关系；允许时间戳 / runtime epoch 使用受控演示值。
- 每个正式 POST 使用 idempotency key；同 key 同 payload 精确 replay，同 key 异 payload 冲突且不推进状态。
- 任一步失败必须 fail closed：不递增 Context、不追加成功 Receipt、不把 UI 改成成功。
- reset 只重建固定合成 Scenario；不得结束未知进程、改数据库救场或依赖浏览器本地缓存恢复。
- 最终验收要求三次连续 `reset → T1 → T2 → T3 → Gates → commencement → replay` 成功。

## 9. 当前明确未冻结

- 五路各自五个内容槽的具体名称与顺序；
- 具体政策、信审阈值、评分、模型、供应商规则或资产风险算法；
- 真实文件模板、真实客户 / 供应商身份与真实内网字段；
- Asset Gate 是否为所有直租 Scenario 的起租硬前提；
- `V3_API_AND_EVENT_CONTRACT.md` 已冻结最小 API capability、Event type 与 Receipt binding；具体 sequence 数量、自然语言 payload、物理 ID 和非必要 Receipt 字段仍开放；
- 现场演示的精确分钟数和备用短路线。

这些内容只能在业务校准或后续 `V3_API_AND_EVENT_CONTRACT.md` 中冻结，不能由当前页面文案或旧 V2 schema 反向决定。
