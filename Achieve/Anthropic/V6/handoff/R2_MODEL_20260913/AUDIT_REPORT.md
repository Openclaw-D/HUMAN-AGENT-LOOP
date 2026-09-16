# AUDIT_REPORT｜R2 任务A 对抗测试独立审查(Agent-AUDIT,2026-09-13)

- 审查者:Agent-AUDIT(独立 subagent,非实现者;只读交付源码与测试,零修改)
- 审查对象:`V6/handoff/R2_MODEL_20260913`(S1–S14 协议断言套件 + 09 对抗测试 + mutation 框架)
- 交付方声称:mutation 捕获 7/7(分母 7 = mutant-A/B/C/D + wrapper-E/F/G);好实现 S1–S14 零违规
- 审查方式:全部实际执行,不接受自报。审计脚本与临时文件仅在 `runtime/audit-20260913-agent-audit/`

## 结论:**PASS-WITH-NOTES(对抗有效,有待改进项)**

交付方声称的三项核心事实全部独立复现为真,报告诚实;任务书建议的三类坏实现(缓存复核短路 wrapper / stale 改标 succeeded / 账本 unknown 释放)全部被抓。另以 4 个定向探针找到 4 个**协议元数据层的逃逸坏实现**(不改变七状态语义方向、不触碰 R1 点名的危险缺陷类),列为应修改进项,不构成 FAIL。若验收方认定"deduped 虚报 / simulated 标记缺失 / stale 数据清空 / 失败错误码丢失"属于必须防御的缺陷类,可升为 FAIL——裁量依据见下文逐条实证。

---

## 1. 实际运行结果(本机复跑,node v22.23.1 / win32)

| 项 | 结果 |
| --- | --- |
| 命令 | `node test/run-all.mjs`(复跑 2 次) |
| TAP 汇总 | `# tests 191 / # pass 191 / # fail 0 / # cancelled 0 / # skipped 0` |
| 退出码 | **0**(两次一致;第二次用重定向捕获真实退出码,避免管道掩盖) |
| 复跑产物 | `runtime/2026-09-12T21-24-02-881Z-pid27976/`、`runtime/2026-09-12T21-24-13-794Z-pid14768/`、`runtime/2026-09-12T21-24-13-979Z-pid16924/`(套件固有行为;`evidence/` 未被触碰,仍只有 `r1-baseline-input-hashes.txt`) |
| 复跑 adversarial-results.json | 与冻结产物 `runtime/2026-09-12T21-20-40-836Z-pid27220/adversarial-results.json` **逐字段一致**(injected 7 / caught 7 / ratio 7/7 / goodImplViolations 0;各缺陷 caughtBy 完全相同)→ 结果可复现,非一次性快照 |

## 2. 独立复演的坏实现(交付方未写,均实际喂给 `runProtocolSuite`)

脚本:`runtime/audit-20260913-agent-audit/badimpls.mjs`(BAD-1..5 + 好实现对照)、`badimpls2.mjs`(BAD-6..8 定向探针)。

| ID | 坏实现描述 | 与交付方 7 个注入的差异 | 抓捕结果 |
| --- | --- | --- | --- |
| AUDIT-BAD-1 | **广谱 stale 改标 succeeded**:不限 deduped,连在飞 join/首跑返回的 stale 也改标(wrapper-G 只改 deduped:true 的) | 更广于 wrapper-G | **抓住:S8+S12**(2 违规) |
| AUDIT-BAD-2 | **账本层说谎**:给 deps 注入 `holdUnknown` 被偷换为 `commit(0)` 的账本——"预算未知释放 0"。与 wrapper-F 不同:结果字段完全正常,只有账本说谎 | 不同机制(wrapper-F 在结果层包装;本例污染依赖注入面) | **抓住:S7+S10**(`unknownHoldTokens<=0` 的账本断言起效) |
| AUDIT-BAD-3 | 探针:**无条件虚报 `deduped:true`**(让业务层误以为未发生外部调用) | 全新缺陷类 | **逃逸:0 违规**(套件无任何 `deduped===false` 负向断言) |
| AUDIT-BAD-4 | **unknown 谎称 failed**(TIMEOUT):嫌 unknown 难处理,破坏七状态显式区分 | 全新缺陷类 | **抓住:S7+S9+S14**(3 违规) |
| AUDIT-BAD-5 | **context.snapshot 恒等伪造**:从调用方注入面给内层适配器冻结快照,绕过复核(与 mutant-D 源码短路不同路径) | 不同注入面 | **抓住:S8+S12**(套件无条件断言 stale,不依赖实现如何达成) |
| AUDIT-BAD-6 | 探针:**simulated 删除显著标记**(`simulation.notice`/`mode`),仅留 status 字符串 | 全新缺陷类 | **逃逸:0 违规**(S1b 只断言 status) |
| AUDIT-BAD-7 | 探针:**stale 清空 findings/questions/evidenceRefs**(status/code 不变;契约承诺"保留数据供人工核对") | 全新缺陷类 | **逃逸:0 违规** |
| AUDIT-BAD-8 | 探针:**failed 结果把 error 置 null**(错误码全部丢失,status 仍 failed) | 全新缺陷类 | **部分抓住:仅 S11+S13**;S3/S4/S5/S6 的错误码断言被守卫式写法绕过(见 §3) |

小结:**8 个中 4 个全抓、1 个部分抓、3 个逃逸(BAD-3/6/7)+ 1 个暴露断言写法缺陷(BAD-8)**。任务书点名的三类(复核短路/stale 改标/账本释放)对应 BAD-5/BAD-1/BAD-2,全部抓住。好实现对照复跑零违规(套件不误伤)。

## 3. 断言质量审计:最弱三个断言(均有逃逸实证)

1. **S1b(`contract-assertions.mjs:37-42`)只断言 `status==='simulated'`。** 不检查 `simulation.notice` 与 `mode==='simulated'`,而契约(codes.mjs STATUS 注释、adapter SIMULATION_NOTICE)要求模拟结果"必须显著标记"。删掉显著标记的坏实现(BAD-6)零违规通过。S1 同样不查 simulation 字段,整个套件对该字段无任何断言。
2. **S8(`:109-119`)只断言 `status==='stale'`。** 不检查 error.code(对比 S3/S5/S6/S12/S13 均有错误码断言),也不检查"保留数据供人工核对"(adapter.mjs revalidateCached 契约注释)。BAD-7 实证:清空 findings/evidenceRefs 的 stale 零违规通过——人工核对拿到的是空壳。
3. **S3/S4/S5/S6 的错误码断言是守卫式写法**(`if (r.error && r.error.code !== 'X')`,如 `:59`、`:68`、`:78`、`:88`):`error:null` 即可令断言恒假跳过。BAD-8 实证:failed+error:null 只被 S11/S13 抓住(这两处用的是无守卫的 `(r.error && r.error.code) !== 'X'` 正确写法,`:184`、`:238`),S3/S4/S5/S6 全部漏过。S2(`:48`)另缺错误码断言(EMPTY_OUTPUT 报成任意码不抓)。同套件两种写法并存,建议统一为 S11/S13 式。

系统性小项:S12 r3 的 deduped/code 断言在 else 分支内(被 status 断言保护),方向正确;S11/S13 的调用计数、容量、背压断言(S11 六连断言、S13 `calls!==2`)是全套件最扎实的部分;S10 四断言(usageUnknown/hold/usage 不伪造/账本状态)覆盖好。

## 4. 报告诚实性审计(逐项核对,全部属实)

1. **caughtBy 场景真实存在**:results.json 中出现的 S3/S4/S7/S8/S9/S10/S11/S12/S13/S14 全部在套件中定义且有实际断言;预期场景映射(A→S3、B→S4、C→S11、D→S12、E→S9、F→S10、G→S12)与 09 的 DEFECTS 表(`09-adversarial.test.mjs:44-52`)一致,"在预期场景被抓"判定(`caughtBy.includes(expected)`,`:170`)语义正确,额外抓捕场景如实并列(C 多抓 S13、D 多抓 S8、E 多抓 S7/S14、F 多抓 S7)。
2. **anchorFound=false 确实计为未捕获、绝不静默**:09 `:204-208`/`:215-218` —— 锚点缺失时 `defectResults.set({caught:false, caughtBy:[], anchorFound:false})` 且 `assert.fail` 使测试变红(响亮失败);汇总(`:352-386`)只对 `r.caught===true` 计数,缺失条目默认未捕获;mutant-A/B 锚点漂移经 `mutate()` 的 `assert.ok` 同样响亮失败。09 的变异机制烟测(`:281-350`)明确覆盖"锚点缺失必须显式报告"。
3. **分母 7 与实际注入数一致**:`DEFECTS.length===7`;results.json `injected:7`、`ratio:"7/7"`;与声称的"mutant-A/B/C/D + wrapper-E/F/G"逐一对应;无以测试总数充当分母的痕迹。
4. **可复现性**:冻结产物(21-20-40-836Z)与我复跑新生成的 results(21-24-13-794Z)summary 与 caughtBy 完全一致。
5. **变异真实生效**:抽查生成的 `mutants/adapter.mutant-D.mjs` —— 锚点后**两处** `stalenessOf` 调用(220 行缓存复核 + 404 行 executeRequest 返回时核对)均被中和。即 mutant-D 实际影响面比"缓存复核调用"的描述更广(等于"关闭全部过期复核"),但这被 caughtBy=["S8","S12"] 如实暴露,不算失实,属于描述粒度问题(见问题清单 P2)。
6. 未发现"恒真断言/断言错误方向"类硬伤:所有"期望 failed/stale/unknown"的场景都是无条件正向断言,伪装类坏实现(BAD-1/4/5 及交付方 G)全部被抓住——套件的失败关闭方向是真实的。

## 5. 交付方应修问题清单(建议下一轮 TESTINFRA 落实)

| 优先级 | 问题 | 修复建议 |
| --- | --- | --- |
| P1 | 无 `deduped===false` 负向断言(BAD-3 逃逸:虚报去重不被抓) | S1 增加"新调用 `deduped` 必须为 false"断言 |
| P1 | S1b 不查 simulated 显著标记(BAD-6 逃逸) | S1b 增加 `simulation.notice` 非空 + `mode==='simulated'` 断言 |
| P1 | S8/S12 不查 stale 数据保留(BAD-7 逃逸);S8 缺错误码断言 | 两处增加"findings/evidenceRefs 保留非空"与 `GENERATION_CHANGED` 断言 |
| P1 | S3/S4/S5/S6 守卫式错误码断言可被 error:null 绕过(BAD-8);S2 缺错误码断言 | 统一改为 `(r.error && r.error.code) !== 'X'` 无守卫式;S2 补 `EMPTY_OUTPUT` |
| P2 | mutant-D 实际中和全部 stalenessOf(含 404 行返回时核对),比"缓存复核调用"描述更广 | DEFECTS 表描述改为"短路全部过期复核(缓存命中 + 返回时核对)";行为如实、仅需注明 |
| P3 | `src/dedupe.mjs:31` 注释称 failed-after-send"不缓存",但 `CACHED_STATUSES` 含 `'failed'` → transport 错误后同ID重试拿到 deduped 失败而非新调用 | 注释与行为二选一改齐;若按注释方向修,建议套件加"failed-after-send 重试"场景(超出本次对抗审查核心,交付方确认语义) |
| P4 | STATUS.md 仍 IN_PROGRESS、"完成后补记"为空;交付根无 MANIFEST.json(冻结流程未完成) | 冻结前补齐;非本次审查范围,不阻塞本结论 |

## 6. 审查边界与留痕

- 只读交付文件;全部写入仅:`AUDIT_REPORT.md`(本文件)与 `runtime/audit-20260913-agent-audit/`(badimpls.mjs、badimpls2.mjs)。复跑 run-all 产生的 `runtime/<时间戳>-pid*/` 为被测套件固有输出目录(helpers.testOutputDir 缺省行为),非审查者指定写入;`evidence/` 冻结证据核验未被触碰。
- 未修任何产品代码;未安装依赖;未发网络。
- 档位裁量说明:FAIL 的定义是"存在抓不住的坏实现或报告失实"。审计确实构造出了 3 个逃逸探针(BAD-3/6/7)+ 1 个断言写法绕过(BAD-8),但它们均不改变七状态语义的失败关闭方向(旧结果仍标 stale、unknown/failed 仍不被伪装成 succeeded、账本 unknown_hold 仍被 totals 断言守卫),不属于 R1 点名、R2 立项防御的危险缺陷类;交付方声称的事实(7/7、零违规、分母、锚点处理)全部独立复现为真且报告无失实。故评 **PASS-WITH-NOTES**,逃逸项全部进入 §5 修复清单。
