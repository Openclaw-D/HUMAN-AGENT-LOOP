# 本机Dify接入检查草案

状态：实际1.13.2容器内Start/Code/End节点schema验证通过、7个合成输入代码检查通过；尚未完成管理员初始化，因此应用导入、图执行及导出均NOT TESTED。由Codex根据用户“初步搭建工作流”的授权生成配置；后端/前端产品代码未修改。

`connectivity.workflow.yml`仅有输入、确定性协议检查、输出三个节点，不含模型依赖或模型调用，不是六角色协作已实现。有效请求明确返回`model_not_configured`，不能作为模型分析成功。名称、描述和输出均标示这一限制。

用途：先验证可导入/执行/导出的技术路径；随后ZCode按冻结契约交六角色真实模型流程，小批导入联调。正式业务协议见上位DIFY_SIX_ROLE_PLAN.md，本文件测试协议不替代它。

合成输入示例（放入request_json字段）：

```json
{"schemaVersion":"jw-connectivity/1","requestId":"synthetic-check-1","projectId":"synthetic-project-1","contextVersion":1,"eventType":"connectivity_check","question":"检查接入状态，不进行业务分析。","synthetic":true}
```

必须检查：合法输入返回模型未配置；畸形JSON、真实数据标记、缺字段、多余authority字段、负版本和布尔版本均返回invalid_input；全过程无外部模型请求、无业务状态写入。

基于官方1.13.2 DSL导入导出实现与该tag的workflow测试fixture编写。仅YAML解析或代码单测通过，不代表Dify画布导入、sandbox执行或可迁移性已通过。
