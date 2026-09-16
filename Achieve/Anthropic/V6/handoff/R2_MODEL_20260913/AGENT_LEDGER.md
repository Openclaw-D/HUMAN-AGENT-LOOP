# AGENT_LEDGER｜R2 A(2026-09-13,北京时间)

授权来源:`V6/ZCODE_GOALS_TO_0900_20260913.md`(默认 2 个、最多 3 个并行 subagent,限流退避降并发)。本表记录全部 subagent 派发(含失败)与主线程工作;输入 hash 基线:`evidence/r1-baseline-input-hashes.txt`(R1 拷贝基线);额度/资源消耗平台未暴露精确计量,按"未知"如实标注,仅记录可见的运行事实。

## 派发台账(时间均为北京时间)

| # | 时刻 | Agent | 目标 | owner 文件 | 并发 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ~03:03 | Agent-DEDUPE(1轮) | registry 容量安全淘汰 | src/dedupe.mjs + 04 + 10 | 6(超限) | 执行后被取消;**工作已落地**(dedupe 重写+04+10 完成) |
| 2 | ~03:03 | Agent-TESTINFRA(1轮) | 运行时输出/S11-S14/mutation/hash 工具 | helpers/contract-assertions/run-all/09/verify-frozen-hash/gen-manifest | 6(超限) | 执行后被取消;**工作已落地**(全套完成) |
| 3 | ~03:03 | Agent-LIFECYCLE(1轮) | 缓存复核/capacity 消费 | src/adapter.mjs + 06 + 11 | 6(超限) | 立即 1302 限流,无产出 |
| 4 | ~03:03 | Agent-LEDGER(1轮) | 账本不变量压力 | 12 | 6(超限) | 立即 1302 限流,无产出 |
| 5 | ~03:03 | Agent-PROVIDER(1轮) | fixture 复验 | providers/fixtures/08 | 6(超限) | 立即 1302 限流,无产出 |
| 6 | ~03:03 | Agent-MAPPING(1轮) | 产品字段映射 | integration/FIELD_MAPPING/13 | 6(超限) | 立即 1302 限流,无产出 |
| 7 | ~03:41 | Agent-DEDUPE(2轮) | 同 #1 | 同 #1 | 2 | 1302 限流,无产出(#1 已完成同等 工作) |
| 8 | ~03:41 | Agent-LIFECYCLE(2轮) | 同 #3 | 同 #3 | 2 | 执行后被取消;**工作已落地**(adapter 修改+06+11 完成) |
| 9 | ~04:03 | Agent-MAPPING(3轮) | 同 #6 | 同 #6 | 2 | **成功**:25/25,FIELD_MAPPING 含产品字段定位(文件:行号) |
| 10 | ~04:03 | Agent-LEDGER(3轮) | 同 #4 | 同 #4 | 2 | **成功**:6/6(合跑 14/14);ledger.mjs 未改;500 步固定seed压力 |
| 11 | ~04:45 | Agent-DISSENT | 异议保留候选结构(Goal 工作包4) | validate-response/aggregate/03/14 | 2 | **成功**:28/28;全量当时 166/166 |
| 12 | ~04:45 | Agent-PROTOCOL | 提醒协议+纠偏预案(工作包5/6) | reminders/human-feedback/15/PROTOCOL_NOTES | 2 | **成功**:15/15 |
| 13 | ~05:20 | Agent-PROVIDER(2轮) | 同 #5 | fixtures/08 | 1 | **成功**:24/24;全量 191/191;providers 实现未改 |
| 14 | ~05:45 | Agent-AUDIT | 独立审查对抗有效性(工作包7) | 仅 AUDIT_REPORT.md + runtime/audit-* | 1 | **成功**:PASS-WITH-NOTES;独立构造 4+ 坏实现全部被抓;发现 4 套件漏洞+1 语义矛盾 |

**并发峰值**:第 1 轮 6(违反后见覆盖条款,全部失败);此后峰值 2,符合"默认 2、最多 3"。**限流事件**:#1–#8 期间账户 1302 两次;处置=退避约 20 分钟并降并发至 2,未重试风暴、未嵌套绕过。

## 主线程(串行)工作

- 接手与基线:R1→R2 拷贝 + 输入 hash 记录;STATUS 接收记录(含 Goal 增量);INTERFACE_R2.md 接口冻结;codes.mjs 共享常量(REGISTRY_AT_CAPACITY、DETERMINISTIC_ERROR_CODES)。
- 整合修复(接管已终止 agent 的文件后):lookup 只读语义(违规接口冻结的副作用淘汰)、10 测试两步语义修正、09 烟测样本重名/锚点结构修正、mutant-C 变异副本 import 改写。
- 审计修复(P1):S1 deduped 负向断言、S1b 显著标记断言、S8/S12 stale 数据保留+错误码非空、S3–S6 无守卫式错误码断言。
- 审计裁决(P3):`failed` 缓存语义细分——新增 DETERMINISTIC_ERROR_CODES,校验类失败才缓存,送出后失败/背压/预算拒绝不缓存(可人工重试);04 新增回归用例。
- P2:mutant-D 影响面描述如实化; dissent 透传行(adapter.mjs);全套文档与冻结。

## 最终数字

- 测试:**192/192 通过**(`node test/run-all.mjs`,~0.35s,退出码 0)
- mutation:**7/7 被抓(分母 7:mutant-A/B/C/D + wrapper-E/F/G),好实现 S1–S14 零违规**(runtime/<最新>/adversarial-results.json;独立审查复核为真)
- subagent 可见资源:平台未暴露 token/额度计量——**未知**;仅上表时长/结果为真实记录

## 未测范围(与 REPORT 一致)

真实模型推理质量、真实 OpenAI 形状网关与 Dify 1.13.x 端点兼容、真实产品 store 端到端集成(FIELD_MAPPING 声明)、产品 API 真实调用(本轮 0)。
