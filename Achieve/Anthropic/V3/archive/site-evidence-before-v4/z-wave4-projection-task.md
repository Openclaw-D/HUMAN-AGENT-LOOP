# Z3 Shared Projection 检查点

## 目标

审计并仅在可复现时修复四板块×五流程严格顺序、六档进度派生、exact stage keys、prototype pollution、深克隆和同步 API。

## 冻结契约

- stage 顺序精确为 policy/credit/commerce/asset；每 stage 五个 flow ID 使用当前冻结定义。
- completedStepCount 必须为安全整数 0..5；prepProgressPercent=count*20，只能 0/20/40/60/80/100。
- 唯一顺序为 `completed* -> active? -> locked*`；count=5 时五个全 completed 且 active=0，currentFlowId 为第五步。
- contextVersion trim 后非空；processRunId/contextVersion 必须一致。
- completedStepCountByStage 只接受 plain/null-prototype exact four own keys，拒绝额外/缺失/inherited/`__proto__` 污染。
- 失败优先级和错误码保持当前测试契约；API 同步；每次输出全新深层对象，调用方修改不能污染常量或后续调用。

## 当前证据

baseline 聚焦测试 8/8、全量 36/36；尚无确认缺陷。重点对抗审计；无确认缺陷时可以不改实现。

## 允许读取

`SITE_CONTRACT.md`、`lib/shared-context-projection.ts`、`lib/evidence-runtime.ts` 的直接调用、`lib/domain.ts` 的投影映射、`test/shared-context-projection.test.mjs`。

## 唯一允许写入

- `lib/shared-context-projection.ts`
- `test/shared-context-projection.test.mjs`

## 排除项

不得写 UI/CSS/domain/flow-workspaces/routes/其他 tests；不得安装、部署、Git 写操作或浏览器；不得读取/输出凭据；不得改变 schema/API/错误码。

## 唯一验收命令

审计/实现完成后只运行一次：

`node --experimental-strip-types --test .\test\shared-context-projection.test.mjs`

不得先用作 baseline；失败后停止，不补跑。

## 最终证据

报告确认缺陷或无缺陷结论、实际写入、唯一命令摘要、测试计数、denial/spawn EPERM、未修风险与范围外发现。终止必须真实 `turn.completed`。
