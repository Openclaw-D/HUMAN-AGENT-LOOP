# Z minimal repair verification

任务类型：`repair`。

唯一目标：验证全局 runner 的 trusted `child-process-required` 路由已修复旧 checkpoint 的 Node test-runner `spawn EPERM`。Controller 已本地验证 public 18/18、hidden 3/3；本次不重新实现业务逻辑。

Ownership 仅登记 `test/v3-shell-model.test.mjs` 为 allowed read/write file，但不要直接读取、修改或 patch 它。禁止读取 `lane-shell-repair-task-pack.md`、`lane-shell-controller.test.mjs`、其它文件或目录；禁止目录枚举、搜索、Git、依赖、网络、凭据和 provider/settings 修改。

只运行下面 acceptance command 恰好一次，不运行任何其它命令：

`node --experimental-strip-types --test ./test/v3-shell-model.test.mjs`

若 command 非零、permission denial、provider error、rate limit、quota/auth、network/timeout 或 scope conflict，立即停止，不修代码、不重试。成功时只报告 exit code、test count、`turn.completed`、usage、wall、denial、副作用与 residue。
