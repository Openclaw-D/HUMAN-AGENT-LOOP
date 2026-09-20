/goal

任务：V0.3-Z3 真实模型回执离线审计。工作区 C:/Users/22673/Desktop/JW。

输入只读：.local/v03-recovery/real-*.json、v03-*.json、real-feedback-verification.json；Back/Edge/.run/takeoff/model-receipts/及同目录model-cost-ledger.jsonl；相关Edge回执/引用源码。禁止读取模型配置、密钥和身份凭据。
唯一写入范围：C:/Users/22673/Desktop/JW/docs/v0.3/parallel-qa/results/receipts/。其他writer在工作，不改历史或生产代码。

1. 按requestId对账，只计已经存在的真实调用；区分成功有效、收到但格式/语义无效、发送未知，不能把HTTP200全算成功。
2. 核对候选引用属于该回执冻结证据、同客户、同哈希；标清只能证明来源绑定，不能证明模型业务判断正确。离线当前性只能描述快照，不能声称当前线上仍有效。
3. 核对select/undo记录与decisionSetId，保留按本人/助手隔离；预测问题返回核验动作仍标语义未通过。
4. 汇总实际token、调用数量、已记录等待时间，unknown用量保持未知。reserve为预占、actual.amount为超额差额，不能相加当供应商真实账单或将0差额宣称免费。数据不够就写未测，不补估计百分比。

不发任何HTTP、不调用模型、不改账本/回执、不重放或恢复未知请求、不启动服务。活跃文件读取不完整时跳过并记录，不报告为损坏；保存输入哈希/读取时点。
验收：可复现审计脚本、脱敏汇总JSON、REPORT.md和明确异常定位。不复制完整原文/身份信息到报告，仅记录必要ID/哈希。集中交回一次。
