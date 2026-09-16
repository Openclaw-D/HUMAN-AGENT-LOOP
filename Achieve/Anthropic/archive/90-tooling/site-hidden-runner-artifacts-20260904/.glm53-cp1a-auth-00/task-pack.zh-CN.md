# 智谱 coding checkpoint

任务类型：`implementation`

## 固定目标

实现 CP1A pure authority evaluator，使冻结的 15 条公开测试一次通过。

## 冻结契约

唯一 public API：

```ts
evaluateV4Authority(request: V4AuthorityRequest): V4AuthorityDecision
```

它必须是 synchronous pure function：不返回 Promise、不做 I/O、不读取 env、不使用 Date/random、不修改输入；输出的 action/resource 必须 deep clone。禁止发明 role-to-permission mapping、delegation、timestamp、persistence、真实组织名称或额外 authority source。

固定优先级：`INVALID_IDENTITY` → `INVALID_ROLE_ASSIGNMENT` → `RESOURCE_SCOPE_MISMATCH` → `EXPLICIT_DENY` → `MISSING_GRANT` → `STALE_CONTEXT` → `STALE_POLICY` → authority-source restriction → `ALLOWED`。

Identity invariants：

- internal_human/capability/authorized_rule/system_service：actorId non-empty；organizationPath 为 non-empty valid path；externalInvitation 必须 null。
- external_human：actorId non-empty；organizationPath 必须 null；externalInvitation 必须存在，且 invitationId、caseId、organizationPath 全部有效。
- 所有字符串 ID 与 organizationPath segment 必须 non-empty（空白字符串也无效）。Actor 失败返回 INVALID_IDENTITY。
- RoleAssignment 的 assignmentId/actorId/scope path 必须有效；actorId 必须等于 request actor；scope 必须覆盖 resource organizationPath。失败返回 INVALID_ROLE_ASSIGNMENT。RoleAssignment 仅是 policy input，永不直接授权。
- ResourceRef 的 resourceId/path 无效返回 RESOURCE_SCOPE_MISMATCH。

V4ActionResourceCompatibility 固定 matrix：observe_organization→organization；observe_case→case；observe_capability→capability_version；observe_access_grant→access_grant；prepare/manage_work/professional_decide/execute_authorized_action→case；govern_access→access_grant；govern_capability→capability_version。任何不兼容先返回 RESOURCE_SCOPE_MISMATCH。

Scope 语义：exact 必须完整 path 相等；subtree 必须是 path prefix。grant/deny 只在 actorId、exact action family+name、resource type、resourceId（exact 或 `*`）、organization scope、policyVersion 匹配时生效。稳定选择 lexicographically smallest grantId/denyId。存在针对当前 actor/action/resource 的 scope candidate 但组织范围越界时返回 RESOURCE_SCOPE_MISMATCH；没有匹配 grant 时返回 MISSING_GRANT。

Context/Policy：prepare、manage_work、professional_decide、execute_authorized_action 都是 Case action，expected/current Context 必须 non-empty 且相同，否则 STALE_CONTEXT；observe 不要求 expected，Decision 回显 currentContextVersion。grant 匹配后 policyVersion != currentPolicyVersion 返回 STALE_POLICY。

Authority source：

- capability 只有 exact actor grant + exact Case resourceId + exact organization scope + fresh Context 时可 prepare。其它 manage/professional/govern/execute 即使有 grant 也返回 CAPABILITY_PREPARE_ONLY。
- external_human 只有 exact invitationId + exact invitation Case + exact organization path 下的 observe/prepare 可 allowed；其它 family 即使有 grant 也返回 EXTERNAL_SCOPE_RESTRICTED。
- authorized_rule/system_service 在 CP1A 的所有 action 即使普通 grant 匹配也返回 outcome unknown + AUTHORITY_SOURCE_UNKNOWN。
- internal_human 在通过前述 Gates 且有 exact matching grant 后可 ALLOWED。

Decision 必须完整返回 outcome/reasonCode/policyVersion/actorId/deep-cloned action/deep-cloned resource/currentContextVersion/matchedGrantId/matchedDenyId。所有 denied/unknown 路径零写入。公开测试冻结了 EXPLICIT_DENY、MISSING_GRANT、STALE_CONTEXT、STALE_POLICY、CAPABILITY_PREPARE_ONLY、EXTERNAL_SCOPE_RESTRICTED、AUTHORITY_SOURCE_UNKNOWN、ALLOWED 的行为。

## 当前失败证据

新实现检查点：authority-policy.ts 尚不存在；Controller 只做过 fixture syntax/loadability，没有运行必然失败的 acceptance。

## Allowed reads

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-types.ts`：只读一次。
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-authority-policy.test.mjs`：只读一次。

## Allowed writes

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-policy.ts`：唯一 writer，仅此文件。

## Excluded

禁止读取或修改 task pack、controller test、manifest、JSONL、index/export/package/API/docs/frontend/V3/capability candidates、Git、依赖、网络、凭据与任何其它路径。禁止目录枚举、搜索、Test-Path、额外 lint/parser/test command。

## Command Gate

Controller 已完成 fixture syntax/loadability、manifest admission 与 runner preflight。新 fixture 缺少 solution 是初始状态，未运行必然失败的 missing-solution test。

Worker 只允许：用一次 Get-Content command 同时读取两个 allowed reads；用 file-change 工具创建唯一 allowed write；实现后运行下面 acceptance command恰好一次。禁止重复读取、重复 acceptance 或其它 command。

`node --experimental-strip-types --test ./test/v4-authority-policy.test.mjs`

## Route v2 admission

Profiles：exact-shape、clone、algorithm。Manifest v2 固定 maxCommandEvents=3、maxReadsPerAllowedFile=1、禁止目录枚举和未分类 command；workspace-write 只限当前 Git working directory；conservative ROI 必须 delegate。

## Stop conditions

契约冲突、scope violation、测试失败、permission denial、provider_error、rate_limit、quota、authentication、network、timeout 或非完整 terminal 时立即停止；不重试，不扩大范围。

## Final evidence

报告唯一修改文件、acceptance command/exit code、测试数量、turn.completed、usage、fresh/cache tokens、wall time、denial、provider errors、rate limit 与 residue；不要声称最终接受。
