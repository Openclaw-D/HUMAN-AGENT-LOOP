# 当前决定 · V0.1

2026-09-16，来源：用户在迁移任务中的明确指令。

- 独立项目根：`C:/Users/22673/Desktop/JW`。根目录只保留Achieve、Front、Back及必要入口文件；Achieve按用户给定拼写。
- 初始版本V0.1；后续0.2、0.3按小目标、实现、验证、记录逐步迭代。V0.1不代表已有问题全部关闭。
- 保留各版本关键Markdown、轻量源码、回测材料；历史原文不改写，不让旧“当前决定”干扰新阶段。原Anthropic保留，迁移使用复制/hash对账。
- 本次允许迁移包装与依赖本地化，未扩展为修改业务逻辑或完成前后端接线。产品代码分工仍按AGENTS。
- 用户要求移植后创建新的Codex项目及新任务交接，允许直接执行；新任务使用JW真实路径，不用worktree，不借此隐藏委派。
- GitHub最终目标为`Openclaw-D/HUMAN-AGENT-LOOP`。用户在获知仓库公开且JW包含历史记录后明确决定“全部上传”“全部公开”，替代先前名称待定与拟用私有的方案。本次允许首次commit/push；仅以JW为Git根，包含已迁移历史归档，不上传依赖缓存、凭据与临时运行数据。不等于公开部署服务。
- 体积标准纠偏：几十MB资料不因体积排除；几百MB（约300–500MB）及超过1GB的单项才重点评估用途与保留方式。此前2MiB非Markdown过滤过严，补回截图、演示文稿、图片、源码基线及历史清单；可重建依赖/缓存仍不上传。详细补齐清单见Achieve/Migration/size-policy-supplement.json。
- 用户进一步明确最终交付必须是JW内完整、可启动且前后端联调通过的演示项目，不接受仅将两端文件放在一起作为完成。当前发布仅为迁移快照，尚未满足此完成条件；真实接线和浏览器端到端验收提升为下一主目标，不再默认排到V0.3。新增产品接线仍遵循Codex/ZCode分工，不以修改验收预期冒充完成。
- 最新发布顺序：用户要求尽快先上传目前运行的前端与最新完整后端，提供Front/dist、简单双击启动入口和面向队员的项目README；不在本轮扩大为业务重写。此当前版本交付不等于联调目标已达成。
- 三者对应唯一项目：本地`C:/Users/22673/Desktop/JW` ⇄ 应用JW项目（id=`cf880028-c0af-418f-87b5-7ca69bf12dc4`）⇄ GitHub `Openclaw-D/HUMAN-AGENT-LOOP`。后续决赛工作使用这个目录与项目，不用旧Anthropic。源码、资料、文档和指定dist须提交同步；node_modules、数据库、凭据和临时状态属于明确的本地排除项，“一致”不表示上传这些环境文件。

产品方向依据 [2026-09-16最新夜间任务原文](Achieve/Anthropic/V7/NIGHT_BACKEND_20260916.md)：目标驱动的人机协作，角色/人/Agent/目标分离，商业融资租赁小微制造业为首个配置。人的正式authority、风险底线、可追溯与人的选择权持续有效。旧阶段原决定及原因在Achieve中可追溯，不批量晋升历史候选。

待裁决：v1.3复核ack政策；前后端接线的首个小闭环；生产身份/数据/模型费用。

## 任务 03 实施决定（2026-09-16，四域 Agent 与 Gate）

来源：执行 `JW_customer_credit_backend_tasks/03_FOUR_DOMAIN_AGENTS_AND_GATES.md`。范围仅 Back/B/**、Back/C/**；A 契约与 D 断言零改动；无 Git 操作；零真实模型调用（E1）。

- 四域在 E1 以确定性评估器实现（零模型）：域"不能做"落到结构（政策只引用激活规则包、信审无视频观感输入通道、商务无对冲定价字段、资产区分存在性与权属）；真实模型只作 E2 授权后的角色指令模板（`C/domains/templates/four-domain-prompts-v1.json`），authority 恒 none 由 schema 结构拒绝任何非 none 声明。
- Gate 四态语义与不可豁免硬门为确定性机制：无已批准例外政策时不存在任何放行接口（attemptWaiver 恒拒）；staleReviewAck 对不可豁免 HARD_BLOCK 结构无效；解除只有事实纠正重算或治理更新规则。A 正式动作（approve/activate/disburse）的当前 Gate 检查属任务 01，本轮未代写。
- 规则包 boundary=simulation_only：所有规则/阈值显式 `simulation_rule` 演示源，不冒充公司制度；机构类型分层（商业融资租赁≠金融租赁）由 scope.orgTypes 强制；场景级 packOverride 仅用于演示 pending 语义，规则文件本体不可变、历史按旧版本+旧 asOf 可重放。
- 业务阈值与系统负载阈值两包分离且禁止合成"压力指数"：超时/低质量→未知/待核验（不判高风险也不默认通过）。
- B 稳定性修复：Windows 原子写 EPERM 有界重试+临时文件清理+结构化失败；恢复竞态用恢复锁（活锁不盲抢）+registry 写锁治理；多粒度预算（全局/客户/会话/调用次数）在同一互斥临界区分级判定，旧账本条目保守计入所有作用域；真实账单未知显式标注不记 0。
- 评测纪律：42 场景、9 必备类别、37 分组不跨分区、14 冻结 held-out（期望 sha256 清单，篡改即拒测）；C01–C28 全部有指认测试位置；预标为 synthetic_prelabel_v1 合成占位，真实业务预标待指定审核者。§8 对照实验预锁指标与决策规则，冻结集结果：单助手臂漏报 4、四域臂漏报 0、双臂误报 0。

## 任务 01/02 实施决定（2026-09-17，客户授信收口与决策闭环）

来源：用户本轮三任务书（任务一检查会话/任务二决策闭环/任务三 Edge 接线）。任务02=ZCode 本路；范围 Back/A/**（v2 客户授信域增量）+ Back/CONTRACT.md 登记节；无 Git 提交；零真实模型/支付。

- 不建第二套事实源：决策闭环全部落在任务01 既有表上（evidence_artifacts/credit_assessments/credit_facilities/financing_requests/exposure_entries/decision_records），新增对象仅 decision_findings、decision_packages、package_domain_results、report_views、object_relinks 与既有表可空列（迁移 004；003 号位归任务一）。旧数据新列为 NULL=未知，不补造历史。
- 依据包=冻结修订（不可变行）：新材料进新修订；每域结果自带依赖摘要水位（登记时重新冻结该域），读时逐域复算当前性——依赖已变的域必须更新、未变域复用，不为水位一致全量重跑；required 域无结果=缺失；检查收口未知（任务一 closureStatus 非 ready_for_assessment/closed 或未引用）显式列为缺口，不当作通过。
- 正式动作提交点机械复查（approve/activate/reserve）：客户级未决差异（动作级 impactScope）→ 绑定包的当前性/Gate → 既有额度与冷却校验，全在事务内，失败零写入；批准后出现不利证据不改写历史，仅按当前依据阻断新用信。Gate 结论按 C 路规则包语义结构消费，A 不复制规则引擎、不提供通用放行。
- 差异处理四结果映射现有制度；关闭关键复核必须引用满足 requiredAction 的现行证据，ack/口述/模型解释仅留痕；硬红线（nonWaivable）不接受 not_applicable，未批准例外政策一律 POLICY_PENDING。提额冷却仅在显式配置时存在，复核不等待冷却。
- 报告=结构化数据的确定性投影（internal_summary/customer_supplement/use_prep_sheet）：生成不改业务状态、同状态重生成返回同一行；客户版服务端白名单组装；customer-only principal 访问内部报告/事件/证据地址一律 403，错误响应不携带内部结构。
- 并行协作事实：任务一 writer 与本路在 errors.ts/kernel.ts 同文件先后写入，按"当前文件状态增量编辑"处理并互留实现记录；迁移编号冲突以 003=任务一、004=任务02 拆分；B/C/D 其他 owner 文件本轮零改动。

## 任务一实施决定（2026-09-17，联合尽调检查会话）

来源：用户本轮任务一书。范围 Back/A/**（检查会话域）+ Back/B/**（会话调度器）；无 Git 提交；零真实模型/渠道调用；不产生任何正式授信语义。

- 任务书所列 InspectionSession/Question/Answer/CaptureRequest 此前仅在规划文档，本地无既有实现；按"执行前映射到已有实现、不造第二套事实源"条款，检查会话域在 A 一次建成（迁移 003 七张新表 + `src/domain/inspection.ts`），最大化复用既有 outbox/audit/幂等/乐观锁/customers/evidence_artifacts；基线文档 `JW_spatial_due_diligence_plan_v2.md` 不在工作区，以任务书文本为唯一要求来源。
- 运行状态（preparing/in_progress/suspended/ended）与收口状态（open/pending_evidence/pending_review/ready_for_assessment/closed）分离持久化；口述（answered）≠材料（waiting_evidence 解除）≠核实（to_verify→人工 verify）三段落状态；真人关键核验 requiresHuman 由名册身份种类+ANSWER_REQUIRES_HUMAN 双重结构拒绝 Agent 代答。
- 暂停线性化点 = 单事务内 outbound_paused=true + dispatch_generation+1 + checkpoint 落库；此后新授权 OUTBOUND_PAUSED、旧代际 STALE_DISPATCH_GENERATION；在途授权单独列明，unknown 结果必须对账（SEND_UNKNOWN_RECONCILE 禁止换 requestId 重问），重复回答/重复回调不重复记账。会话恢复以业务表为真相源，checkpoint 仅作 drift 对比（计划/场景版本前移 → 锚定项 stale_review，须显式 rebind，不按名称相似换绑）。
- 问题去重键 = 对象|期间|目的|受众|回答权限：同键开放问题合并返回原问，任一不同保留差异；等待超时/追问越界由 sweep 转每事项至多一条 open 待办（部分唯一索引保证），系统/渠道故障在待办原因中如实标注、不计客户失信。
- 小结为确定性投影（真实事项/问题/待办 → inspection_summaries，按 closure_revision 固化不改写）；客户版只含 customer 受众事项，内部版须名册/admin；READY_FOR_ASSESSMENT 事件仅陈述必要核验完成，不携带自动批准。B 路仅新增 `schedule/inspection-dispatcher.mjs`（读快照→按代际请求授权→ReceiptsPort 三分记录→暂停/旧代际即停），A 保持唯一业务事实源；顺手修复 B ports.mjs MemoryReceipts.put 既有笔误（receipt.requestId）。
- 测试注册：A 路 3 套 18 项（contract/orchestration/closure，覆盖 A01–A12）+ B 路 5 项，均为 `node --test` 可独立运行入口并自动纳入 run-all；回归无退化（A core/flows/tx/limits/credit/crash 共 47 项、B 关键 8 套 60 项全绿）。
