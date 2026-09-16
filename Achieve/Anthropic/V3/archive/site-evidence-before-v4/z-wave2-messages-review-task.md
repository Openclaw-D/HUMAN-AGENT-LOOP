# Z Wave 2 / Lane 3 — Messages + Product Model reviewer (read-only)

工作目录：`C:\Users\22673\Desktop\Anthropic\jianwei-v3\site`

你是只读 reviewer。不得修改、创建或删除任何源码、测试、配置、文档或证据文件；JSONL 由外部 runner 记录。先读取 `SITE_CONTRACT.md`，再只读审计 `lib/product-model.ts`、`lib/domain.ts` 中 message runtime、`app/api/cases/[caseId]/messages/route.ts`、`test/product-model-stability.test.mjs`、`test/site-domain.test.mjs` 及直接依赖。

冻结语义：未配置独立 `JIANWEI_MODEL_API_KEY` 时只能是 deterministic“本地候选推理”；不得读取或复用 runner/其他凭据；live 请求失败必须 fail closed；模型 authority=none。不得发起真实产品模型请求，不得把 stub 写成 live，不得改变 schema/API/错误码。

唯一问题：寻找 timeout 是否覆盖 fetch 与 body 消费、abort/timer/body release、invalid JSON/non-2xx、large input、message idempotency/conflict/concurrency、Context Packet 克隆隔离和资源泄漏方面的可复现缺陷。所有复现必须完全离线、确定性；性能热点需有可执行证据，不能凭猜测。没有确认缺陷时明确写“未发现可复现缺陷”。不得引入依赖、读取/输出凭据、联网、Git 写、部署、UI/CSS/产品改造。

唯一允许执行的验收命令（最多一次）：
`node --experimental-strip-types --test .\test\product-model-stability.test.mjs`

输出必须包含：审计结论；候选缺陷的严重度、精确文件/行、根因、最小离线复现和契约影响；已排除假阳性；唯一命令退出码；是否 `spawn EPERM`；确认零文件写入、零残留、零凭据访问。不要实施修复。
