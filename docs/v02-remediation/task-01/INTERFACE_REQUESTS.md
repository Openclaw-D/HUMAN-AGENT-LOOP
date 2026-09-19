# 任务一（客户办理前端）· INTERFACE_REQUESTS

## IR-T01-1 统一上传链（依赖：任务02/04 · BLOCKED）

- 现状：门户/内部上传（uploadOriginal→Edge transformOriginals→A artifacts 登记）只入 A 档案；处理（解压/解析/事实/分析/登记）只发生在 Connectors 通道件上。A `artifact_processing` 无记录时 myMaterials stage 落 'registered'。
- 请求：任务02/04落定统一上传链——登记件是否/何时进入常驻处理由后台策略决定，并经 A 处理状态（G3 回执）或等价权威面暴露。
- 前端已做：上传文案如实（登记≠处理；未接入显示"已登记（待处理）"，不伪装 OCR）；处理状态展示消费服务端真实字段。
- 后台就绪后：前端把"未接入"措辞替换为真实进度展示（不用改数据流）。

## IR-T01-2 目录搜索能力确认（依赖：任务03 · 已对齐待合流）

- 任务03 working tree 已把目录 search 从仅 display_name 扩为 display_name + customer_id + legal_entity_ref 同词匹配，并注明与任务一对齐。
- 前端已按该口径提示"按客户名称/标识搜索"，并标注"匹配口径由服务端目录决定"。
- 请求任务03：合流时确认该改动随提交交付；若口径再变（如前缀匹配/独立参数），请回传，前端同步提示文案。
- 附：目录响应目前无能力声明字段（capability/notice）；如后续希望前端自适应显示口径，请在分页响应中加 `searchScope` 或等价说明字段（nice-to-have，不阻塞）。

## IR-T01-3 通道动作回执按 requestId 查询（依赖：任务02/04 · BLOCKED，非阻塞本轮）

- 现状：A 回执接口（/receipts/:requestId）只覆盖 A 动作；处理通道动作（channelAction）的 requestId 留在 Connectors 任务 aOps（需先知道 taskId）。
- 现行前端处置：结果页对账明确标注"A 动作在此查询；通道动作在材料页通道任务回执按对账编号核对"；502 提示分别指路，不误查。
- 请求：提供按 requestId 查询通道回执的只读端点（或 Edge 聚合对账口），前端即可把两路对账合一。

## IR-T01-4 大区/省店/坐标/指标目录字段（延续 V02_REUSE_ROUND_01 · 任务04/后续后台轮）

- 地图接入需要目录响应扩展（大区/省店/坐标/指标）。本轮未在前端假设这些字段存在。
- 请求后台轮确认目录契约扩展与版本化方式；前端在地图任务中按新契约消费。

## 本任务不请求、仅声明

- createCustomer requestId（`wb-new-*`）与各面板动作 requestId 均由前端固定并随载荷提交；服务端幂等表语义（同号重发吸收）依赖不变，前端承诺"不换号重试"即建立在该语义上。
- 登录/会话/撤权行为（onAuth 终态、401/403 清会话回登录）沿用既有 Edge 契约，未提新需求。
