# AGENT_LEDGER｜R3-B Subagent台账

授权链:ZCODE_R2_B_20260913 → R2批次(96/96冻结) → ZCODE_R3_B_20260913(本批)。并发:默认2、最多3(未超);限流:本轮未发生。

| 任务 | Owner | 独占写面 | 输入(sha256前8位) | 结果 | 证据 | 资源记录 |
| --- | --- | --- | --- | --- | --- | --- |
| 主agent 接手+控制器v0.3.0 | 主agent | src/*(camera-controller增量/thumbnail迁移/standalone重写)、tools/*、STATUS、screenshots、evidence/browser与collected、整合文档 | R3_B任务书、R2控制器=fd19c44a、R2壳=06d77452、R2 MANIFEST | ✅ v0.3.0增量+11场景CDP矩阵failedChecks=0 | screenshots/INDEX.md、evidence/headless-measure.json | 主agent额度未知;产品API付费0 |
| SA-A 回归+契约测试 | subagent(两段提交) | test/run-r3.mjs、test/regression-generated/*、test/r3-contract.test.mjs、evidence/r3-tests-run.log、evidence/regeneration-proof.json | R2五测试文件(与R2 MANIFEST三方核对一致)、R3控制器v0.3.0 | ✅ 首轮101/105(4条版本字面量如实上报未擅改)→裁决后**105/105 exit 0**;stress-loop 42×2轮完整执行 | evidence/r3-tests-run.log、evidence/regeneration-proof.json | 两段tokens≈957,157+3,819,344;约39+6分 |
| SA-B 契约与映射 | subagent | EVENT_RESOURCE_CONTRACT.md、MAPPING.md | R3_B、R3控制器、R2 MAPPING/STATUS、评审链 | ✅ 契约表9行+收据schema+替换映射 | EVENT_RESOURCE_CONTRACT.md、MAPPING.md | tokens≈316,478;约9分 |

- **并发峰值**:2(默认额度内);限流事件:无。
- **所有权**:每文件唯一writer全程保持;SA-A上报的口径冲突由协调者裁决后由SA-A本人执行(未易手)。
- **裁决记录**:4条R2版本字面量断言→授权生成器显式版本映射(regeneration-proof.json含coordinatorRuling与逐条计数);行为语义差异semanticDiffLines=0独立复核,不属"改测试迎合错误"。
- **额度声明**:subagent token数为环境回报;主agent与总账户剩余额度未知。ZCode开发额度与产品API分开,本轮产品付费调用=0。
