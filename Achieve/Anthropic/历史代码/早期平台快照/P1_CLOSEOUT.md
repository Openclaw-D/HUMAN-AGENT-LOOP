# 见微-人机协同平台：P1 收尾

日期：2026-08-27  
Gate：`P1 REOPENED`（本文件仅保留旧技术基线证据）  
决定者：P1 唯一总控任务（用户保留最终产品验收权）

## 1. P1 当前结论

P1 的技术闭环已经通过：用户确认的极简三视图前端已接入唯一真实 `WorkProjection`；轻量后端以 append-only Event 为权威事实，覆盖前三个锚点场景；普通消息、显式 Agent Run、Handoff、Human Gate、ActionIntent、Receipt、幂等、版本冲突、失败/`unknown`、Event-only replay 和重启恢复均有真实证据；前后端在 4178/4179 本地闭环运行。

2026-08-27 用户新增并冻结“全中文展示”硬约束，并明确指出十场景、关系图交互、进度循环、矩阵状态/交互和本项目模型运行接口均未完成。P1 已正式重开；新权威任务图见 `P1_REOPENED_REQUIREMENTS.md`。只有该文件的全部 Gate 和第 8 节中文 Gate 通过后才能重新标记为 `P1 ACCEPTED`。

这不表示客户、生产、部署或十场景全部运行完成。当前运行数据明确是 `fixture:false`、`dataOrigin:sample`；后七场景仍为 `catalog-only`。

## 2. 冻结成果

- 产品名称与十场景名称保持 `P1_CONTROL_BOARD.md` 冻结顺序。
- 物理桌面证据为 1920×1080；顶部约 10%，下方左 80% 画布、右 20% 接续台；白底、黑白与克制灰阶。
- 关系、进度、矩阵三视图只读取同一个 `state.projection`，切换视图不产生 Command。
- 右侧接续台承载 Activity、消息、Challenge、Handoff、Gate、Action、Receipt 与显式 Agent 接续，不是独立聊天真相源。
- `P1_PROJECTION_CONTRACT.md` 与 `contracts/work-projection.v1.schema.json` 是 P1 的冻结契约。
- `currentActorId` 是当前 Human 操作上下文，P1 sample 默认跟随 owner；system/connector Event 不得静默夺取当前操作身份。

## 3. 证据索引

### 前端与视觉

- 前端：`prototype/p1-frontend/`
- 前端检查：`prototype/p1-frontend/evidence/CHECKS.md`
- 连调检查：`integration/p1/INTEGRATION_CHECKS.md`
- 正式真实 Projection PNG：
  - `integration/p1/evidence/real-risk-progress-1920x1080.png`
  - `integration/p1/evidence/real-risk-relation-1920x1080.png`
  - `integration/p1/evidence/real-risk-matrix-1920x1080.png`
  - `integration/p1/evidence/interaction-continuation-density-1920x1080.png`
  - 负向：`integration/p1/evidence/backend-unavailable-1920x1080.png`

最终视觉复核：四张正式图均为物理 1920×1080，顶部、左画布与右接续台完整；页面无水平/页面级垂直溢出，console error 为 0；产品页无 fixture 标识。

### 后端

- 后端：`runtime/p1/`
- 后端完整证据：`runtime/p1/evidence/BACKEND_CHECKS.md`
- GLM JSONL：检查点 A、A repair（拒绝）、B、D、E 均保留于 `runtime/p1/evidence/`。
- 最终公开验证证据：`node --test` 3/3；`node scripts/verify.mjs` 为 `ok`，并报告 `restartReplayEqual=true`、`selectorsShareProjection=true`。

### 连调

- 4178 通过受限 `/api/v1/**` 代理连接固定 `127.0.0.1:4179`，不是任意代理。
- risk 最终证据：Human owner 为 currentActor；普通消息可发送且 Receipt `unknown` 不显示成功。
- interaction 最终证据：多次新的显式 Run 各产生一个 Event，同一幂等重放不重复；v10/cursor10、10 Events、4 Runs 的历史重启后保持。
- stale Command 返回 409 `PROJECTION_VERSION_CONFLICT` 且零写入；后端不可用时前端显示 `PROJECTION_UNAVAILABLE`，不回退 fixture。

## 4. 执行与 GLM 口径

- GLM-5.3 只通过 GLM 项目内受控 runner 串行用于后端检查点；没有内部 GLM subagent、并发 provider 调用、worktree、commit、push、部署或依赖安装。
- A 首次实现经 controller 微修后接受；A repair GLM 因超出自身 shell 约束且测试失败明确拒绝，没有包装成成功。
- D 修复多次显式 Run 的重启兼容；E 修复 currentActor 漂移和历史单次 Run 文案兼容。所有检查点均由执行任务独立复核后才进入总控 Gate。
- GLM 项目 runner 只在项目副本中增加“非 Git + workspace-write + 精确授权根目录相等”的窄 Gate；全局 runner、provider、auth 未修改，`danger-full-access` 未使用。

## 5. 已披露残留与限制

- 后端手工 Gate 保留一份 192512-byte 的纯 sample SQLite；本地策略拒绝删除，未绕过。
- 检查点 D 保留一个 200704-byte 的受控回归副本。
- 检查点 E 对只读历史镜像生成了 32768-byte `-shm` 与 0-byte `-wal` sidecar；主库 SHA 未变、无残留进程。总控将其作为非阻塞测试残留接受，不声称已清理。
- 当前仅前三场景为 `active`；后七场景没有伪 Work。
- 未完成认证、TLS、外部 connector、客户数据、部署、生产运维与 P2 加固。
- 当前样例仍含英文业务内容；这已由用户明确提升为 P1 阻塞项，不再延期到后续阶段。

## 6. 当前本地运行状态

- 4178：前端，`prototype/p1-frontend/serve.mjs`。
- 4179：后端，使用 `integration/p1/runtime/p1.sqlite`。
- 4177：legacy 服务，未修改。

4178/4179 在 P1 收尾时保持 loopback 运行，供用户在 Codex 右侧继续查看。

## 7. P2 Gate

P2 尚未启动。只有用户确认 P1 当前产品表达后，才建立新的 P2 控制目标。建议 P2 优先处理：真实身份/认证边界、ScenarioPack 扩展与后七场景纵向闭环、外部 connector 的真实 Receipt、可靠性/安全/可观测性和中文业务语料一致性；不得把 P1 sample 证据升级为生产声明。

## 8. 最终项目需求清单：全中文展示（不可放宽）

本节是“见微-人机协同平台”的项目级硬约束，适用于当前阶段及后续所有版本、场景、页面和演示，不得由执行任务重新讨论或降级：

1. 所有用户可见文字必须使用简体中文，最终页面不得出现英文字母。
2. 项目名称固定显示“见微-人机协同平台”；阶段显示“第一阶段”，不得显示 `P1`。
3. 技术概念必须转为中文用户词：`Agent` 显示“智能体”，`Activity` 显示“协同动态”，`Projection` 显示“状态投影”，`Work` 显示“协同事项”，`Gate` 显示“人工关口”，`Receipt` 显示“执行回执”。
4. 后端可以保留英文代码标识、接口路径、字段名和枚举值，但所有进入用户可见投影的名称、标题、目标、角色、阶段、详情、矩阵文案、动态标题、动态正文和错误信息必须是中文。
5. 前端不得直接显示样例编号、工作区编号、内部权限枚举、错误码、英文状态、英文日期格式或其他技术标识；必须转换为中文用户表达。
6. 十个场景名称继续使用已冻结中文名称；三个可运行样例及后续新增样例的协同事项名称也必须是中文。
7. 普通消息、显式智能体接续、人工关口、交接、行动意图和执行回执产生的新动态必须持续输出中文，不能只翻译初始页面。
8. 空、加载、错误、冲突、无权、失败、未知和后端不可用状态必须全部使用中文，不能回退到英文原文。
9. 正式验收必须覆盖三个可运行场景和关系、进度、矩阵三视图；浏览器扫描全部可见 DOM 文本，英文字母匹配数量必须为零。
10. 四张正式 1920×1080 图片必须重新生成，页面不得包含英文；旧英文截图全部作废，不得继续作为最终展示证据。

代码、测试、接口和数据库内部使用英文标识不违反本要求；任何内部标识一旦进入用户可见页面，就必须先映射为中文。
