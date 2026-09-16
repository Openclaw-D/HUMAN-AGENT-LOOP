# Z coding checkpoint

任务类型：`implementation`

## 固定目标

新增一个纯数据、可重复、可深克隆的 V3 Golden Scenario package 模块与公开单测，供后续 Backend Authority runtime 直接消费。

## 冻结契约

- 新模块导出：`V3_SCENARIO_REF`、`V3_SCENARIO_PROCESS_IDS`、`V3_SCENARIO_PRINCIPAL_IDS`、`V3_SCENARIO_CASES`、`V3_SCENARIO_TRANSITIONS`、`getV3ScenarioBaseline`。
- `V3_SCENARIO_REF` 固定：`scenarioId=JW-V3-DL-GOLDEN-001`、`scenarioVersion=1.0.0-macro`、`seed=jw-v3-dl-golden-seed-001`、`businessItemType=FinancingLeasingCase`、`caseId=FL-DEMO-001`、`leaseMode=direct-lease`、`dataClass=synthetic_deidentified_demo`。
- 五路顺序固定：`opportunity | policy | credit | commercial | asset`。
- canonical principal 固定：`collaboration-manager | business-owner | risk-policy | risk-credit | risk-commercial | risk-asset | external-customer | external-supplier`。
- Case 固定为 1 个 Golden `FL-DEMO-001` + 4 个独立 background `FL-BG-001..004`；background 必须 `readOnly=true`、无 Golden Context/Evidence/Receipt；`active_lease` 与 `closed` 的 `commencementBand=5`。
- T1：`business-owner` commit，一次 ContextCommit，trigger 五路。
- T2：`external-customer` 在 `INV-CUSTOMER-RISK-001` 范围内 commit，一次 ContextCommit，必须声明 credit regression / needs input。
- T3：`external-customer` 与 `external-supplier` 分别产生 Evidence Receipt，`business-owner` 对同一 pending batch 只 commit 一次，再 trigger 五路。
- baseline 必须是 pre-commencement、`contextSeq=0`、无成功 Gate / Receipt；`getV3ScenarioBaseline()` 每次返回深克隆，调用方 mutation 不能污染 constants 或下一次结果。
- 模块不得包含真实身份、真实内网字段、精确专业规则、百分比、API 调用或 mutable runtime。

## 当前失败证据

新实现检查点：当前 Scenario 只散落在 frontend seed 与文档，没有可供 Backend consumption 的独立版本化 package。

## Allowed reads

- `package.json`：只读一次，用于确认 ESM / TypeScript test runtime。

## Allowed writes

- `lib/v3-demo-scenario.ts`：本 lane 唯一 writer。
- `test/v3-demo-scenario.test.mjs`：本 lane 唯一 writer。

## Excluded

禁止读取 task pack、controller hidden test、现有源码或目录；禁止目录枚举、搜索、Git、依赖安装、网络、凭据、前端/API/runtime 修改、文档修改、provider/settings 修改和额外副作用。

## Command Gate

Controller 已完成 manifest admission 与 runner preflight 准备。Worker 只允许对 `package.json` 使用 `Get-Content` 读取一次，通过 patch 工具写 allowed writes；实现后运行下列 acceptance command 恰好一次。禁止 `Test-Path`、额外 parser/lint、目录枚举、搜索、Git、重复读取和其它 inspection command。

`node --experimental-strip-types --test ./test/v3-demo-scenario.test.mjs`

## Route v2 admission

Profiles：`exact-shape`、`clone`、`state`。Required terms：`JW-V3-DL-GOLDEN-001`、`ContextCommit`、`INV-CUSTOMER-RISK-001`、`credit regression`、`deep clone`。输出 constants 可冻结，但 baseline clone 必须保持调用间引用隔离。

## Stop conditions

契约冲突、范围冲突、测试失败、permission denial、provider error、rate limit、quota、auth、network 或 timeout 时立即停止，不自行扩大范围或重试。

## Final evidence

只报告新增的两个文件、唯一 acceptance command 与退出码、测试数、terminal、usage、wall、denial、副作用和残留进程；不得复制凭据或原始 task pack。
