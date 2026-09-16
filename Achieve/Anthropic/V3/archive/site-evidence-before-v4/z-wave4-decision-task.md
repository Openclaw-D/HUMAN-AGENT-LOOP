# Z2 Decision/Receipt 检查点

## 目标

审计并仅在可复现时修复 Decision/Receipt 的验证优先级、stage/flow/action/actor、幂等冲突、序列、克隆、跨页隔离后端契约与并发稳定性。

## 冻结契约

- 唯一事项 `FL-DEMO-001`；四 stage 与二十 flow ID 按 `SITE_CONTRACT.md` 现有定义；`action` 仅 `reject|submit`。
- 同步 API 必须保持同步和原子；验证优先级保持 `CASE_NOT_FOUND -> INVALID_STAGE -> INVALID_FLOW -> INVALID_ACTION -> INVALID_ACTOR -> INVALID_REQUEST_ID -> IDEMPOTENCY_CONFLICT`。
- 同 requestId + 同规范化 payload 精确重放同一 Receipt；异 payload 冲突且序列不推进。
- Receipt shape、gateId、recordedAt、错误码保持不变；每次 list/latest/replay 输出深克隆且不能被调用方污染。
- 跨 stage/flow 失败关闭。前端当前页隔离依赖 Receipt 的 stageId/flowId，后端不得删改。
- 正式 Receipt 历史语义不得为“缓存优化”截断。若无持久化前提下无法安全消除无界历史风险，只报告，不牺牲历史或幂等语义。

## 当前证据

baseline 聚焦测试 11/11；HTTP normal/replay/409/mixed/invalid/x32 均通过。尚无确认缺陷，重点做对抗审计；没有确认缺陷时可以不改实现。

## 允许读取

`SITE_CONTRACT.md`、`lib/decision-runtime.ts`、`lib/domain.ts` 中 latest/reset 包装、`app/api/cases/[caseId]/decisions/route.ts`、`app/workbench.tsx` 的 Receipt filter、`test/decision-runtime.test.mjs`。

## 唯一允许写入

- `lib/decision-runtime.ts`
- `test/decision-runtime.test.mjs`

## 排除项

不得写 UI/CSS/domain/flow-workspaces/routes/其他 tests；不得安装、部署、Git 写操作或浏览器；不得读取/输出凭据；不得改变 schema/API/错误码。

## 唯一验收命令

审计/实现完成后只运行一次：

`node --experimental-strip-types --test .\test\decision-runtime.test.mjs`

不得先用作 baseline；失败后停止，不补跑。

## 最终证据

报告确认缺陷或无缺陷结论、实际写入、唯一命令摘要、测试计数、denial/spawn EPERM、历史/缓存剩余风险和范围外只读发现。终止必须真实 `turn.completed`。
