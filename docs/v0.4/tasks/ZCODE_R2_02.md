# ZCode R2-02：上传恢复适配装配准备
中型目标：让已有A授权投影、Edge恢复reader与Connectors恢复模块形成可注入的装配模块，并在隔离HTTP/PG链验证；共享server最终挂载留串行。
输入：docs/v0.4/results/01-upload/CONTRACT.md、REPORT.md；Back/Edge/src/upload-context.mjs、Connectors/src/intake/upload-context.mjs和当前A授权路由。
ownership：Back/Edge/src/upload-context.mjs、可新建Back/Edge/src/upload-context-assembly.mjs；新测试Back/Edge/test/v04-upload-assembly*；报告 docs/v0.4/results/r2-02-upload/。A、Connectors源码、server、compose及共享配置只读。
实现最小注入式工厂，复用正式A授权接口及已有Connectors恢复能力；真实HTTP源未装配时明确缺口，禁止伪造生产入口。双重授权检查、可信身份传递、租户白名单、响应allowlist、歧义/撤销/过期失败关闭保持。输出具体串行挂载示例，不自动改server。
测试：授权正例、读中撤权/会话变化、跨租户客户、歧义、上游不可用、不泄露token、GET零写。隔离实例用真实模块，若上游替身明确列出边界。无现成安全PG则未测而非通过。不改真实上传或对象存储原子性，不自创权限政策。
交可注入装配模块、测试、契约、报告、所需后续挂载最小清单；不声称共享运行实例恢复已启用。

## 共同约束（完整契约的一部分）
项目绝对路径 C:/Users/22673/Desktop/JW。当前用户授权本包任务并行，只允许各自ownership；不独占仓库，不覆盖/回退其他人修改。先读根AGENTS.md、docs/V0.4_KANBAN.md和本包明确输入；保护用户在Front任务追加的UI决定。禁止worktree、切分支、commit/push、改共享配置、重启共享服务、真实模型调用或读取凭据。默认low，保留指定模型，不自行升档。
不得创建、唤醒、读取、控制其他对话，不调用任何跨任务消息或调度工具，不使用Codex subagent。必要协作只在本任务报告阻点，由主协调任务决定；不能自行向其反馈或派工。完成后将已做/验证/遗留留在本任务最终结果，停止执行，等待用户；无后台轮询。
每文件单writer；若指定文件仍被旧任务写入或输入发生影响语义的漂移，先完成不依赖它的工作，相关修改停止并列为待接续。报告仅写各自目录，不能修改共享CONTRACT、任务板、根文档或其他任务记录。只用自建临时资源/随机端口/隔离数据库，结束停止自己的测试进程，登记资源。失败与skip如实保留，测试证据写源码hash和命令，不反复刷全套。
