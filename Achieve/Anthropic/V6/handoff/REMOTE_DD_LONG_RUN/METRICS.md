# METRICS｜REMOTE_DD_LONG_RUN（实测值或 NOT TESTED，不发明合格线）

startedAt 2026-09-12 23:31；测量时间 2026-09-13 01:35。全部为合成隔离数据；真实模型调用=0。

## 缺口/矛盾发现

- **NOT TESTED（真实模型准确率类）**：发现/漏报/误报统计需要真实模型对合成案例推理；本轮无凭证（modelCalls=0），确定性 SIMULATION stub 的"追问"来自固定表，不构成发现能力证据，不伪称。
- 已实现的可测基础：问题绑定（annotation.evidenceId + evidenceVersion + 归一化 rect）；悬空标疑在服务端被拒（R4 回归：NOT_FOUND）；证据版本不符 409（R4）。

## 证据可追溯

- **不存在的引用数（本轮用例门）= 0**：服务端校验 annotation.evidenceId 必须存在于同一会话（R4：悬空 → NOT_FOUND；R7：跨会话 → NOT_FOUND）；每个证据带 sha256 + fixtureId + capturedAt/receivedAt 分列。
- hash/截图证明拍摄现场真实性：**不伪称**（合成图形 + sha256 仅作完整性线索）。

## 人工可控

- 人可纠正/补证/暂停：复核动作 confirm/correct/request_resupply/request_retake/pause_round/escalate_human 全部实现并有回归（R6）；pause_round → 会话级 paused 实测。
- 资料变化使旧确认过期：重拍取代链 → 旧证据 expired=true（R8）；旧确认不自动继承（确认绑定 targetVersion）。
- 无模型自动批准路径：模型回复 kind=model_simulation、author 标注 authority=none；非法 kind（auto_approve）400（HTTP 矩阵 F3）；阈值未配置 → 无可执行建议。

## 状态可靠

- 重复提交不重复写：R3（证据）/故障矩阵 F1（标注）幂等重放实测。
- 旧回执不污染新会话：R7 跨会话 NOT_FOUND；陈旧回执静默（stale 分支）。
- 刷新/重启恢复：故障矩阵 phase2（重启后会话/证据/标注存活）+ rows 域既有恢复机制复验 64/64。
- 预期一致性：全部写路径 requestId 幂等 + expectedVersion OCC（409+serverVersion）。

## 风险/经济性边界

- 阈值未配置 → `not_configured` + 所需输入清单（R10/UI 实测），未知值不是 0。
- 负收益 fixture（测试输入）→ `blocked`："负收益方案不推荐执行（测试输入，非实际核算）"（R10/HTTP smoke）。
- 正收益 fixture → `ready_for_review` + "仍不能放行"（阈值未配置）（R10）。
- 非 test_fixture 来源输入 → 400 拒绝（不让业务侧未经口径确认提交数值）。
- NOT TESTED：真实定价/资金成本/损失率（明确不做，等业务 owner 确认口径）。

## 协作效率（同一会话实测，合成）

- 完成一次"证据附着→圈选提问→模拟追问→业务回复→人工确认"闭环的人工动作数：**5 次点击 + 2 次输入**（附着、打开、圈选拖拽、提问文本+提交、确认复核）。
- 澄清轮次：标注→模拟追问 1 轮（每标注一轮，确定性）；重复提问计数机制=回复列表长度（可在 UI 直接观察）。
- 实测延迟（本机 dev，非模型开销）：附着→确认各 ~150ms 内返回；模型步骤 0ms（stub，无调用）。真实模型延迟 NOT TESTED。
- 与传统流程对比（六分钟演示类）：**NOT TESTED**（需明确案例与录制，不在本轮范围）。

## 可用和可接手

- 一套页面双端：390×844 等效视口（429×928 实测）与 1920×1080 均无横向溢出（412≤429 / 1920≤1920）；返回路径、关键问题、复核入口在两端可达（截图 p1-meeting-desktop.png / p2-remote-session-mobile.png）。
- 说明/运行/恢复：REPORT.md §运行方式与恢复。
- NOT TESTED：真实多用户并发（身份未配置，失败关闭）；真机软键盘。
