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

## 任务02 实施决定（2026-09-17，PR#3 审核修复轮：Back/B、Back/C）

来源：`JW_PR3_independent_audit_and_four_tasks` 四任务包之任务02（范围 Back/B/**、Back/C/**、Back/Connectors/**；A/Edge/Front 零改动；无 Git 操作；零真实模型调用）。审核基线 870e149。

- **文件锁死锁回收重写（F12/W13）**：B/src/fs-lock.mjs 废除"读死 token 后直接 unlink"（多竞争者会误删新 owner 锁、静默双持）。新协议：获取唯一原子点=wx 独占创建；死锁回收=临时文件+rename 原子覆盖（全程不 unlink 非本人锁）+动手前内容复核（观察已变即放弃）；持有期看门狗（默认 500ms）检出锁被夺→LOCK_STOLEN 失败关闭且不删新锁。Windows 无内容 CAS 原语，残留竞态窗口（复核与 rename 之间）由看门狗收敛为"有界必检出、失败关闭"，如实声明于模块头。W13 测试：5 项（含 4 真实子进程并发回收死锁、对账不变量=任一重叠区间的在先持有者必须非 ok 退出）。
- **W04 规则负例加固**：C/rules/engine.mjs 规则 scope 限定维度在交易面缺失→`applicability_unknown`（不再当"不适用"静默跳过）；数值比较遇非有限数/非数值、布尔判定遇非布尔、等值遇类型不同→`condition_error`（不再转 not_hit 安全结论）；派生覆盖率输入非数值或债务≤0→产出 value=null 显式派生事实走类型错误路径（不再静默不产出）。Gate 新增 `RULE_APPLICABILITY_UNKNOWN`/`RULE_CONDITION_TYPE_ERROR`→NEEDS_EVIDENCE+解除条件；计划器生成内部澄清/纠正问题。42 场景冻结集（含 14 held-out）零翻转。
- **F06/W05 C→A 契约适配**：C/src/gate-adapter.mjs 显式有版本适配器（c-to-a-gate-adapter@1）。Gate：rulesetVersion→rulePackVersion、scope.blockedActions→顶层 blockedActions，坏 schema 明确拒绝；域结果登记帧：A 要求 inputWatermark 为 string（C 是对象）→确定性字符串投影 `wm:<gen>:<hash16>`（原件留 cOriginal 可重算核对）；非 completed Run 一律拒绝登记（B2.5）；deps.rulePackVersion 必须显式提供（信审/商务域 Run 自身盖的是阈值包版本 sim-business@0.3，不得冒充规则包版本）。契约测试以四种 Gate 结果的真实场景管线输出为输入（禁手写 fixture），镜像 A decision-support.ts/package.ts 校验形状。
- **F07/W15 评测纪律**：C/src/evaluation/ab-experiment.mjs 明示**功能消融**（单助手臂刻意移除冲突保留/域完成性/去重——只证功能必要性，不证"多 Agent"因果优势）；两臂管线失败进分母计 pipelineErrors；四域臂任一预锁指标劣于、或存在管线错误、或有效样本为 0→exit 1（不再无条件 exit0）；耗时/费用如实标"未测"不记"已测零"。spawn 测试锁口径。
- **B1 进件规范化**：C/intake/normalize.mjs。商机只触发：主档归集绑定不授内部权限；分级邀请=角色×主体×种类授予面，越权/未挂邀请/元数据缺失/加密缺页一律 pending_supplement 不编数；同源链（derivedFrom）求根，祖先待补则派生件级联待补，独立来源按根去重（W03：文件数量与复述不加可信度）；主体|期间对齐表只定位不产出比对结论；银行流水自动附"入账≠经营收入"口径注记，相似金额不做设备自动匹配；批次无倒计时、同输入确定性同 id。W01/W02/W03 各有判据测试。
- **B3 调度规划层**：B/src/schedule/question-arbiter.mjs（纯函数；A 仍是唯一事实源）。去重键=对象或事实|期间|目的|受众|回答权限，同键合并保留原问+域来源痕迹；外发分级白名单（常规核验/补件/澄清/现场复核=auto；敏感指控/授信承诺/评分参数/清单外=human_gate 失败关闭）；单语音仲裁：每公共通话时刻至多一个 customer 语音问题 active，其余排队不抢话，财务/厂长等客户侧分级角色各自授权线程并行（audience=customer+targetAnswerer 区分，与内部受众分立）；暂停→计划零新外发；progressionNote 明示 answered≠材料取得≠核验完成。W07/W08/W09 各有判据测试。真实接线待任务01在 A 侧 next-actions 暴露绑定字段后由 dispatcher 的 planner 接缝接入。
- **本轮边界**：B3.5–B3.7 空间桥接标签、企微/RTC 实时面仅消费既有 CAPABILITY_MATRIX 口径未新增承诺；B4 预算/恢复既有测试维持全绿；未动 A/Edge/Front/Connectors 任何文件；held-out manifest 未重生成。测试：B 101/101、C 93/93、四域评测 42/42（196 断言）全绿。

## 任务一实施决定（2026-09-17，联合尽调检查会话）

来源：用户本轮任务一书。范围 Back/A/**（检查会话域）+ Back/B/**（会话调度器）；无 Git 提交；零真实模型/渠道调用；不产生任何正式授信语义。

- 任务书所列 InspectionSession/Question/Answer/CaptureRequest 此前仅在规划文档，本地无既有实现；按"执行前映射到已有实现、不造第二套事实源"条款，检查会话域在 A 一次建成（迁移 003 七张新表 + `src/domain/inspection.ts`），最大化复用既有 outbox/audit/幂等/乐观锁/customers/evidence_artifacts；基线文档 `JW_spatial_due_diligence_plan_v2.md` 不在工作区，以任务书文本为唯一要求来源。
- 运行状态（preparing/in_progress/suspended/ended）与收口状态（open/pending_evidence/pending_review/ready_for_assessment/closed）分离持久化；口述（answered）≠材料（waiting_evidence 解除）≠核实（to_verify→人工 verify）三段落状态；真人关键核验 requiresHuman 由名册身份种类+ANSWER_REQUIRES_HUMAN 双重结构拒绝 Agent 代答。
- 暂停线性化点 = 单事务内 outbound_paused=true + dispatch_generation+1 + checkpoint 落库；此后新授权 OUTBOUND_PAUSED、旧代际 STALE_DISPATCH_GENERATION；在途授权单独列明，unknown 结果必须对账（SEND_UNKNOWN_RECONCILE 禁止换 requestId 重问），重复回答/重复回调不重复记账。会话恢复以业务表为真相源，checkpoint 仅作 drift 对比（计划/场景版本前移 → 锚定项 stale_review，须显式 rebind，不按名称相似换绑）。
- 问题去重键 = 对象|期间|目的|受众|回答权限：同键开放问题合并返回原问，任一不同保留差异；等待超时/追问越界由 sweep 转每事项至多一条 open 待办（部分唯一索引保证），系统/渠道故障在待办原因中如实标注、不计客户失信。
- 小结为确定性投影（真实事项/问题/待办 → inspection_summaries，按 closure_revision 固化不改写）；客户版只含 customer 受众事项，内部版须名册/admin；READY_FOR_ASSESSMENT 事件仅陈述必要核验完成，不携带自动批准。B 路仅新增 `schedule/inspection-dispatcher.mjs`（读快照→按代际请求授权→ReceiptsPort 三分记录→暂停/旧代际即停），A 保持唯一业务事实源；顺手修复 B ports.mjs MemoryReceipts.put 既有笔误（receipt.requestId）。
- 测试注册：A 路 3 套 18 项（contract/orchestration/closure，覆盖 A01–A12）+ B 路 5 项，均为 `node --test` 可独立运行入口并自动纳入 run-all；回归无退化（A core/flows/tx/limits/credit/crash 共 47 项、B 关键 8 套 60 项全绿）。

## 任务01 实施决定（2026-09-17，PR#3 审核修复轮：Back/A 内核权威）

来源：`JW_PR3_independent_audit_and_four_tasks` 任务01 任务书。范围 Back/A/**、Back/CONTRACT.md、迁移 005–007；无 Git 提交；零真实模型/资金调用。审核基线 870e149；上一轮同任务遗留的未跟踪草稿（006_a2_a3_authority.sql、trust-gates-a2/ledger-races-a3 测试=冻结契约 RED 基线、authority.ts/limitreq.ts 半成品）按"同任务延续"处理：前两者作为冻结验收契约实现之，后两者与本轮实现重复且未编译通过，已删除（无独有语义）。

- 幂等与授权不可分：鉴权先于任何缓存回执查询（v1 withCommand / v2 withCommandV2 / 检查会话 withIxCommand 三处统一）；v1 幂等表补 principal_id/op 归属，跨主体同 requestId 一律 REQUEST_MISMATCH；v2 外层命中改为落回事务过全部授权门后由锁内 replayed 出口返回——这是"撤权后重放不借缓存"（K02）的结构保证，不是逐点补丁。
- 客户级授权选 DB 登记表（principal_customer_grants + Principal.customers='grant'）而非身份目录静态清单：授权可 admin 撤销且即时生效（重放路径同样复查），合成目录缺省 'all' 保持旧行为，生产必须显式 'grant'。
- HOLD_FOR_REVIEW 从"就绪通过"改为显式缺口（GATE_HOLD_FOR_REVIEW），推翻 DECISION_LOOP_V1 §2.3 旧表述——审核 F02 判其为 P0；Gate 规则版本 ≠ 激活版本 → GATE_STALE_RULES，提交点分别映射 GATE_BLOCKED / STALE_BASIS。规则/Gate/分析运行全部改为"获准服务身份（kind=service）回执制"：业务人员可提复核，不能把自己提交的 CLEAR 当 C 已评估。
- 必需域来自批准政策（--required-domains-policy，未配置一律 POLICY_PENDING fail-closed），不适用域必须显式 exemptions 入包；收口引用只收 sessionId 由服务端解析（假会话 404）。正式提案强制绑定依据包，无包存量默认阻断、--allow-legacy-basis 显式兼容（K07 双核验证）。
- 台账两层去重：第一层 requestId 幂等不变；第二层迁移 007 部分唯一索引 (fr_id, entry_type)。用信命令在客户锁后强制 FOR UPDATE 重读申请行（Read Committed 下加锁前快照不得用于状态判断，F04）。disburse 定位为"已承诺敞口的执行"：不再重复当前性门（K14c/B08 的边界——新承诺在 commit 拦截，后来不利信息不追溯冻结既有负债）。
- 冷却口径收窄（修订 B11）：只硬阻断激活/恢复与客户级向上提额申请，不再冻结既有合法用信可用额（K18 与 B11 展示断言并存：staleBlockers 如实展示 cooling_active，但 hardBlockers 才清零可用）。提额请求机制（credit_limit_requests）：在途唯一/次数窗口/实质新证据/nextEligibleAt 全部客户级持久，跨业务员不可绕行；重试经幂等不重复计数；配置全显式（--limit-increase-*），未配置=对应约束不存在，不编造默认。
- 修复既有潜伏缺陷：lazyExpire 账目 INSERT 参数错位（$3 未被 SQL 引用，触发 PG "could not determine data type"——该路径此前无测试覆盖）；computeBuckets 超安全整数显式 500（K16 白盒注入验证）；检查会话提问自增会话版本（两个冻结测试共同编码的行为）。
- 测试纪律：K01–K18 全部先失败后通过；并发用真实 PG 客户锁屏障（pg_locks 轮询），不用随机 sleep；既有正向测试语义保留、机器适配（decision-loop B01–B14 经 Gate 回执+服务身份运行+政策必需域+真实收口会话重放；customer-credit/ledger-property 等加 --allow-legacy-basis）。全量 102 项 101 pass/0 fail/1 skip（crash 套件容器重启用例按资源边界守卫跳过）。接口破坏（v1 匿名读口关闭）已在 CONTRACT §9 向任务03 提示。
