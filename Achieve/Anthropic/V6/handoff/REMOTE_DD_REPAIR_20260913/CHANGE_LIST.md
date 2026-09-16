# CHANGE_LIST｜REMOTE_DD_REPAIR_20260913

对照 `V6/CODEX_REVIEW_REMOTE_DD_20260913/REPORT.md` F1–F7 逐项。修复位置/方式/证据索引。

## F1（P1）原样重试与草稿/请求恢复 — 已关闭

- `app/v5-preview/remote-session/page.tsx` 重写 runWrite：
  - 发送前持久化完整原请求 `{path, body(含 requestId), ownerSessionId, op, savedAt, draftRevision}` → `sessionStorage['jw:v5-preview:remote-pending-request']`（覆盖发送中刷新窗口）。
  - 重试判定：同 path+op+owner+业务载荷一致 → **复用记录中的 requestId**（不借新 ID 冒充）；载荷不同（如版本推进）→ 新请求。
  - NETWORK → 记录保留 + 恢复条（原样重试/显式放弃）；确定性结果（含 409 明确未提交）→ 清记录 + 就近错误显示。
  - 挂载恢复：刷新/离开返回后记录条自动恢复（owner 不匹配不自动重放）。
  - 提问草稿：`questionRevisionRef`（修订）+ `draftAssocRef`（requestId+修订关联）双判定清空；提交中编辑/A→B→A 不误清。
  - 修复过程中发现并关闭的关联缺陷：createSession 及全部写调用体缺 expectedVersion、发送体漏 sessionId（重建时回归，组件测试暴露后修复）。
- 证据：`evidence/gate-*.txt`；浏览器组件时间线（同 requestId 三次尝试、恰好创建一条、跨刷新同 ID 重放成功）见 REPORT §3。

## F2（P1）暂停为服务端执行门 — 已关闭

- `lib/v5-preview/remote-service.ts`：`SESSION_PAUSED` 独立错误（HTTP 409）；暂停中阻断 `simulateFollowUps`（模型推进）与 `confirm`/`escalate_human`（确认通过类）；`request_resupply/request_retake/correct` 仍可用（补证/纠正）。
- `resume_round` 显式人工恢复动作：仅 paused 态可用、留痕于复核记录、generation+1（旧在途结果被代际隔离）。
- SessionRecord 新增 `generation`。前端仅如实呈现暂停态并禁用确认按钮（服务端为真门）。
- 证据：repair 测试 F2（红→绿）。

## F3（P1）复核资格撤销与证据失效 — 已关闭

- 当前有效确认按时间序现算：confirm 后发生 retake/resupply/correct/escalate → 不再 human_verified（历史意见全保留）；最新动作是 confirm → 恢复 human_verified（规则明确可测）。
- superseded 证据：API 拒绝新 confirm（INVALID_INPUT）；投影 `expired=true`；关联标注显示"所属证据已过期"；新证据不继承旧确认。
- 证据：repair 测试 F3/F3b；验收探针首个断言翻转（`probe-after-repair.txt`：actual='unverified'）。

## F4（P1）核算幂等摘要与失效 — 已关闭

- 幂等摘要覆盖 `{requestId, sessionId, mode, inputs, op}`（**含 mode 与全部 inputs**）；expectedVersion 不入摘要（版本推进后原样重试仍是同一请求——与 rows 域教训一致）。同 ID 换输入 → REQUEST_MISMATCH；同输入重放 → 同一结果稳定返回。
- `CalculationRecord.basedOn = {remoteVersion, ruleConfigStatus, generation}`；详情投影现算 `stale`（basedOn.remoteVersion < 当前）→ UI 显示"已过期，不得继续作为现行结果"；历史结果本身不被改写。
- 证据：repair 测试 F4。

## F5（P1 待真机复验）触控与移动可用性 — 代码关闭，真机 NOT TESTED

- 圈选改 **Pointer Events**（pointerdown/move/up/cancel + setPointerCapture(try/catch 降级) + `touch-action:none` + clamp01 钳制），触摸/鼠标/笔统一；组件级以 pointerType='touch' 的 PointerEvent 实测圈选。
- 无障碍替代：`<details>` 数字输入精确标注（x/y/w/h 百分比 + 越界校验）。
- 手机首屏重排：会话状态/视频如实提示 → 证据与本地拍照 → 问题/复核/核算；参会人折叠（默认收起，toggle 展开）；角色中文化（见微协调/客户·实控人…）；技术 ID（sessionId/sha256）收进 `<details>`。
- **真机触摸/软键盘 NOT TESTED**（无真机）；桌面 Chrome pointerType='touch' 合成事件与 429×928 视口仿真留证。

## F6（P2）证据摘要真实性 — 已关闭

- 新证据 `sha256` = `sha256(renderFixtureSvg(fixtureId))` **实际返回原图字节**；同 fixture 重复附着摘要稳定（不掺历史 ID）。
- 记录新增 `digestOf: 'fixture_bytes' | 'fixture_meta_legacy'`；缺省的历史记录读取时按 legacy 显示（不拒绝、不覆盖、不伪称原件 hash）；UI 显示"sha256(旧语义legacy)"。
- 证据：repair 测试 F6（字节摘要一致 + legacy 兼容直写验证）。

## F7（P2）声明更正 — 已关闭

- BASELINE 更正：site **是** Git 仓库（HEAD 63c41c3，92 dirty 项，v5-preview 全部未跟踪）；见 `BASELINE.md` + `evidence/pre-snapshot/git-status-site.txt`。
- remote-store 升级兼容策略公开（见 BASELINE"重大改版缺口"节）：遗留无 generation 的 remote-store.json 会被拒绝，恢复=删除该合成文件重建；rows-store 不受影响。
- READY_FOR_INTEGRATION 失败语义更正（见 MODEL_READINESS.md）：真实失败 → `failed/rejected` 独立状态，**不回退 model_simulation 冒充**；已实现并有 9 项故障路径回归。
- 鉴权边界更正：projectId 为冻结演示归属（服务端决定），非真实跨用户鉴权；身份未配置 → 本机合成演示可验收，不对真实客户开放（WRITE 面无可信身份校验，如实声明）。

## B｜provider adapter 与故障路径 — 已关闭

- `createModelProviderAdapter`：providerKind 归一化（real / 本地 fixed_stub）；请求含业务/会话/证据版本、角色与目的；结果结构化 `ok/partial/failed/rejected` + 失败原因；失败零回复（不冒充）。
- 本地 fake handler 验证 9 条故障路径（超时/畸形/空/部分失败/坏引用/暂停/过期版本/重复幂等/正常）；`modelCalls=0`。

## 涉及文件

`lib/v5-preview/remote-{types,store,service}.ts`｜`app/v5-preview/remote-session/{page.tsx,camera-panel.tsx(新增)}`｜`app/v5-preview/{page.tsx(概览入口不动，仅历史), preview.module.css(追加)}`｜`test/v5-preview-remote-repair.test.mjs(新增)`、`test/v5-preview-remote.test.mjs(env 隔离方式修正)`。rows 域产品文件零修改。
