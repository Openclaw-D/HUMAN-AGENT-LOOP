# READY_FOR_INTEGRATION｜真实模型与视频接入清单

状态：协议与失败路径已就绪（确定性 SIMULATION stub 验证）；**未做任何真实调用**（modelCalls=0，无凭证）。以下为接入所需的最小参数与调用协议草案，供用户提供凭证/环境后验证一条真实链路。

## 1. 真实模型链路（当前：`simulateFollowUps` stub）

已就绪的替换点：`lib/v5-preview/remote-service.ts` 的 `simulateFollowUps`（确定性 stub，标注 model_simulation）。

接入所需（须用户逐项提供/确认）：
1. 模型入口与协议：endpoint、鉴权方式（产品凭证，**不进源码/URL/日志**，经服务端环境注入）、模型名与版本。
2. 输入契约草案（已实现 stub 的输入形状）：`{ annotationId, question, evidenceRef: {fixtureId, sha256, version}, sessionContext: {projectId, scenario, domainRoles} }` —— 不含"好/中/坏客户"标签等评估端信息。
3. 输出契约草案：`{ followUps: [{domainRole, text}], confidence: null | 模型自报值 }`；confidence 仅展示，不驱动放行。
4. 失败语义：超时/格式错误/空输出 → 回复体 `kind='model_simulation'` + `error` 标记，不写已核实状态，不阻塞人工通道。
5. 用量核算：每次调用记录 tokens（请求/响应），写入 METRICS，50 万 tokens 总上限硬门。

明确不做：让模型生成公式/成本/资料；用外观/语气推断诚信；模型输出自动变"已核实"。

## 2. 视频接入（当前：not_configured + 显式模拟视图）

已就绪：会话模型（sessionId↔projectId 绑定、参与者/出席状态）、adapter 状态机语义（not_configured/connecting/connected/reconnecting/failed/ended + 取消/清理）、"加入/采集不可用"的如实提示。

接入所需：
1. RTC provider 选型与凭证（服务端授权短期会话 token，不进前端源码）。
2. `roomId` 作为外部引用挂到 session（不影响 sessionId 主键语义）。
3. 本地媒体轨道生命周期：离会关闭 track；页面卸载清理监听（当前无媒体流，尚未验收设备行为——不冒称）。
4. 移动端实拍上传另需设备相册/相机权限与压缩策略（不拿低清截图冒充原相机照片）。

## 3. 验证顺序建议（拿到凭证后）

1. 真实模型单链路：一个标注 → 真实 followUps（1 次）→ 对比 stub 输出与格式契约 → METRICS 记 tokens/延迟。
2. 视频：simulation → provider sandbox 房间 → connected/reconnecting/failed 各状态一例。
3. 不并发扩展六角色；先一条链路稳定再轮转。
