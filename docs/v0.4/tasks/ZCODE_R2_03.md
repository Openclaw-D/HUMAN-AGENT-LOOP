# ZCode R2-03：材料scope贯穿模型调用与回执摘要
中型目标：把已有显式材料选择模块接进模型模块调用，确保选了哪些材料与回执/缓存身份绑定，独立验证未知围栏。
输入：docs/v0.4/results/02-evidence/CONTRACT.md、REPORT.md；03-receipts报告；assistant-model.mjs、assistant-decisions.mjs及provider/scope/receipts源码。
ownership：Back/Edge/src/assistant-model.mjs、assistant-decisions.mjs；新测试Back/Edge/test/v04-model-scope*；报告 docs/v0.4/results/r2-03-model-scope/。provider、scope、receipts、B transport、server全部只读。
先确认旧02/03输入模块已稳定；冻结可选scope参数的内部最小契约。规范scope传到provider，使用返回规范摘要绑定context/请求身份，不让不同材料选择命中同一旧输出。缺参保持旧调用兼容；显式非法范围失败关闭。operation/principal/customer/currentness保持现有权限语义，不以换scope或operation自动绕过原未知请求；合法独立新任务与同任务重试分别验证，必要政策歧义只报不发明。
本地计数HTTP替身验证单件/组合/顺序去重/材料失效/非法范围/缓存/未知/重启兼容；输出不得含未选材料；证据不完整不能冒充成功。不得真实GLM出站。server请求参数挂载留给串行集成，提供最小字段映射，不抢写入口。
交契约、模块、测试及出站计数证据，区分模块通过与HTTP业务入口未装配。

## 共同约束（完整契约的一部分）
项目绝对路径 C:/Users/22673/Desktop/JW。当前用户授权本包任务并行，只允许各自ownership；不独占仓库，不覆盖/回退其他人修改。先读根AGENTS.md、docs/V0.4_KANBAN.md和本包明确输入；保护用户在Front任务追加的UI决定。禁止worktree、切分支、commit/push、改共享配置、重启共享服务、真实模型调用或读取凭据。默认low，保留指定模型，不自行升档。
不得创建、唤醒、读取、控制其他对话，不调用任何跨任务消息或调度工具，不使用Codex subagent。必要协作只在本任务报告阻点，由主协调任务决定；不能自行向其反馈或派工。完成后将已做/验证/遗留留在本任务最终结果，停止执行，等待用户；无后台轮询。
每文件单writer；若指定文件仍被旧任务写入或输入发生影响语义的漂移，先完成不依赖它的工作，相关修改停止并列为待接续。报告仅写各自目录，不能修改共享CONTRACT、任务板、根文档或其他任务记录。只用自建临时资源/随机端口/隔离数据库，结束停止自己的测试进程，登记资源。失败与skip如实保留，测试证据写源码hash和命令，不反复刷全套。
