# 智谱 coding repair checkpoint

任务类型：`repair`

## 固定目标

只修复 `lib/v4/authority-policy.ts` 的 5 个已冻结 contract defects，使 CP1A 的 15 条公开测试通过；不改变 types/tests/API。

## 冻结契约

Public API 保持 `evaluateV4Authority(request: V4AuthorityRequest): V4AuthorityDecision`。它必须 synchronous、pure、deterministic：无 I/O/env/Date/random，不修改输入，action/resource 输出 deep clone；业务拒绝不 throw。

固定优先级保持：`INVALID_IDENTITY` → `INVALID_ROLE_ASSIGNMENT` → `RESOURCE_SCOPE_MISMATCH` → `EXPLICIT_DENY` → `MISSING_GRANT` → `STALE_CONTEXT` → `STALE_POLICY` → authority-source restriction → `ALLOWED`。

只做以下 repairs：

1. Type-only import 改为 `./authority-types.ts`。
2. RoleAssignment 同时验证 assignmentId、actorId、scope shape，并要求 scopeCoversResource 当前 resource；不覆盖即 `INVALID_ROLE_ASSIGNMENT`。
3. external_human 的 request scope 必须在 `RESOURCE_SCOPE_MISMATCH` 阶段、explicit deny/grant 之前验证：presentedInvitationId 必须等于 actor invitationId，resource 必须是 invitation caseId，resource organizationPath 必须精确等于 invitation organizationPath。external grant/deny 只有 invitationId 与同一 invitation 匹配才可生效；wrong/missing invitation 不得授权。
4. grantId/denyId 排序禁止 localeCompare；用显式 ordinal string comparison（`a < b ? -1 : a > b ? 1 : 0`），确保 locale-independent determinism。
5. 在 action-resource compatibility 前验证 full action vocabulary；unknown family/name 返回 `RESOURCE_SCOPE_MISMATCH`，并且不能匹配 grant/deny。合法 vocabulary 以 authority-types.ts 为唯一准则。
6. defensive invalid Actor handling：对公开 contract 已表达的 malformed shapes 返回 `INVALID_IDENTITY`，decision construction 不得因为缺失/无效 actor shape 再次 throw。

保留既有正确语义：Role 不是 grant；action-resource matrix；deny/grant exact matching；Case Context freshness；stale policy；capability prepare-only=`CAPABILITY_PREPARE_ONLY`；external observe/prepare-only=`EXTERNAL_SCOPE_RESTRICTED`；authorized_rule/system_service unknown=`AUTHORITY_SOURCE_UNKNOWN`；stable matched IDs；zero mutation。

## 当前失败证据

上一候选的 public acceptance 因 default Node test isolation `spawn EPERM` 未执行 15 tests。Controller 已独立证明当前 Node 22.23.1 使用 in-process isolation 可运行 V4 tests；本 repair 使用新的 acceptance command，不升级 sandbox。

## Allowed reads

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-types.ts`：只读一次。
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-authority-policy.test.mjs`：只读一次。
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-policy.ts`：只读一次。

## Allowed writes

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-policy.ts`：唯一 writer，仅此文件。

## Excluded

禁止读取或运行 `v4-authority-policy-controller.test.mjs`。禁止读取/修改 task pack、manifest、JSONL、docs、index、capability files、V3、package、app/frontend、Git metadata、runner evidence 或任何其它路径。禁止目录枚举、搜索、Test-Path、额外 parser/lint/test command。

## Command Gate

Controller 已冻结缺陷、manifest admission 与 provider-free preflight；hidden Gate 不提供给 worker。

Worker 只允许：用一次 Get-Content command 同时读取三个 allowed reads；用 file-change 工具修改唯一 allowed write；然后运行下列 acceptance command恰好一次。禁止重复读取、重复 acceptance 或其它 command。

`node --experimental-strip-types --test --experimental-test-isolation=none ./test/v4-authority-policy.test.mjs`

## Route v2 admission

Profiles：exact-shape、clone、algorithm。Manifest v2 固定 maxCommandEvents=3、maxReadsPerAllowedFile=1、禁止目录枚举和未分类 command；model=glm-5.3-flash、effort=high、sandbox=workspace-write；conservative ROI 必须 delegate。

## Stop conditions

contract conflict、scope violation、test failure、permission denial、provider_error、rate_limit、quota、authentication、network、timeout 或 incomplete terminal 时立即停止；不重试，不扩大范围，不由 Codex 接管。

## Final evidence

报告唯一修改文件、acceptance exit/TAP、turn.completed、usage/fresh/cache、wall time、denial/provider errors/rate limit/residue；不要读取或运行 hidden Gate，不声称最终接受。
