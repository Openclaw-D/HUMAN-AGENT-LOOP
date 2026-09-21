# 最终收敛：三客户四页事实映射

2026-09-21；最高依据[FOUR_PAGE_SYNC_FINAL](../../tasks/FOUR_PAGE_SYNC_FINAL.md)。仅好、中、差三例，沿用整列推进、正常约5次/补证约6次、拒绝提前停止；不扩展其他业务功能。本文是契约和静态映射，不是整链完成证明。

## 统一关联与版本

新增AdvanceRound投影以`customerId + processId + domain + roundId`定位本次专业列；关联`actionId/requestId → source:eventId → materialRef → decisionSetId/candidateId/feedback.eventId → resultRef`。tenant、身份和受众由服务端授权，不能只按客户字符串拼接不同来源。

现有真实字段：材料`artifactId/sha256/supersedes/supersededBy`与解析版本；A事件`eventId/seq/at`；模型`requestId/contextHash`；决策`revision/latest.id/latest.feedback.candidateId/eventId/at/reason`。material版本不得伪造为统一整数：保存原artifactId＋hash及取代关系，解析版本另列。`roundId/domain/actionId`尚无跨四页完整持久关联，需AdvanceRound适配层登记，不能前端猜测。

拟定统一读投影`viewBasis={customerId,processId,domain,roundId,roundVersion,domainVersion,sourceVersions,materialRefs,decisionRefs,current}`，附于现有计划/轮次读回，不另造四套状态。sourceVersions保留A资源版本/事件水位、feedback revision、模型contextHash，各源序号不直接比较。后端在读完各源后核对版本及权限，变化则标`syncing/current:false`或重读；四页同一事实只展示同一已确认basis，禁止把新材料与旧候选当作现行组合。

## 四页字段与真实读源

以下Edge前缀均为`/api/jw/v2`，所有现有读口仍须各自鉴权。

| 页面 | 对同一专业列显示 | 当前真实来源 | 缺口/对齐要求 |
|---|---|---|---|
| 平台 | columnResults、列状态、downstream运行/等待原因、basis及最终结果 | `/customers/:id/workspace`；A评估/依据包投影 | 无完整RoundReceipt与整列调度读面；状态必须服务端聚合，不能按点击数/其他页数组推算 |
| 材料 | 本轮该列实际原件、hash/取代链、上传/解析/核验状态、被哪项判断引用 | `/customers/:id/artifacts`及`/artifacts/:artifactId/processing`、`/content` | 客户材料清单不是“该轮该列材料”；需要持久materialRef关联，未登记上传只能标请求中 |
| 决策 | 候选/依据、建议首选、用户实际选择、理由、后续分支、当前性 | `GET /customers/:id/assistant/decisions?assistant=…`；`POST /actions/customers/:id/assistant/decisions/feedback`；A `/assessments/:id/candidates`另属评估候选历史 | assistant不等于domain；反馈仓库按tenant/customer/principal/assistant隔离，不能把一个人的选择自动当成全员选择。现有GET仅latest/pending，历史路径与round关联、共享可读范围尚缺 |
| 流程 | 谁何时做何动作、材料/选择依据、调度与回执、拒绝/归档/办结 | `/customers/:id/events` SSE＋`/events-page`；`/activity`聚合thread/kernel/model元数据 | activity不含decision反馈历史及完整模型正文；需round事件/结果引用才能四页追溯。未知actor/time保留未知，不用当前会话补历史 |

## 选择事实与呈现约束

只有服务端已持久化且action=`select`的反馈，才能把对应`decisionSetId + candidateId`标为用户实际选择。默认排名第一仅是推荐；等待反馈回执时为“选择提交中”，不能提前展示已确认路径。现有反馈输入含`operationId,expectedRevision,decisionSetId,action,candidateId,reason`，action支持select/none/undo；鉴权、版本冲突与unknown按原回执恢复，不改ID盲重发。

Front呈现已选节点/分支为黑灰底、浅色字、加粗，并有“已选择”及适当aria语义；未选白灰。置信度变化不能替换选择；新材料使依据失效时保留“历史已选/待重评”，新候选集需要新的明确选择。undo不删除原事件；最新撤销态不能抹掉最终结果曾依据的历史选择。最终输出绑定不可变的decisionRefs、材料版本及判断摘要，不能只引用会变化的latest。

当前`decision-feedback-store.mjs`有持久events及revision；`assistant-decisions.mjs`反馈写入actor/reason/candidateId，GET只回latest/pending而非全历史。冻结要求是复用这些事实并补受权历史投影，不用前端另存一份业务历史；共享人员可读策略未明确时按原person作用域失败关闭，不自动扩大授权。

## 当前阻点与输入漂移

1. A/Edge server本次未找到advance-plan/advance-round入口；整列推进、持久关联和统一basis仍是整链阻点，不能只靠Front解决。
2. R2在制源码已变化：decisions现在接受body.materialScope并传provider；model现在将selection从内容hash基中剔除并单独校验。因此旧文“hash必然冲突”仅是先前快照，**本轮不再断言仍存在，也不宣称修复通过**。GET历史/材料scope读回和最终接口一致性留R2交付后验收，不抢写。
3. 好例收入红线、中例补证证据、案例归档缺口继续按THREE_CASES中的快照记录；本轮未重查/修改材料，不用预期结局覆盖事实。

## 最终验收记录（每例一份，尚未执行）

每份至少包含：caseId/fixtureVersion/sourceMode、点击序号和所选domain、原请求及round/action ID、服务端事件/回执、viewBasis及材料hash、decisionSet/candidate/feedback引用、四页对应截图或断言、最终结果与依据、刷新重连后的同版本读回、实际出站计数。

- 好：约5次整列推进、后列实际联动、五列必需事项办结后钻石；中：信审等待补证→真实登记→重评，约6次后钻石；差：正式拒绝→下游停止/不适用→保留记录归档红叉。
- 同一事实四页一致；异步专业可以不同状态，但同domain/round/action不得互相矛盾。切页/刷新/重连后收敛至同一确认版本；旧结果不混入新basis。
- 同ID终态更新采用upsert；请求未落盘只标请求中，unknown不重发、不变绿。实际选择及材料版本与最终输出一致。
- 推进前后page/route/scroll/transform/zoom/focus不变；不操作用户当前浏览器。实现通过、测试通过、用户视觉接受分别记录；当前全部尚未由本任务验收。

后续仍限既定单个后端包补统一关联/读投影及Front接线，不新增独立平台、其他客户或生命周期功能。本任务只写本目录，无测试/服务/真实模型调用、无跨任务通信，完成即停。
