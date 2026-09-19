# 版本记录

## V0.1 · 2026-09-16

从Anthropic复制当前前端、最新backend-next和轻量历史资料到独立JW；采用Achieve/Front/Back目录。依赖桥本地化，新增独立前端启动配置；逐文件hash和排除理由可追溯。原件未删除。业务行为未因迁移改版，前后端未接线，已知缺陷与业务候选保留。实际检查见Achieve/Migration/VERIFICATION.md。

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

## 2026-09-19 goal-03 续（J1.1–J1.5 页面做实）
- Edge：新增 Connectors IR-02-C 消费面（读 status/tasks/preview + 写 intake/upload/manual-entry/correct-fact/questions/pause，X-Service-Token 服务端持有）；A 决策链读面（decision-status/domain-exemptions）与写面（豁免登记、DELETE grants 页面化撤权）；CSRF 扩展至 DELETE。
- Front：处理通道卡、G3 处理状态、通道人工路线（批量转录/更正）、通道补证问题（回答/获准复核）、检查会话收口按钮、依据包冻结/详情/域意见登记/信审候选/包绑定提案、admin 撤权客户身份；修复 npm test 漏挂 wb-logic。
- 测试：Edge 非 e1 46/46（新增 5）；Front 32/32；typecheck 0；dist 重建。契约 consumed-surface → goal03d-1。详见 docs/product-delivery/goal-03/。

## 任务02 增量 · 2026-09-18/19（四任务产品交付轮：A 桥贯通+解析 v2+默认测试入口修复+IR-03-8 关闭）

执行 `JW_product_delivery_four_tasks` 任务02（基线 e4ed7a5 在制树；范围 Back/B、Back/C、Back/Connectors；文档 docs/product-delivery/goal-02/）。A 桥贯通（Back/Connectors a_bridge）：材料→解析→四域预审全链接通 A 权威登记（analysis-runs/Gate 回执/findings/回执对账；a_links 幂等对账、unknown 不换 ID、requestId 确定性 ≤128）。解析 v2（Back/C parse-adapters）：引号 CSV 状态机、非法日期与合计行剔除、XLSX 专用适配器（DEF-G04N-03 修复）、text-PDF（修复 extractPdfText 流切片混入 `stream` 关键字致长流抽取全空）、扫描件人工路线（录入→冲突→更正→复核 verified，零伪造事实）。默认测试入口修复（任务书 B1）：Connectors `npm test` 修复前实跑 0 用例，修复为显式清单；B 补挂 3 文件 83→105。续轮（2026-09-19，ROUND-LOG 回执在案）关闭 IR-03-8①②③⑤：①G3 处理状态写口接线（reportProcessingStages/reportG3：received/parsed/analyzed/needs_review/failed，runRef=`<taskId>:a<attempt>`，requestId=`ptx-<taskId>-a<attempt>-prc-<stage>` 确定性幂等，a_links entity_type=processing，上报失败不阻断主链）；②人工事实并入四域分析（fact_assertions 加列 entry_mode/value_json 幂等回填、requeueForAnalysis 录入/更正/复核自动重入、liveManualBlocks 取代 parse 值、复核 verified 升级，CLEAR 回执真实到达 A）；③判重收敛客户级+既有绑定新邀请显式 accepted；⑤start-connectors 透传 processing 配置（resolveProcessingConfig 优先级，a_customer_links 表为权威）。测试（2026-09-19 最终轮）：Connectors **77/77**（73+新增 G-A3/M3/N3/N4）、A 桥真内核 **3/3**、C 101/101、B 105/105；perf 双臂对照处理 2642→1560ms、域计算 80→26、外发 100→5，等价性断言 4/4。如实遗留：IR-03-8④（检查会话裸 kind 匹配）归 01；⑤ 的 01 侧目录归集读口 OPEN（种子降级为兼容路径）；B 全量并发偶发 1 次 crash-recovery 时序失败（单独复跑均 105/105）；包域结果登记默认关；XLSX 仅首 sheet、PDF 表格不重构、`stream\r` 形态不识别。
