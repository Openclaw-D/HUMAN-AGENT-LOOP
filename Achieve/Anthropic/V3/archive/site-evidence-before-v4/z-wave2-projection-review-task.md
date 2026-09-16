# Z Wave 2 / Lane 4 — Shared Projection + Domain reviewer (read-only)

工作目录：`C:\Users\22673\Desktop\Anthropic\jianwei-v3\site`

你是只读 reviewer。不得修改、创建或删除任何源码、测试、配置、文档或证据文件；JSONL 由外部 runner 记录。先读取 `SITE_CONTRACT.md`，再只读审计 `lib/shared-context-projection.ts`、`lib/domain.ts` 的 Projection 组装、`lib/flow-workspaces.ts`、`test/shared-context-projection.test.mjs`、`test/flow-workspaces.test.mjs`、`test/site-domain.test.mjs` 及直接依赖。

冻结语义：只有政策/信审/商务/资产及固定 20 flow；exact stage shape；四路共享同一 contextVersion；每板块五流程严格 completed* -> active? -> locked*；completedStepCount 0..5；prepProgressPercent 只能 0/20/40/60/80/100；模型 authority=none；输出深克隆，不受调用方嵌套修改污染。不得改变产品流程、Workspace/UI/schema/API/错误码。

唯一问题：寻找 exact own shape、Reflect.ownKeys/symbol/prototype getter、单次 getter 读取、深克隆、四路同版、顺序状态、同步 API 和确定性性能退化方面的可复现缺陷。没有确认缺陷时明确写“未发现可复现缺陷”。不得引入依赖、读取凭据、联网、Git 写或部署。

唯一允许执行的验收命令（最多一次）：
`node --experimental-strip-types --test .\test\shared-context-projection.test.mjs .\test\flow-workspaces.test.mjs`

输出必须包含：审计结论；候选缺陷的严重度、精确文件/行、根因、最小确定性复现和契约影响；已排除假阳性；唯一命令退出码；是否 `spawn EPERM`；确认零文件写入、零残留、零凭据访问。不要实施修复。
