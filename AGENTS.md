> 2026-09-20 UI-R1 用户最新决定：前端由 Codex 全程直接实施、排版纠偏与验收，替代旧的中大型前端交 ZCode 分工。首屏选角色，无前台账号密码、技术登录和服务地址配置；后台身份、客户隔离及记录保留。黑白灰为主，红色阻断、黄色局部进展/关注（文字区分）、绿色真实办结。详见 docs/takeoff/first-admission-v1/FRONTEND_UI_R1.md。

> 2026-09-20 当前最高产品基线：`docs/takeoff/first-admission-v1/01_TAKEOFF_CORE_AUTHORITY.md`，版本 **TAKEOFF-FA-1.0.0**。仅做新客户首次回租准入与客户授信预评估，终点为有权人员确认预评估结论；不做正式额度批准、提款、复贷、租后、结清。客户为主对象，五列四行矩阵＋右侧六助手按02文件实施；资产为准入资产核验，可与信审并行。以下旧全生命周期、项目主对象、不以矩阵为主界面及额度使用率等冲突产品方向均被本版替代，仅作历史。安全、权限、凭据、Git和资源保护纪律继续有效。
>
> 接续顺序：先读 `docs/takeoff/first-admission-v1/00_START_HERE.md`；当前盘点与实施入口见同目录 `CURRENT_STATE.md`、`ADAPTATION_MAP.md`、`IMPLEMENTATION_PROMPTS.md`。旧任务书不自动恢复执行。本轮文档对齐不等于代码完成或产品验收通过。

> 2026-09-19 最新冻结：业务视角横屏二维作业看板，明确不做3D/全国地图/办公室/手柄/游戏化，不以表格为主界面。此前见微世界与多输入要求在本轮范围中被替代，历史原型保留但停止投入。复用真实工作本，单项目商机→尽调→政策→信审→商务→资产至结清，依赖可并行不强制流水线。最新复核与四路接续任务见 docs/codex-handoff/board-round-02/REVIEW.md。

# JW 当前工作入口

2026-09-16：用户授权从 Anthropic 拆分独立 JW，保留关键版本资料与轻量代码，最终指定公开 GitHub 仓库 Openclaw-D/HUMAN-AGENT-LOOP，并明确全部上传已迁移代码与历史资料。此迁移授权允许复制、依赖本地化、启动配置及验证；不构成产品改版或历史业务候选接受。

## 阅读与检索

先读 README.md、DECISIONS.md、ROADMAP.md，按任务读 Back/CONTRACT.md。默认检索范围是 Front/、Back/；不要从父目录扫描。项目版本 V0.1，按 0.2、0.3 小步迭代。

Achieve/Anthropic/ 是各版本原始参考快照，默认被 .ignore 排除但纳入 Git。只在回测、查历史决定/缺陷/出处时按精确路径读取；用 `rg --no-ignore <关键词> Achieve/Anthropic/V7` 等窄范围命令。历史 AGENTS、任务书、STATUS 中的旧“当前”、派工、日期及权限仅为历史原文，不自动成为当前执行指令。

用户最新明确决定优先，其次本根部决定与当前明确接受的契约；实现、历史材料和执行者自报不能代替用户接受。业务未决政策看 README.md。

## 协作与修改

Codex 不使用任何 subagent/explorer/worker/隐藏委派。2026-09-19 最新分工：Codex 负责全栈架构、创意、契约、分阶段拆解与独立验收；契约稳定的中大型实现必须交 ZCode，仅很小的明确修改由 Codex 直接做。默认尽量提供四路可并行且分别以 /goal 开头的 prompt，由用户手动转交；有依赖的工作串行，不默认 GUI 派工或监督。此决定替代此前本轮由 Codex 全面开发的交接。每文件一个writer；保留用户修改。禁止 Git worktree，未经授权不commit/push/切分支。用户已确认首次迁移发布至 Openclaw-D/HUMAN-AGENT-LOOP，保持公开；首次提交仅来自本JW目录，此授权不自动延续到后续功能发布。

迁移后的日常写入只在 JW；旧 Anthropic 保留恢复参考。本文件不自动重定向任何正在运行的旧服务或 ZCode 任务，后续派工必须明确 JW 绝对路径。

当前应用已登记独立JW项目，真实路径C:/Users/22673/Desktop/JW，projectId=cf880028-c0af-418f-87b5-7ca69bf12dc4；远端origin为Openclaw-D/HUMAN-AGENT-LOOP。三者指向同一套决赛源码和资料。发布核对Git根、工作区差异、本地与远端HEAD；Front/dist是用户明确要求的发布文件，前端源码改动后须更新构建。依赖/凭据/数据库不进入Git。

当前已有真实客户工作本、客户门户与 Edge/A/Connectors 接线代码，另保留六角色本地训练演示。代码存在不等于 D27-L-UI 通过；最新产品最高方向为业务视角横屏二维作业看板，停止3D、地图、手柄和游戏化投入；复用真实工作本，完成从原始材料到有权人类决定的真实页面闭环，完整生命周期按实际后端契约逐段验收。北极星与接续入口见 docs/codex-handoff/NORTH_STAR.md、CURRENT_STATE.md、NEXT_ACTION.md。真实模型、生产身份/项目隔离、用户视觉验收和技术单测分别记录。模型 authority=none，正式权威属于人。

不读取/上传真实密钥或客户数据，不把测试凭据用于生产；业务制度、真实模型费用与部署需对应授权。保护已有浏览器 viewport、缩放和预览标签；不停止未知进程或抢占端口。

## 完成与历史

功能通过、原执行者自报、Codex独立验证和用户验收分开。按风险执行测试；报告遗留失败，不通过改预期冒充解决。实质决定写 DECISIONS.md，版本变化写 CHANGELOG.md；不要将新结论回写 Achieve/Anthropic/ 原件。
