# 四路 Goal 派发回执

## 当前：2026-09-16 00:35 +08:00 后端长程新批次

### 2026-09-16 07:00 最终收口（监督已结束）

- 触发时间07:00:34，已按截止规则用正式工具删除automation `9-16-07`，返回deleted；不再GUI派工或延长到白天。本次仅读取最终文件作收口，未重跑测试，不宣称已终止全部ZCode进程。
- B06:35自报runtime预算透传、锁owner保护、负账目拒绝已实现，63/63模块及25/25常驻自证，指纹37cd7a9c05568eb0。D最终附录确认DEF-03/04修复，但D-25e重启用例目标状态出现不稳定，仍保留FAIL，原因尚未独立确定，不能宣布后端全部通过。
- D06:45汇总为40唯一id：37 PASS/1 FAIL/2 BLOCKED；其中2个BLOCKED是被新测试替代的历史id，不应当作两个新的实现缺口。STATUS/RESULT上部仍有旧计数和旧FAIL文字，最终附录优先，文档一致性未收好。
- 已形成真实PG/HTTP/常驻worker/LangGraph/mock工程闭环与人控恢复；商业租赁8合成案例、多轮及非租赁模板已有交付。具体通过范围见各lane证据，不等于真实模型推理能力或生产部署通过。
- 剩余门：D-25e稳定性与根因、最终报告去重对齐、最新组合版本核验、真实GLM-5.2接入与费用授权、生产身份/项目隔离、v1.3复核ack政策接受；Celery仍隔离spike候选。真实API调用保持0，未读取真实key。

### 2026-09-16 06:01–06:06 第六次监督

- 四路GUI核查：A持续组合watch，C保持巡检/06:45终审，D原Goal等待B修复；B05点Goal已完成，但模块修复未接产品入口，已真实/goal发送最后修复Goal，见新目标卡和工作中1秒。D收到定向验收及汇总纠偏提醒，见消息气泡，不重发原Goal。
- Codex独立复跑原预算反例：直接transport六实例并发现在仅1次simulated/实际请求，其余5次failed；目录账本failed且0新增请求。证明模块层原反例修复，不证明worker预算有效。
- D真实worker新DEF-04仍开放：runtime.mjs没有budget透传，预算1/1仍6次调用、3目标candidate_ready。静态核查与D报告一致。B须补CLI/runtime真实接线与端到端预算测试，不能只测直接构造transport。
- 另将活PID超龄10秒抢锁、旧owner清理可能误删新锁的互斥风险交B检查/失败关闭，D独立反证；未实测该竞态，不将其写作已复现。要求负账目拒绝，估算预算不冒称真实费用硬上限。
- D当前概要仍有计数与旧FAIL残留，已要求按唯一test id/最新hash程序化汇总，06:45交结果；A既有watch按B源码变更重组合，旧hash结果不证明最新修复。v1.3政策、生产身份/项目隔离、真实provider继续留门。
- health只读确认db=up、model=not_configured、uptime约7625秒。0真实API/密钥，无前端/Git/账户/既有Dify操作。07:00最终收口并删除本轮automation，不续白天新任务。

### 2026-09-16 05:00–05:05 第五次监督

- 四路GUI核查：A/C/D原Goal仍运行，B上一Goal完成。B已用真实/goal标记发送预算门P1新Goal，见目标卡与工作中4秒；A/D只追加提醒，见消息气泡与等待引导，不重复Goal。
- DEF-03人工恢复已由D按retest-def03-r4独立复测通过（28断言，执行者证据，Codex未重复执行）。D也报告v1.3候选stale门、manifest及干净启动通过；生产身份、项目读/证据写隔离与业务候选裁决仍未通过，不混为全后端验收完成。
- Codex独立发现并真实socket复现新P1：B预算上限1、每次估算1，六实例Promise.all共用账本竟6次simulated/6次请求；costLogPath指向目录仍simulated且出站1次。现有“并发”测试只是顺序await，账本读写异常被吞。已记录精确hash、根因与验收于REVIEW_20260916_0500.md，交B修、D独立并发/子进程/损坏账本反证。
- D-25接口已发布，已督促取消“无接口”旧留门，清理STATUS里旧FAIL和重复/计数矛盾；A待B稳定新hash后更新组合及传递manifest，不能沿用旧版通过证明新版。
- health只读探针ok=true、db=up、model=not_configured、uptime约3883秒。0真实API/密钥，无前端/Git/账户/既有Dify操作；独立探针只用随机loopback端口及新临时目录。下一检查仍06:00，07:00收口。

### 2026-09-16 04:01–04:09 第四次监督

- 四路GUI核查：A/C/D原Goal仍运行；B上一Goal明确完成，已通过 /goal 菜单、Goal标记、核验草稿、发送接续DEF-03修复，见新目标卡与工作中1秒。D已收到同轮验收提醒（新气泡及等待引导）。未重复重发运行中Goal。
- A自报实际B常驻CLI+C mock+PostgreSQL最终组合7/7（4目标/2角色/2客户端），23/23回归；属于执行者证据，非Codex最终验收。Codex本轮只读health确认ok=true、db=up、model=not_configured、principalVerifier=configured，uptime约282秒。
- D真实进程kill/restart检查发现P1 DEF-03：unknown恢复零盲重发通过，但B CLI人工retry_step接受后没有新transport调用、goal仍leased。已交B准确复现、区分A resume路径前置条件并修复，要求授权恰好一次重发、无授权零调用、固定hash交D。关闭后可补本地mock预算失败关闭，不花真实API额度。
- A已落实v1.3 stale跨历史终态的可见性/UPSTREAM_STALE人工ack候选，仍pending user ruling，不改写历史决定。已要求D独立测候选实现，将技术结果与用户业务政策接受分列，保留原反例，不能以改预期冒充需求验收。
- D仍有预算门未测；匿名证据提交与项目读取边界意味着生产身份/项目隔离不能宣称通过。已要求D明确标记，不把synthetic身份当生产认证。C当前无新写面需求，继续跟踪v1.3和B交接。
- 无前端、真实key/付费API、Git、账户或既有Dify操作。本轮不重复跑正在变动的全套测试；后续按修复后的固定版本验证。

### 2026-09-16 03:02–03:10 第三次监督

- A/B/C/D原生GUI均已核查。B首轮Goal明确完成，已用真实/goal→Goal标记→核验草稿→发送接续worker CLI/恢复交接，工作中8秒与新目标面板确认；A/D原Goal仍运行，仅追加纠偏消息，均见新消息气泡及等待引导，不重发Goal；C仍跟随契约巡检，无新写面任务。
- B自报53/53模块、13/13真实A+C mock组合和Celery Linux spike通过；D已开展真实PG/HTTP独立矩阵，但worker CLI缺失留门。B收到补齐/明确常驻入口与固定hash交接要求；Celery仍候选，真实模型未测。
- 发现重要验收漂移：A对DEF-01仅升v1.2契约，将accepted/decided处停止传播写为新规则，D随之修改预期。Codex不接受“实现注释=用户授权”或“改预期=原需求已满足”。已发A/D `REVIEW_20260916_0305.md`：保留原反例，区分历史决定不可改写与下游失效传播；提出最小候选及人工复核门，未获用户决定的业务政策不冻结。
- A须按既定DoD完成真实B执行器+C配置最终组合与完整传递manifest，不能只引用B自报。D继续独立故障恢复/unknown验证；原需求语义缺口未关闭，其余无争议工作继续。
- 本轮未在不断变化的源码上重复全套测试；不把各lane自报全绿当最终验收。无真实key/付费API/前端/Git/账户变更。

### 2026-09-16 02:02–02:08 第二次监督

- A 已落盘 CONTRACT v1.0、README、RESULT、manifest；19/19集成与10步E2E、C计划组合通过为A自报，未作本轮Codex全套复跑。GUI显示追加崩溃/PG重启测试，发现PG Pool idle client error未处理会使常驻进程退出，正在修复与回归。
- Codex首次GET `http://127.0.0.1:48080/api/v1/health`连接拒绝，随后同一只读探针返回 `ok=true, db=up, model=not_configured, principalVerifier=configured, uptime≈53s`，确认服务恢复，不能把先前“常驻”文案当持续可用证据。
- B GUI实际仍运行，已自报50/50模块测试，正将本地stub适配到A v1.0、C mock，随后做真实组合和Celery spike；尚无B完整交付报告，不宣称组合完成。
- C GUI完成阶段回复并保留后台检查，文件自报两模板真实PG集成、8案例及多轮/heldout、413竞态修复；本轮未重复跑C旧测试。其RESULT仍有旧BLOCKED/契约v0.1语句，最终须同步当前v1.0和实际验证，不作为新阻断。
- D已从上一轮重连恢复，实际正在修自有PG测试资源问题。发现D仍等A/dist，而A已改为Node22直接运行TS：已在D原任务发送准确入口提醒、独立SUT与固定hash要求，并要求禁止通配清理未知资源。GUI新消息气泡及“等待引导当前任务”确认，不重发Goal。下一轮核查D已消费提醒并跑实测矩阵。
- 四路均已核查，现有Goal不重复。后端整体尚未独立验收；真实GLM-5.2未配置、0次付费调用，未修改前端/Git/账户/既有Dify。

### 2026-09-16 01:00–01:05 首次监督

- 四路逐一原生 GUI 核查，未重复发送 Goal：A 正实现 kernel 并自修状态机问题；B 正写 LangGraph 核心，依赖安装完成为 GUI 自报；C 已进入规则包/案例/模板；D 已读取 A 新契约并准备独立 SUT，末次观察显示重新连接中 7/10，停止生成仍在，不据此重发。
- 本机只读 docker ps 确认 Docker daemon 已恢复，隔离 `v7next-a-pg` 正在运行；已有 Dify 容器同时运行，Codex 未修改或停止任何容器。数据库容器运行不等于完整 API 验收。
- A `backend-next/CONTRACT.md` v0.1 DRAFT 已实际落盘，A/B 新源码与 lockfile 出现；A HTTP入口/组合仍开发中。D 已获知契约和 C mock，未在旧依赖阻断上空转。
- Codex 独立执行 `node --test V7/backend-next/C/test/mock-server.test.mjs`：16 pass / 0 fail，exit 0（真实 TCP 模拟服务，包括429、5xx、断连unknown、凭据脱敏、串项目探针）。只证明本测试集，不证明真实模型、业务效果或生产权限。
- C 外部冒烟7/7、D harness自检8/8是执行者自报，尚未由Codex独立复核。C STATUS中约01:05为执行者估计时间，不作为精确时钟证据。
- 下一步仍由原Goal持续：A真实API与固定版本→B/C契约对齐→D独立组合/故障注入；留意D连接恢复，若终止后再定向接续。无前端、Git、真实API或密钥操作。

当前唯一派工入口为 `NIGHT_BACKEND_20260916.md`，本节替代下文历史任务的续跑入口。新写面 `V7/backend-next/`；旧 `backend/` 只读复用参考，禁止继续旧前端任务。下文保留历史证据，不代表当前任务仍存在。

| Lane | 本次 GUI 实际任务标题 | 写入范围 | 实际观察 |
|---|---|---|---|
| A | A路持久化协作内核与HTTP集成实现 | backend-next/A/** 和共享 CONTRACT.md | /goal 菜单→Goal 图标→核验全文→发送；正式目标面板与工作中 |
| B | B路:LangGraph持久化编排与Celery验证 | backend-next/B/** | 同上，正式目标面板与工作中 |
| C | C路：mock HTTP模型接口与融资租赁案例包 | backend-next/C/** | 同上，正式目标面板与工作中 |
| D | V7后端D路黑盒验收与故障恢复测试 | backend-next/D/** | 同上，正式目标面板与工作中 |

四路均已实际发送，不需补发，不向正在执行的同一 Goal 重复投递。C 消息称 A/B/D 并行时 D 尚待随后发送，现 D 已发送。各任务初始回执显示工作中/加载中，只证明启动被 UI 接受，不证明已经产生代码、完成依赖安装或通过验收。当前模型界面 GLM-5.3-Flash / 最高，Codex 未修改模型或账户设置；GLM-5.2 是之后待接的独立付费 API，本轮真实调用为零。

正式 heartbeat 已创建成功：`9-16-07`，名称「后端每小时监督至9月16日07点」，ACTIVE；北京时间 2026-09-16 01:00、02:00、03:00、04:00、05:00、06:00、07:00 检查，最后收口后删除自身，晚于截止触发则直接删除。无变化安静，有实质进展/失败/需要用户动作才通知。旧 `v7-ctlr` 更新被工具确认不存在，本次是新建，不恢复旧监督。

本机 Docker CLI 可用，但本轮只读 docker ps 报 Linux engine 管道不存在；基础设施和可恢复依赖准备已交 A 单writer负责，尚未验证安装完成。B 执行 Celery 隔离 Linux 有界验证，不触碰既有 Dify 数据。后续先确认真实产物与依赖状态，再按固定版本独立验收，不能将 mock 通过说成真实模型接通。

---

2026-09-15。当前执行入口：LONG_RUN_GOALS.md。以下为 GUI 派发时观察，不等于实现或验收完成。

| Lane | ZCode 任务标题 | 写入范围 | 派发回执 |
|---|---|---|---|
| A | 共享状态与B/C页面最终集成闭环 | V7/backend/A/**，共享 CONTRACT.md | Goal 卡片及工作中 |
| B | V7-B LangGraph 协作编排实现 | V7/backend/B/** | 先输入 /goal、选择命令后输入目标；Goal 卡片及工作中 |
| C | 远程尽调现场界面C实现 | V7/backend/C/** | Goal 卡片及工作中 |
| D | D独立验收与有限轮修复清单 | V7/backend/D/** | Goal 卡片及工作中 |

用户补充验收：必须出现 Goal 的高尔夫旗标/目标图标，不以普通消息含 /goal 字样作为成功依据。B 已再次截图核对目标图标、Goal 卡片及工作中；后续监督按同一标准核对各任务真实目标状态，不向运行中任务重复派发。

既有前端任务「首页四域格子与响应式交互改造」保留，后端任务不得抢写其文件。

既有 heartbeat `v7-ctlr` 已通过正式 automation 工具更新为 ACTIVE、每小时一次，名称「V7-CTLR 每小时后端四路推进」。检查各路证据、依赖和真实 GUI 状态，有可执行进展继续接续；无变化安静，权限门及重复阻断报告要求见 LONG_RUN_GOALS.md。未新增重复自动化。

## 2026-09-15 02:25 +08:00 心跳检查

- 四个现有 GUI 任务均仍在执行；A 正在检查 B/C 可集成产物，C 正在执行判断模块测试，未重复派发 Goal。前端和浏览器预览尺寸/缩放未修改。
- A 的 CONTRACT v0、基础 API、assembly/sim-round.mjs 已落地；A 自报 16/16 测试通过，仅为自报及已有证据，不是 Codex 最终验收。当前 assembly 仍为模拟组合缝，不能称 B/C 最终集成。
- B/C/D 的部分 STATUS 仍写合同未发布，已落后于代码。B 已收到合同发布及 C 工具就位的接续指令；GUI 新消息气泡和“工作中”确认。要求对齐唯一合同，旧 R1 仅历史参考，修复不限固定轮数。
- D 已在执行 X 黑盒矩阵并修正自己的测试问题，故过程中 JSON 通过数不是最终报告。GUI 自报发现 stale/formalOutcome/unknown/resolved 方面问题，须以固定源码 hash 的可复现缺陷报告定性。
- Codex 静态复核发现 A/server.mjs 直接将请求 body 交给 human-actions，service.mjs 仅校验自报 actorRole；D 原 X-8 只测 model 角色拒绝。已向 D 发送“未认证却自称 human”的反证要求，GUI 消息气泡确认（当时显示等待引导当前任务）。身份字段不等于可信授权；不能把现有 403 用例当权限验收通过。
- 后续优先：D 落盘缺陷并交 A 修复；A 读取缺陷、B/C 接口产物完成组合；C 对齐已发布合同；D 固定版本复测。Codex 不写各 lane 源码、不重跑正在变化的全套测试。
- 真实模型调用仍待明确用途/成本授权，未读取密钥或发起付费 API。现有 site dirty diff 仅观察，无改写或归因。

## 2026-09-15 03:28 +08:00 心跳检查

- A/B/C/D 四个 GUI 任务逐一核对：A 原 Goal 已结束且仍引用旧 B 阻断；B/C 首轮已交付，D 等 A 修复（界面自报监测器就绪，不等于持续执行已验证）。没有四路都仍运行的声明。
- B RESULT/HANDOFF 和实现已落盘，ports.mjs 已正确使用 fs.writeFile/rename；D-7 在 D 回执中关闭。C 已完成合同对齐。A 旧 STATUS 未同步此变化。
- D-1/D-2 撤回，D-3/4/5/6 与新 D-8 尚开；Codex 核对 b-round 仍访问不存在的 opinion.requestId，与 D-8 一致。完整指令见 HEARTBEAT_20260915_0325.md。
- 已在 A 原任务先键入 /goal、选中命令出现 Goal 图标，再输入精确修复/组合目标发送。新 Goal 卡片及“工作中 12 秒”确认。目标包括默认正式动作失败关闭、可信 principal 校验边界、状态/引用修复、组合脚本清理和合同澄清，不以文档降级替代安全修复。
- B/C 暂无新的独立缺陷或已发布新合同待处理，未为填槽重复启动；D 下次在 A 新 hash 发布后接续反证和组合验收。
- Codex 独立复跑 `node --test V7/backend/C/test/v7-calculation-tool.test.mjs`：12 pass / 0 fail，exit 0，仅证明该计算测试集，不证明真实模型能力、身份权限或最终组合完成。
- 保留全部 frontend/preview 状态；未读取真实凭据、调用付费模型、改变账户或 Git。每小时 heartbeat 继续。

## 2026-09-15 04:26 +08:00 心跳检查

- A 已发布 CONTRACT v0.1、身份失败关闭/状态门/证据引用校验、b-round 修复和固定 hash。D 最新日志自报 X 60/60、D-3～D-8 关闭与组合通过；这是 D 复测证据，尚未整体验收。
- Codex 独立执行 B 目录 `node --test test/a-live-integration.test.mjs`，exit 1：1 pass / 1 fail；首例第 90 行因未配置可信身份源被 A 返回 403 PRINCIPAL_UNTRUSTED。旧 B 43/43 不再代表当前上游版本。未改产品/测试源码。
- C 原集成脚本同样未见 principal 适配；按新合同检查更新，不预先宣称其当前通过。
- 已分别在 C、B 原任务先键入 /goal、选择 Goal 旗标再输入接续目标。两路新消息 Goal 卡片及工作中回执已确认（C 6秒、B 8秒）。当前任务入口 HEARTBEAT_20260915_0425.md，限定各自写面，禁止回退 A 安全门或使用真实凭据。
- 下一步：B/C v0.1 交付后，A 固定最终组合版本与 LangGraph 候选组合验证；D 扩展编排级 unknown/kill-recover/幂等/resume 和含 B 实际依赖的干净目录验证。未因 D 现有全绿而宣布这些未完成项通过。未给 A/D 重复派发。
- 真实模型用途/成本授权仍缺，0 次真实付费调用；前端与预览状态保持，heartbeat 继续。

## 2026-09-15 05:27 +08:00 心跳检查

- B/C v0.1 适配交付已落盘。Codex 独立复跑 B `node --test test/a-live-integration.test.mjs`：2 pass / 0 fail，exit 0，包含合成合法身份、匿名/错凭据、未配置 verifier、凭据不落盘与意见状态门。上轮此套件失败已关闭；不等同所有功能最终验收。
- C 自报 58 单测及 20 集成通过；新报 resolved 意见错误码与合同不符（409 RUN_ESCALATED vs RUN_RESOLVED），交 A 裁决，不由 Codex 改源码。
- A 原 Goal 已结束，现按先 /goal→旗标→目标→发送接续：消费 B/HANDOFF-A-LANGGRAPH-v0.1.md，完成实际 LangGraph assembly、合同偏差处理、完整 hash、最终运行说明与仅提案 site diff。GUI 新 Goal 卡片及工作中 6 秒确认。
- D 原轮次已交付，现同样以旗标 Goal 接续：在 D 隔离范围扩展 thin/LangGraph unknown、kill-recover、幂等、可信 resume 反证，做含 B 实际依赖的干净目录复跑，等待新版本才测对应变更。GUI 新 Goal 消息及工作中 6 秒截图确认（其 accessibility 未完整反映聊天，使用截图核对）。
- B/C 无需重复派发。A/D 写面不重叠；前端/预览、真实模型授权门不变。未声称生产认证或跨机器通过，heartbeat 继续。

## 2026-09-15 06:25 +08:00 心跳检查

- A 发布 CONTRACT v0.2、实际 LangGraph lg-round、22 文件 hash 和运行说明；组合通过为执行者自报，未作最终验收。site diff 仍仅提案。
- D 自报 thin 故障恢复 19/19 与含 B 实际依赖的干净目录验证通过；不能外推实际 LangGraph 或第二台机器。
- 新 D-9：B resume 仍信任调用方自填 actor/role。已交 B 修复 thin/LangGraph 的可信身份与授权校验入口，缺 verifier/无效凭据默认拒绝，凭据不落盘。合成身份适配不代表生产权限已完成。
- B 新 Goal 卡片及工作中已确认；D 新 Goal 卡片、目标图标及工作中 2 分 20 秒再次截图确认。D 执行实际 LangGraph unknown/kill-recover/幂等测试，并等待 B 新交付验证 D-9。未重复发送。任务入口 HEARTBEAT_20260915_0625.md。
- 待 B 修复后更新最终组合 hash；C 的 RUN_RESOLVED 预期与 v0.2 证据同步仍待接续。前端/预览未修改，真实付费模型调用为零；每小时 heartbeat 继续。

## 2026-09-15 07:25 +08:00 心跳检查

- B D-9 已交付，两候选对称身份门；Codex 独立执行 B `node --test test/d9-trusted-resume.test.mjs`：4 pass / 0 fail，exit 0。覆盖无 verifier、错误凭据、伪造 actor、项目/动作拒绝、合成可信正例及凭据不落盘；不是生产身份验收。GUI B 显示目标完成，未重派。
- D 当前文档自报 LangGraph 实际候选 17/17、D-9 B 部分关闭、含 B 依赖干净目录 lg-round 通过；GUI 仍显示工作中与停止生成。本轮没有重派或覆盖 D 的执行，不用文档自报替代最终独立验收。
- A 当前 lg-round 仅检查 resume 函数存在，未证明组合暂停恢复。已发新 Goal 消费 B 接口、补 thin/LangGraph 暂停→可信恢复→A 投影及拒绝负例、更新最终 hash；截图确认 Goal 卡片及工作中 7 秒。
- C 已收到 CONTRACT v0.2 的 RUN_RESOLVED 断言/证据同步 Goal；截图确认 Goal 卡片及工作中 6 秒。入口 HEARTBEAT_20260915_0725.md。A/C 先分别键入 /goal 并选中目标图标，核对完整草稿后发送。
- 全部四路已检查；保留各任务已有预览布局/viewport，未操作前端。真实付费调用为零，无 Git/部署/账户操作。待 A 最终组合后交 D 定向验收，heartbeat 继续。

## 2026-09-15 07:47 +08:00 用户要求继续检查并下发更新

- A 已交 recovery-round 与最终 23 项 manifest；Codex 独立执行恢复脚本 exit 0、实际 24 条 ok（A 自报 23/23 为计数偏差），登记 hash 校验 23 项/0 不匹配。未外推清单覆盖完整或生产能力。
- C v0.2 集成与观察闭合已交付；B D-9 无新修复请求，未重复派发 A/B/C。
- D 上轮界面已结束，等待组合 hash 的依赖现已满足。已先 /goal 选中目标图标，下发 UPDATE_20260915_0747.md 最终隔离验收：恢复链独立断言、manifest 传递依赖覆盖、干净目录复现、异常路径合成凭据反证与当前报告收口。限定 D 写面，禁止旧 V6/site 扩写。
- 实际发送后刷新核对 Goal 卡片及执行状态；前端/预览与真实模型/生产身份/部署/Git 权限门保持。

## 2026-09-15 08:18 六角色与商业融资租赁客群更新

- 最新用户明确商业融资租赁（非银行系金租）、小微制造业、风险可识别/理解/定价/控制与成本后收益质量；任务入口 SIX_ROLE_COMMERCIAL_LEASING_20260915.md，替代旧首页编号右对齐与单业务视角。公开金租资料只作风险问题参考，不直接作为本业务规则。
- F 现有“首页四域格子与响应式交互改造”已收到 /goal：编号左移、六角色图标、共享事实与角色待办、多案例模拟交互。Goal 卡片+工作中6秒及随后读取任务书可见。写面仅原 home/**，不改活动site；真实LLM/生产授权不冒称完成。
- C 八案例/多轮/版本化评测任务书已准备，但本次尚未发送：切换时出现 user input detected，随后窗口最小化；一次恢复尝试仍遇用户输入及最小化，停止争抢窗口。C 不应被记为已派发。下一次窗口可用先核对现有消息再发 C 节，防重复。
- F 可先四个本地种子推进，不因 C 未派发而阻塞角色UI。用户原文提供业务背景，不授权生产模型训练、付费调用或读取凭据。
