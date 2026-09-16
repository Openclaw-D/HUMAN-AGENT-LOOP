# MORNING_REPORT｜R2 A(北京时间 2026-09-13 晨)

任务:`V6/ZCODE_R2_A_20260913.md` + Goal `V6/ZCODE_GOAL_A_TO_0700_20260913.md`(09:00 覆盖)。批次:`V6/handoff/R2_MODEL_20260913/`。**所有候选仍待 Codex 复验与用户接受;未自认 visual_accepted;产品真实 API 调用 0。**

## accepted-candidate(本批已实测关闭,待 Codex 复验)

1. **在途零淘汰 + 明确背压**:registry 三分类淘汰(cached 最老→uncached 最老,in-flight 永不淘汰);满载 `failed/REGISTRY_AT_CAPACITY`(不静默/不挂起/不新增)。固定 seed 600 请求压力 + 容量 2/3 确定性枚举;mutant-C 反证可被抓。
2. **缓存/在飞结果重新验证**:cache-hit 与 join 返回前重跑快照核对;generation/contextVersion/paused 变化 → stale(数据保留供人工核对)。暂停→恢复→旧响应、证据修订→旧缓存、不同项目同文本隔离、重复回调冻结保护全部有测试。
3. **冻结证据输出隔离**:测试可变输出仅写 `runtime/`(`R2_MODEL_TEST_OUT_DIR` 可指定);`verify-frozen-hash` 退出码 0/1;冻结前后 hash 核验通过=复跑不改冻结源。
4. **确定性缓存语义细分(审计裁决)**:校验类失败才缓存;送出后失败/背压/预算拒绝不缓存,人工重试完整新调用。
5. **字段映射与失败关闭**:`product-mapping.mjs` + `FIELD_MAPPING.md`(产品字段带 文件:行号);fixtureId-only 拒绝;generation 缺失/0、contextVersion 三路皆无 → 失败关闭;七状态→产品动作表。
6. **账本不变量压力**:500 步固定 seed + 30 交错,committed/unknown_hold 永不 release、恒等式逐步成立、上限不破;ledger 实现零改动。
7. **provider 全路径补强**:悬空引用/未知 usage/部分失败/错误体 usage/dissent 透传,parse→validate→adapter→ledger 四层断言;官方格式来源复验一致;真实兼容仍 NOT TESTED。
8. **对抗体系**:协议套件 S1–S14(好实现零违规)+ mutation **7/7(分母 7)** + 独立审查(PASS-WITH-NOTES)且其补强全部落实。
9. **候选协议层(明确标注候选)**:dissent 异议保留聚合(异议丢失 0/越权决定 0)、点名提醒协议(仅授权上下文/普通事件不打断/重复合并/动作白名单仅 notify_human)、人工纠偏记录与预案样例(单例不触发规则替换;decidedBy 仅 human;无自动训练入口)。

## changes-required(自报,转 Codex/主任务)

1. **两项接入裁决**(主任务单 writer 决定,非 A 权限):产品 generation 初始 0 vs 协议正整数(+1 偏移或放宽协议);contextVersion 需主任务在同一 store 读取内取 `remoteVersion` 传入。
2. **审计遗留 NOTE**:聚合"跨结果同证据不同结论"只做显式 conflictsWith + dissenting×本结果 findings 的确定性冲突对,不做启发式语义冲突推断(刻意保守;如需更宽口径由主任务提出)。
3. R1 批次的 33 项 manifest 中 adversarial-results.json 失配问题:**本批已从机制上修复**(运行时目录隔离),但 R1 旧批次本身不回写、不改其冻结记录。

## deferred(本轮未做,非遗漏)

1. 真实 provider 端点联测(无凭据,产品调用 0 是硬边界)。
2. 真实模型推理质量(始终 NOT TESTED,归评估侧)。
3. 提醒/纠偏协议接产品事件流(候选层先行,事件 importance 标注属业务层)。
4. 性能仅报实测分布(0.25–0.35s/192 项),未做也不做 SLA 声明。
5. 独立审查 P3 之外两条候选取舍已按保守侧采纳(白名单外事件不进计划;authorizedContext 必须显式),如主任务要求相反语义需新批次。

## 运行事实

- 测试:192/192,退出码 0(`node test/run-all.mjs`);复跑两次结果一致。
- 并发:subagent 峰值曾尝试 6(超限全失败)→ 纠偏后退避,峰值 2,符合 Goal 覆盖;限流两次,均退避处理,未重试风暴。台账:AGENT_LEDGER.md。
- 边界:仅写 R2_MODEL 目录;旧批次与产品只读;未操作 Codex;未读取任何凭证;无 Git 写/新依赖/部署。
