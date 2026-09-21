# 三例路径与收尾：AdvanceRound R2补充

2026-09-21；用户指定合成案例预期，尚未实现。与[CONTRACT.md](CONTRACT.md)联合使用；此补充只规定三例演示，不把固定轮数施加给一般客户。不得把预期标签放进客户证据或覆盖模型结论。最新COLUMN_ADVANCE_R2优先：正常约5次、补证约6次整列推进，覆盖旧4/5轮；主要推进指已接受的整列业务请求，重放、刷新、回执恢复不增轮；上传及单独人工确认不必各算一次箭头点击。

## 验收表

| 案例 | 服务端执行路径（步骤粒度由可执行计划确认） | 收尾触发所需证据 |
|---|---|---|
| 好客户 | 业务→政策→信审→商务→资产，约5次整列推进；后列按依赖提前真实异步分析 | 约5次主要推进（复用异步结果，不重复执行）、五专业本次流程全部完成的真实域记录、required human决定、无未决/陈旧/unknown；持久`case.completed`后显示全屏大钻石 |
| 中客户 | 业务→政策→信审待补证→实际登记补件后信审整列重评→商务→资产，约6次；相关后列同步失效/重评 | 约6次主要推进；waiting_evidence记录、补件artifactId/hash/登记回执、新版本重评及人工确认齐全；五专业完成且持久`case.completed`后同样显示大钻石 |
| 差客户 | 进件/协作到信审节点，有权人明确拒绝；立即停止不允许下游，不要求凑满5次 | 权威拒绝decision/confirmation引用＋`case.rejected`；服务端归档元记录`case.archived`保留全部历史；显示大红叉，后续不可办理 |

步骤名为验收映射，不允许adapter用步骤名替代真实命令。任一列等待人工时保持awaiting_confirmation，未收到独立确认不得绕过该依赖门；中例无实际补件不能进重评，次数偏离约5/6次时说明实际依赖或补证原因，不能跳过门凑数。

钻石只表示“本案例/本次流程已办结”，不代表正式额度批准、放款或资金到账。拒绝叉只在明确拒绝后显示；failed/unknown/running不映射拒绝。拒绝已确认但归档失败时可显示拒绝事实，同时明确“归档未完成”，不得说拒绝归档分支已验收。拒绝后下游保留停止/不适用原因，不空白、不假绿。推进保持页面/路由/滚动/画布平移缩放/焦点不变；全屏收尾只由真实终态触发，与推进时自动定位无关。

## 终态读回与归档增量（拟新增，不是已存在API）

RoundReceipt与`advance-plan`读回增加`caseOutcome`：`{caseId,fixtureVersion,sourceMode,processId,status,version,terminalEventId,terminalAt,decisionRef,domainCompletionRefs,archiveRef,ending}`。

- sourceMode=`synthetic`；status=`in_progress/completed/rejected`；ending=`null/diamond/rejection`。ending由服务端核验终态与依据后派生，浏览器不得上传ending或状态请求。轮次completed不直接等于case.completed。
- 终态以processId标识本次办理范围；相同customer不同流程不能串结局。缺少已接受流程定义或必需域规则时不可自称全部办结；不能借旧生命周期状态冒充本次完成。
- 新增归档能力由同一后端包在A持久层实现：以原拒绝引用及processId幂等登记`archiveRef`，记录actor/时间/原因/证据索引；逻辑归档只停止该流程继续推进，不删除材料、客户、回执或历史，也不操作Codex任务。
- 自动归档仅限本授权合成案例的“明确拒绝后保留记录”动作；写入前重验拒绝事实及权限，不产生新的信用判断。不得扩大成通用批量删除/归档能力；若执行身份不具归档权限，保持“拒绝，待归档”。
- 全屏退出、返回工作台、查看记录均只读；刷新读取相同terminalEventId/版本，不重复推进/归档。相同终态事件只触发一次提交效应；视觉呈现可由Front本地记忆已看状态，但不能改变服务端终态。reduced-motion关闭动效，保留静态结果。

## 当前合成资源核对及缺口

核对范围仅`docs/materials/kashgar-demo-v1`明确标为synthetic的索引/说明/补件，以及既有TAKEOFF合成manifest；未读生产数据、未运行生成器或修改fixture。索引grade是设计标签，不能作为正式结论。

| 可复用资源 | 本次确认事实 | 与新验收的差距 |
|---|---|---|
| KS-INJECTION-1000（较好） | case-index.json latest.revenue2025=59,423,412元 | **超过年收入5000万元绝对红线**，不能直接充当约5次成功样例；在新的授权合成版本中一致调整材料/台账/索引并复验，不能修改原件后伪称未变 |
| KS-LASER-500（正常） | revenue2025=30,758,820元；S01补件说明历史应收未收回、设备担保待核验、影像待采集 | 超出1000–3000万元聚焦区间但未越5000万元红线；现有答复不等于完成补证，不能直接保证约6次后全绿。需新版本真实合成补件＋上传登记/核验记录及重评，不强迫模型给支持结论 |
| KS-TEXTILE-200（较差） | revenue2025=18,480,308元，设计定位较差 | 设计定位不等于正式信审拒绝；需规则/材料、当前有权人的明确决定及归档回执 |
| Back/Edge/test/fixtures/takeoff/fixture-manifest.json | 单个恒锐合成客户，含材料纠正、诉讼/撤回、不可可靠解析的扫描样张 | 可复用测试形态，不能称已具备三客户固定结局或五/六次整列服务端轨迹 |

真实现有拒绝能力：A `/api/v2/assessments/:id/decide`支持`reject_assessment`，写decision记录及DECISION_RECORDED；`confirm-preassessment`支持`not_support`，但含义是本次预评估不支持，不能与任意技术失败混同。实施时按流程定义选择一个正式拒绝口径，绑定原回执，不重复调用两种决定以凑事件。

在本次读取的`Back/A/src/http/server.ts`、`domain/credit.ts`、`Back/Edge/src/proxy.mjs`未找到案例archive命令；**拒绝已有，案例终态聚合/逻辑归档/五专业全绿判定/5或6次整列计划尚缺**。这不是宣称全仓完全无归档代码。

## 纳入同一个后端包的增量及停止条件

沿[IMPLEMENTATION_MAP.md](IMPLEMENTATION_MAP.md)单writer、R2交回后串行实施：AdvanceRound持久层新增caseOutcome与逻辑归档记录，配合原命令读取终态；新增隔离测试覆盖三例约5/6次整列推进与拒绝路径、补件缺失、unknown、归档失败、拒绝后下游零发送、刷新不重复提交/归档、事件引用与原材料可读。

合成材料修订是该包的明确前置依赖：仅新增版本目录（建议`docs/materials/event-advance-r1/`），保留旧v1；修改范围需主协调纳入后续包ownership，本任务不写材料。案例生成必须留源、hash、财务一致性及收入边界验证；严禁仅改grade或模型结果标签。若材料/规则不支持预期，报告具体冲突，停止该案例成功验收。

Front继续独占全屏组件/布局/动效及测试；未接后端时明确演示fixture，不声称实时整链。此处没有派发任何任务、没有新增费用授权，也未改变正式人类权威。

