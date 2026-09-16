# Z coding checkpoint

任务类型：`implementation`

## 固定目标

修正现有 V3 frontend shell policy，使 `v3-shell-model.ts` 与已冻结的 Role Projection Authority 一致，并同步更新其公开单测。

## 冻结契约

- 内部 Role ID 继续是 `leadership | business | risk | external`；可见名称不在本 lane 修改。
- canonical 协同 principal 是 `collaboration-manager`；旧 `leadership-observer` 只能作为兼容 alias，`buildRoleProjection` 返回 canonical principal。
- 协同不再是纯只读：允许 `view` 与 typed `management-action`，但 `canSubmitHumanGate=false` 且不能提交任何 professional Gate。
- `business-owner` 可看五路、可做业务 / 商机材料与事实协同，但 `canSubmitHumanGate=false`、`canSubmitGateProcessIds=[]`，不能代签政策 / 信审 / 商务 / 资产 professional Gate。
- 四个 risk principal 都看五路，各自只能提交自己 process 的 Gate；外联语义保持 invitation-scoped 且无 Human Gate。
- `FL-BG-003` 已是 `active-lease`，因此 `commencementBand` 必须为 5；其他 Case identity 不改变。
- 保留现有导出兼容性；可增加 `canSubmitManagementAction` 或等价 typed capability，但不能删除 UI 当前所需字段。
- 返回对象继续不可由调用方 mutation 反向污染 seed；错误输入继续 fail closed。

## 当前失败证据

现有 `business-owner` 被赋予五路 Gate；`leadership-observer` 被固化为 pure read-only；`FL-BG-003` 已起租却只有 3/5 起租格。

## Allowed reads

- `lib/v3-shell-model.ts`：只读一次。
- `test/v3-shell-model.test.mjs`：只读一次。

## Allowed writes

- `lib/v3-shell-model.ts`：本 lane 唯一 writer。
- `test/v3-shell-model.test.mjs`：本 lane 唯一 writer。

## Excluded

禁止读取 task pack、controller hidden test、其他源码或目录；禁止目录枚举、搜索、Git、依赖安装、网络、凭据、API / backend 修改、UI/CSS 修改、文档修改、provider/settings 修改和额外副作用。

## Command Gate

Controller 已完成 manifest admission 与 runner preflight 准备。Worker 只允许每个 allowed read 使用 `Get-Content` 读取一次，通过 patch 工具写 allowed writes；实现后运行下列 acceptance command 恰好一次。禁止 `Test-Path`、额外 parser/lint、目录枚举、搜索、Git、重复读取和其它 inspection command。

`node --experimental-strip-types --test ./test/v3-shell-model.test.mjs`

## Route v2 admission

Profiles：`exact-shape`、`state`。Required terms：`collaboration-manager`、`management-action`、`business-owner`、`professional Gate`、`FL-BG-003`。必须保持 alias normalization、权限 denial 语义和 clone 隔离。

## Stop conditions

契约冲突、范围冲突、测试失败、permission denial、provider error、rate limit、quota、auth、network 或 timeout 时立即停止，不自行扩大范围或重试。

## Final evidence

只报告修改的两个文件、唯一 acceptance command 与退出码、测试数、terminal、usage、wall、denial、副作用和残留进程；不得复制凭据或原始 task pack。
