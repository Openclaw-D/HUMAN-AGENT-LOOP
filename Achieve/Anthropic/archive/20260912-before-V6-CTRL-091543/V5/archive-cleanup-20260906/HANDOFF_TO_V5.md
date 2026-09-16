用户明确要求将归档项目的背景和经验交接给你（V5-RISK），请现在对照当前主线梳理并吸收到本地项目上下文，避免把历史经验全部忽略。用户希望专注一个项目、减少无效 token 消耗。本次授权是历史经验整理与文档整合，不是启动 B1、重开旧项目或更换产品方向。

工作区：C:\Users\22673\Desktop\Anthropic。
先读当前 DECISIONS.md、NORTH_STAR.md、V5/CONTRACT.md，以及你已有的 V5/backend/B0_CODEX_REVIEW.md；当前主线是成熟 A2A 复用、人机协作、上下文接续与条件触发。历史只能提供证据与复用候选，不能自动覆盖用户已接受主干。

已完成归档与当前入口：
1. 精选 450 个文件约104MB已从原 Desktop/Archive 迁入 materials/reusable-assets/20260906-archive/，全部通过 SHA256 校验。先读该目录 README.md，按需检查下列少量入口，不全量读取450文件。
2. 01-stars-a2a/：server/a2a-core.mjs、store.mjs、a2a-core.test.mjs、http.test.mjs、src/a2aClient.ts、docs/A2A-ARCHITECTURE.md。可调查任务/消息/产物、持久化、人工 Gate 和协议交互经验。历史 README 自述仅 A2A-aligned compatible subset、未通过官方 TCK；旧 HANDOFF 与 README 状态有冲突，代码及测试要独立核验，不把旧架构文档的版本描述当当前官方事实。
3. 02-jw-backend/：历史 app、tests、docs、evals。其中 evals/agent_communication 及 tests/agent_communication 记录引用 allowlist、Agent 对权威表零写入、缺件转补件/人工复核、provider 失败显式失败且不伪回退 synthetic。evals/model_gateway 与 tests/evals 记录输入/答案隔离、预算上限、有限重试、限流、熔断与恢复。旧三角色/单焦点机制不直接套入 V5 四域受控并行。
4. 03-synthetic-cases/：仅本地保留 project-01/02/03，168份材料的 synthetic 标记和 manifest SHA256已核验。原 package-index.json仍列出全部旧案例；不要把未本地保留的条目当文件缺失缺陷。可用于后续最小闭环验证，不代表真实客户资料或模型效果。
5. 04-presentation/ 与 05-tq-demo/：可编辑展示资料与轻量并行/人工闸门交互参考。只按需要借鉴表达，不能反向定义产品，也不新增视觉工作。
6. 其余历史资产在私有只读 GitHub 库 https://github.com/Openclaw-D/archive-legacy-projects-20260906 ，Release snapshot-20260906。5681条原路径、2742个去重文件、10分包约1.19GB；恢复校验及远端SHA256已通过。冷备是工作目录快照，不含完整旧Git历史。无具体本地缺口时不要下载整库。
7. 清理结果与证据：V5/archive-cleanup-20260906/RESULT.md、retained-receipt.json、remote-verification.json。用户已手动收尾清理；本轮确认 Archive-transfer-20260906已不存在。不要把 RESULT 的历史“临时目录待清理”继续当待办。录音已删除，用户另有存档，不要求恢复录音。

希望吸收的经验（先核对证据，再给出适用结论）：
- 清理旧项目不等于丢弃已有评测、失败路径和可复用逻辑；先查最小相关资产，避免重复造轮子。
- Human保有authority，Agent始终authority=none；Candidate、事实和正式审批/Gate必须分开。
- 验证协作机制与评价模型质量要分开；synthetic或fake通过不等于真实模型能力。
- 把失败、缺件、限额、重试和恢复写进验收；当前B0的四项问题尤其要保持可见：局部纠偏不误伤未受影响任务、哈希不替代可恢复输入、成熟A2A互通复用路线、Candidate不等于正式前序放行。
- 这些历史模块是候选证据，不宣称本次已运行或适配V5；我这次验证的是资产完整性和恢复性。

请完成一个有界文档检查点：
A. 形成一张简短“历史来源 → 可吸收经验/资产 → 与V5当前问题的关系 → 采纳/候选/不采用及理由 → 下一步验证”的映射，特别对齐上述B0四项审查问题。
B. 将有证据且不改变现行主干的经验，合并到现有V5上下文/相关候选文档和材料导航；必要时新增一份V5历史复用说明并从现有入口链接。不要复制全部历史契约或新建第二套North Star。产品取舍如需改变主干，明确留Candidate给用户，不静默冻结。
C. 给用户简洁回报：吸收了什么、明确不沿用什么、解决当前哪个问题、剩下哪个最小检查点。合并的是经验与文档，不是直接合并旧源码。
D. 不执行代码改版、安装、部署、Git提交、外部模型调用或ZCode派工；不触碰ZCode ownership。完成此检查点后停止。

这条消息由用户明确授权从归档整理对话发送。你负责后续V5文档整合；发送方记录交接后不再同时写共享上下文。
