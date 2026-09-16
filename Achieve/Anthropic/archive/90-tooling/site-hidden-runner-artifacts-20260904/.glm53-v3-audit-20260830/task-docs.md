# Z 只读审计：Docs 与实现 claims drift

任务类型：`read-only-review`

## 固定目标

只读对照 README、SITE_CONTRACT、package scripts 与当前 root frontend，定位 documentation drift；不得修改任何文件。

## 冻结契约

以 current frontend authority 为现状判断基准，但 visual judgment excluded；重点核对 route skeleton、已实现/未实现声明、启动/测试命令、旧 Role Tabs/项目池/巨型 shell 等已废弃结构是否仍被文档当成当前契约。只报告明确 `file:line`、冲突对象、影响和证据的 P0-P3 问题；无可靠发现时明确写“无可靠发现”。不要设计页面或评价视觉美感。

## 当前证据

Controller 已确认 `/`、`/collaboration`、`/policy` 可渲染，构建路由包含根页、九模块骨架与多项 `/api/v3` API；最终视觉尚未由用户验收。

## Allowed reads

- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/README.md`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/SITE_CONTRACT.md`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/package.json`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/app/jw-front.tsx`
- `C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/test/jw-front.test.mjs`

## Allowed writes

无。

## Excluded

禁止读取 task pack、hidden controller test 或其它文件；禁止目录枚举、搜索、Git、网络、安装、写文件、运行站点或浏览器。你不是唯一参与者，不得撤销或覆盖他人改动。

## Command Gate

每个 allowed read 只用 `Get-Content -LiteralPath` 读取一次；读取完成后只允许运行下列 acceptance command 恰好一次。禁止 `Test-Path`、`rg`、`Get-ChildItem`、额外 parser/lint/test、重复读取和其它 inspection command。

`node --experimental-strip-types --test ./test/jw-front.test.mjs`

## Route v2 admission

Profiles：exact-shape、path、integration。Hidden controller test 不在 allowed reads；Controller 独立执行额外 gate。

## Stop conditions

provider_error、rate_limit、timeout、scope_violation，以及契约冲突、测试失败、permission denial、quota、auth、network 时立即停止，不重试。

## Final evidence

按严重度列 findings；每项必须含 `file:line`、冲突声明、当前实现证据及交付影响。最后报告 acceptance command、退出码、terminal、usage、wall、denial、副作用与残留进程。不得声称最终验收。
