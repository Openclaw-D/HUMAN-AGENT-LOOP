# 见微 V4 当前挑战

状态：`OPEN ONLY`

历史 30 项挑战全文保存在 `archive/40-v4-life-convergence/20260903-before-minimalization/CHALLENGE_LOG.md`。当前只保留会改变下一步的十五项。

## C01｜技术嵌入不能改变制度权力

Gate：每个方案都必须证明 Human Role、原决定权、退回/否决、逐级报批和例外路径仍然存在，并留下可追溯 Receipt。只证明更快不算通过。

## C02｜四域组件不能重新膨胀成全生命周期系统

Gate：商机、客户、尽调、直租/回租只作上游 Context；首期只建设小微业务协同入口及政策、信审、商务、资产差异能力。Golden Case 虽固定为新客回租，也不得扩成新客经营、尽调采集或回租全流程系统；不得外推汽融、其他事业部或集团通用场景。新增对象或页面必须证明 Golden Case 不增加就无法成立。

## C03｜模型增强风险发现，但不能制造幻觉或权威

Gate：制度/规则/传统模型与 LLM Candidate 分层；输出必须带来源、版本和不确定性。Agent 不得批准、否决、突破流程或产生正式 Receipt。

## C04｜非线性协作不能越权或制造无效劳动

Gate：冻结 WorkItem 的 Evidence/Dependency/Receipt；只提前低成本、可撤回或无硬依赖工作。前序否决停止真实依赖项，同时保留既有贡献。

## C05｜复用成熟平台，但 Capability 不能冒充 Authority

Gate：复用低成本、内网可用、可视化且可导出的成熟编排底座；当前参考实现是租赁内网 Dify `1.13.2`，但不把品牌写成产品身份。替换底座必须证明 ROI 为正并通过同一 Authority/Data/Export/Failure Gate；Human Role、权限、正式顺序和 Receipt 不得被任何画布改变。没有真实缺口就不写新底座。

## C06｜人的价值不能被最终起租结果吞没

Gate：业务结果与过程贡献分开；保存专业判断、风险发现、响应、学习和知识投入。正式权限仍由组织授予，不能由模型或工龄自动扩权。

## C07｜资产反馈与多模态不能伪造精确性

Gate：资产保持独立责任；历史表现只作为有来源的 Evidence/Candidate 前向反馈。小样本预测先做可解释 baseline；空间重建等派生结果不能单独证明现场事实。

## C08｜真实交付不能被比赛压成演示壳

Gate：Golden Case 必须经过真实 API、状态、幂等、权限、失败关闭、事件重放、浏览器与部署验证。静态图、PPT、fallback 或 Agent 自报不得冒充 E2E。

## C09｜多 Harness 协作不能产生双写与 Context 漂移

Gate：Codex 和 ZCode 只共享当前 Markdown 与本地代码证据；每个任务明确 ownership。共享 contract/schema/migration 串行；ZCode 执行期间 Codex 不改其文件，完成后再独立验收。

讨论治理 Gate：每次新输入先对照已接受主干，区分补充/细化、探索和明确变更；执行端不得把 Candidate、访谈意见或最新一段聊天当成覆盖主干的指令。新线程冷启动应能识别“已接受什么、还在探索什么、已验证什么”，并继续中观细化。

## C10｜两套 V4 Candidate 不能长期并存为双后端

当前裁决：`lib/v4life/**` + `app/api/v4life/**` 是唯一 Case/Work/Evidence/Human Gate/Receipt canonical implementation；旧 `lib/v4/**` + `app/api/v4/**` 降为 legacy Candidate，不再增加第二套业务状态能力。初步引用审计仍发现旧路径被 21 个测试文件和 2 个 runtime API route 引用；其中 authority/capability 模块可能作为非 canonical 支撑能力复用，不能整目录粗暴删除。Gate 仍保持 OPEN：完成逐文件能力/引用差异表、迁移消费者与测试、形成可恢复 baseline 后，才可归档重复的 case-state/read/work 路径。

## C11｜真实作业工作台与 Case Chat 不能再次变成静态叙事页

Gate：`/work` 只显示一个小微合成 Case 的业务协同入口及政策、信审、商务、资产真实 Projection；用户动作必须经过现有 API，成功后重新读取 canonical state。右侧 Case Chat 可以解释 Evidence、生成草案/Candidate 和提出补件建议，但不得持有第二套状态、假装真人在线、直接审批或生成 Receipt。禁止静态假 Receipt、假对话、假在线人数、供应商旧叙事、乐观成功和管理 KPI；刷新、冲突、退回、否决与失败状态必须与服务端一致。

## C12｜封存 Context 不能被误当成已核验事实

访谈 Evidence 表明，既有十问、材料包、主体关系和前端尽调说明可能不完整、不一致、延迟到达或已经过期。Gate：`SEALED` 只表示不可变版本；每项关键 Evidence 必须保留来源、观察时间、适用时点、主体映射与 `claimed / unverified / verified / contradicted / stale` 状态。缺失和矛盾必须显式形成 Candidate/WorkItem，不能被模型补齐成事实。

## C13｜新客回租必须同时解决访前浪费与起租前变化

Gate：首个 Golden Case 至少证明两个时间边界——访厂前把明显不可操作、关键缺件和需现场核验的问题前置；批复后至起租前对关键主体、司法、负债、经营和资产变化形成差异 Candidate。两个边界均沿现有 Human Role 和正式流程确认，系统不得自行取消访厂、否决或放款起租。

## C14｜首要场景不能演变成单方局部最优

Gate：每项优化都要说明客户、业务、政策、信审、商务、资产和公司整体分别减少或增加了什么成本、等待、风险和责任。若业务端更快只是因为信审承担更多补录，信审少看只是因为商务/资产兜底，或客户少提交只是因为关键 Evidence 消失，则不算系统增益。首期优先新客回租，但公共能力、数据契约和 Authority 不得排斥其他小微融资租赁场景。

## C15｜共同场景和单点能力不能冒充差异化

Gate：比赛不能只证明“也能做新客回租”或“也能排重”。对手在确存、确权、排重的单点叙事上已有先发优势，见微只有在同一 Case 上可观察地证明以下接续才算形成差异：风险 Evidence 被谁发现、交给谁、影响哪个 Gate、如何转成商务/起租条件、后续变化如何重开事项、资产结果如何反馈前序。排重若无必要不自研，按 `REUSE FIRST` 作为 Evidence-producing Capability 接入；“全局”不得扩成集团通用平台。
