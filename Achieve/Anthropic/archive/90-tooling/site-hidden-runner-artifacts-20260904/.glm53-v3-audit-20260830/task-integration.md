# Z 只读审计：API 与前后端 integration

任务类型：`read-only-review`

## 固定目标

只读审查协同页与 Case API/demo backend 的 frontend-backend contract，输出可复核 findings；不得修改任何文件。

## 冻结契约

重点检查 error propagation、CaseProjection、fail-closed、请求/响应 exact shape、路径参数、空/错误状态、状态变更入口和客户端假设。只报告具有明确 `file:line`、触发机制、影响和证据的 P0-P3 问题；无可靠发现时明确写“无可靠发现”。不要评价视觉布局或提出范围外产品方案。

## 当前证据

Controller 已验证全量测试 127/127、typecheck、lint、build 通过，并在 1920x1080 浏览器看到 `/collaboration` 成功加载 `CTX-0001` 且 console 无错误；未发送聊天 POST，以免改变 demo state。

## Allowed reads

- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/app/collaboration/collaboration-shell.tsx`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/app/api/cases/[caseId]/messages/route.ts`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/app/api/cases/[caseId]/projection/route.ts`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/lib/v3-client.ts`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/lib/v3-demo-backend.ts`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/test/v3-demo-backend.test.mjs`

## Allowed writes

无。

## Excluded

禁止读取 task pack、hidden controller test 或其它文件；禁止目录枚举、搜索、Git、网络、安装、写文件、运行站点或浏览器。你不是唯一参与者，不得撤销或覆盖他人改动。

## Command Gate

每个 allowed read 只用 `Get-Content -LiteralPath` 读取一次；读取完成后只允许运行下列 acceptance command 恰好一次。禁止 `Test-Path`、`rg`、`Get-ChildItem`、额外 parser/lint/test、重复读取和其它 inspection command。

`node --experimental-strip-types --test ./test/v3-demo-backend.test.mjs`

## Route v2 admission

Profiles：integration、path、exact-shape、state。Hidden controller test 不在 allowed reads；Controller 独立执行额外 gate。

## Stop conditions

provider_error、rate_limit、timeout、scope_violation，以及契约冲突、测试失败、permission denial、quota、auth、network 时立即停止，不重试。

## Final evidence

按严重度列 findings；每项必须含 `file:line`、机制、影响、证据和为什么现有测试未覆盖。最后报告 acceptance command、退出码、terminal、usage、wall、denial、副作用与残留进程。不得声称最终验收。
