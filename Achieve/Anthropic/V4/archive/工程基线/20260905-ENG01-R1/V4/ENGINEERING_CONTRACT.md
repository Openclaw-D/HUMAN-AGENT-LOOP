# V4工程滚动契约｜20260905 / ENG01

Owner：Codex V4-Ctrl。当前唯一执行书；工程复验通过可继续，主干变更仍由用户决定。仅当前检查点被派发，后续由Ctrl明确增量。

## 总目标与边界

现有小微业务+政策/信审/商务/资产组件，本地可运行、低保真可交互、前后联调。复用lib/v4life、/api/v4life与/work，不重建平台、不绑定编排品牌。

制度、人权威、必经依赖、五色/六维和候选隔离继承NORTH_STAR及DOMAIN_FRAMEWORK。新回仍是主场景；不改seed，不编造预付/巡视规则，不接模型/真实业务API，不安装依赖，不部署/commit/push/worktree。不处理Unity、历史代码、V1–V3、Codex状态或Memory。

## ENG01：材料核验最小闭环

复用changeVerification，让合成演示材料由既有demo角色提交核验理由，经真实HTTP和引擎回读核验状态、版本、事件。保留默认关闭的candidate隔离；不意味着正式核验岗位已被接受。Context本轮只展示已有投影，不新增窗口动作。

冻结接口：新增POST `/api/v4life/cases/[caseId]/verification`。沿用parseChangeVerificationBody：commandId、expectedRev、evidenceId、actorId、verificationStatus、reason；沿用引擎结果和错误JSON。仅已知合成demo case且NODE_ENV非production允许；生产失败关闭，非demo不通过端点扩权限。不接受请求自行开candidate，不以角色切换冒充登录认证。不改变引擎method签名、默认模式、seed、业务角色矩阵。

前端新增窄核验区域，标“合成演示/候选岗位语义，非正式审批”；显示服务端材料核验状态，理由必填；pending/错误/权限不足/过期反馈清楚。重复重试复用commandId，冲突刷新并提示，禁止静默用新版本重提。核验不冒充审批或Receipt。保持顶部Context、主工作区、右协同及手机入口；新增区域灰阶线框，风险色度用文字，不重写全部历史CSS。

## 单文件单writer

路径相对jianwei-v3/site。ZCode先核实没有其他活跃writer，再在原生Harness并行分包；不得为凑并发造任务。

| Writer | 允许写入 | 约束 |
| --- | --- | --- |
| BE | app/api/v4life/cases/[caseId]/verification/route.ts | 只读复用http/runtime/engine；需改共享内核先报阻塞 |
| FE | app/work/VerificationPanel.tsx、verification.module.css、WorkShell.tsx | 独立fetch冻结接口；共享model/types只读；不得伪造canonical state |
| TEST | test/v4life-verification-http.test.mjs、test/v4life-verification-ui.test.mjs | HTTP handler集成与UI/异常回归；不削弱旧断言 |
| ZCode主控 | docs/v4/ENG01_REPORT.md | 串行整合，写exact diff、命令/退出码/结果/未验证；不自写Accepted |
| Codex Ctrl | 根部当前Markdown、V4当前文档、docs/v4控制/验收记录 | 不改运行中的代码writer文件；独立复验 |

共享types/schema/engine/journal/seed/runtime/package/lock/scripts、/work/screen和其他页面禁止改；确有必要报精确原因和最小diff，Ctrl另行裁决。用户和既有dirty修改必须保留。

## Gate和停止条件

G0：312文件当前dirty基线已复制逐项SHA验证，见archive/工程基线/20260905-ENG01/manifest.json。ZCode先跑全量baseline，记录既有失败。

G1：成功核验后GET状态/版本/事件更新；同命令不重复事件；错版本/角色/目标状态/空理由/不存在case/production关闭验证。默认引擎不被请求打开candidate。

G2：新增focused、全量test、typecheck、lint、build逐项运行，记录真实退出码，不能截尾掩盖失败。所有writer停写后主控串行build。不得停未知进程、抢端口、重置共享demo；本轮ZCode不启动服务/浏览器。Ctrl随后用独占合成状态HTTP/浏览器复验。

G3：Ctrl检查桌面/手机操作反馈、刷新、重复/过期及四域不回归；首个交互预览给用户，build不等于视觉接受。

ZCode完成本checkpoint写COMPLETE_CANDIDATE并停写，等Ctrl复验/纠偏。越界、其他writer、不可避免共享内核改动先停对应lane。不得静默换模型。严禁操作/联系Codex；本地报告不是“同意使用 Codex”的授权。
