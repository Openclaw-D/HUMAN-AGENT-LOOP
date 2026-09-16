# Z Wave 2 / Lane 1 — Evidence canonical reviewer (read-only)

工作目录：`C:\Users\22673\Desktop\Anthropic\jianwei-v3\site`

你是只读 reviewer。不得修改、创建或删除任何源码、测试、配置、文档或证据文件；JSONL 由外部 runner 记录，不属于你的写入权限。先读取 `SITE_CONTRACT.md`，再只读审计 `lib/evidence-runtime.ts`、`lib/shared-context-projection.ts`、`app/api/cases/[caseId]/evidence/route.ts`、`test/evidence-runtime.test.mjs` 及它们的直接依赖。

冻结语义：Canonical Evidence/Event 与同一 Context Version 四路共享；同 requestId 同载荷精确重放、异载荷冲突；同 evidenceId 同规范载荷即使新 requestId 也精确重放最初 Receipt 且不推进版本，异载荷冲突；失败不推进。进程存活期间绝不允许 LRU、eviction、TTL 或容量淘汰牺牲幂等。进程重启清空是已知 demo 边界，不得伪装成生产持久化。

唯一问题：寻找 canonical idempotency、规范化/Unicode、prototype key/getter、clone alias、并发和长期状态方面的可复现缺陷。只报告可由当前代码与确定性本地命令复现的问题；区分契约缺陷、已知进程内边界和纯建议。没有确认缺陷时明确写“未发现可复现缺陷”。不得建议改变 schema/API/错误码、引入依赖、读取凭据、联网、Git 写、部署、UI/CSS/产品改造。

唯一允许执行的验收命令（最多一次）：
`node --experimental-strip-types --test .\test\evidence-runtime.test.mjs`

输出必须包含：审计结论；每个候选发现的严重度、精确文件/行、根因、最小确定性复现和为何违反冻结契约；已排除的假阳性；唯一命令的退出码与关键输出；是否发生 `spawn EPERM`；确认没有文件写入、没有残留进程、没有凭据访问。不要实施修复。
