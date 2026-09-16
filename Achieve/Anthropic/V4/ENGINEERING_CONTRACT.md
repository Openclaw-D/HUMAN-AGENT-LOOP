# V4工程滚动契约｜20260905 / ENG01

2026-09-05暂停令：USER PAUSED。ENG01-R1已交付，独立工程检查已收尾，等待用户检查；不启动下一检查点。以下为已执行契约，不能覆盖最新暂停指令。当前裁定见CURRENT_CHECKPOINT.md。

Owner：Codex V4-Ctrl。当前唯一执行书；工程复验通过可继续，主干变更仍由用户决定。仅当前检查点被派发，后续由Ctrl明确增量。

## 当前增量：ENG01-R1 未决核验恢复（revision 0006）

原ENG01 G1/G2已由Ctrl独立复验，真实双端happy path通过；本节仅修复其刷新丢失commandId的失败恢复缺口，未改产品边界，不扩视觉。以下R1写入表在本检查点替代原表。上一工程契约和受影响文件已复制至archive/工程基线/20260905-ENG01-R1，五文件逐项SHA比对一致。

- 沿用原VerificationCommand及HTTP协议。未决命令只能在确定服务端accepted/replayed或明确终结拒绝后清除；500/断网/异常响应不得清除。新命令发送前必须同步成功保存原commandId、caseId、actorId、expectedRev及完整冻结载荷；不可先fetch后靠effect写存储。
- 仅在本机合成演示面使用sessionStorage，不用localStorage/新数据库/新服务；封装版本为1，单个专用key `jw:v4:verification:pending:v1`。不得读取或清理其他key，不得缓存客户原材料/凭据/正式数据。理由为本来就提交的合成核验文本；此存储不是生产合规方案。
- 初次挂载先恢复再允许发送，SSR不访问window。恢复只建立未决态，禁止自动发送；case/actor不一致继续失败关闭，显示原绑定，切回原身份后由人显式重试同一payload/id。桌面/手机仍共用一个owner状态。
- 存储不可访问、写入/读取/清除失败、JSON损坏、不支持的schema版本、非严格命令形状：显式错误并禁用新提交；不静默丢记录、不用新ID重提、不自动修复或覆盖损坏记录。成功HTTP后若清除失败也保持保护，重复同ID允许服务端replay，不伪称已清理。
- 不使用TTL自动忘记未决状态。明确只保证同一标签页刷新恢复，不宣称跨标签页/关窗恢复/事务exactly-once。不改变后端角色、权威、默认candidate隔离或状态语义。
- R1复验补充（已回原owner）：封装只含version/command，命令恰七字段，非空白及长度遵守既有HTTP限制；共享单一in-flight锁，终结清除/父状态变更须匹配原commandId，迟到旧响应不得清除新命令；存储不匹配失败关闭。未决或发送中禁用演示reset，避免清除服务端幂等上下文。TEST补乱序响应及严格形状的可执行回归。
- 细化同一边界：reason按原始字符串length≤2000，与http.ts一致，另须trim后非空；hydrate未完成或存储错误非null也禁用reset，不能借恢复失败清掉可能仍需重试的服务端journal。

| R1 writer | allowed writes（相对repo） | DoD |
| --- | --- | --- |
| 原FE lane | app/work/VerificationPanel.tsx、WorkShell.tsx、verification-pending-store.ts（可新增纯存储适配helper） | 同步先持久化后发送；hydrate门控；失败关闭；同id显式重试；无视觉扩展 |
| 原TEST lane | test/v4life-verification-ui.test.mjs、test/v4life-verification-recovery.test.mjs（新增） | 真执行存储/命令生命周期测试：reload/原载荷一致、先写后发、读写清除异常、坏JSON/版本、stale身份、SSR、双端共享，不只正则；保留旧600断言意图 |
| ZCode主控 | docs/v4/ENG01_R1_REPORT.md | 全量test/typecheck/lint/build，exact diff与未验证项；停写等待Ctrl |

其余文件只读，包括旧ENG01_REPORT.md、样式、后端、根部authority、契约、package/lock。先核实writer空闲，原FE/TEST两个lane并行，不重建BE任务凑并发；共享接口先内部约定，禁止相互写文件。不得操作浏览器/服务/端口/Codex。Ctrl专属3101合成服务正在运行，不能结束或重启。报告只给摘要，不回贴源码。

停止条件：R1可复现证据提交即停；涉及新业务语义/新增依赖/跨标签页锁/生产存储立即报边界，禁止扩大实现。五色六维骨架留下一独立检查点，不夹带。

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
