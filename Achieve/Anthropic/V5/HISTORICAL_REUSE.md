# V5 历史经验复用索引

日期：2026-09-06。用途：为当前 B0 四项修订提供精确证据入口，减少重复探索。主干仍以根部 NORTH_STAR.md 和 V5 决定为准。

证据等级：本轮只读检查了以下源码、测试文本和材料导航，未运行旧代码/测试、未验证官方协议兼容性、未合并源码。资产完整性由归档交接报告提供，本轮未重算450文件哈希。“采纳”仅表示吸收符合现行契约的经验；模块和测试迁移均为 Candidate。

以下路径以 `materials/reusable-assets/20260906-archive/` 为起点，行号为本轮读取版本。

| 历史来源 | 可吸收经验/资产 | 对应当前问题 | 处置与理由 | 下一步最小验证 |
| --- | --- | --- | --- | --- |
| `01-stars-a2a/server/a2a-core.test.mjs` 中 `creates a new revision...`；`a2a-core.mjs:392` reconsiderContext | 新修订关联旧Context，原否决决定保留；修订具有来源链 | B0-1 局部纠偏不误伤 | 采纳“旧决定不覆盖”；整Context新建方案仅候选，未证明四域局部依赖失效 | 用“信审/商务受影响，政策/资产未受影响”的同一轨迹核对结果有效性；旧全局版本不等于结果必失效 |
| `01-stars-a2a/server/a2a-core.mjs:201` constructor/exportSnapshot；`store.mjs:4` loadSnapshot | 快照保存contexts与inbox，构造器从载荷恢复任务索引 | B0-2 哈希不能恢复输入 | 载荷恢复思路候选；不沿用catch后返回undefined的损坏处理，它混淆缺失与损坏 | 列出packet正文/不可变引用位置、版本与纠偏记录；空对话冷启动必须可重建，损坏显式报错 |
| `01-stars-a2a/server/a2a-core.test.mjs` 中 `supports A2A SendMessage...`；`server/http.test.mjs:58`；`README.md:23` | 消息身份/重复消息测试，协议入口与应用治理边界分开；README明确仅compatible subset、无TCK | B0-3 成熟A2A复用与互通路线 | 交互测试形态候选；旧实现不是官方SDK或互通认证，不能借此合理化再造协议 | 在当前官方固定版本下比较成熟adapter/SDK，分别标明本地状态测试、wire测试、独立对端互通证据 |
| `01-stars-a2a/server/a2a-core.test.mjs` 中 `preserves risk veto...`；`02-jw-backend/tests/agent_communication/test_orchestrator_and_api.py:405,527` | 任务completed可同时业务REJECTED；协作关闭不等于正式裁决；越权模型输出时权威表计数不变且不产生有效回复 | B0-4 Candidate不解锁正式前序 | 采纳状态与权威分离；固定risk-human标签不是生产身份校验，不照搬 | 对照任务状态/结果有效性/Human Decision三栏；Candidate齐备仍无Receipt时拒绝正式推进；检查更新与新增均未污染正式状态 |
| `02-jw-backend/evals/agent_communication/README.md`；`tests/agent_communication/test_group_chat_contract_matrix.py:260,467,522` | 引用限制在当前case；证据目标往返；源消息不匹配拒绝；Agent-only权威表零写入 | 差异输入、任务关联与来源约束 | 采纳验证意图，Python实现与旧路由为候选；allowlist不是“每域相关证据必须互不相同” | 定义四域可共享事实与相关证据边界；跨case/错source拒绝，正常共享不误拦 |
| `02-jw-backend/tests/evals/test_model_gateway_resilience.py:39,56,71,102` | 有限重试、超时转人工、限额前不发调用、熔断后受控恢复 | 有限触发与稳定接续 | 采纳失败验收维度；旧时长、次数和预算数字不移植 | 为同一任务列超限/超时/恢复轨迹，确定配置边界，不因失败无限自派工 |
| `02-jw-backend/tests/evals/test_model_gateway_dataset.py:29`；`evals/agent_communication/README.md` | provider输入与答案隔离；synthetic标识；流程契约评价与模型质量分开 | 比赛“又快又准”证据归因 | 采纳方法，旧分数与模型排名不沿用 | 保持输入、风险标准与对照条件可比；分别报告机制正确性、真实模型质量与协同效率 |
| 材料导航 `03-synthetic-cases` | 本地三个案例包作为材料候选 | 后续最小合成闭环 | 候选；168材料完整性为交接验证，非本轮效果验证 | 待具体缺口出现仅抽取一个适配新客回租的子集，保留synthetic标识；原完整索引列其他案例不算本地缺失 |

## 明确不沿用

- 旧三角色、单焦点、所有任务串行或角色自动回流等流程不能覆盖 V5 业务协调加四域受控并行。
- STARS 的固定人物标签、确定性策略与自报A2A版本不构成生产权限、模型能力或当前标准事实。README与HANDOFF冲突时保留不确定性，以代码/测试和后续官方核验区分。
- 全Context修订不能直接解决任务级纠偏；完整快照也不自动意味着事务可靠或防上下文污染。旧store的缺失/损坏混同是需避免的反例。
- 旧真实provider失败不得伪回退synthetic的经验继续适用；旧CLI/provider运行脚本不构成调用或更换平台授权。
- 展示PPT、TQ交互资料当前不加载，避免新增视觉支线；私有冷备无具体本地缺口不下载，不重开旧项目。

## 当前最小检查点

后续修订 B0 候选时，针对四项审查逐项给出：旧经验来源 → 适用/不适用 → 新接续轨迹 → 可复现断言。重点以同一事件展示一次局部纠偏、未受影响结果继续有效、完整输入冷恢复，以及无人工Receipt时不正式放行。

本索引补充证据，不替代 [B0审查](backend/B0_CODEX_REVIEW.md)，四项问题均未因发现历史资产而关闭。本轮不派工、不启动B1。

检索纪律：先读本表的一行，再打开对应源码/测试；不要把历史契约全文带入每轮上下文。归档清理的transfer临时目录已由用户收尾，不作为当前待办；精确收尾记录见 CONTEXT_LOG.md 的归档交接条目。
