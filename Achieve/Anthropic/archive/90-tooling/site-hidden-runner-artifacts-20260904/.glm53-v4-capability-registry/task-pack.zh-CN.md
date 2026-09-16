# 智谱 coding checkpoint

任务类型：`implementation`

## 固定目标

只实现 `capability-registry.ts`：对冻结的 V4 Capability Manifest 做同步、精确、失败关闭的 Admission，并构建只读、深克隆、稳定排序的 in-memory Registry。能力可以插拔，但绝不能获得正式业务权威。

## 冻结契约

- 必须导出 `V4CapabilityError`、`admitV4CapabilityManifest(input: unknown)`、`createV4CapabilityRegistry(input)`。
- 所有 API 都是同步函数，不能返回 Promise。
- Manifest exact shape 以 `capability-types.ts` 为唯一类型契约；根对象及所有嵌套对象拒绝 missing、enumerable extra、non-enumerable extra、symbol extra 和 `__proto__` own key。
- 验证优先级：根 exact shape / 基础字段 → `authority` → output permissions → bounded execution/evaluation → governance admission → registry duplicate/not-found。
- `authority` 只有精确值 `none`；否则抛 `CAPABILITY_AUTHORITY_FORBIDDEN`。
- `permissions.write` 只允许 `evidence | candidate | action_intent`；其它值抛 `CAPABILITY_OUTPUT_FORBIDDEN`。任何能力都不能写 Decision、Human Gate 或 Receipt。
- 数值禁止 bool、string、NaN、Infinity 和小数越界：`timeoutMs` 为 1..300000 整数，`maxAttempts` 为 1..3 整数，`backoffMs` 为 0..60000 整数，`minimumScore` 为 0..1 有限数。
- Admission 只允许 `shadow | active`，其它 lifecycle state 抛 `CAPABILITY_NOT_ADMISSIBLE`；`approvalReceiptId` 与 `rollbackVersion` 必须非空。
- 其它 shape/value 错误统一抛 `INVALID_CAPABILITY_MANIFEST`。
- 同一 `capabilityId + version` 重复抛 `DUPLICATE_CAPABILITY_VERSION`；查询缺失抛 `CAPABILITY_NOT_FOUND`。
- Admission checks 的 exact tuple 固定为 `manifest-exact-shape, authority-none, output-boundary, governance-eligible`。
- Registry 按 `capabilityId`、再按 `version` 做 ordinal stable ordering。
- 所有输入、Admission、list、get、snapshot 之间不得共享 nested references；不冻结 caller input，也不修改输入。
- 本 checkpoint 不实现 Routing、Adapter execution、Authority Kernel、Event、Evidence persistence、Candidate run、Human Gate、canonical Receipt、API 或 SQLite。

## 当前失败证据

新实现检查点；`capability-registry.ts` 当前不存在。

## Allowed reads

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\capability-types.ts`：只读一次。
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-capability-registry.test.mjs`：只读一次。

## Allowed writes

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\capability-registry.ts`：唯一 writer；只允许创建和修改此文件。

## Excluded

- `task-pack.zh-CN.md`
- `v4-capability-registry-controller.test.mjs`
- `docs/v4/**`、`lib/v3/**`、`app/api/v3/**`、`app/**`、其它 `lib/v4/**`、其它 `test/**`
- Git、依赖安装、网络、凭据、provider 配置、目录枚举、搜索、额外 inspection、服务启动停止、部署
- 不得自行发明 capability lifecycle、authority state machine、岗位权限、API、SQLite 或前端契约

## Command Gate

Controller 已完成 fixture syntax/loadability、manifest admission 与 runner preflight。新 fixture 缺少 solution 是初始状态，未运行必然失败的 missing-solution test。

Worker 只允许：每个 allowed read 使用 `Get-Content` 读取一次；通过 file-change 工具写 `capability-registry.ts`；实现后运行下列 acceptance command 恰好一次。禁止 `Test-Path`、额外 parser/lint、目录枚举、搜索、Git、重复读取和其它 inspection command。

`node --experimental-strip-types --test ./test/v4-capability-registry.test.mjs`

## Route v2 admission

- profiles：`exact-shape`、`clone`、`state`、`numeric`。
- required terms：`capability-registry.ts`、`capability-types.ts`、`v4-capability-registry.test.mjs`、`authority-none`、`output-boundary`、`governance-eligible`、`CAPABILITY_AUTHORITY_FORBIDDEN`、`CAPABILITY_OUTPUT_FORBIDDEN`、`CAPABILITY_NOT_ADMISSIBLE`、`DUPLICATE_CAPABILITY_VERSION`、`CAPABILITY_NOT_FOUND`。
- conservative ROI：预计 controller 直写与边界验证 65 分钟；worker task-pack/monitor/review/handoff/repair/context/provider 高估总成本 34 分钟；净收益 31 分钟，benefit/cost 1.91，超过 15 分钟与 1.5 的 Gate。

## Stop conditions

- 类型或公开测试与本任务包矛盾时停止并报告。
- 需要读取或写入 excluded path 时停止并报告。
- acceptance 首次失败后停止，不自行重跑或扩大修复。
- permission denial、rate limit、quota、authentication、network、timeout 或非完整 terminal 时停止。

## Final evidence

报告唯一修改文件、acceptance command/exit code、测试数量、未实现范围；transport 证据由 runner 记录，worker 不读取 JSONL，不声明最终验收。
