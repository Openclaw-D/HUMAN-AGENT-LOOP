# Z Wave 2 / Lane 2 — Decision + Confirm Human Gate reviewer (read-only)

工作目录：`C:\Users\22673\Desktop\Anthropic\jianwei-v3\site`

你是只读 reviewer。不得修改、创建或删除任何源码、测试、配置、文档或证据文件；JSONL 由外部 runner 记录。先读取 `SITE_CONTRACT.md`，再只读审计 `lib/decision-runtime.ts`、`lib/domain.ts`、`app/api/cases/[caseId]/decisions/route.ts`、`app/api/cases/[caseId]/facts/[factId]/confirm/route.ts`（若路径存在）、`test/decision-runtime.test.mjs`、`test/site-domain.test.mjs` 及直接依赖。

冻结语义：模型 authority=none；reject/submit 与事实确认都必须由具名人类进入 Human Gate 并返回 Receipt；stage/flow 必须真实匹配；同 requestId 同载荷精确重放、异载荷冲突；失败不推进正式状态或 Receipt；当前页 Receipt 只按 stageId+flowId 隔离展示。不得改变 Receipt/schema/API/错误码。

唯一问题：寻找验证优先级、跨 stage/flow、request replay/conflict、并发、actor/authority、Receipt 克隆/序列和 confirm 状态推进方面的可复现后端缺陷。UI 源只能作为隔离契约证据，不得提出视觉或产品改造。没有确认缺陷时明确写“未发现可复现缺陷”。不得引入依赖、读取凭据、联网、Git 写或部署。

唯一允许执行的验收命令（最多一次）：
`node --experimental-strip-types --test .\test\decision-runtime.test.mjs .\test\site-domain.test.mjs`

输出必须包含：审计结论；每个候选发现的严重度、精确文件/行、根因、最小确定性复现和契约影响；已排除的假阳性；唯一命令退出码；是否 `spawn EPERM`；确认零文件写入、零残留、零凭据访问。不要实施修复。
