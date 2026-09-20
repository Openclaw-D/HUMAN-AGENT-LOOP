> 2026-09-20 用户最新重大决定：先读[固定北极星 V0.3-NORTH-STAR-1.4](docs/v0.3/01_FIXED_NORTH_STAR.md)。产品定位固定为AGI，核心交互为必看数据＋3–5个候选置信度排序/默认首选＋点选反馈纠偏；默认推荐不等于正式审批，学习效果以版本化评测验证。面向科技领导，以夺冠得分和客户服务带来的可量化增量利润为目标；聚焦年收入一千万至三千万元的制造业小微客户，年收入不超过五千万元为绝对红线，好/中/差三例真实跑通商机、政策、信审、商务、资产五区，统一系统，产品必须采用A2A多智能体并行协作（不授权Codex内部subagent），吸收TypeSafe/Jev结构化决策设计。必须有月/季/半年/年度价值测算和真实测试证据。未经用户新的重大明确决定不得改变北极星或彻底重构，仅允许局部微调。旧文冲突处以此为准；本次仅文档冻结，不代表代码完成或生产验收通过。CTRL仍是唯一工程协调入口。

> 2026-09-20 V0.3 最新入口：先读 [决赛评分与产品基线](docs/v0.3/00_AUTHORITY.md) 和 [任务板](docs/v0.3/TASKBOARD.md)。AI赛道固定权重：创新突破20%、AI场景融合度20%、提效数据显著性20%、方案完整与速度30%、方案呈现10%。总体目标按用户指定的07-RACE末轮扩展为同一客户五区协同至履约、结清、多轮返单；TAKEOFF首次准入保留为子流程，以下与其总体范围冲突的旧“最高/当前/唯一”表述降为历史。范围更新不代表代码完成。15分钟展示（12分钟固定+3分钟预留），另备5分钟问答。用户明确授权本轮可见V0.3任务创建与接续；内部subagent、worktree及未授权发布仍禁止。
> 2026-09-20 当前最高产品基线：`docs/takeoff/first-admission-v1/01_TAKEOFF_CORE_AUTHORITY.md`，版本 **TAKEOFF-FA-1.0.0**。仅做新客户首次回租准入与客户授信预评估，终点为有权人员确认预评估结论；不做正式额度批准、提款、复贷、租后、结清。客户为主对象，五列四行矩阵＋右侧六助手按02文件实施；资产为准入资产核验，可与信审并行。以下旧全生命周期、项目主对象、不以矩阵为主界面及额度使用率等冲突产品方向均被本版替代，仅作历史。安全、权限、凭据、Git和资源保护纪律继续有效。
>
> 接续顺序：先读 `docs/takeoff/first-admission-v1/00_START_HERE.md`；当前盘点与实施入口见同目录 `CURRENT_STATE.md`、`ADAPTATION_MAP.md`、`IMPLEMENTATION_PROMPTS.md`。旧任务书不自动恢复执行。本轮文档对齐不等于代码完成或产品验收通过。

> 2026-09-20：现同步冻结中的开发源码、测试、迁移、前端构建及文字交付记录，作为后续精简前的恢复点。最新状态见[CURRENT_STATE](docs/codex-handoff/CURRENT_STATE.md)。未宣称完整验收通过；下文仅文档同步说明属于上一提交历史。

> 2026-09-19 最新冻结：业务视角横屏二维作业看板，明确不做3D/全国地图/办公室/手柄/游戏化，不以表格为主界面。此前见微世界与多输入要求在本轮范围中被替代，历史原型保留但停止投入。复用真实工作本，单项目商机→尽调→政策→信审→商务→资产至结清，依赖可并行不强制流水线。最新复核与四路接续任务见 docs/codex-handoff/board-round-02/REVIEW.md。

# JW · HUMAN-AGENT-LOOP

**见微：业务人员的横屏二维作业看板。** 以合成的融资租赁案例为起点，展示业务、政策、信审、商务、资产与见微如何共享事实、发现风险、推进任务，并由人承担正式判断和责任。AI用于辅助，不替代人的审批权限。

云端基线 **V0.1**，当前本地产品方向 **V0.2 二维业务看板**。这个仓库供队员运行演示、讨论逻辑、记录进度和持续开发，后续按0.2、0.3小步迭代。

> 当前已有真实客户工作本、客户门户与 Edge/A/Connectors 接线代码，另保留本地训练演示。**D27-L-UI 页面旅程仍未整体通过，不能宣称完整交付或生产可用。** 当前北极星与执行入口见 [北极星](docs/codex-handoff/NORTH_STAR.md)、[当前状态](docs/codex-handoff/CURRENT_STATE.md)、[下一步](docs/codex-handoff/NEXT_ACTION.md)。

## 当前 TAKEOFF 演示入口

本轮为 **TAKEOFF-FA-1.0.0**：新客户首次回租准入与授信预评估，终点是有权人员确认预评估结论。采用轻量二维矩阵；不产生正式额度、融资申请或敞口。当前状态及独立复核见 [发布复核](docs/takeoff/first-admission-v1/CODEX_RELEASE_REVIEW.md)。

需要 Node.js 22.23.1+、Docker，以及 `Back/A`、`Back/Connectors` 的 npm 依赖（分别执行 `npm ci`）。首次配置将 `Back/Edge/config/takeoff-runtime.example.json` 复制为同目录 `takeoff-runtime.json`；已有本地配置请保留。示例仅供合成演示，含公开测试身份，不能作为生产配置。

在 `Back/Edge` 执行 `node scripts/takeoff-up.mjs --serve-front Front/dist`，就绪后访问 **http://127.0.0.1:48214/**。停止使用同目录 `node scripts/takeoff-down.mjs`，保留数据库。已有服务占用端口时应先核对归属。页面操作顺序见 [演示脚本](docs/takeoff/first-admission-v1/implementation/04/DEMO_SCRIPT.md)。这是本机入口；内网共享部署尚未验收。

助手当前为确定性简报；真实模型及 Jev 未启用。需求登记已有 API，页面录入尚缺，完整新客户全页面办理尚未验收。

## 仅预览前端（不构成可办理的完整演示）

1. 下载/克隆本仓库，先完整解压。Windows电脑需要安装 **Node.js 22.23.1或更新的22.x版本**；已有则无需重复安装。
2. 双击根目录 **`Start-JW.cmd`**，浏览器会打开 `http://127.0.0.1:3618/`。
3. 保持启动窗口开启，结束时按 `Ctrl+C` 或关闭窗口。

仓库已经包含 `Front/dist` 构建结果，此入口只启动静态 HTTP 服务；登录、客户资料和办理需要上面的完整 TAKEOFF 服务。不要直接双击其中的index.html。端口被占用时会提示，不会关闭其他程序。

macOS/Linux或希望使用命令行：`node Front/start-preview.mjs --no-open`，再打开上述地址。演示中的案例、对话和状态均为合成模拟，启动入口不会连接真实模型、调用付费API或启动后端。

## 文件夹里是什么？

| 目录 | 用途 |
|---|---|
| **Front** | 真实客户工作本与受限门户、另存的六角色训练演示、源码、测试、dist与启动服务 |
| **Back** | 最新V7/backend-next后端：A业务内核/数据库、B任务执行器、C规则与mock、D集成验收；含源码、迁移、模板、测试和配置示例 |
| **Achieve** | 历史决策、roadmap、旧代码、截图、PPT及迁移证据；用于查历史，不是第二个活动项目 |

日常开发只在本JW目录的Front/Back进行。Achieve默认不参与日常检索；需要历史时按版本定点查，不运行其中的旧任务书。原Anthropic文件夹保留备份参考，不需要它才能运行本前端。

## 后端怎样运行？

后端需要 **Node.js 22.23.1+、PostgreSQL**（本机验证通过Docker运行）。按 [Back/START.md](Back/START.md) 初始化依赖、独立数据库，并启动A、B、C。数据库迁移和配置示例已包含；不会上传或复制旧数据库、真实密钥和node_modules。

来源为 `V7/backend-next`，不是较旧的 `V7/backend`。上传前逐文件对账见 [最新后端核对](Achieve/Migration/latest-backend-check.json)。该清单只证明迁移来源；当前功能与验收以接续状态和固定快照证据为准。

## 修改前端

在Front目录运行：

```powershell
npm ci
npm run dev
```

开发端口为3617；`npm run build`更新dist，`npm test`和`npm run typecheck`运行检查。当前dist已随仓库提供，修改源码后须重新构建，才能让双击入口展示新版本。

## 当前验证与下一步

历史迁移测试见 [迁移交付状态](Achieve/Migration/DELIVERY_STATUS.md)，后续产品轮作者证据见 [产品旅程测试记录](docs/product-delivery/goal-04/TEST_RESULTS.md)。历史计数不代表本轮独立复验。

尚未闭合：D27-L-UI 普通人从原始材料到有权人类决定、完整启动与恢复、真人试用。真实模型已有本地接入记录，生产身份、真实数据、媒体、多人空间和部署分别验收，不以单元/API 测试替代页面与用户验收。

2026-09-19 最新决定：收敛业务视角二维看板，复用真实工作本，优先完成一次上传、处理、补证、核验与有权人类决定的办理闭环。Codex负责设计与独立验收，ZCode实施；完整规则以北极星为准。

团队接手先读：[当前决定](DECISIONS.md) · [路线图](ROADMAP.md) · [交接](HANDOFF.md)。迁移保留912份原始Markdown，几十MB资料也保留；[清单](Achieve/Migration/manifest.json)可逐文件核对来源和SHA256。

公开仓库：[Openclaw-D/HUMAN-AGENT-LOOP](https://github.com/Openclaw-D/HUMAN-AGENT-LOOP)。仅提交本JW目录；依赖、凭据、数据库和临时状态不上传。

## 历史：8f8d962文档同步边界

本次仅同步方向、交接与复核文档。文档所述51项前端和13项Edge测试对应本地未提交开发快照，相关代码尚未随本次推送。云端源码不能据此视为已包含这些修复；本地原型和原始测试日志未上传。后续对话先读北极星、board-round-02/REVIEW.md和四路任务书。
