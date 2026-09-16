# REPORT｜R2 任务C（评估盲点修复 → Goal 4 批量合成评估）

日期：2026-09-13。写面仅 `V6/handoff/R2_EVAL_20260913/`；R1 批次（64/64 哈希核对零改动）、产品代码、其他 lane 只读。真实模型调用 0、产品 API 调用 0、无 Git 写操作、未操作 Codex。

## 第一部分｜验收缺陷关闭（CODEX_REVIEW_FOUR_TASKS_20260913 C项）

| 验收发现 | 关闭方式 | 实测证据 | 状态 |
| --- | --- | --- | --- |
| collectRefs 漏 conclusions（c-conclusion-probe 引用0/critical无/exit0） | v2 schema（conclusions 可带 evidenceRefs）+ 三处统一收集；同一探针 R1/R2 对照复验 | evidence-r2/codex-probe-verify.txt：R1 exit0 → R2 `fabricated_citation` exit4 | **关闭** |
| 需全输出引用与分类报告 | citations.bySource + fabricated/stale/not-found/absent 分类明细（owner 定位） | evidence-r2/scorecards/ | **关闭** |
| 畸形输入需失败关闭 | validateCandidate 全面严格化；neg7/8/9 → exit 2 逐条中文错误，无崩溃 | evidence-r2/render-and-schema-failures.txt | **关闭** |
| 零分母不得完美 | critical `no_citations` + degenerate 标记；矛盾分母0→N/A | neg10 exit4；selftest 断言 | **关闭** |
| 新错误类别独立负控制、正确样例不误伤 | neg7–neg16（10个）：neg13 版本不存在、neg14 缺kind、neg15 前序越权、neg16 缺version（versionAbsent≥1 且"引用缺少版本号"路由进人工复核）+ R1 九正控/六负控全量回归 + 7 个场景正控 | selftest-r2 **109/109**（evidence-r2/selftest-r2-output.txt）；neg16 评分 evidence-r2/neg16-score.txt | **关闭** |
| 固定seed确定性；输出输入隔离 | 无随机源+双跑字节一致断言；输出只写 evidence-r2/ | selftest 末项；R1 MANIFEST 64/64 复核 | **关闭** |
| 演示改手机主视角 | MOBILE_DEMO_STORYBOARD.md v2 | 见第三部分 | **关闭（草案）** |

## 第二部分｜Goal 4 工作包（ZCODE_GOAL_C_TO_0700_20260913.md，09:00 收束版）

| 工作包 | 交付 | 验证 |
| --- | --- | --- |
| 1 conclusions/全字段/畸形/零分母/冻结输出 | 首轮已完成；SA-4 审计 2 处低危偏差（缺kind放行、evidenceRefs放松未文档化）本轮修复：kind 必填（缺失即 critical）、findings/questions evidenceRefs 必填、文档同步 | selftest 63/63 → 扩展后 109/109（含 neg16 缺版本负例）；METRIC_AUDIT.md 偏差2条均已关闭 |
| 2 场景族：生命周期/前序/人机冲突/意见并存 | SCN-3（前序pending仅预处理+起租75%后监控仍在）、SCN-4（人工纠正优先/新替旧异常/意见与行动并存）包+golden | pos 答案覆盖全绿（缺口3/3、矛盾1/1）；neg15 前序越权 exit4 |
| 3 场景族：语音扩展/会话归属/去重挂断 | EVT-2（否定词/单位纠偏）、SCN-1（会话归属≠说话人/仅本人控制）、SCN-2（提醒去重/挂断接续）包+golden | pos 答案覆盖全绿（缺口4/4、3/3、2/2） |
| 4 场景族：单例纠偏/跨案例反例/授权代办/模型自升 | SCN-5（case-scoped 纠偏/无授权全局规则/授权pending+模型自升权限矛盾）包+golden | pos 答案覆盖全绿（缺口3/3、矛盾1/1） |
| 5 metamorphic 测试 | tools/metamorphic-test.mjs：T1 语义改写（EXACT不变+PROXY允许下降——实证别名依赖）/T2 无关文字/T3 同源重复/T4 顺序变化/T5 版本替换翻转stale | **10/10**（evidence-r2/metamorphic-output.txt）；T4 曾抓到 factStatus 键序漂移真缺陷，已修复为顺序无关 |
| 6 接A标准结构、离线映射、独立坏例复验 | tools/map-adapter-to-candidate.mjs（失败关闭：非succeeded/simulated拒绝、缺version拒绝、simulated须显式notice）+ docs/A_ADAPTER_MAPPING.md + fixture | evidence-r2/adapter-mapping-evidence.txt 三态验证；独立坏例复验见 SCORER_ADVERSARIAL_REVALIDATION.md |
| 7 分镜v2 | MOBILE_DEMO_STORYBOARD.md v2：手机五段式（五行总览→业务全屏访谈→文字Agent辅助→纠偏/确认→挂断回聊天）；文字Agent带"模拟协作·authority=none"标识、输出须带证据引用；解说页画面—事件映射纪律 | 219行，v2修订记录10条在文末；三案例分镜表与EVT-1插播全保留 |

## 场景覆盖与分母

见 `SCENARIO_COVERAGE.md`（场景族/子场景正反边界映射/断言分层/人工未判/修复建议）。准确率类分母：引用存在率=exists/total；版本正确=versionMatch/(非historical)；缺口覆盖下界=matched/requiredTotal；矛盾覆盖=matched/expectedTotal（0→N/A）。**ADVISORY 线索与人工复核项无分母，不是准确率**。无综合信用分。

## METRIC_AUDIT 摘要（SA-4）

定义↔实现↔证据总体一致；2 处低危偏差（conclusion.kind 缺失放行、findings/questions evidenceRefs 放松未文档化）已在本轮修复并补 neg13/neg14 控制；version_not_found_as_current 原无专项负控——已补 neg13。详见 METRIC_AUDIT.md（SA-4 原文）。

## Subagent 并行（详见 AGENT_LEDGER.md）

9 路 subagent（SA-1..9），并发峰值 3（Goal 覆盖前）/ 2（覆盖后默认）；限流[1302] 3 次（SA-2/3 产出完整采信、SA-5 零产出由主agent补写），Goal 覆盖后降并发+退避。SA-7（六场景正例答案）、SA-8（分镜v2）、SA-9（独立坏例复验）见台账。额度读数不可得，如实记"未知"。

## NOT TESTED（如实）

- 真实模型质量（本轮调用 0；全部控制为人工样例）——**不以手写答案绿分冒称模型质量**。
- 真机 Safari（iPhone 17）、真实 ASR、真实视频、触控真机表现。
- 文字Agent辅助与五行总览为分镜设计，产品页面以主任务实际实现为准。
- 真实审批/生产鉴权/部署：未授权未触及。所有候选仍待 Codex 复验与用户视觉接受，本报告无 visual_accepted 判定。

## 恢复说明

全部命令在 `docs/manifest-meta.json` reproducibleCommands；评分确定性可复现（双跑字节一致）。R1 批次零回写（其 MANIFEST 仍有效）；A lane 批次零回写。mapping/metamorphic 的临时副本只写 evidence-r2/。
