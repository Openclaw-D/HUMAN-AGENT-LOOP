# STABLE_DEMO_BATCH_2 · rework-2 REPORT｜请求归属一致性收口

日期：2026-09-12。执行：ZCode 主 Agent（单 writer 串行）。任务契约：`V6/ZCODE_REQUEST_OWNERSHIP_CLOSEOUT.md`（未改写）；缺陷输入：`V6/CODEX_REVIEW_REWORK_1/REPORT.md`（F1/P1 + F2/P2）。

**状态：F1/F2 闭合，真实组件回归全过，Gate 全绿。执行者自测完成，待独立验收。**

---

## 1｜F1/F2 逐条修复位置与失败前/修复后证据

### F1/P1：被阻断的 B 覆盖草稿关联，确认旧 A 仍清掉 B — PASS

- **失败前（真实组件，非"函数不存在"式红）**：`evidence/repro/f1-both-channels-red.json`——3399 生产页（rework-1 源码）两通道复现：消息通道 A 落账丢回执 → 编辑 B → 阻断（0 POST，阻断本身正确）→ 确认 A → **B 被清空** + 旧"内容已保留"残留；说明通道同序列 → 切换情景后重开表单**草稿为空**。根因与 Codex 定位一致：`submittedRevisionRef` 在获知阻断前被无条件改写为 B 的修订号（"最近一次点击的修订号"不是请求身份）。
- **修复位置**：
  - `rows-logic.ts`：`DraftRequestAssociation {requestId, revision}` + `shouldClearDraftForRequest()`——清空资格 = 关联存在 ∧ **确认的 requestId === 关联.requestId** ∧ 草稿修订未前进；`SubmitOutcome` ok/conflict 携带 `requestId`（error 仅结果未知时携带）；**阻断结果不携带 requestId**。
  - `todo-card.tsx/chat-panel.tsx`：`draftAssocRef` 仅在 `result.requestId !== undefined` 时写入——**被阻断的 B 不改写 A 的关联**；提交成功与恢复确认成功都按关联判定清空。
  - `page.tsx`：所有"真正发出"的返回路径携带 `body.requestId`。
- **修复后**（`evidence/verify/browser-matrix.json` R2-M1/M2/M3）：消息通道确认 A → B 保留 + 陈旧错误清理 + 单次幂等重放；说明通道跨"表单卸载+情景切换"后 B 原文保留；刷新恢复后新草稿同样保留。单元真值表：`test/v5-preview-rework2.test.mjs` 第 1 项。

### F2/P2：情景归属检查比较错对象 + 回执副作用未受所有权约束 — PASS

- **失败前（代码审查确认，未声称浏览器复现情景翻回）**：`shouldApplyWriteResponse(next.scenario, sentScenario)` 第二参数应为当前上下文却传了发送时快照——旧回执的 next.scenario 与快照本来相同，检查永远放行；`writeOutcome`（设置冲突横幅）先于 owner 判定调用；恢复路径的 notice/resolving 修改无完整所有权保护。
- **修复位置**：
  - 情景门改接线：`shouldApplyWriteResponse(next.scenario, overviewRef.current.scenario)`——比对**真实当前上下文**；同名情景往返（A→B→A 生命周期）由服务端全局单调版本区分；版本门保留，service/store 零修改，未用情景门掩盖后端版本行为。
  - 副作用顺序：`owner = isSameRequestOwner(...)` **先判定**；`writeOutcome` 的 onConflict 仅在 owner 时接线（陈旧回执不设横幅）；非 owner 的 409 → `STALE_REQUEST` 返回（携带 requestId）。
  - `resolveRequest`：成功/失败全路径先判所有权，非 owner → `stale`——不清理记录、不设置 notice、不产生任何新反馈（`ResolveResult` 增加 'stale'，组件显式静默分支）；`setResolving(null)`（finally）保留无条件释放（忙碌语义）。
- **修复后**（matrix R2-M6）：确认动作在途时切换情景 → 旧确认回执（服务端 409：版本推进+幂等表清空）到达后：情景全程不翻转、**无陈旧"确认…未完成"提示**、无残留行、seedNotice 正常。

### 反馈一致性（任务书 CP2-5）— PASS

- `clearDraft/clearInput` 同步清理 error/conflictHint；提交成功无论是否清空都撤下旧错误；确认成功未清空（保留新草稿）时同样撤下过时阻断提示。"输入已丢失却仍写'内容已保留'"（F1 复现中的残留）与"成功后仍要求先确认已消失请求"两个场景在 R2-M1/M2/M3 中验证闭合。

## 2｜修改文件、diff 与哈希

| 文件 | diff 行数 | 说明 |
| --- | --- | --- |
| `app/v5-preview/page.tsx` | 94 | 结果携带 requestId、情景门接线、副作用所有权 |
| `app/v5-preview/rows-logic.ts` | 48 | 关联判定/类型扩展 |
| `app/v5-preview/todo-card.tsx` | 85 | draftAssocRef + 确认处置 + 反馈清理 |
| `app/v5-preview/chat-panel.tsx` | 59 | 同构 |
| `app/v5-preview/api-client.ts` | 4 | writeOutcome 返回类型标注（WriteOutcomePending 中间结果；内部辅助模块最小调整许可） |
| `test/v5-preview.test.mjs` | 10 | 断言适配（更强：requestId 绑定判定） |
| `test/v5-preview-rework1.test.mjs` | 8 | 断言适配 |
| `test/v5-preview-rework2.test.mjs` | 新增 | 5 项回归 |
| preview.module.css / rows-view / domain-row / service / store / v6fix 测试 | **零修改** | SHA256 与开工前一致 |

哈希：开工前 `evidence/pre-snapshot/SHA256SUMS.txt`（13 文件）；完工 `evidence/post-rework-SHA256SUMS.txt`（源码与 `.v6-runtime` 副本逐一相同）。

## 3｜请求与草稿关联时间线（合成数据，摘自 browser-matrix.json）

- R2-M1（消息）：POST messages（A，落账，回执注入丢弃）→ 提交 B：**0 POST** + 阻断提示 → 确认：POST 1 次（A 原载荷幂等重放，消息数 3 不变）→ **输入=B 原文**、chatError=null、行消失。
- R2-M2（说明）：POST notes（A，发送前失败，0 POST）→ 提交 B：**0 POST** + 阻断 → 确认：POST 1 次（A 首送，v+1，待复核）→ 切换情景 → 重开表单 = **B 原文**。
- R2-M6：确认消息在途（delay）期间确认切换 → 行消失/记录作废 → 旧确认回执（409）到达 → 无陈旧提示、情景 post-rental 全程稳定。

## 4｜测试命令 / 计数 / 退出码；运行方式

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 全部聚焦 V5 测试 | `node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview*.test.mjs`（4 文件） | **64/64，exit 0**（`evidence/verify/unit-tests-green.txt`） |
| typecheck | `npm.cmd run typecheck` | exit 0 |
| lint | `npm.cmd run lint -- --ignore-pattern ".v6-runtime/"` | exit 0，0 error / 1 既有 v4life warning |
| 隔离构建 | `next build`（.v6-runtime；构建前停止 3321/3399，未同时构建破坏服务中输出） | exit 0（`gate-build.txt`） |
| HTTP 验证 | `node http-verify.mjs phase1`（数据文件经 `V5_VERIFY_DATA_FILE` 指向 rework-2 目录；脚本已加种子重置前置） | **6/6**（`http-verify-phase1.txt`） |
| 重启恢复 | 归属校验停止 → 重启 → `phase2` | **1/1**（幂等表跨重启恢复；`http-verify-phase2.txt`） |
| 真实组件回归 | 浏览器步骤见 `verification/f1-browser-steps.md`（可重复；自动化能力仅纯函数，不自称等价） | 10 项全过（`browser-matrix.json`） |

**运行实例（当前状态）**：3399 生产（**rework-2 重建**，PID 28572，数据 `rework-2/evidence/production-data/`，保留运行供验收——F1 序列在生产页实测通过、无开发按钮）；3321 dev（PID 21340，rework-2 数据目录）；3311 现场（PID 28568）全程只读未动。

## 5｜逐项结论（PASS/FAIL/NOT TESTED）

| 任务书要求 | 结论 |
| --- | --- |
| F1 两通道真实交互回归（当前实现失败→修复后通过） | **PASS**（红：repro JSON；绿：M1/M2） |
| 普通 A 在途编辑 B / A→B→A（消息+说明） | **PASS**（M4a/M4b；M4b 附两种时序如实记录） |
| 原请求确认与被阻断新提交交错 | **PASS**（M1/M2/M3） |
| 刷新恢复 + 新草稿 | **PASS**（M3） |
| 两通道互不误清 | **PASS**（M5） |
| 情景切换取消/确认 + 旧成功/旧失败/旧 finally | **PASS**（M6；取消路径沿用 rework-1 已验语义本轮复核未回归） |
| 真正旧 GET 晚到 | **PASS**（M7） |
| 确认失败/成功后反馈一致 | **PASS**（M8 + 决定性探针） |
| 3399 生产模式验证最终交付源码 | **PASS**（M9：重建+重启+生产页 F1 序列+无开发按钮） |
| 精确 390×844 / 360 宽 / 1920×1080 | **PASS（附说明）**：IAB 视口映射跨标签不一致（部分 ×1.1、部分字面），实际值如实记录——390 基准（429×928）首屏 bottom=818.4 与独立验收基准 817.78 一致无回归；360×844 精确无溢出（按钮 bottom 850.4 略超 844 首屏下沿，为 360 宽内容换行所致、非本轮改动引入，独立验收在 360 宽仅校验溢出）；1920×1080 精确无溢出首屏完整 |
| 真机软键盘 | **NOT TESTED**（无真机条件，沿用既往） |

## 6｜已知限制 / 恢复方法

1. 说明表单随待复核卸载为既定产品语义：若用户向已卸载表单键入（编辑未进入 React 状态），该内容不属于草稿状态——属表单卸载时序固有边界，M4b 两种时序均已如实记录（提交进状态的编辑跨卸载+切换保留）。
2. 双击确认的两击同帧窗口内第二击可能发出同载荷请求，由服务端幂等兜底（不重复记账）；按钮随即进入禁用态。未做防抖（超出最小修复范围）。
3. `http-verify.mjs` 首轮 5/6 系脚本数据目录错配（指向 rework-1 数据文件；该文件经脚本自恢复机制完好 v8），已参数化修正；非产品缺陷，如实记录。
4. IAB 工具限制沿用：setViewportSize 每标签页仅首次生效（每尺寸独立新标签页）、截图管道间歇超时（以 DOM 度量+已保存截图替代）。
5. 恢复：产品代码用 `evidence/pre-snapshot/` 13 文件覆盖回；删除 `test/v5-preview-rework2.test.mjs`；清理 `site/.v6-runtime/` 与 `rework-2/evidence/{runtime-data,production-data}/`；3399 停止 `taskkill /PID 28572 /T /F`、3321 停止 `taskkill /PID 21340 /T /F`（执行前仍需归属核验）。

## 7｜停止

F1/F2 闭合、真实组件回归 10 项全过、Gate 全绿（64/64、tsc 0、lint 0 error、HTTP 7/7、build 0、生产页 F1 通过）。**执行者自测完成，待独立验收**；不自动开始客户目录/目标/权限/AI 等未授权方向，不自行调用 Codex。
