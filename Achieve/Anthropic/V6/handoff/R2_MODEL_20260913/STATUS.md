# STATUS｜R2 A:模型调用并发与可集成性(2026-09-13)

**状态:IN_PROGRESS(执行中,Goal 增量已接收)——完成后更新为 READY_FOR_REVIEW 并冻结。**

- 执行者:ZCode(R2 任务 A)
- 任务书:`V6/ZCODE_R2_A_20260913.md`;协调入口:`V6/ZCODE_FOUR_TASKS_ROUND2_20260913.md`;验收依据:`V6/CODEX_REVIEW_FOUR_TASKS_20260913/REPORT.md`
- **Goal 增量已接收(03:31 北京时间)**:`V6/ZCODE_GOALS_TO_0900_20260913.md` + `V6/ZCODE_GOAL_A_TO_0700_20260913.md`。截止北京时间 2026-09-13 **09:00**(08:30 冻结新增范围,08:50 晨报收束);**每任务默认 2 个、最多 3 个并行 subagent,限流退避降并发,不重试风暴**;本文件替代早前"六 agent 一次性并行"计划(该轮 6 路全部因账户限流未启动,无任何 R2 修改落地,src 仍为 R1 基线)。
- 写入范围:仅 `V6/handoff/R2_MODEL_20260913/**`。R1 交付与产品代码只读;R1 拷贝为演进基线(输入 hash 见 `evidence/r1-baseline-input-hashes.txt`),旧批次原样保留。
- 真实产品 API 调用:**0**;不读取/复用 Codex/ZCode 凭证;不操作 Codex;无 Git 写操作、无新依赖。

## 接手确认:本轮要修的三类 R1 缺陷(Codex 验收点名)

| # | R1 缺陷 | R2 修复方向 | Owner(subagent) |
| --- | --- | --- | --- |
| 1 | RequestRegistry 容量淘汰会删除**在途**请求条目(probe 以容量2复现:在途 a 被淘汰后同ID变 register,破坏在途去重) | 只淘汰可安全终结条目(settled-cached 优先);全不可淘汰时明确背压(REGISTRY_AT_CAPACITY),不静默、不无限增长 | Agent-DEDUPE |
| 2 | 已完成缓存返回不复核当前上下文(会话推进后仍可能以 succeeded 呈现旧结果) | cache-hit 与 in-flight join 均重新执行快照核对,变化 → stale | Agent-LIFECYCLE |
| 3 | 测试运行回写冻结证据(Codex 复跑测试时 adversarial 测试重写 evidence/adversarial-results.json 与 mutants,导致 manifest hash 不匹配) | 测试输出只写运行时目录(`R2_MODEL_TEST_OUT_DIR` 环境变量可指定,缺省 `runtime/`),复跑不改冻结源;交付前后 hash 核验工具 | Agent-TESTINFRA |

## 并行执行计划(原生 subagent,每文件唯一 writer)

接口冻结见 `INTERFACE_R2.md`(共享 schema 先冻结,整合串行)。六个实现 agent 并行:

| Agent | 唯一写入文件 | 目标 |
| --- | --- | --- |
| Agent-DEDUPE | src/dedupe.mjs, test/unit/04-*.test.mjs, test/unit/10-capacity-*.test.mjs | 容量安全淘汰 + 背压 + 固定seed随机调度 + 512+ 请求 |
| Agent-LIFECYCLE | src/adapter.mjs, test/unit/06-*.test.mjs, test/unit/11-cache-validity-*.test.mjs | 缓存/在飞返回复核当前上下文;capacity 消费;组合场景(暂停/恢复/版本更正/迟到/unknown/重复回调) |
| Agent-LEDGER | test/unit/12-ledger-invariants-*.test.mjs(账本实现仅确认,如需改动只在本文件授权范围) | 预算未知释放 0 的并发混合不变量压力(固定 seed) |
| Agent-PROVIDER | src/providers/*.mjs, src/fixtures/*.mjs, test/unit/08-*.test.mjs | 官方格式复核 + fixture 补强(错误形状/usage 传播) |
| Agent-TESTINFRA | test/helpers.mjs, test/contract-assertions.mjs, test/run-all.mjs, test/unit/09-*.test.mjs, tools/verify-frozen-hash.mjs | 运行时输出目录、S11–S14 新场景、mutation 框架(捕获率/分母)、hash 核验 |
| Agent-MAPPING | src/integration/product-mapping.mjs, FIELD_MAPPING.md, test/unit/13-mapping-*.test.mjs | 与主产品 session/evidence/generation 逐项映射,缺字段失败关闭(产品源码只读) |

第二批:Agent-DOCREVIEW(文档一致性核验,读全部交付)。整合与冻结由主线程串行完成(全量测试、mutation 报告、REPORT/MANIFEST/AGENT_LEDGER、hash 前后核验)。

## 指标对账(任务书 5 项)

1. 容量饱和在途淘汰 0;同ID并发 transport 恰 1;变载荷拒绝 100%;容量不足明确背压 — DEDUPE/TESTINFRA
2. 组合场景旧结果当现行 0;unknown 自动重试 0;预算未知释放 0;缓存返回复核上下文 — LIFECYCLE/LEDGER
3. 字段映射逐项列明、缺字段失败关闭、状态语义统一 — MAPPING
4. 正负控制 + mutation 抓新缺陷,报捕获比例/分母 — TESTINFRA
5. 测试输出 R2 目录、复跑不改冻结源/manifest、前后 hash 核验;provider 仍 fixture 验证;真实调用 0 — TESTINFRA/PROVIDER

## 完成补记(08:50 收束前填写)

**状态:READY_FOR_REVIEW(本批文件自 MANIFEST.json 再生成时刻起冻结)。**

- 最终测试:**192/192 通过**(`node test/run-all.mjs`,退出码 0;零网络/端口/真实模型调用)。
- mutation:**7/7 被抓(分母 7)**,好实现 S1–S14 零违规;独立审查(AUDIT_REPORT.md)结论 **PASS-WITH-NOTES**,其发现的 4 项套件逃逸与 1 项 R1 遗留语义矛盾已全部修复并回归。
- Codex 三项点名缺陷(在途淘汰/缓存复核/测试回写冻结证据)全部实测关闭;Goal 工作包 1–7 全部交付(5/6 为候选协议层)。
- 指标:同ID并发调用恰1、在途淘汰0、unknown自动重试0、未知费用释放0、暂停/过期被采信0、异议丢失0(聚合结构+测试)、越权决定0(pendingDecisions 无决定性字段+越权拦截)。
- 冻结核验:`node tools/verify-frozen-hash.mjs` 冻结前后各一次,退出码均 0(复跑不改冻结源);证据见 evidence/hash-verify-*.txt。
- 交付清单:STATUS/REPORT/MANIFEST/AGENT_LEDGER/ADAPTER_CONTRACT/INTEGRATION/FIELD_MAPPING/PROTOCOL_NOTES/AUDIT_REPORT/MORNING_REPORT + src/test/tools + evidence(原始输入hash、运行日志)。运行时可变产物在 runtime/(不入冻结清单)。
- 未完成/转下一批:真实 provider 端点联测(无凭据)、generation 起点与 contextVersion 供给的两项主任务裁决(见 INTEGRATION §3)、协议层接产品事件流。
