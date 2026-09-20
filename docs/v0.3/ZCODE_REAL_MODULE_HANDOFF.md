/goal

接续优先级增量：先单独完成 `docs/v0.3/ZCODE_PATH_FORECAST_SLICE.md` 的明确taskKind切片，再回本包；两个包不同时实施，不新增并发任务。当前尚未自动派发。

P0补件恢复缺口（仅新增待办，未授权新接口发布）：现有channelStatus仅返回tasks/questions/pause/coordinatorVersion/rulesetVersion，没有可恢复上传授权的invitationId或有效绑定列表；intake当前仅issue/accept/verify/revoke/checkUploadScope，无授权绑定查询。设计最小只读upload-context契约后再实施：服务端从会话核对租户、客户、上传权限及本身份可使用绑定的明确依据；返回可用性、原因、获准kind/object范围、有效期及必要的不透明引用，不返回邀请token/providerUserId等秘密。不能从任务或工件的uploaderRef反推权限，不能把同客户所有邀请暴露给当前人，不能猜最近一条、自动延长有效期或自动创建/验证绑定。若当前principal与接受人尚无可信映射，明确返回需要连接/核验，而非推断授权。上传POST再次检查撤销/过期/范围，避免读后撤权竞态。覆盖关抽屉、刷新、换身份/客户、多绑定、撤销、过期及零写读取；FRONT在该读面完成前保持禁用，不用localStorage当授权。

在 C:/Users/22673/Desktop/JW 串行完成「三例完整原件→五专业真实AI辅助结果→受控人选→人工确认前的可办理状态」。这是同一份接续包，不开并行任务。按当前AGENTS，中大型后端实施由ZCode负责；CTRL负责契约及真实模型最终独立验收，FRONT独占前端。

输入：docs/v0.3/REAL_API_CHECKPOINT.md；docs/takeoff/first-admission-v1/00_START_HERE.md及01/03/04契约；docs/materials/kashgar-demo-v1/case-index.json、各material-manifest.json、INTEGRATION.md；.local/v03-recovery/case-runtime-map.json与case-upload-receipts.json。保留已存在的三客户和评估，不重建、不删旧记录。

最新UI权威增量：docs/v0.3/UI_STATE_PATH_AUTHORITY.md。大号浅银铜色实体锁=未开始/前置未满足，机油蓝金属扳手=处理中（仅实际running旋转），亮绿闪亮勾=真实完成，大红叉=明确失败/不通过；覆盖旧黄扳手及三色点。后端保留细分状态、阻断原因、当前性和完成凭据供前端映射，不用图标改变业务状态。动态路径需要节点与边的实际事件来源、发生时间/版本及当前可执行性依据；未发生分支与已走路径严格区分，不能由LLM虚构事件。展示范围已确认是当前客户已走路径＋眼前可选分支、后续逐步展开，不扩成全生命周期或固定五步流水线。先交现有事件/权限/前置条件到路径投影的最小契约，复用既有接口；缺乏依据的节点保持未知或不可执行。

Ownership：Back/Connectors的材料处理/元数据/分析接线，Back/Edge服务端编排与既有观察面适配，必要的Back/A领域结果契约适配和定向测试。Back/B transport、费用账本、未知回执及运行配置不得自行改写。前端、原材料、旧Achieve不写。你不是唯一作者：保留所有现有修改；FRONT仍在改Front。不得重启服务、激活规则、调用付费模型或修改共享数据；先完成可审阅代码和运行脚本，交CTRL单点执行真实调用及恢复。单文件单writer，交回时释放ownership。

按顺序完成：
1. 通用原件名称/期间元数据通过上传→存储→A清单读回，不再仅依赖sourceGroup推测名称；同源表示不重复上传，不改变原件字节。准备幂等增量接入脚本：只上传manifest中uploadByDefault=true、sourceMode=synthetic且SHA256吻合的文件；已有9件按字节哈希识别，检查类别与sourceGroup不一致并提出明确历史修订方案，不直接篡改。费用白名单只来自实际核验的合成原件。
2. 五专业真实模型分析必须使用获准原文、稳定完整身份、单账本、单并发、LangGraph既有路径、引用核验及未知不重发。不得把当前Connectors deterministic_calculation的结果改名为real；不得把Edge个人decisions直接当共享域意见。材料量扩大后仍最多8片段/每片段800字符/30事实/总正文12000字符，遗漏如实记录，按域选证避免第一份资料吃掉所有上下文。
3. 复用A analysis-runs/start→真实执行→finish→decision-packages/domain-results。输入摘要必须执行前冻结；runId用A实际返回ID，规则必须当前已有合法版本，不能事后给旧个人模型结果补造运行。五域支持情况以当前代码核对，未支持项明确列缺口。opinion.authority=none；个人反馈、人工采纳、预评估确认三者分开。记录运行状态不能把缺件/冲突自动清绿。
4. 前端最低契约：每专业返回本次做了什么、有效发现、缺件/冲突、证据引用、是否当前、等待谁处理；必须来自实际持久状态。优先现有读写面，若必须新公开接口，先交最小请求/响应/权限/幂等契约，不自行发布。保留assistant/observe兼容。
5. 明确人工结束路径及角色权限：只能有权人确认首次回租预评估，不创建正式额度、提款、签约或资金动作。不能代用户作实质审批判断。现有业务角色不能创建assessment，信审创建权限不放宽。

验收：三例材料接入可恢复且无重复，变更使受影响结果失效；每域真实调用证明能关联同一原件哈希和A运行；无越权、无无来源有效结论、无未知重发。反例覆盖原件信封不误作同键事实、真实同键事实仍冲突、跨客户、撤权、材料变化和损坏输入。可用隔离HTTP做工程单测，但不能作为真实模型验收；最终真实API由CTRL执行。不得预置全绿、改掉安全断言或使用“|| true”。

最新画布范围已确认：当前客户已走路径＋眼前可选分支，后续逐步展开。用户要求JEV未来状态与置信度；当前项目仅有GLM建议的model_estimate_uncalibrated，没有Jev适配或未来状态概率公式。该缺口须明确标待评估，不用建议置信度冒充未来状态概率。先按UI_STATE_PATH_AUTHORITY.md补充预测目标、条件、时间范围、来源、校准状态和版本的契约；新厂商接入/调用尚未授权，不直接启用。此项属于同一任务包增量，未新增派工。

交付一份报告：变更文件、定向测试/退出码、运行脚本dry-run与恢复方法、前端最小消费字段、未完成项及ownership释放。不要重复已通过无变化全套测试，不并行派工、不空转耗费模型。

