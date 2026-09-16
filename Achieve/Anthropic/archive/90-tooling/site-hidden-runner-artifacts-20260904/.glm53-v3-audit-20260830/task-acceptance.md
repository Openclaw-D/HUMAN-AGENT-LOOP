# Z 只读审计：Acceptance blind spots

任务类型：`read-only-review`

## 固定目标

只读审查 V3 验收脚本及相关场景测试的 claim-to-evidence 覆盖，定位 acceptance blind spot；不得修改任何文件。

## 冻结契约

重点检查 fresh-process、non-zero exit、HTTP/static/runtime 证据是否被混淆、脚本是否可能误报成功、旧证据能否代表当前源码、关键路径是否缺少 fail-closed gate。只报告明确 `file:line`、触发机制、影响和证据的 P0-P3 问题；无可靠发现时明确写“无可靠发现”。不要运行会写 evidence 或改变服务状态的 full acceptance。

## 当前证据

Controller 已独立运行全量测试、typecheck、lint、build 均通过，并确认旧 `V3_ACCEPTANCE_EVIDENCE` 早于当前新前端源码，因此不能作为当前最终证据。

## Allowed reads

- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/scripts/v3-full-run.mjs`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/scripts/v3-http-acceptance.mjs`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/scripts/v3-acceptance.mjs`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/test/v3-demo-scenario.test.mjs`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/test/api-route-source-contract.test.mjs`

## Allowed writes

无。

## Excluded

禁止读取 task pack、hidden controller test 或其它文件；禁止目录枚举、搜索、Git、网络、安装、写文件、启动/停止站点或浏览器。你不是唯一参与者，不得撤销或覆盖他人改动。

## Command Gate

每个 allowed read 只用 `Get-Content -LiteralPath` 读取一次；读取完成后只允许运行下列 acceptance command 恰好一次。禁止 `Test-Path`、`rg`、`Get-ChildItem`、额外 parser/lint/test、重复读取和其它 inspection command。

`node --check ./scripts/v3-full-run.mjs`

## Route v2 admission

Profiles：integration、path、exact-shape。Hidden controller test 不在 allowed reads；Controller 独立执行额外 gate。

## Stop conditions

provider_error、rate_limit、timeout、scope_violation，以及契约冲突、测试失败、permission denial、quota、auth、network 时立即停止，不重试。

## Final evidence

按严重度列 findings；每项必须含 `file:line`、机制、影响、证据和现有 gate 为什么未捕获。最后报告 acceptance command、退出码、terminal、usage、wall、denial、副作用与残留进程。不得声称最终验收。
