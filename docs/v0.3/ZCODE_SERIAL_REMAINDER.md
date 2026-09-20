/goal 完成V0.3剩余后端整合与隔离验收，一次一个待办，不并发派工。

> 暂勿发送本包原版：V0.3-Jev已获用户单独授权并接手候选置信度/反馈切片，涉及Back/Edge/src/assistant-model.mjs、server.mjs、Back/B/src/transport/glm.mjs及独立反馈模块。CTRL当前不写这些文件。待Jev交回文件清单与检查点后，重划ownership再交接；不得并发覆盖。用户授权已由CTRL读取该任务最新用户消息核实，不扩大到共享服务重启、付费模型或正式审批。

工作目录：C:/Users/22673/Desktop/JW。先读根AGENTS.md和docs/v0.3/TODO03_04_CHECKPOINT.md，保留当前所有在制修改；其他人可能在修改前端，不覆盖他们的文件。最高产品范围以最新AGENTS及TAKEOFF-FA-1.0.0为准，仅首次回租准入和授信预评估。评分20/20/20/30/10不变，模型authority=none。

输入：当前Back/Edge/src/assistant-{model,receipts,evidence,evidence-provider,profiles}.mjs、Back/B/src/graph/assistant-analysis.mjs、Back/Connectors/src/processing/assistant-evidence.mjs与coordinator.mjs，以及对应测试。03A/B已通过，不重复开发。

Ownership：只修改上述后端模块、相关后端测试及docs/v0.3/zcode/serial-remainder/。Front/及前端构建由Codex负责，不改。对其他后端文件确需修改时在交付中逐项解释，禁止覆盖无关在制改动。不得修改原材料、共享配置、真实凭据、历史归档；不创建worktree、不提交发布、不重启现有服务、不调用付费模型。

顺序与完成标准：
0. 优先诊断现有入口阻断。CTRL于2026-09-20T12:54Z只读实测48214：身份目录200且包含biz1/business；healthz/ready显示kernel-a、connectors、connectors-channel均ECONNREFUSED，db TCP可达。源码liveVerifier将A探针不可达折叠为PRINCIPAL_UNTRUSTED，因此不能据403推断凭据错误。先核对受控启动记录、配置目标和实际服务状态；不读取/输出密钥，不用admin/mock绕过，不未经授权重启共享服务。修复代码中的错误分类可在隔离测试完成；涉及共享运行环境恢复时向用户说明具体动作后获得授权。
1. 收敛LangGraph职责：证据准备节点不能空跑；说明并验证授权读取、输入冻结、受控调用、引用校验、当前性检查、回执持久化分别发生在哪里。不得新增第二套自动重试。完善事实/单位与完整原文片段的关系、遗漏披露及冲突保留。审查profile在证据读取期间切换的归属、未知跨profile阻断及单进程部署边界。
2. 在自有临时目录、独占PG及随机端口中，跑真实A登记→Connectors原始材料→Edge→本地HTTP模型替身。主案例Materials/kashgar-demo-v1/KS-LASER-500（500万元），补证前后各一轮；再验证纺织和注塑的缺件/冲突/权限。A登记不得仅手工插表冒充；报告真实/替身边界。旧结果失效、刷新一致、合法重放只发送一次、未知不重发、撤权拒绝必须通过。
3. 固定合成输入做30次顺序测量，分开冷启动、解析、编排、HTTP替身等待、回执重放和端到端耗时。标明缓存命中与独立冷请求策略；报告次数、用量、p50/p95。页面完成时间留给Codex测，不伪造。并发仅用于防重发专项。
4. 只跑改动相关回归，完成必要默认入口接入。输出REPORT.md、运行命令/退出码/日志、源码hash清单、剩余问题和一条可执行的前端联调入口。不得把本地替身或执行者自报写成真实模型或用户视觉验收。

依赖与停止：后端契约保持assistant/observe地址/请求不变；新增响应证明给Codex前端消费。遇到业务制度缺失、方向变化、真实模型费用或共享环境切换才停止报告；一般小修自行处理。禁止要求用户重复批准已授权的隔离测试。交付后由Codex独立验收，不自动继续下一个中大型任务。
