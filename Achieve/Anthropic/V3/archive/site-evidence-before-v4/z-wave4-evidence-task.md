# Z1 Evidence/Context 检查点

## 目标

审计并修复 Evidence request/evidence 幂等、失败不推进、四路 Context Version 一致、深克隆/别名、prototype key、并发和进程内状态无界增长风险。只修复能够由唯一测试证明的问题。

## 冻结契约

- 唯一事项 `FL-DEMO-001`；模型 `authority=none`；进程内合成 runtime，不得改成生产持久化。
- 输入 `{caseId,requestId,evidenceId,kind,title,summary,actor}`；错误码和 Receipt shape 保持不变。
- 当前验证优先级保持：`CASE_NOT_FOUND -> INVALID_REQUEST_ID -> INVALID_EVIDENCE_ID -> INVALID_KIND -> INVALID_TITLE -> INVALID_SUMMARY -> INVALID_ACTOR -> requestId replay/conflict -> evidenceId replay/conflict -> injected failure`。
- 同 `requestId` + 同规范化 payload 精确重放；同 `requestId` + 异 payload 为 `IDEMPOTENCY_CONFLICT`。
- 同 `evidenceId` + 同规范化 evidence payload，即使换了有效 `requestId`，必须重放最初 Canonical Receipt，不得生成新 Event、Receipt 或 Context Version；新 requestId 后续也必须重放同一 Receipt。
- 同 `evidenceId` + 异 payload 为 `EVIDENCE_ID_CONFLICT`。
- 失败和冲突不得推进任何 sequence/version/receipt；四个 stage runs 始终同一 contextVersion。
- 输入与每次输出都不能被嵌套修改或 `__proto__`/prototype 污染；同步 API 仍为同步。
- 进程内缓存不能无限增长；采用简单、有界、可测试的保留窗口即可，但不得改变 HTTP schema/错误码，也不得伪装为生产持久化。若不能在不破坏 Canonical 语义下安全处理，保留实现并在报告中明确风险。

## 当前失败证据

production baseline：第一次接受同一 `evidenceId` 后，再以新的 `requestId` 和完全相同内容 POST，返回 200 但 Receipt 不同，Context Version 再推进；字段 `sameEvidenceIdReplayedCanonicalReceipt=false`、`sameEvidenceIdAdvancedContext=true`。现有聚焦测试 5/5，但没有覆盖此场景。

## 允许读取

`SITE_CONTRACT.md`、`lib/evidence-runtime.ts`、`lib/shared-context-projection.ts`、`lib/domain.ts` 中 Evidence 包装、`app/api/cases/[caseId]/evidence/route.ts`、`test/evidence-runtime.test.mjs`。

## 唯一允许写入

- `lib/evidence-runtime.ts`
- `test/evidence-runtime.test.mjs`

## 排除项

不得写 UI/CSS/domain/flow-workspaces/routes/其他 tests；不得安装、部署、运行 Git 写操作或浏览器；不得读取/输出凭据；不得改变产品方向、schema、HTTP 错误码或把 stub 写成 live。

## 唯一验收命令

实现/审计完成后只运行一次：

`node --experimental-strip-types --test .\test\evidence-runtime.test.mjs`

不得先用该命令做 baseline；失败后停止，不补跑。

## 最终证据

报告确认根因、实际写入文件、唯一命令输出摘要、测试计数、是否有 permission denial/spawn EPERM、未修风险和任何范围外只读发现。终止必须真实 `turn.completed`。
