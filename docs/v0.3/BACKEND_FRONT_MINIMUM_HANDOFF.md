# CTRL → FRONT 后端最小接线，2026-09-21

状态：源码核对与待实施契约；不代表运行实例已加载、独立验收通过或已派发ZCode。四路parallel-qa保持独立核验，不承担本包产品实现。此顺序覆盖旧任务书“预测优先”。

## 顺序及责任

1. P0 上传上下文恢复：ZCode后端单writer实施，CTRL冻结契约并验收，FRONT接线。
2. 材料统一读面：同一后端任务接续，不与第一项争写；FRONT消费读面。
3. 实际路径与眼前分支：同一后端任务接续；只投影已有业务事件、权限与前置，不引入新工作流。
4. 预测：先验收现有taskKind切片，再接页面；与实际路径独立，不能阻塞真实路径展示。

共享后端改动须先确认原writer交回；用户手动转交ZCode，不新增隐藏委派或并发产品writer。新公开接口仅为待审契约，不随本文自动发布。

## 已有源码可接面

- Edge `/api/jw/v2/customers/:id/artifacts` 及其 `/:artifactId/processing`、`/:artifactId/content` 为已登记透传读面，A逐请求裁决。材料列表并非已完成统一业务名称读面。
- Connectors原件preview代码返回 `evidenceId, customerId, sourceGroup, format, size, sha256, completeness, previewSafe, downloadUrl`；必须经现有授权入口获取，签名URL不是永久访问权。
- processing/status 返回 `tasks, questions, pause, coordinatorVersion, rulesetVersion`，没有可恢复的上传授权绑定；task完成不授予上传权限。
- assistant/decisions已有 `authority, customerId, assistant, revision, pending, latest`；源码包含 `taskKind=next_action/path_forecast`，latest包含current。存在代码不等于预测已上线或质量通过；旧记录默认next_action。

## 待实施最小字段（建议DTO，非现有API承诺）

**上传上下文**：`customerId, available, reason, bindingRef, allowedKinds, allowedObjects, expiresAt`。服务端从当前会话确定身份与租户，再证明本身份与绑定关系；无法证明返回不可用。读取零写，无token/providerUserId，不推断最近邀请、不延长或自动新建。上传POST重验权限、撤销、期限和范围。刷新、重开、换客户、换身份、多绑定、撤销均需反例测试。

**材料**：`artifactId, recordKind(original/extracted), businessName, originalRef, sourceGroup, sha256, parserVersion, locator, analysisRefs, savedReceiptRef, current`。字段必须有持久来源，缺失明确null并说明；提取记录引用原件，不能冒充第二份独立原材料。保存回执关联真实对象和修订；历史记录保留。不同版本不能仅以文件名合并。

**路径**：`customerId, assessmentId, revision, historyNodes, historyEdges, availableBranches`。历史节点/边必须绑定真实event或receipt及时间；无法证明先后因果不得连成既成链。当前分支含 `actionId, prerequisites, missing, allowed, actorRole, basisRevision`，执行仍经原写接口重验。候选选择回执只证明选择，不证明业务完成；写后读新revision再展开下一批。仅返回眼前可选分支，未来未知不预绘为确定全链。没有可靠事件源则如实缺失。

**预测**：保留 `taskKind, targetState, conditions, horizon, evidenceRefs, current`，并明确provider/method、支持评分含义与calibration。现有未校准confidence只能标“证据支持把握（未校准）”，不能改称事件概率、违约率或JEV服务输出；没有有效依据则待评估。预测不能写入history或授予操作权限。

## 交付与验收

每项交回源码位置、字段实际样例（脱敏）、权限/陈旧性反例、测试退出码、未实现字段、ownership释放。FRONT只按已验收字段显示；未知保持缺失，不从文案或动画补造事实。隔离HTTP工程验收不代替真实模型质量；不调用付费模型、不改共享配置、不重启服务。

## 用户最新增量：横向贝叶斯决策沙盘

由FRONT转达用户手绘与明确要求：左侧当前状态→可选方案卡→客户可能反应→后续行动→效果。世界树不限于角色工作流；上传恢复P0顺序不变。以下为待ZCode实施契约，尚无沙盘运行或贝叶斯计算验收证据。

- 保留实际路径读面；新增独立沙盘场景DTO，不把假设节点混入history。节点 `type=decision/chance/outcome`，路径 `mode=actual/hypothetical`。actual必须绑定持久业务事件；假设边明确条件，不代表已发生。
- 场景标识：`scenarioId, revision, parentRevision, customerId, assessmentId, basisRevision, evidenceHashes, createdBy, createdAt, current`。保存是独立沙盘记录，使用expectedRevision防覆盖并保留版本；不写业务报价、正式意见、审批或资金状态。权限从当前会话核对，浏览器不能指定权威事实。
- decision方案支持价格、期限、首付等对比：每值携带单位、币种（如适用）、来源或假设标识。报价仅模拟，不发送、不生效；方案是否符合实际业务规则单列validated/unknown/invalid，不把可模拟等同可办理。
- chance客户反应记录 `hypothesis, probability, probabilityStatus, priorSource, priorVersion, evidenceRefs, likelihoodBasis, methodVersion, posteriorVersion`。仅当有可追溯先验、似然及明确模型时计算后验；否则probability=null、probabilityStatus=unverified_hypothesis。LLM文字或confidence不能直接充当似然或反应概率。条件分布仅在分支互斥且穷尽时归一化，缺失反应保留unknown分支，不强行凑100%。避免将同源证据重复计入更新。
- outcome收益、时间、风险每项记录 `value, unit, source, assumptions, status`；未知用null，不能填0。预期收益仅在结果效用、有效概率及计算依据齐备时计算；风险评分与违约概率严格区分，不虚构可比指标。
- confidence是模型/证据支持评分，字段、标签与probability分离，并标明是否校准。不得将沙盘称为已接入JEV或已完成贝叶斯更新，除非有对应真实实现与验收证据。
- 新证据产生新basisRevision；旧场景保留且标失效，重新计算创建新修订，不能覆盖历史或自动触发付费模型。用户选择方案仅保存沙盘选择回执，后续行动仍是假设；真实执行须单独通过既有业务接口授权。

实施拆分保持串行：先交不含概率计算的场景/节点/单位/来源契约与保存边界，再提交先验及似然可用性清单；缺必要业务参数时由CTRL请用户裁决，不编造分布。最后实现有依据的计算并用可手算样例、缺失输入、重复证据、跨客户、撤权、并发修订及证据变化反例验收。此增量不授权新公开接口发布或新增模型厂商调用。

### 渐进树形交互字段增量

保留五专业入口，节点只展示实际返回的候选数量，不为“3选1”补造第三项。`children/hasMore`区分未加载、已知子节点与暂无依据；展开/收起只读，不触发选择、模型调用或业务动作。选择回执仅证明选择，不能自动创建后续实际路径。

`selectionStrategy`包含策略名称、适用条件及依据；“最大概率”仅在同一条件下可比较且具备有效反应概率时可用，不能按confidence冒充概率。策略推荐与用户确认分离，不自动采纳或执行。

`effect`含 `direction=improved/worsened/unknown, metric, baselineRef, comparisonRule, evidenceRefs`；默认灰线，仅有明确指标、比较规则和同口径基准才显示改善绿/恶化红。金额增加不自动代表总体改善，多指标冲突不得归为单一全绿。

金额解释字段 `amountBefore, amountAfter, delta, currency, amountKind, basisRefs, methodVersion`；区分模拟额度、预评估建议与正式批准。无可复现计算依据则null，不以相关性断言某动作造成额度变化。此项目不得将沙盘或预评估金额描述为正式最终批准额度。右侧展示动作、来源、计算依据与限制，不展示隐藏推理。
