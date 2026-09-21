# V0.4 串行集成图（静态快照，非运行验收）

2026-09-21，源码hash采集于04:41 +08:00；根目录 `C:/Users/22673/Desktop/JW`；HEAD `e298a789bc9d49eac23a17f9dfe75244f73ca64f`。本任务只写本目录，未跑测试、服务或模型；读取命令及源码 SHA256 见 [SNAPSHOT.md](SNAPSHOT.md)。下列“装配”仅指源码注册，不确认共享实例启用。

**结论：activity 已注册；A 上传授权已注册，但上传恢复 HTTP 链未闭合；材料选择模块已交付，模型摘要校验与入口仍未接通。**旧01自报14/14、旧02自报18/18、旧03自报37/37、旧04自报12/12，本任务未复跑，不转换为独立验收。

**归属校正：**`v04-message-idempotency.test.mjs` 是本 Back 任务新增复现，六项失败尚未修复，已由本轮 **ZCode R2-01** 契约承接；不是旧 ZCode03 的缺陷责任。旧04报告中的相反归属不沿用，也不改写旧报告。

## 请求、返回及装配表

源码路径均相对上述绝对根目录；路径前缀 `/api` 为真实 HTTP 路由，标“候选”的除外。

| 接口与参数 | 权限来源与返回字段 | 当前装配 / 消费者 / 单一 writer |
|---|---|---|
| `GET /api/jw/v2/customers/:id/activity?limit&cursor&sources&audience`；limit默认50/最大200；sources=`thread,kernel,model_receipt`；audience=`customer,internal` | session→`activity:read`→A `checkCustomer`；客户联系人禁内部受众及模型回执。返回 `items,perSourceCursors,nextCursor,exhausted,sources,incomplete,ordering`；item含 `activityId,source,sourceRecordId,customerId,tenantId,occurredAt,actor,requestId,state,refs`，thread另有text/delivery | 已注册：`Back/Edge/src/server.mjs:521`、`customer-activity.mjs`。供四页/聊天统一读取；R2-04仅验收，**当前R2四包无人可改server/activity，最终串行writer待协调指定** |
| `GET /api/v2/customers/:customerId/upload-authorization?kind&principalId` | A凭据认证＋真实客户租户/grant＋human＋种类写门；principalId仅一致性核验。200可为`ok:false`；返回 `principalId,customerId,tenantId,canRead,canUpload,kindRestricted,allowedKinds,kindAllowed,reason` | 已注册：`Back/A/src/http/server.ts:282`、`domain/upload-authorization.ts`；消费方Edge恢复adapter；A文件本轮只读 |
| `createUploadContextReader({sessionOf,authorizeUpload,fetchContext})`；调用`{req,customerId}` | 前后两次A授权与会话核验；返回 `ok,customerId,available,reason,bindingRef,invitationId,allowedKinds,allowedObjects,expiresAt`。200授权拒绝不得当成功；无授权源503 | `Back/Edge/src/upload-context.mjs` 是候选模块，**未注册浏览器恢复路由**；R2-02独占reader及可新增assembly；server最终挂载待串行 |
| `makeUploadContextService(store).read({tenantId,customerId,principalId})` | Connectors `jw_principal`绑定＋accepted邀请＋有效期＋唯一有效绑定；HTTP代理还需可信actor和租户白名单。返回恢复context；不创建/续期邀请 | `Back/Connectors/src/intake/upload-context.mjs` 已有模块，当前http/server及compose未找到恢复挂载；R2-02仅可注入消费，**无权补Connectors HTTP入口**，该writer待指定；不虚构URL |
| `provider({snapshot,tenantId,customerId,revision,scope?})` → `POST /api/connectors/internal/assistant-evidence` body=`{tenantId,customerId,artifactIds}` | 可读snapshot＋所选ID全部合法＋响应逐件tenant/customer/hash/current校验；服务令牌只在服务端。返回原pack，显式模式另有`selection:{mode,artifactIds,summary}` | provider/scope模块已交付，旧调用已装配；R2-03只读这两个文件，负责model/decisions接线。消费者为模型context；不能说现有浏览器请求已支持scope |
| `POST /api/jw/v2/actions/customers/:id/assistant/observe`：现有`assistant,question`；decisions同前缀`/assistant/decisions`：现有`assistant,question,operationId,expectedRevision,taskKind?` | workspace授权；decisions另有staff/person作用域、pending及版本门。observe返回`status,sent,requestId,replayed,current,contextHash,…`，模型authority=none | `server.mjs:415`及`assistant-decisions.mjs:39`当前provider调用均不传scope。建议后续统一HTTP字段`materialScope:{artifactIds}`→内部`scope`，**这是待R2-03契约冻结的映射，不是现有API承诺**；server只有串行writer可挂参数；Front消费者`Front/site-mirror/lib/workbench/wb-client.ts` |

## 三处必须先消除的歧义

1. **activity不是完整聊天历史。**thread有正文与可信发送者；kernel/model无可信actor，返回unknown；模型条目只有回执元数据，不含问答正文。审计、decision反馈、Connectors进度未聚合；纯claim不入列，坏JSON/缺字段文件跳过并计数，不是逐条unknown。`state=completed`不能解释为业务审批完成；当前thread固定completed且消息写入未按delivery状态过滤，须与R2-01修复一起验收。
2. **游标不是全局版本。**thread/kernel用各源seq，model用`at|requestId`；nextCursor为base64url `{v:1,c:{…}}`，无客户/身份/受众绑定。客户端按客户＋身份＋过滤条件保留独立游标，切换即清理；读到头`nextCursor=null`只表示本轮穷尽，继续刷新需由消费者契约明确如何保留perSource水位，不能当永久完成。intent→terminal保持同一activityId但时间/状态会更新，消费方应upsert而非见过ID就丢弃；时钟回拨仍可能漏读。裁剪提示在`sources[]`，单源失败看`incomplete[]`。
3. **selection与hash当前不兼容。**`assistant-evidence-provider.mjs:18`在`prepareEvidence`算hash后附加selection；`assistant-model.mjs:160`及`:243`却对剔除hash后的整个pack重算摘要，显式包将触发校验失败。R2-03需冻结兼容旧包的内容校验与selection完整性校验，再让规范selection进入contextHash/requestId；不能只去掉校验或仅透传字段。`scope`省略/null保留legacy包，空数组报`EVIDENCE_SCOPE_EMPTY`；旧02正文将空数组写INVALID之处以源码为准。

## 固定串行顺序与必要验收

| 顺序 | 前置依赖与必验门槛 |
|---|---|
| 1 活动只读 | 以旧04为基础，R2-04提供隔离恢复证据；跨页/同时间/晚到/非法游标/裁剪/刷新重启/intent转terminal/缺目录；GET零模型、上传、审批。**静态安全阻点待复现：server在await listPage后没有二次会话/权限检查；模型文件仅按customerId筛选，未校验tenant/person授权。不能用翻页前撤权测试代替读取中撤权，也不能据此宣称多租户整链通过。** |
| 2 上传恢复 | R2-02装配模块交回后，指定唯一server及Connectors挂载writer；A授权字段映射、可信actor/tenant名单、前后撤权检查、歧义/过期/缺源失败关闭、响应allowlist、GET零写；A允许种类与恢复邀请种类同时约束，不以canRead替代canUpload；真实PG与替身分开 |
| 3 材料scope/回执 | R2-03冻结HTTP字段及内部签名，解决上述hash冲突；单件/组合/乱序去重/漏件/取代/非法/未选正文隔离；同operation异scope冲突与同scope重放、unknown重启零新增出站；不得靠换scope或operation解除原unknown。旧03关于无pending的新operation边界保留为政策待定 |
| 4 四页聊天 | 前三步及R2-01六项整改通过后，Front单一writer接统一读面；同ID同事实、终态更新、切客户/身份清理、显式发送且导航零业务调用、内部受众保护。activity没有模型正文，完整模型聊天恢复仍须另行明确持久来源，不由UI补造 |

本轮R2-01独占messages/message-store，R2-02独占upload reader/assembly，R2-03独占model/decisions，R2-04仅写自身新测试；最终server、Connectors和activity修复均不自动归任一R2包。此文仅登记依赖与缺口，不派工、不改代码、不扩大生命周期；本任务无后台资源。
