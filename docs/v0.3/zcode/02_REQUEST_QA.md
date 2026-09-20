/goal
任务名：V0.3-Z2-REQUEST-QA
目标：独立测试需求登记前端行为与权限边界，交付候选回归用例；不碰模型观察。
项目：C:/Users/22673/Desktop/JW。
只读输入：Front/site-mirror/app/takeoff/admission-request-panel.tsx、Front/site-mirror/lib/workbench/takeoff-actions.ts、wb-client.ts、Front/preview/test/behavior/takeoff-actions.behavior.test.mjs、该测试引用的工具及Front/package.json。仅读必要依赖；不运行全套测试或构建，CTRL负责最终集成。
独占写入：C:/Users/22673/Desktop/JW/docs/v0.3/zcode/request-qa/ 和 C:/Users/22673/Desktop/JW/.local/v03-zcode-request/。所有候选测试/fixture/报告在此；不得改Front或Back源码、既有测试、package文件、dist、公共文档。
执行：使用现有测试工具与本地真实HTTP替身，优先补需求登记的遗漏边界：金额精度和安全整数、null字段、重复点击、409保留草稿并显式读新版本、403/401、保存后读回失败不报成功、客户或会话变化防止旧结果串入。断言请求payload与UI，不只测辅助函数；不机械重复全部已有测试。仅绑定127.0.0.1随机端口，不请求现有服务或真实模型。
依赖：只读复用现有npm依赖，不安装/更新包。CTRL可能修改共享类型，记录实际读取文件测试前后hash；变化时报告漂移，不修改预期凑通过。不要自行改产品契约。
验收：覆盖正常保存及关键失败边界；保留命令、退出码、原始日志、源码hash；发现区分实际复现/审读推测。候选测试可独立运行，由CTRL决定是否集成。
交付：REPORT.md、测试、原始证据，末尾不超过12行CTRL摘要。你不是唯一执行者，不覆盖他人文件，不commit/push/worktree，不修改配置或密钥，不访问共享数据库，不停止现有服务，不联系/唤醒Codex，不做常驻监督。完成即停，由用户手动交回CTRL。
