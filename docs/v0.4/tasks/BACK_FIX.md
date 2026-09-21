# V0.4- Back：消息幂等作用域小修
目标：先用最小回归证实扫描发现的跨客户/身份复用requestId返回旧回执风险；若证实，在原模块局部修复，不接管四路ZCode的后端集成。
ownership：仅 Back/Edge/src/messages.mjs、新增 Back/Edge/test/v04-message-idempotency.test.mjs；报告 docs/v0.4/results/back-message-idempotency/。message-store、server、assistant-model、A/B/Connectors及四路ownership均只读。
检查现有幂等存储与fingerprint：同作用域同requestId同载荷仍重放；同ID异载荷仍冲突；不同客户/可信身份不得拿到另一个作用域的回执或导致错收件人。只从可信session/服务端customer获取作用域，不信任请求body的tenant/principal。租户字段若无可信来源，不自行构造；明确现有边界。保留internal/customer受众与显式外发权限。
兼容旧存储：已有无作用域回执不能直接跨作用域返回，也不能因换命名空间静默再次发送；应失败关闭、给出明确冲突/不可安全重放结果。不清空账本、不迁移数据库、不降低unknown保护。若仅修改messages.mjs无法安全处理存储并发/唯一性，交付复现与最小待集成说明，不能宣称已修复。
测试使用本地替身，断言实际发送次数：同作用域重放、异载荷、跨客户、跨principal、已有可信tenant边界、旧回执兼容、内部受众、发送失败/未知。先复现后修，再跑现有messages相关回归；不跑真实模型或共享环境。此为范围明确的小修授权，不扩展中大型后端实施。

## 本轮授权与边界
用户已明确要求三个可见任务针对扫描结果快速、简单地解决主要问题，本文件替代本任务上一份只读扫描限制，仅授权以下小切片。四路ZCode仍在实施；不独占仓库、不回退别人修改。直接使用 C:/Users/22673/Desktop/JW，模型与low保持；禁止subagent、worktree、切分支、commit/push、真实模型出站、共享配置变更或重启共享服务。按本文件ownership写入，其他文件只读。若需扩大范围，停止该部分并在本任务说明。
只跑与改动直接相关的必要验证；不得删失败断言或把skip算通过。结果在本任务最终回复给用户，简述已做/验证/未做，完成后停止。不得向协调任务/CTRL发消息，不调用send_message_to_thread、不另建任务、不自动接续。不要求用户完成后转发报告。
独占报告目录为 docs/v0.4/results/ 下本任务指定目录；可记录检查点但不修改根文档或其他任务文档。先确认允许文件当前内容及差异，保护已有修改。
