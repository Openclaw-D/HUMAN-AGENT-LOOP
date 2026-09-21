# AdvanceRound R2：整列推进最小契约

最终范围以[四页同步映射](FOUR_PAGE_SYNC.md)为准：仅三个客户；平台/材料/决策/流程共享持久关联与确认版本，真实已选路径独立于默认推荐。本目录旧源码观察按该文的R2漂移说明限定，不把历史缺陷当作当前已验证结论。

2026-09-21；状态：交互与协议设计冻结，**未实现、未装配、未运行验收**。最新依据：[EVENT_ADVANCE_R1](../../tasks/EVENT_ADVANCE_R1.md)。本契约覆盖旧右箭头纯导航；不改用户当前页面布局，不扩大真实模型费用或外部交易授权。

最高依据更新为[COLUMN_ADVANCE_R2](../../tasks/COLUMN_ADVANCE_R2.md)：每次推进一整列专业，后列实际调度联动，页面与视口固定；正常约5次、补证约6次，覆盖旧4/5轮。三例钻石/拒绝红叉归档保留，详见[三例验收](THREE_CASES.md)。

## 1. 一次点击的含义

右箭头显式推进当前客户的一个完整专业列（domain），不是一格、一行或浏览节点。先展示服务端计划“本列全部相关动作、列内输出、受影响后列及停止条件”；点击提交整列计划，不能通过只选部分actionIds缩成单格推进。独立专业可以提前异步分析，不要求五专业串行。

推进绝不改变页面、路由、scroll、画布transform/缩放或焦点位置，不发送导航/定位指令，不调用scrollIntoView表现推进。Front只更新已有位置的数据；浏览器本轮不操作。每个相关事项输出依据、结果或明确阻断，不能仅变色/留空；只有必需事项全部具备真实完成回执、有效依据且人工门已通过，本列才可整体绿勾。

五专业：业务/政策/信审/商务/资产；领域代码使用现有后端字典，不按中文名临时造枚举。模型分析、命令执行、人工正式决定分开记录。无真实可执行动作时按钮说明阻点，不用空轮次或本地计时器假推进。

## 2. 新接口（均为拟新增，Front当前不得当作可用接口）

基路径 `/api/jw/v2/customers/:customerId`；身份来自可信session，tenant由后端授权客户归属派生；不信任body的actor、tenant、角色、URL或动作代码。

| 接口 | 输入 | 返回与语义 |
|---|---|---|
| `GET {base}/advance-plan?domain=<专业代码>` | 无业务写入；每次重验客户访问及动作资格 | `{available,reason,domain,domainVersion,planId,planHash,policyVersion,expectedVersion,roundNo,summary,allowedActions,affectedDomains,downstreamPlan,blockers}`；allowedActions覆盖整列，含`actionId,commandKind,targetRef,dependsOn,inputsHash,evidenceRefs,requiresHumanConfirmation`；downstreamPlan明确每个依赖域的预期接收/排队/运行或等待条件 |
| `POST /api/jw/v2/actions/customers/:customerId/advance-rounds` | `{requestId,domain,planId,planHash,expectedVersion,roundNo,actionIds}`；domain必须匹配计划，actionIds精确匹配整列动作集合，拒绝子集或任意动作体 | 首次持久接受202，返回`RoundReceipt`；接受仅说明排队成功。已完成且依据未变的列返回200＋`reused:true`及原回执，不新建工作、不计费；已有执行则关联原job，不重复派发。版本/计划/幂等冲突409且零新增动作 |
| `GET {base}/advance-rounds/by-request/:requestId` | 原requestId；只读恢复，可在未拿到roundId时使用 | `{found,receipt}`；found=false不证明从未发送，不自动生成新ID/重发。后端必须先按原键完成认领/派发对账才能提供安全重试结论 |
| `GET {base}/advance-rounds/:roundId` | roundId | 权威当前RoundReceipt，刷新/重启后可恢复；读权限不等于继续执行权限 |
| `GET {base}/advance-rounds/active` | 无 | `{receipt:null|RoundReceipt}`；换设备/清空浏览器缓存仍可发现当前running/unknown围栏，不依赖前端保存requestId |

`expectedVersion`固定为版本向量：`{customerRevision,assessment:{id,version}|null,package:{id,version}|null,ruleVersion,materialDigest}`；其中customerRevision是拟新增轮次/依赖版本，**不等于现有activity seq或admission.inputVersion**。没有原生version的依据必须以受控digest核验。每个动作执行前还需核对自身依赖版本；不得只在计划生成时检查一次。

`RoundReceipt`最小字段：

```text
requestId, roundId, customerId, tenantId, domain, domainVersion, roundNo, parentRoundId?, version,
actor:{principalId,roles}, acceptedAt, updatedAt, state, outcome, current,
planHash, basisVersion, affectedDomains,
actions:[{actionId,commandKind,targetRef,requestId,state,sent,executor,
          startedAt,finishedAt,sourceReceiptRef,eventRefs,error}],
columnResults:[{itemId,kind,state,result,basisRefs,receiptRef,blockers}],
domainChanges:[{domain,before,after,reason,dependencyRefs}],
downstream:[{domain,state,jobId,causedByEventId,dependencyVersion,receiptRef,waitFor}],
evidenceRefs, candidateRefs, confidence:{value:null|number,calibration:"uncalibrated"|"calibrated"|"unknown",evaluationRef:null|string},
judgmentSummary, blockers, next:{canAdvance,reason}, eventCursor
```

时间由服务端记录，缺失为null；initiator与各action.executor分别保留。confidence只有真实来源才给数值，校准必须有评测引用；判断摘要是依据与结论摘要，不包含隐藏思维链。候选缺失不能伪造3–5条或百分比。响应按客户/租户/受众过滤；内部候选不能经轮次读面泄露给客户联系人。

## 3. 状态、幂等和恢复

- 执行state：`accepted → running → completed | waiting_evidence | awaiting_confirmation | rejected | failed | unknown`；`completed`只指本轮动作全部获得确定回执，不代表客户全生命周期完成。outcome另记`progressed/needs_evidence/needs_confirmation/rejected/stale/failed/unknown`。
- action.state：`pending/running/succeeded/failed/unknown/blocked`；sent使用`false/true/null`。部分成功后失败，保留已发生事件及回执，阻断依赖分支，不整轮回滚或宣称全部成功。
- 幂等身份绑定tenant＋customer＋initiator＋requestId；计划、版本、roundNo、规范actionIds纳入payloadHash。同键同体返回原回执；异体冲突。查询与重放均先鉴权，不跨身份返回别人的回执。
- 客户级原子active-round围栏覆盖accepted/running/unknown：其他principal、新requestId、换客户再切回、进程重启不能绕过；waiting_evidence/awaiting_confirmation也不得直接再按箭头绕过对应门。新轮次必须由服务端确认有新依据或人工决定后发出新计划。
- 动作requestId由持久roundId＋actionId派生并固定；发送前落intent，完成后绑定原始业务回执。网络断连、进程崩溃及发送不明进入unknown，恢复先读原命令/模型回执，不改ID重发。A/B现有回执不自动充当RoundReceipt。
- 只允许有可核验幂等恢复协议的动作入计划；没有则`ACTION_RECOVERY_UNAVAILABLE`阻断。found=false、超时、claim失联均不视为“可安全重试”；需原子所有权及fencing证明未发送，或取得原权威回执。unknown不能靠TTL、裁剪、重新登录、换scope自动解除。
- 每个待执行动作及返回敏感内容前重验权限；不能把人类凭据存入checkpoint。权限失效停止未发送动作，已发送动作继续只读对账，不借另一身份补发。

## 4. 五专业、拒绝和补证

**R2调度语义（优先于旧轮次泛化表述）：**一次计划以一个domain为主列，动作集合包括该列全量相关事项及明确列示的后列派发。A持久产出提交后通过持久outbox/job交接驱动真实调度，不能让Front推算或请求下一列来伪造联动。主列完成无需等待所有后列完成，但必须持久记录每个后列的实际交接状态；后列running只能来自执行器已开始的运行事件。派发失败如实显示，不掩盖已完成主列。

后列状态固定为`received/queued/running/waiting_dependency/needs_reassessment/completed/failed/unknown/stopped/not_applicable`，分别绑定接收事件、队列认领、运行开始、waitFor依赖、版本失效或结果回执。没有权限/材料的后列显示明确等待；只有获准、前置满足且真实执行器开始才标running。业务列产出后政策及其他依赖列必须有对应可追溯状态；无可运行能力则报集成缺口，不能验收为已联动。

跨列幂等工作键=`tenant/customer/processId/domain/actionKind/dependencyDigest`，在当前轮次requestId之外原子去重，复用异步已启动/已完成的工作。单个推进请求的running/unknown围栏继续有效；该推进已结算但后列job仍运行时，下一列推进只关联原job并等待/汇总，不重新扣费、确认或执行。涉及unknown的依赖仍被锁住，不能换列/换ID绕过。原第3节客户级围栏约束未结算推进请求，不应把所有合法后列并行job当成重复请求禁止。

expectedVersion补入`domainVersions`与`dependencyDigest`，分别验证主列及后列所消费依据；列已异步完成且依据未变时返回原完整结果，不为凑约5/6次人为再执行。case完成仍取五列必需事项/正式门的集合判定，不能取轮数。

依赖图只来自既有域结果/材料引用/已批准规则；无依赖关系证据就不推断其他域通过。材料变化只标记直接及传递受影响域为待重评；旧候选与正式历史原样保留、标明当前性。互不依赖且各自获授权的任务可异步并行，轮次按各子回执更新，不以页面动画计时完成。

信审正式拒绝引用现有有权人决定ID，使当前业务分支提前终止并禁发不允许的下游；已在途动作不能假称已取消，迟到候选只留历史不得恢复推进。模型“建议拒绝”只能生成候选/待确认，不能自行变成正式rejected。正式确认、拒绝、额度批准、资金操作均不隐藏在箭头批处理中。

补证请求进入waiting_evidence，记录缺件、请求者、依据及关联轮次。真实补件通过现有上传登记并得到新材料版本后，生成`parentRoundId`关联的重评轮次；roundNo由服务端递增，允许补证约第6次及后续必要重评。已正式拒绝后的重新受理政策未冻结，默认不自动重开；普通补证不构成推翻正式拒绝的授权。

## 5. 四页与聊天如何同步

新增轮次状态必须持久记录有原始时间/actor/roundId/actionId的事件；业务结果仍以A为权威，协调日志不能代替业务写入。轮次接受、动作开始/回执、待补证、待确认、终止分别留记录。

四页和聊天订阅同一客户现有`/events` SSE并使用`/events-page`补拉业务事件、`/workspace`刷新投影；eventId命名空间去重、服务端版本决定当前性。新RoundReceipt是轮次执行读面，未接入activity前前端从轮次GET恢复，不声称activity已有轮次记录。SSE只是更新提示，断线/刷新后读持久源；SSE与轮次版本不可混作总序。

当前activity只聚合thread/kernel/model元数据，没有完整模型聊天正文，且存在此前登记的读取中撤权及终态更新待验事项。收到同ID新版本需upsert，不能“见过ID即丢弃”。unknown/running禁重复触发；历史回看只读，回退不撤销业务；接口缺失明确“业务推进未接通”。

## 6. 开发前安全门槛

1. **执行权限：**human箭头不自动换成service；A analysis start/finish要求service，创建评估/送审要求human＋credit。服务任务的显式委托、原发起人权限交集和撤权方式未具备前，该action禁用。模型费用/外部交易本轮无新增授权。
2. **版本原子性：**部分现有命令无通用expectedVersion。预读版本后POST存在竞争，实施须在相应A事务内校验依赖版本，或证明现有状态门已等价保证；证明不了则该动作不入可执行计划。
3. **专业图：**现有B TaskRun图是任务执行图，不是现成客户五专业轮次服务。不得给它换名就宣称A2A五专业联动已完成；只启用有实际命令、依赖及授权证据的分支，其余显示缺口。
4. **终止范围：**正式拒绝之后重开、哪些已完成域仍有效，由现有正式规则/决定支撑；不得由推进adapter自创业务政策。

协议可供Front制作准确状态，以上门槛未满足的动作不可开放。真实调用清单、单个后端包及验收见[IMPLEMENTATION_MAP.md](IMPLEMENTATION_MAP.md)。

