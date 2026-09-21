# Front：统一事件时间轴第一切片
目标：保留当前用户已接受的首页/眼睛/卡片/导航设计，先让时间轴消费现有activity接口并正确增量更新；不同时重做聊天或四页全部接线。
输入：docs/v0.4/results/04-activity/CONTRACT.md、REPORT.md、Back/Edge/src/customer-activity.mjs及server对应只读路由。交付报告是执行者自报，先精确核对契约与源码；缺口不靠前端补造。
ownership：Front/site-mirror/app/takeoff/work-timeline.tsx、Front/site-mirror/lib/workbench/wb-client.ts、可新增专用activity类型/helper、Front/preview/test/behavior/v04-activity.behavior.test.mjs、Front/dist；报告 docs/v0.4/results/front-activity/。其他Front文件不改，尤其保护用户新UI。
明确显示来源ID、服务端原始时间、可信身份；缺失标未知。请求/处理中/完成/失败/未知分开。复合游标作为不透明值，去重用来源命名空间；裁剪/resync/未覆盖来源明确展示。旧接口fallback只有明确不支持时才允许且标降级，不将403/500吞成空记录。利用已有snapshotVersion刷新触发或用户刷新按钮，避免无限定时轮询；切客户/身份丢弃旧响应。当前API若不能安全消费，只交精确阻点，不扩大后端写权限。
测试覆盖分页、晚到、重复、拒绝、截断、未知身份时间、客户切换、刷新，GET期间业务写/模型调用为零。跑相关测试、typecheck/build，视觉检查不改变用户viewport。只完成时间轴切片，不宣称四页或聊天已同步。

## 共同约束（完整契约的一部分）
项目绝对路径 C:/Users/22673/Desktop/JW。当前用户授权本包任务并行，只允许各自ownership；不独占仓库，不覆盖/回退其他人修改。先读根AGENTS.md、docs/V0.4_KANBAN.md和本包明确输入；保护用户在Front任务追加的UI决定。禁止worktree、切分支、commit/push、改共享配置、重启共享服务、真实模型调用或读取凭据。默认low，保留指定模型，不自行升档。
不得创建、唤醒、读取、控制其他对话，不调用任何跨任务消息或调度工具，不使用Codex subagent。必要协作只在本任务报告阻点，由主协调任务决定；不能自行向其反馈或派工。完成后将已做/验证/遗留留在本任务最终结果，停止执行，等待用户；无后台轮询。
每文件单writer；若指定文件仍被旧任务写入或输入发生影响语义的漂移，先完成不依赖它的工作，相关修改停止并列为待接续。报告仅写各自目录，不能修改共享CONTRACT、任务板、根文档或其他任务记录。只用自建临时资源/随机端口/隔离数据库，结束停止自己的测试进程，登记资源。失败与skip如实保留，测试证据写源码hash和命令，不反复刷全套。
