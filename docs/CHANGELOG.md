> 2026-09-20 用户最新重大决定：先读[固定北极星 V0.3-NORTH-STAR-1.4](docs/v0.3/01_FIXED_NORTH_STAR.md)。产品定位固定为AGI，核心交互为必看数据＋3–5个候选置信度排序/默认首选＋点选反馈纠偏；默认推荐不等于正式审批，学习效果以版本化评测验证。面向科技领导，以夺冠得分和客户服务带来的可量化增量利润为目标；聚焦年收入一千万至三千万元的制造业小微客户，年收入不超过五千万元为绝对红线，好/中/差三例真实跑通商机、政策、信审、商务、资产五区，统一系统，产品必须采用A2A多智能体并行协作（不授权Codex内部subagent），吸收TypeSafe/Jev结构化决策设计。必须有月/季/半年/年度价值测算和真实测试证据。未经用户新的重大明确决定不得改变北极星或彻底重构，仅允许局部微调。旧文冲突处以此为准；本次仅文档冻结，不代表代码完成或生产验收通过。CTRL仍是唯一工程协调入口。

> 2026-09-19 最新冻结：业务视角横屏二维作业看板，明确不做3D/全国地图/办公室/手柄/游戏化，不以表格为主界面。此前见微世界与多输入要求在本轮范围中被替代，历史原型保留但停止投入。复用真实工作本，单项目商机→尽调→政策→信审→商务→资产至结清，依赖可并行不强制流水线。最新复核与四路接续任务见 docs/codex-handoff/board-round-02/REVIEW.md。

## 2026-09-19 三种输入与完整框架补充

用户确认前期可加大投入先完成骨架；键鼠/Xbox/屏幕点击同等兼容。已核对Front声明依赖与官方文档，新增docs/codex-handoff/WORLD_INPUT_AND_STACK.md。Three.js路线为当前建议，Unity不是必需也非直接互换。未安装依赖、未改源码，三输入实机NOT_RUN。

## 2026-09-19 · V0.2见微世界方向更新（文档）

统一当前北极星、路线、README/AGENTS/交接/状态入口；补充官方交互研究与Xbox实机验收要求。替代单线演示与地图后置顺序；历史记录保留失效标识。仅文档，未实现世界/音频/手柄/CG/PPT，未跑测试、未调用模型、未发布。更新前精确备份在.local/world-direction-*。


# 版本记录

## V0.3 · 2026-09-20 解析及证据链在制交付

修复流水别名与XLSX命名空间；锁定PDF.js 6.3.289并接入异步解析；新增受控证据读取、引用核验、LangGraph观察路径和管理员profile切换；前端可展开核验片段，dist已重建。C128/B109/Edge127/Front107及独占PG专项1通过。整链、性能和视觉验收尚未完成，详见docs/v0.3/TODO03_04_CHECKPOINT.md；未发布或切共享环境。

## V0.1 · 2026-09-16

从Anthropic复制当前前端、最新backend-next和轻量历史资料到独立JW；采用docs/archive/Achieve/Front/Back目录。依赖桥本地化，新增独立前端启动配置；逐文件hash和排除理由可追溯。原件未删除。业务行为未因迁移改版，前后端未接线，已知缺陷与业务候选保留。实际检查见docs/archive/Achieve/Migration/VERIFICATION.md。

用户最终指定Openclaw-D/HUMAN-AGENT-LOOP并明确同意公开上传JW全部迁移内容；替代名称待定/拟用私有方案。新增发布范围核对说明，保持原Anthropic与新JW开发边界。

按用户体积标准纠偏，补回886份之前按体积/扩展名排除的历史参考资料，单文件最大约45MiB。用户明确最终交付必须前后端联调通过，已将此列为当前首要未完成目标；没有宣称本次归档补齐解决接线。

按最新“先交当前前端+最新后端、简单运行”要求加入Front/dist、Start-JW.cmd和免前端依赖的本地启动服务；README改为队员使用说明。再次核对后端148文件与当前来源一致。应用JW项目已登记正确目录，后续使用新项目与同一GitHub仓库。

## V0.1 → 任务 03 增量 · 2026-09-16

执行 `JW_customer_credit_backend_tasks/03_FOUR_DOMAIN_AGENTS_AND_GATES.md`（仅 Back/B、Back/C；A/D 零改动；E1 确定性，零真实模型调用）：新增 C 四域模块（输出 Schema、能力注册表、共享感知、四域评估器、规则引擎与业务 Gate、提问计划、金额候选、单一下一步协调）、42 场景评测集（14 冻结 held-out）与单助手对照实验；B 接入四域确定性工具链（现有持久执行器产出候选）、修复 Windows 原子写 EPERM 与崩溃恢复竞态、预算升级为全局/客户/会话/调用次数多粒度（旧配置行为兼容）、新增选择性重算与隔离缓存。测试：B 82/82、C 72/72、四域场景 42/42（196 断言）。真实模型、真实政策、A 正式动作 Gate 接线仍为未完成门。

## 任务01 增量 · 2026-09-17（PR#3 审核修复轮）

执行 `JW_PR3_independent_audit_and_four_tasks` 任务01（审核基线 870e149；范围 Back/A/**、共享契约与迁移 005–007；零 Git 提交、零真实模型/资金调用）。按任务书 A1→A2→A3 三个提交边界关闭审核 F01/F02/F03/F04/F06/F10/F12：A1 身份/客户级授权与幂等归属（K01–K04，含撤权后重放不借缓存、v1 读口/事件/回执封匿名旁路）；A2 Gate 只来自可信服务回执、分析运行开始即盖章输入摘要、必需域政策 fail-closed、HOLD_FOR_REVIEW 不再产生 ready、正式路径强制绑定依据包（K05–K11，legacy 通道仅显式开启）；A3 台账锁后重读+二层去重、commit/disburse 提交点门、冷却口径收窄为"向上申请/发布"、客户级提额请求（在途唯一/次数窗口/实质新证据/nextEligibleAt）（K12–K18，真实 PG 屏障并发）。旧套件按契约 v2.2 适配（decision-loop B01–B14 走新机器，语义保留）。测试：Back/A 全量 102 项 101 pass / 0 fail / 1 skip（crash 容器重启用例按边界守卫跳过）；K01–K18 共 21 项全绿。契约登记见 Back/CONTRACT.md §9 v2.2；接口破坏（Edge 匿名读口）需任务03 跟进。

## 任务01 增量 · 2026-09-18（四任务产品交付轮 v2.4）

执行 `JW_product_delivery_four_tasks` 任务01（基线 e4ed7a5；范围 Back/A、迁移 009、CONTRACT §11、docs/product-delivery/goal-01/）。新增可供页面办理的业务服务面：授权客户目录（grants 过滤+键集分页）、受限邀请与客户联系人身份（DB 侧动态身份，邀请码/凭据仅存 sha256，兑换恰一次、requestId 对账、撤权级联停用、授予面服务端强制）、材料处理状态权威投影（service 回执制、runRef 内单调、失败必须给下一动作、客户侧白名单披露 my/materials）。修复 B13 混合角色越权（every→some）、游标微秒截断跨页重复、撤权级联缺失；A22 迁移清单补 009。测试工具加固（/healthz 指纹/迁移等待/鉴权探测/端口段加宽）。测试：Back/A 120 项全部最终态通过证据、0 fail/1 skip；新套件 invitations-directory V1–V6。契约登记见 Back/CONTRACT.md §11 v2.4；本路无破坏性接口变更。

## 任务04 增量 · 2026-09-19（四任务产品交付轮 R4/R5：复测关闭+D3 固定快照）

执行 `JW_product_delivery_four_tasks` 任务04 续（基线 e4ed7a5 在制树；范围 Back/D/**、Back/Edge/test/e1/**、Back/Edge/scripts/**、根部交付说明；文档 docs/product-delivery/goal-04/）。R4 缺陷复测关闭轮：重跑首件金丝雀并定向复测——DEF-G04N-01（register_results 400 未达 A）、DEF-G04N-02（kind 命名空间错位，黑盒走真实邀请兑换→cit_* 凭据→`material.<kind>` 正反两例：获准 200/未获准 403）、DEF-G04N-03（XLSX 当 ZIP）全部复测关闭，金丝雀 41/41 全绿（`evidence/d2/first-file-1789748291415.json`）；台账保留关闭留痕。R5 D3 固定快照轮：version-seal 封存 buildId `521bdc0e2f60246e`（gitSha+dirty 如实+契约/迁移 009/dist/规则包指纹，`evidence/d3/version-seal.json`）；delivery-up 增 `--serve-front` 透传（同源托管交付形态）、version-seal 探针端口参数化+能力位如实化；页面层旅程 J1.1–J1.7 以 4 个隔离浏览器会话实测（PASS：J1.1 建客邀请/J1.7 双客户隔离/J1.6 记录留存；BLOCKED：J1.0 admin 页/J1.2 处理推进/J1.3 追溯面/J1.4 问答/J1.5 正式决定，owner 逐条上矩阵，硬门 D27-L-UI 不判 PASS）；性能 3 轮对运行中冻结栈七项指标留证（新工具 `Back/D/product-journey/perf-d3.mjs`，首屏 47–65ms/页面上传 34–49ms/SSE 同步 ~720ms，keySubmit 项 BLOCKED 如实单列）。新立缺陷 DEF-G04N-04（P1，页面提案链无法绑定依据包：页面不传 packageId×交付运行时无 service 主体；服务端权威门行为正确）与 DEF-G04N-05（P2，页内消息对端不渲染）。根部交付说明 `DELIVERY-BRIEF-draft.md` 按定稿权刷新。零他路源码修改、零 Git 提交、零真实密钥/模型调用。

## 任务04 合流装配 · 2026-09-19（四路切片提交+单一固定快照回归+PR）

合流装配轮（分支 v02-goal1234-delivery；等 A/B/C 三路 ROUND-LOG 完工回执齐后执行）。R2：`.gitignore` 增 `!docs/**/*.log` 救回 196 个回归/验收证据 log，g03d 运行态凭据入忽略。R3：`JW_product_delivery_four_tasks/` 扁平化入库（六文件 sha256 复核一致，4 处嵌套路径引用修正）。四切片提交：01路 `c0ee2ea`（§11.1 服务身份/§11.2 单件读回/检查会话 kind 双形态/客户线程应答，迁移 010，132 项全绿）、02路 `d45b03e`（A 桥+解析 v2+IR-03-8①②③⑤ 关闭，Connectors 77/77）、03路 `c53c6a8`（⑨⑩⑪ 页面带包提案/消息双端渲染/预览断链修复，Edge 53/53+Front 37/37+dist 重建）、04路 `bc81c86`（装配/证据/任务书包/Back/D）。单一固定快照回归九路全绿：A 131+1skip、B 105/105（并行满载首跑 104/105=已登记偶发族，复跑绿）、C 101/101、Connectors 77/77、Edge 53/53、Front 37/37、e1 1/1、金丝雀 43/43（临时段 17943/17945，驱动器加 `--a-port/--conn-port` 向后兼容参数）；交付栈迁移 010 首次应用+探针绿（buildId `4647b2ef388bc085`）。DEF-G04N-04/05 标注「修复已双路交付、页面级复测待 J1」；PR（base main）已开，OPEN 清单如实。证据 `docs/product-delivery/goal-04/evidence/d4-merge/`；台账 TEST_RESULTS R6。

## 2026-09-19 goal-03 续（J1.1–J1.5 页面做实）
- Edge：新增 Connectors IR-02-C 消费面（读 status/tasks/preview + 写 intake/upload/manual-entry/correct-fact/questions/pause，X-Service-Token 服务端持有）；A 决策链读面（decision-status/domain-exemptions）与写面（豁免登记、DELETE grants 页面化撤权）；CSRF 扩展至 DELETE。
- Front：处理通道卡、G3 处理状态、通道人工路线（批量转录/更正）、通道补证问题（回答/获准复核）、检查会话收口按钮、依据包冻结/详情/域意见登记/信审候选/包绑定提案、admin 撤权客户身份；修复 npm test 漏挂 wb-logic。
- 测试：Edge 非 e1 46/46（新增 5）；Front 32/32；typecheck 0；dist 重建。契约 consumed-surface → goal03d-1。详见 docs/product-delivery/goal-03/。

## 任务02 增量 · 2026-09-18/19（四任务产品交付轮：A 桥贯通+解析 v2+默认测试入口修复+IR-03-8 关闭）

执行 `JW_product_delivery_four_tasks` 任务02（基线 e4ed7a5 在制树；范围 Back/B、Back/C、Back/Connectors；文档 docs/product-delivery/goal-02/）。A 桥贯通（Back/Connectors a_bridge）：材料→解析→四域预审全链接通 A 权威登记（analysis-runs/Gate 回执/findings/回执对账；a_links 幂等对账、unknown 不换 ID、requestId 确定性 ≤128）。解析 v2（Back/C parse-adapters）：引号 CSV 状态机、非法日期与合计行剔除、XLSX 专用适配器（DEF-G04N-03 修复）、text-PDF（修复 extractPdfText 流切片混入 `stream` 关键字致长流抽取全空）、扫描件人工路线（录入→冲突→更正→复核 verified，零伪造事实）。默认测试入口修复（任务书 B1）：Connectors `npm test` 修复前实跑 0 用例，修复为显式清单；B 补挂 3 文件 83→105。续轮（2026-09-19，ROUND-LOG 回执在案）关闭 IR-03-8①②③⑤：①G3 处理状态写口接线（reportProcessingStages/reportG3：received/parsed/analyzed/needs_review/failed，runRef=`<taskId>:a<attempt>`，requestId=`ptx-<taskId>-a<attempt>-prc-<stage>` 确定性幂等，a_links entity_type=processing，上报失败不阻断主链）；②人工事实并入四域分析（fact_assertions 加列 entry_mode/value_json 幂等回填、requeueForAnalysis 录入/更正/复核自动重入、liveManualBlocks 取代 parse 值、复核 verified 升级，CLEAR 回执真实到达 A）；③判重收敛客户级+既有绑定新邀请显式 accepted；⑤start-connectors 透传 processing 配置（resolveProcessingConfig 优先级，a_customer_links 表为权威）。测试（2026-09-19 最终轮）：Connectors **77/77**（73+新增 G-A3/M3/N3/N4）、A 桥真内核 **3/3**、C 101/101、B 105/105；perf 双臂对照处理 2642→1560ms、域计算 80→26、外发 100→5，等价性断言 4/4。如实遗留：IR-03-8④（检查会话裸 kind 匹配）归 01；⑤ 的 01 侧目录归集读口 OPEN（种子降级为兼容路径）；B 全量并发偶发 1 次 crash-recovery 时序失败（单独复跑均 105/105）；包域结果登记默认关；XLSX 仅首 sheet、PDF 表格不重构、`stream\r` 形态不识别。

## 真实模型接入增量 · 2026-09-19

用户授权接入真实 GLM-5.2（此前"GLM-5.2 只预留 transport、0 调用"边界自此解除，仅限 B transport 面）。新增：根目录一键密钥入口 `Set-GLM-Key.cmd` + `Back/B/scripts/setup-glm-key.mjs`（打码输入、粘贴清洗、写入前 .gitignore 护栏、自动冒烟）与 `Back/B/scripts/glm-real-smoke.mjs`（七状态冒烟；启用预算必须配账本，冒烟账本落 gitignored `.tmp`）。用户 Key 经入口显式注入 gitignored 的 `Back/B/config/b-config.json`：mode=real、model=glm-5.2、endpoint=open.bigmodel.cn v4 chat/completions、outboundAllow 仅该 origin、预算 0.5 元/次估 0.01 元失败关闭。验证链：mock 全链路（C loopback，simulated+usage+成本入账+串线探针）→ 真实端点无效凭据 401→INVALID_CREDENTIAL 映射（零费用）→ 首次真实调用成功（prompt 71+completion 786 tokens、14.3s；模型遵守 authority=none、缺证据输出 unknown 不编造；费率未注入，成本如实标未估算）。模型意见仍 authority=none；E1 42 场景冻结评测与前端六角色演示保持零真实模型；无 Git 提交。

## 2026-09-20 TAKEOFF-FA-1.0.0 接续对齐（文档）
保存用户原始包并校验8份内容文件SHA-256；更新五个入口产品指针，登记适配映射、验收状态、清理记录与分阶段ZCode任务。源码仍为原二维事项卡版本，预评估确认与同版方案扩展尚待实施；未宣称功能完成。
# 2026-09-20 TAKEOFF-FA-1.0.0 发布修复

- 集成本轮首次回租准入二维工作台、预评估确认、五专业证据链与独立启动能力。
- 正面确认缺少 CLEAR Gate 时失败关闭；核对当前激活规则、候选规则及相同证据集合，保留负面结论与正式授信账本边界。
- 页面与演示脚本从实际处理链取规则版本，使用来源材料快照；账本验收绑定实际运行库并拒绝跨库基线。
- 验证、清理和限制见 `docs/takeoff/first-admission-v1/CODEX_RELEASE_REVIEW.md`。

## V0.3 决赛控制基线（2026-09-20）
建立用户给定评分权重、全周期产品目标、可见任务分工和上下文差异记录；更新根部接续入口，保留旧首次准入资料。产品实现与独立验收按分项记录，尚未宣称全周期交付。


## V0.3 · 2026-09-20 · To Do 01

修复模型观察按inputVersion重用旧回答：完整SHA-256身份、严格回执校验、在途合并/文件原子占用、未知不重发、返回前重新鉴权与当前性校验；前端兼容合法重放及旧接口保守隐藏。新增24项回执回归，挂接默认测试入口，更新Front/dist。验证和初次前端失败处置见 docs/v0.3/TODO01_ACCEPTANCE.md。

## 2026-09-20 · V0.3-NORTH-STAR-1.4（文档）

新增AGI固定产品定位（1.3）及“关键数据＋3–5个候选置信度＋默认首选＋点选反馈”核心交互（1.4）；同步当前根部入口版本指针，保留旧历史。新增TypeSafe/System One/Jev公开研究、原始评测辨析、五区/源码映射、轻量架构、反馈学习与验收建议。

未改业务代码、未接入Jev、未声称训练/校准或页面实现完成。完成文档链接与变更边界核对；本次没有需要重建的前端变更。精确备份：.local/typesafe-jev-research-20260920-204253/。
## 2026-09-20 候选反馈特殊授权与writer交接（在制）

记录用户对V0.3-Jev直接实施候选置信度/反馈前后端的特殊阶段授权；暂缓存在文件交叉的ZCode收尾包。CTRL不并发修改交接中的后端文件，功能及验收结果待Jev交回。

## 2026-09-20 候选反馈后端交回（执行者自验）

V0.3-Jev释放assistant-decisions、decision-feedback-store、assistant-model、server、B transport及对应测试的后端ownership。验收文档：docs/v0.3/research/DECISION_FEEDBACK_ACCEPTANCE.md；执行者报告后端53项、前端24项和typecheck通过，CTRL尚未独立复验。反馈为范围隔离的上下文适应，不是权重训练或正式审批。Front最终整合/build归FRONT；共享A/Connectors恢复与在线验收仍未完成。

- V0.3：显式无限累计金额预算（仍记账、损坏账本失败关闭），预算定向测试10/10；三例真实建档并上传9件合成原件，首GLM调用未知未重发。

- V0.3真实API：政策身份及三例collecting评估接通；GLM环境代理、可配置思考模式/回执身份、单层JSON围栏兼容；三例真实有效候选及反馈撤销读回。修Connector纯原件误报事实冲突，新增来源组读面。完整五专业共享编排尚待单包实施。

## V0.3 · 2026-09-21
- 整理根目录，保留当前前后端、合成材料与交付文档；移除旧历史快照及公开树中的本地运行抓包。
- Connectors监听空闲PG连接错误，数据库恢复后可继续查询；隔离部署回归36/36。
- 当前前端构建/类型检查通过；全套132项中4项旧界面测试待V0.4更新。
- 完成范围、限制和V0.4接续详见v0.3/RELEASE_V0.3.md与V0.4_KANBAN.md。
## V0.4 · 2026-09-21
- 政策岗位合成身份在首屏可选并进入客户工作区；运行配置模板补齐该身份映射。五专业入口移除卡片框与底部说明，显示放大的 Logo 和各八字价值说明；前端构建已更新。

- V0.4 客户选择页简化为绿/黄/红三张空白流程图色板，角色切换仅保留图标；目录行为回归6/6、typecheck/build通过，已在现有浏览器检查，待用户视觉接受。

- V0.4 首页三个客户卡改用内部同组件真实进度缩略看板；共享补充读面加载逻辑。眼睛标识放大并加轻微动效。相关回归26/26及typecheck/build通过，1468×808现有预览视觉检查完成，用户接受待确认。


## 2026-09-21 UI 比例与聊天工具栏
移除 DesktopFrame 小窗口整页缩放；调整顶部导航与前后箭头。增加长按 @、表情、引用和现有材料上传入口；普通内部消息使用 messages 接口。语音/电话/扫码明确未接通，自动转交未实施。typecheck/build、14 项工作区测试及 2 项聊天工具栏测试通过。当前浏览器实测仍有 144% zoom，1920×1080/100% 的运行视觉验收未通过，不能标成已锁定。

## 2026-09-21 V0.4 integration
Unified demo entry, native material/tree/timeline reuse, good/medium/bad click-driven progression, synchronized chat and confidence bars, per-stage branching, large presentation controls and Escape return. Includes independent regression and ZCode soak limitations report.
