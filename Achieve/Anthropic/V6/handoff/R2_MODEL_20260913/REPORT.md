# REPORT｜R2 A:模型调用并发与可集成性(2026-09-13)

任务书:`V6/ZCODE_R2_A_20260913.md`;协调:`V6/ZCODE_FOUR_TASKS_ROUND2_20260913.md`;验收基线:`V6/CODEX_REVIEW_FOUR_TASKS_20260913/REPORT.md`;Goal:`V6/ZCODE_GOAL_A_TO_0700_20260913.md`(09:00 覆盖)。执行台账见 `AGENT_LEDGER.md`;交付状态见 `STATUS.md`。

## 1. Codex 三项点名缺陷的修复(全部实测关闭)

| # | R1 缺陷(Codex probe) | R2 修复 | 证据 |
| --- | --- | --- | --- |
| 1 | RequestRegistry 容量淘汰删除**在途**条目(容量2复现 a/b/c 后 a 变 register) | 淘汰仅限 cached 最老→uncached 最老;in-flight 任何情况不淘汰;满且无可释放 → 显式背压 `failed/REGISTRY_AT_CAPACITY`;lookup 只读、track 执行 | test/unit/10(小容量 9 组合确定性模型+容量3 场景+固定seed 600 请求)、协议 S11/S13;mutant-C(把锚点判定变异为可淘汰在途)被 S11 抓住=修复可被反证 |
| 2 | 同ID改载荷/在途变 paused 仍返回 ok(主任务 probe 语义) | cache-hit 与 in-flight join 返回前**重新快照核对**→ stale;payload 含 projectId/contextVersion,变载荷→REQUEST_MISMATCH | test/unit/11(交错矩阵)、协议 S12;mutant-D(短路复核)被 S8+S12 抓住 |
| 3 | 测试回写冻结证据(Codex 复跑致 manifest 不匹配) | 一切测试可变输出仅写运行时目录(`R2_MODEL_TEST_OUT_DIR` 可指定,缺省 `runtime/`,不入 MANIFEST);`tools/verify-frozen-hash.mjs` 退出码 0/1 | 本批冻结后复跑测试+前后 hash 核验(见 §5 与 evidence/) |

## 2. 指标对账(任务书 5 项 + Goal 验收指标)

| 指标 | 结果(实测) |
| --- | --- |
| 容量饱和在途淘汰 0;同ID并发 transport 恰 1;变载荷拒绝 100%;容量不足明确背压 | 通过(10:固定 seed=42 LCG、600 请求、混合新ID/重复/变载荷;每组合查调用计数与保留状态;容量2/3 确定性枚举) |
| 暂停/恢复/版本更正/迟到/unknown/重复回调组合:旧结果当现行 0;unknown 自动重试 0;预算未知释放 0;已完成缓存返回复核当前上下文 | 通过(11 交错矩阵:每组合断言 transport 计数+ledger 状态,不只测结果字符串;12:500 步固定 seed=1337 压力+30 交错,unknown_hold/committed 永不 release 成功) |
| 字段映射逐项列明;缺字段失败关闭;不把 fixtureId 当完整证据;状态语义统一 | FIELD_MAPPING.md(产品字段带 文件:行号 定位:remote-types.ts:61-81/44-55、remote-store.ts:158-177/289-294 等)+ src/integration/product-mapping.mjs(25 项测试);generation 缺失/0 → 失败关闭;contextVersion 供给路径三选一皆无 → 失败关闭 |
| 正负控制及 mutation 抓新缺陷;只报捕获比例和分母 | **mutation 捕获 7/7(分母 7)**:mutant-A(悬空检查)/B(越权拦截四处)/C(淘汰判定)/D(缓存复核短路)+ wrapper-E(unknown 自动重试)/F(缺usage记0释放)/G(缓存 stale 冒充现行);好实现 S1–S14 零违规;**独立审查(AUDIT_REPORT.md)结论 PASS-WITH-NOTES**,其 4 项套件补强与 1 项语义裁决已全部落实(见 §3) |
| 测试输出指定目录;复跑不改冻结源/manifest;前后 hash;provider 仍 fixture 验证;真实调用 0 | 见 §5;providers 实现未改,fixture+9 个派生变体,parse→validate→adapter→ledger 四层全路径断言;**产品真实 API 调用 0** |

## 3. 独立审查结论与处置(AUDIT_REPORT.md,PASS-WITH-NOTES)

审查者独立构造 4+ 个交付方未写的坏实现(广谱 stale 改标、账本说谎、snapshot 伪造、unknown 谎称 failed)——**全部被抓**;报告诚实性属实。发现并处置:

| 审计发现 | 处置 |
| --- | --- |
| 无条件虚报 deduped:true 逃逸 | S1 补 `deduped===false` 负向断言 ✅ |
| simulated 删除显著标记逃逸 | S1b 补 mode+中文 notice(含 SIMULATED)断言 ✅ |
| stale 清空数据逃逸 | S8/S12 补 findings 保留+error 非空断言 ✅ |
| failed 置 null 绕过守卫式断言 | S3–S6 改无守卫式(expectErrorCode)✅ |
| R1 遗留:`CACHED_STATUSES` 含 failed 与注释矛盾 | **语义裁决**:新增 DETERMINISTIC_ERROR_CODES,校验类失败才缓存;送出后失败/背压/预算拒绝不缓存(人工核实后同ID同载荷重试=完整新调用);04 新增回归用例 ✅ |
| mutant-D 影响面描述 | 已如实标注(同时中和返回时核对)✅ |

## 4. Goal 工作包交付(4/5/6/7)

- **工作包4 异议保留(候选)**:`validate-response` dissent 校验(position/text/引用/越权)+ adapter 透传;`aggregate.mjs`:dissent 全量保留(参数也滤不掉)、问题 text 精确去重保留 sources、引用证据或 mustResolve 追问进 unresolvedQuestions、pendingDecisions 只列冲突双方无决定性字段。测试 03+14。
- **工作包5 提醒协议(候选)**:`reminders.mjs` R1–R9(仅授权上下文/普通事件不打断/白名单外降级/点名例外/重复合并/跨批继承/动作白名单仅 notify_human/确定性/失败关闭)。
- **工作包6 纠偏预案(候选)**:`human-feedback.mjs`(decidedBy 仅 human;'model' → TypeError;单例不触发规则替换四条件;预案四要素 status 恒 awaiting_human_decision,无自动训练入口)+ PROTOCOL_NOTES.md 样例两则。
- **工作包7**:provider fixture 复验(官方来源注释逐条核对一致)+ 全路径补强 + 独立审查(本表 §3)。

## 5. 复现与冻结核验(实测)

```bash
cd V6/handoff/R2_MODEL_20260913
node test/run-all.mjs            # 192/192 通过,退出码 0,~0.35s,零网络/端口/真实调用
node tools/verify-frozen-hash.mjs # 冻结后复跑测试前后各执行一次:两次退出码均 0 = 复跑未改任何冻结文件
```
- mutation 报告:`runtime/<运行时目录>/adversarial-results.json`(每次运行生成于运行时目录,非冻结区)。
- **性能实测分布**:全套 192 项 0.25–0.35s(Node v22.23.1,win32);未做基准优化,不宣称 SLA。
- 冻结与核验流程(实测):① 单次全量输出定格于 `evidence/test-run-final.txt`(退出码 0);② `gen-manifest` 冻结;③ 复跑全量(只写 runtime/,退出码 0);④ `verify-frozen-hash` 输出 `runtime/verify/verify-after-rerun.txt`:46/46 匹配、退出码 0 = **复跑未改任何冻结文件**。核验输出属运行时产物,入 runtime/verify/ 而非 evidence/,避免复写冻结区。

## 6. NOT TESTED 与边界

真实模型推理质量;真实 OpenAI 形状网关与 Dify 1.13.x 端点兼容(mock 只证明协议);真实产品 store 端到端集成;提醒/纠偏协议未接产品事件流;越权批准词表为启发式(最终防线 authority=none);**产品 API 真实调用 0**;未读取/复用任何 Codex/ZCode 凭证;未操作 Codex;无 Git 写操作、无新依赖。所有候选结构(dissent 聚合/提醒/纠偏)仍待 Codex 复验与用户接受,不自认 visual_accepted。
