# Route v1 Stage 2B — stable dependency planner

实现同步 deterministic job planner。Contract 与 error priority 已冻结。

## Scope
- Working directory: `C:\Users\22673\Desktop\Anthropic\codex-route-v1-fixture\stage2-planner`
- 只允许读取一次 `acceptance_test.cjs`。
- 只允许写 `planner-error.cjs`、`planner.cjs`。
- 禁止读取 controller/manifest/task pack/目录清单；禁止 Git、network、dependencies、credentials。
- CommonJS；不得返回 Promise。

## API
`planner.cjs` 导出 `planJobs(jobs)`。`planner-error.cjs` 导出 `PlannerError`，其 `name='PlannerError'`，有 code；CYCLE 还必须有 deep-cloned `details`。

每个 job 为 `{ id, dependsOn, payload }`。Validation priority：jobs 非数组 `INVALID_JOBS`；逐项先查 job 非 plain object `INVALID_JOB`、id 非 non-empty string `INVALID_JOB_ID`、dependsOn 非数组/包含非 non-empty string/重复项 `INVALID_DEPENDENCIES`、payload 非 plain object或不可 structuredClone `INVALID_PAYLOAD`；然后依次查 Map-safe 重复 id `DUPLICATE_JOB_ID`、self dependency `SELF_DEPENDENCY`、unknown dependency `UNKNOWN_DEPENDENCY`，最后才检测 cycle `CYCLE`。

## Planning contract
- 用 stable Kahn topological planning。
- 每一 wave 中所有当前 indegree=0 的 job 按原始 jobs 输入顺序构成一层；全部移除后才形成下一层。
- 返回 `{ order, layers, jobs }`：order 是层顺序展平的 id；layers 是 id 二维数组；jobs 是按 order 排列的 deep-cloned 原 job。
- cycle error details 精确为 `{ remainingIds }`，只含循环后剩余 id，按原输入顺序。
- 输入、结果 nested arrays/objects 均 clone 隔离；`id='__proto__'` 安全；不得修改输入。

## One acceptance
实现后仅运行一次 `node acceptance_test.cjs`。失败不得修改或重跑。结束时报告 files、command、exit code、output、remaining risk。
