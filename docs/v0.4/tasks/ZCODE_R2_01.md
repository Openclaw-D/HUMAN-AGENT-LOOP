# ZCode R2-01：消息幂等与持久未知修复
中型目标：闭合已复现的跨作用域回执、并发重复发送及异常后重发问题。
输入：docs/v0.4/results/back-message-idempotency/REPORT.md、Back/Edge/test/v04-message-idempotency.test.mjs、Back/Edge/src/messages.mjs和message-store.mjs。
ownership：上述两个产品模块和v04-message-idempotency测试、可新增Back/Edge/test/v04-message-persistence*；报告 docs/v0.4/results/r2-01-messages/。server和其他模块只读。
先冻结本路契约，再实现可信customer/principal/已有可信tenant绑定；同scope同requestId同载荷重放，异scope/异载荷明确冲突。旧无scope回执失败关闭且零发送，不清账、不静默改key重发。为SQLite与内存store提供一致原子claim/owner校验/intent转terminal；发送后异常持久unknown，不能因裁剪或重启忘记。必要SQLite兼容增量仅限本store，不重构存储。
测试两个独立SQLite连接争抢、进程重启、未知、旧记录、受众、客户/身份/租户边界及出站计数；原六项失败必须逐项处理，不弱化断言。跑消息模块及HTTP相关回归，若他路在制导致导入失败留证，不改他路。交源码、测试、契约、报告和资源状态；修复完成不代表用户业务上线。

## 共同约束（完整契约的一部分）
项目绝对路径 C:/Users/22673/Desktop/JW。当前用户授权本包任务并行，只允许各自ownership；不独占仓库，不覆盖/回退其他人修改。先读根AGENTS.md、docs/V0.4_KANBAN.md和本包明确输入；保护用户在Front任务追加的UI决定。禁止worktree、切分支、commit/push、改共享配置、重启共享服务、真实模型调用或读取凭据。默认low，保留指定模型，不自行升档。
不得创建、唤醒、读取、控制其他对话，不调用任何跨任务消息或调度工具，不使用Codex subagent。必要协作只在本任务报告阻点，由主协调任务决定；不能自行向其反馈或派工。完成后将已做/验证/遗留留在本任务最终结果，停止执行，等待用户；无后台轮询。
每文件单writer；若指定文件仍被旧任务写入或输入发生影响语义的漂移，先完成不依赖它的工作，相关修改停止并列为待接续。报告仅写各自目录，不能修改共享CONTRACT、任务板、根文档或其他任务记录。只用自建临时资源/随机端口/隔离数据库，结束停止自己的测试进程，登记资源。失败与skip如实保留，测试证据写源码hash和命令，不反复刷全套。
