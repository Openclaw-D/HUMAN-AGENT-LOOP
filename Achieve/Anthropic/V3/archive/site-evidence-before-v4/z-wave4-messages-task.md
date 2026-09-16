# Z4 Model/Messages 检查点

## 目标

审计并仅在可复现时修复本地候选/live 边界、timeout/error 失败关闭、请求验证、错误映射、Context Packet 透传隔离、资源清理与可复现性能热点。新增一个离线稳定性测试，不得发起真实网络请求。

## 冻结契约

- 产品凭据仅为 `JIANWEI_MODEL_API_KEY`；不得读取/复用/输出 runner 或产品凭据。测试只能设置明显假的占位值并完整恢复环境与 `globalThis.fetch`。
- 缺产品凭据时 `completeProductCandidate` 必须 `MODEL_NOT_CONFIGURED`；UI/domain 继续明确“本地候选推理”，不得伪装 live。
- endpoint/model/body schema 保持；模型 authority=none；不得替人提交、否决、确认或伪造 Receipt。
- 网络、非 2xx、无效 JSON、空 content 必须稳定映射为 `ADAPTER_FAILURE`；408/504 或 Abort/Timeout 映射 `ADAPTER_TIMEOUT`；失败关闭，不返回候选成功。
- timeout 资源必须可回收，不留未处理 rejection/timer；成功只接受非空字符串并 trim。
- messages route 只接受 object body 和四个 string 字段；既有错误码/status mapping 保持；跨 stage/flow Context Packet 由 domain 控制，不得在本检查点改变 domain。
- 不改变现有 HTTP schema/API/错误码；没有确认缺陷时可以只新增有价值的离线回归测试或完全不改实现。

## 当前证据

baseline Messages HTTP normal/replay/409/mixed/invalid/error500/timeout504/x32 全通过；本机中位数 p50=14.257ms、p95=25.953ms、765.84 req/s，仅作本机对照。当前没有 product-model 专属回归测试；`response.json()` 抛错是否稳定映射需审计。

## 允许读取

`SITE_CONTRACT.md`、`lib/product-model.ts`、`app/api/cases/[caseId]/messages/route.ts`、`lib/domain.ts` 中调用与 Context Packet、`.env.example`、`package.json`、`test/site-domain.test.mjs`。

## 唯一允许写入

- `lib/product-model.ts`
- `app/api/cases/[caseId]/messages/route.ts`
- `test/product-model-stability.test.mjs`（允许新增）

## 排除项

不得写 UI/CSS/domain/flow-workspaces/其他 routes/其他 tests；不得安装、部署、Git 写操作、浏览器或真实网络；不得读取/输出任何凭据；不得把 stub 写成 live。

## 唯一验收命令

审计/实现完成后只运行一次：

`node --experimental-strip-types --test .\test\product-model-stability.test.mjs`

不得先用作 baseline；失败后停止，不补跑。

## 最终证据

报告确认根因或无缺陷结论、实际写入、离线 mock/资源恢复证据、唯一命令摘要、测试计数、denial/spawn EPERM、性能结论与范围外发现。终止必须真实 `turn.completed`。
