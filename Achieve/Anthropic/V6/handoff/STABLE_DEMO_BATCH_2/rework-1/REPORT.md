# STABLE_DEMO_BATCH_2 · rework-1 REPORT｜R1–R3 交互恢复缺陷返修

日期：2026-09-12。执行：ZCode 主 Agent（单 writer 串行）。任务契约：`V6/ZCODE_BATCH_2_REWORK.md`（未改写）；缺陷输入：`V6/CODEX_REVIEW_BATCH_2/REPORT.md`（部分通过，退回 R1–R3）。

**状态：三个检查点完成，验收矩阵 10 行全过，Gate 全绿。执行者自测完成，待独立验收。**

---

## 1｜R1/R2/R3 逐条修复位置与失败前/修复后证据

### R1：完整请求恢复，不是布尔标记恢复 — PASS

- **失败前**（真实浏览器复现，`evidence/repro/r1-note-refresh-confirm-noop.json`）：说明落账后丢回执 → 刷新 → 恢复条显示但点击「确认结果」**POST=0**（attemptRef 随刷新丢失，sessionStorage 仅存哨兵 '1'），恢复条永续残留。
- **修复位置**：
  - `page.tsx`：发送前建立完整恢复记录（requestId、expectedVersion、todoId、原文本、scenario 归属、savedAt），写入 `sessionStorage['jw:v5-preview:pending-note-request']`（消息通道独立键）——覆盖发送中刷新窗口；挂载时经 `parseStoredNoteRequest/parseStoredMessageRequest` 校验（结构/版本/类型/情景，`rows-logic.ts`）后逐字恢复；损坏/旧哨兵 → 「恢复受限」提示 + 显式清除，**无虚假确认按钮、不猜已提交**；旧版 '1' 哨兵不当作恢复成功（迁移清理）。
  - 确认动作 `resolveRequest`：按记录**原载荷重放**（`noteBodyFromRecord/messageBodyFromRecord`，不用当前版本重建）；成功/幂等回执才算确认；重放 409 = 未落账（幂等表先于版本门的可判定语义）→ 如实提示「未能在原版本落账（当前演示记录不包含该条内容）」，**不解释为必然已落账**；NETWORK 保留记录可重试；GET 不替代请求级确认。
- **修复后**（`evidence/verify/browser-matrix.json` M1/M2）：未达服务端 → 刷新 → 确认 = 原载荷发送一次成功、记录正确、提示消失；已落账丢回执 → 刷新 → 确认 = 幂等重放（同 requestId 同 expectedVersion），不重复、不回退、无残留。存储不可用时恢复行如实标注且当次会话确认仍可用（M6）。

### R2：消息与说明分别恢复，互不误清 — PASS

- **失败前**（`evidence/repro/r2-message-borrows-note-marker.json`）：消息未知结果被记入说明的哨兵标记；恢复条错标「补充说明」；确认按钮只读说明引用，消息 POST=0；说明成功**交叉误清**消息记录；原样重试幂等通过但恢复条永续。
- **修复位置**：双通道独立槽位（page.tsx `noteRecovery/messageRecovery` + 两个存储键）；恢复行/确认按钮/阻断文案按类型区分（`pendingRequestRowText/recoveryResolveLabel`：确认说明结果 / 确认消息结果）；`decideRepeatSubmit`——同类型同内容重放原请求、内容不同**阻断**（明确提示 + 新草稿保留，不静默覆盖旧记录）；成功只清对应通道；恢复入口不依赖待办状态（待补充/待复核/null 全部可达），已确认待复核仍不开放新普通提交。
- **修复后**（matrix M3–M6、M8）：两行同时可见且类型准确；确认说明后消息行保留（不误清）；消息确认独立成功清理；阻断路径零 POST；刷新后无假告警。

### R3：回执只能影响所属请求与所属草稿 — PASS

- **失败前**（`evidence/repro/r3-late-receipt-clears-new-draft.json`）：A 落账、回执延迟 3s；在途编辑 B；回执释放后 B 被清空（t=3010ms 存在 → t=4000ms 清空）。
- **修复位置**：草稿修订标识（todo-card `draftRevisionRef`/chat-panel `inputRevisionRef`，每次编辑自增；提交时冻结修订号）；成功清空唯一出口 `clearDraft/clearInput` 经 `shouldClearDraftAfterConfirmation(提交时修订, 当前修订)` 判定——**A→B→A 字符串相同但修订不同不清**；恢复入口重放成功同一判定；回执所有权 `isSameRequestOwner`（requestId 不匹配 = 被取代的陈旧回执，不得清理记录/触发横幅，STALE_REQUEST 静默路径）；`isStaleRecordScenario` + seed 清空——旧请求不污染新情景；**写入回执情景上下文门 `shouldApplyWriteResponse`**（返修中发现 seed 版本碰撞缺陷后补入，见 §3）。
- **修复后**（matrix M7、M9）：消息通道 A→B 与 A→B→A 全程 DOM 保留 + 保留提示；说明通道草稿跨「表单随待复核卸载 + 情景切换」后 DOM 完整留存（组件状态未被回执清空）；切换取消不写入；确认切换后旧恢复行不复活、旧在途回执不覆盖新情景（25 采样全程不翻转）。

## 2｜修改文件与哈希

修改（diff 行数对 pre-rework-snapshot）：`page.tsx` 405｜`rows-logic.ts` 235｜`todo-card.tsx` 164｜`chat-panel.tsx` 138｜`preview.module.css` 4｜`test/v5-preview.test.mjs` 68（适配）｜`test/v5-preview-rework1.test.mjs` 新增。

零修改（SHA256 不变）：`api-client.ts`、`domain-row.tsx`、`rows-view.tsx`、`lib/v5-preview/{service,store}.ts`、`test/v5-preview-v6fix.test.mjs`、`test/v5-preview-http.test.mjs`。

哈希：返修前 `evidence/pre-rework-snapshot/SHA256SUMS.txt`（14 文件）；返修后 `evidence/post-rework-SHA256SUMS.txt`（源码与 `.v6-runtime` 验证副本逐一相同）。

## 3｜验收中发现并修复的新缺陷（任务书范围内）

**seed 版本碰撞下旧情景在途回执短暂覆盖 DOM**（M9 首验发现）：切换情景后，旧情景写入回执（服务端已落账 v37）与新情景 seed（v37）版本相同，`shouldApplyOverview` 版本门无法区分，DOM 短暂翻回旧情景。任务书明确要求「异步成功、失败、finally 都须检查所属请求/上下文，不能仅检查 overview版本」。修复：`shouldApplyWriteResponse(nextScenario, currentScenario)`（rows-logic 纯函数 + 单元真值表 + 三条写入路径接线 + 接线断言）；修复后复验回执窗口 25 采样全程不翻转。此发现已在 CHECKPOINTS.md 与 browser-matrix.json M9 如实记录（含返修前行为）。

## 4｜浏览器事件时间线（仅合成数据）

逐项时间线（请求类型/requestId 前缀/版本/回执/DOM 结果/草稿前后值）见 `evidence/verify/browser-matrix.json`（M1–M12）与 `evidence/repro/*.json`（失败前）。要点示例：

- M1：POST notes（req 8ecaf56b，v8，未达）→ 刷新（记录逐字恢复）→ 确认 → POST 一次（同 req 同 v8）→ 200 → 行消失/存储清空/服务端 v9 待复核。
- M2：POST（req 19369267，v10，落账回执丢）→ 刷新（v11）→ 确认 → POST 一次 → replayed 幂等 → 消息数 4 不变、版本不变、行消失。
- M7a：delay 发送 A → t+1s 草稿=B → 回执 t+3s → t+6s 输入仍 B + 保留提示。
- M9：切换确认 → 记录清空/草稿保留/v37 → 在途回执到达窗口 DOM 情景全程 post-rental（修复后）。

## 5｜测试命令 / 计数 / 退出码；运行目录与访问方式

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 红证据 | `node --experimental-strip-types --test test/v5-preview-rework1.test.mjs`（实现前） | 11/11 fail（`evidence/repro/regression-red-before-fix.txt`） |
| 单元+行为 | `node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview.test.mjs test/v5-preview-v6fix.test.mjs test/v5-preview-rework1.test.mjs` | **59/59 pass，exit 0**（`evidence/verify/unit-tests-green.txt`） |
| typecheck | `npm.cmd run typecheck` | exit 0（`gate-typecheck.txt`） |
| lint | `npm.cmd run lint -- --ignore-pattern ".v6-runtime/"` | exit 0，0 error / 1 既有 v4life warning（`gate-lint.txt`） |
| 隔离 HTTP | `node http-verify.mjs phase1` / `phase2` | 6/6 + 1/1 PASS（`http-verify-phase*.txt`） |
| build | `next build`（`.v6-runtime`，exit 0，5 路由） | 产物 `.next-v6-runtime` |
| 浏览器矩阵 | 真实页面 + 页内 fetch 注入（位置如实标注；未伪造服务端成功） | 10 行全过（`browser-matrix.json` + `screenshots/`） |

**运行实例（当前状态）**：

- **3399 生产模式演示（保留运行供验收）**：`next start --port 3399`，数据 `rework-1/evidence/production-data/`，PID 14964。访问 `http://localhost:3399/v5-preview`——实测无 `Open Next.js Dev Tools` 按钮（`screenshots/production-mode-3399.png` + 真实提交交互成功）。停止：`taskkill /PID 14964 /T /F`。
- 3321 dev（验收矩阵用，当前运行，数据 `rework-1/evidence/runtime-data/`，含矩阵合成标记不回滚）：重启方式见 `verification/restart-isolated.mjs` 头注（Bash 工具内 spawn 不驻留，需后台任务方式）。
- 3311 现场（PID 28568）：全程只读未动，无需恢复。

## 6｜未测项 / 已知限制（如实）

1. **真机软键盘未测**（无真机条件）；三视口为 IAB 视口模拟（实际 innerWidth 396/429/2112，1.1 映射），非真机。44px 触控目标延续。
2. **IAB 工具限制**：`setViewportSize` 每标签页仅首次生效（三视口用独立新标签页逐档测量）；截图管道间歇 30s 超时（390 档双行截图未取得，以 DOM 度量 + 360/1920 截图替代；桌面双行布局见 repro 阶段截图与 production 截图）。
3. **说明通道回执后草稿可见性**：表单随待办转待复核卸载（既定产品语义），草稿留存以「跨卸载+切换后重开表单完整」证明（M7c2）；表单内的可见保留仅消息通道直接可演示。
4. **双击确认**：两击同帧时 React 禁用态未及渲染（第二击发出同 requestId 请求），由服务端幂等兜底（实测不重复记账）；按钮随即进入禁用态。未做防抖节流（超出最小修复范围）。
5. `next build` 输出为执行记录转录（exit 0）；生产实例 3399 实际可打开且完成真实交互，为更强的等价证据。
6. 确认动作确定性失败（如 409/NOT_FOUND）后，原表单/输入框的历史错误文案仍显示旧内容（页面顶部 recoveryNotice 承载最终准确结果）；如需就近内联更新属新一轮 UI 打磨，未扩做。
7. 隔离数据（3321/3399）含本轮验证合成标记（M1验证 等），按验收惯例不回滚伪装未测试。

## 7｜恢复方法

- 产品代码回退：`evidence/pre-rework-snapshot/` 14 文件逐文件复制回 `jianwei-v3/site/` 对应路径。
- 测试适配回退：`test/v5-preview.test.mjs` 用快照副本覆盖；删除 `test/v5-preview-rework1.test.mjs`。
- 隔离副本清理：删除 `site/.v6-runtime/` 与 `rework-1/evidence/{runtime-data,production-data}/`。
- 3399 停止：`taskkill /PID 14964 /T /F`；3321 停止：`node verification/restart-isolated.mjs stop`（归属校验后）。

## 8｜停止

三检查点完成、验收矩阵 10 行 PASS、Gate 全绿（59/59、tsc 0、lint 0 error、HTTP 7/7、build 0、生产路径可打开）。R1–R3 逐条闭合 + 1 项范围内新缺陷修复。**执行者自测完成，待独立验收**；不自动开始下一批，不自行调用 Codex。
