# rework-2 检查点记录

执行：ZCode 主 Agent（单 writer 串行）。任务契约：`V6/ZCODE_REQUEST_OWNERSHIP_CLOSEOUT.md`（未改写）。缺陷输入：`V6/CODEX_REVIEW_REWORK_1/REPORT.md`（F1/P1 + F2/P2）。

## CP0：开工检查点

- 允许文件 13 个副本 + SHA256：`evidence/pre-snapshot/`。Git 状态：非 Git 仓库（如实记录）。
- 实例归属（端口→PID→命令行核验）：3311=28568（现场，全程只读）；3321=28460（dev，rework-1 数据目录）；3399=14964（生产模式，rework-1 构建产物 + production-data）——3399 服务的是带 F1 缺陷的当前交付源码，用作 CP1 红复现现场。

## CP1：先以真实组件复现（完成）

**红证据**：`evidence/repro/f1-both-channels-red.json`——两通道均在 3399 生产页以真实组件交互失败（非"函数不存在/源码不匹配"式红）：

- 消息通道：A 落账丢回执 → 编辑 B → 发送被阻断（**新增 POST=0**，阻断本身正确）→ 确认 A（幂等成功）→ **B 被清空**，且旧错误文案"本次未发送；内容已保留"与空输入残留。
- 说明通道：A 未达（表单保持打开）→ 编辑 B → 阻断（POST=0）→ 确认 A（此刻首送成功）→ 切换情景后重开表单 → **草稿为空**（B 被抹掉）。

### 最小请求归属模型（实现前冻结）

一次回执的**清理资格**由四个维度共同决定，缺一不可：

1. **请求身份（requestId）**：全局唯一幂等键。回执（成功/失败/冲突/finally）只允许影响"当前记录仍是该 requestId"的通道状态（已有 `isSameRequestOwner`）；**草稿关联也必须挂在 requestId 上**（F1 缺口——此前挂在"最近一次点击"上）。
2. **发送时草稿修订（draftRevision at send）**：请求真正发出（新建或重放，即携带 requestId 的结果返回）时冻结 `{requestId, revision}` 关联；**被阻断的新提交（无 requestId）不得改写关联**。清空草稿 = 关联.requestId === 确认的 requestId **且** 关联.revision === 当前修订（`shouldClearDraftForRequest`）。
3. **情景生命周期**：回执应用的上下文是**页面当前情景**（`overviewRef.current.scenario`），不是发送时情景快照（F2 缺口——原实现比较错对象）；同名情景往返（A→B→A 生命周期）由服务端全局单调版本区分，版本门保留不放松。
4. **当前确认尝试（confirm attempt）**：确认动作以开始时的记录 requestId 为准；响应到达时重新判定所有权，非所有者 → 结果标记 `stale`，**不清理记录、不产生任何新提示/横幅/忙碌污染**（成功和失败副作用全部先判归属）。

不引入队列平台；关联是每通道至多一条的 `{requestId, revision}` 标量。

### 协议/依赖影响评估

无冻结接口变更；`SubmitOutcome/ResolveResult` 为 app/v5-preview 内部组件接口的最小扩展（ok/conflict 结果携带 requestId；ResolveResult 增加 'stale'）。无新依赖。→ 继续 CP2。

## CP2：修复实现记录（完成）

**F1 修复——草稿关联绑定请求身份（非"最近一次点击"）**：

- `rows-logic.ts`：新增 `DraftRequestAssociation {requestId, revision}` + `shouldClearDraftForRequest(association, confirmedRequestId, currentRevision)`——清空资格 = 关联存在 ∧ 确认的 requestId === 关联.requestId ∧ 修订未前进；`SubmitOutcome` 的 ok/conflict 携带 `requestId`（error 仅在结果未知时携带）；阻断结果（PENDING_REQUEST_EXISTS）**不携带 requestId**。
- `page.tsx`：submitNote/sendMessage 所有"真正发出"的返回路径携带 `body.requestId`；`resolveRequest` 返回 `ResolveOutcome {result: 'ok'|'failed'|'stale', requestId}`。
- `todo-card.tsx/chat-panel.tsx`：`draftAssocRef` 只在 `result.requestId !== undefined` 时写入（**被阻断的 B 不改写 A 的关联**）；提交成功与恢复确认成功都经 `shouldClearDraftForRequest` 判定——确认 A 永远不能用 B 的修订号授权清空。

**F2 修复——情景门比对当前上下文 + 副作用先判所有权**：

- `applyWriteResponse`：`shouldApplyWriteResponse(next.scenario, overviewRef.current.scenario)`——比对**真实当前上下文**；删除错误的 sentScenario/record.scenario 快照比较（旧回执与发送时情景本来就相同，比快照永远放行）。同名情景往返（A→B→A 生命周期）由服务端全局单调版本区分；版本门保留不放松；service/store 零修改。
- submitNote/sendMessage catch：`owner` 先判定——`writeOutcome` 的 onConflict 仅在 owner 时接线（陈旧回执不得设置冲突横幅）；非 owner 的 409 返回 `STALE_REQUEST`（携带 requestId 标识所属请求）。
- `resolveRequest`：成功/失败路径全部先判所有权——非 owner → `stale`（不清理记录、不设置 notice、不触发刷新反馈）；NETWORK+owner → failed（行内可重试提示）；`setResolving(null)`（finally）保留无条件释放（忙碌语义非请求状态）。
- 反馈一致性（任务书 CP2-5）：`clearDraft/clearInput` 同步清理 error/conflictHint；提交成功无论是否清空都撤下旧错误；确认成功未清空（保留新草稿）时同样撤下过时阻断提示——"输入已丢失却仍写'内容已保留'"与"成功后仍要求确认已消失请求"两个场景均闭合。

**修改文件**：page.tsx 94 行｜rows-logic.ts 48 行｜todo-card.tsx 85 行｜chat-panel.tsx 59 行｜api-client.ts 4 行（writeOutcome 返回类型标注为中间结果 `WriteOutcomePending`，page 附加 requestId 后才是 SubmitOutcome——任务书"内部辅助模块最小调整"许可内，无 schema/端点/语义变化）｜test/v5-preview.test.mjs 10 行 + rework1 8 行（断言适配至新接线，均为等价或更强）｜新增 test/v5-preview-rework2.test.mjs。**零修改**：preview.module.css、rows-view、domain-row、service、store、v6fix 测试（SHA256 对照 `evidence/pre-snapshot/SHA256SUMS.txt` 与 `evidence/post-rework-SHA256SUMS.txt`）。

**单元回归（红先于实现："函数不存在"不充当红证据——真实红 = CP1 浏览器复现）**：rework2 测试 5 项 = `shouldClearDraftForRequest` 真值表（确认 A 不得清 B/修订前进不清/无关联不清）+ page 接线（ok 必带 requestId、阻断结果必不带、onConflict 按 owner 接线、情景门比对 current.scenario 且禁绝快照比较）+ 组件接线（关联按 requestId 建立、clearDraft/clearInput 清理旧反馈、stale 分支显式静默）。

## CP3：可复验收口证据（完成）

真实浏览器矩阵 10 项全过（`evidence/verify/browser-matrix.json`，3321 dev + 3399 生产双现场）：

| # | 路径 | 结果 |
| --- | --- | --- |
| M1 | F1 消息通道（阻断→确认→B 保留+反馈清理） | PASS |
| M2 | F1 说明通道（跨卸载+情景切换草稿留存） | PASS |
| M3 | 刷新恢复 + 新草稿阻断 + 确认后保留 | PASS |
| M4a | 消息 A→B→A 修订序列 | PASS |
| M4b | 说明在途编辑 B（trace 证实编辑已提交进状态）→ 回执 → 切换 → 保留 | PASS（附两种时序的如实记录） |
| M5 | 双通道同时未知互不误清 | PASS |
| M6 | 确认在途时切换情景：陈旧确认回执（409）静默、无陈旧提示、情景不翻转 | PASS |
| M7 | 真正旧 GET 晚到不回退 | PASS |
| M8 | 确认失败→行内提示保留可重试；重试成功→提示清理；双击幂等；决定性探针单次 POST | PASS |
| M9 | 3399 生产构建 F1 同序列 + 无开发按钮 | PASS |
| M10 | 视口：390×844 等效（429×928，×1.1 映射）首屏 bottom=818.4 完整（基准 817.78 无回归）；360×844 精确无溢出；1920×1080 精确无溢出首屏完整 | PASS（映射差异如实标注） |

**Gate**（evidence/verify/）：单元+行为 **64/64**（FE 22 + v6fix 26 + rework1 12 + rework2 5，`unit-tests-green.txt`）｜typecheck **exit 0**｜lint **0 error**（1 既有 v4life warning）｜`next build` **exit 0**（`gate-build.txt`）｜HTTP phase1 **6/6** + 重启后 phase2 **1/1**（幂等表跨重启恢复）——首次 phase1 5/6 系脚本数据目录错配（指向 rework-1 数据文件），已参数化 `V5_VERIFY_DATA_FILE/V5_VERIFY_RUN_ID` 修正重跑，rework-1 数据文件经自恢复机制完好（v8）。**3399 生产验证**：rework-2 源码重建 + 重启（新 PID 28572），F1 同序列在生产页通过（M9）。3311 现场全程只读。

**真实交互回归的可重复步骤**（自动化能力仅覆盖纯函数；真实组件行为以可重复浏览器步骤补齐，不自称等价）——见 `verification/f1-browser-steps.md`。

