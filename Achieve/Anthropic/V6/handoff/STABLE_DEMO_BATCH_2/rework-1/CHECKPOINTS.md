# STABLE_DEMO_BATCH_2 · rework-1 检查点记录

执行：ZCode 主 Agent（单 writer 串行）。任务契约：`V6/ZCODE_BATCH_2_REWORK.md`（未改写）。缺陷输入：`V6/CODEX_REVIEW_BATCH_2/REPORT.md`（部分通过，退回 R1–R3）。

## CP0：返修前检查点

- 允许文件 14 个副本 + SHA256：`evidence/pre-rework-snapshot/`（SHA256SUMS.txt）。范围：app/v5-preview 8 文件、lib/v5-preview 3 文件、test 3 文件。
- Git 状态：工作区非 Git 仓库（`fatal: not a git repository`），如实记录；本检查点仅为文件快照，非 Git baseline。
- 运行状态：3311 现场（PID 28568，next start-server）只读未动；3321 隔离实例（PID 18872，next start-server，site/.v6-runtime）经端口→PID→命令行→数据目录内容（GET v28 与 evidence/runtime-data/rows-store.json v28 一致）四重验证归属本批，重启前重新验证。

## CP1：失败复现与关系模型

### 复现证据（真实浏览器 + 页内 fetch 包装，全部落盘 evidence/repro/）

- `r1-note-refresh-confirm-noop.json`：说明落账后丢回执 → 刷新 → 确认按钮 POST=0，恢复条残留。
- `r2-message-borrows-note-marker.json`：消息未知结果记入说明哨兵标记；恢复条错标"补充说明"；确认不重放消息（POST=0）；说明成功交叉误清消息记录；原样重试幂等但标记永续残留。
- `r3-late-receipt-clears-new-draft.json`：A 落账、回执延迟 3s；在途编辑 B；回执释放后 B 被清空（t=3010ms 仍在 → t=4000ms 为空）。

### 请求恢复状态关系模型（实现前冻结短文）

参与修复的七类状态及其关系：

1. **请求类型（kind）**：`note`（补充说明，含 todoId）与 `message`(项目沟通) 是两条**独立恢复通道**。类型决定恢复入口的文案、确认动作与存储键；任何通道的状态变化不得影响另一通道（R2）。
2. **完整原载荷（body）**：首次发送前构造并冻结——`{requestId, expectedVersion, todoId(notes), text, actorRole:'business'}`。它是重放与确认的**唯一依据**；确认/重试必须原样重发该 body，不得用当前版本重建（否则幂等哈希不匹配 → REQUEST_MISMATCH 或语义漂移）。
3. **请求 ID（requestId）**：幂等键 + **所有权凭据**。异步回执（成功/失败/finally）只有当"当前通道记录的 requestId === 本请求 requestId"时才允许清理记录或影响草稿；不匹配即为被情景切换/新请求取代的陈旧回执，只应用版本门控的 overview，不触碰记录与新草稿（R2/R3）。
4. **原始版本（expectedVersion）**：冻结在 body 内。服务端幂等表查询先于版本门——重放命中 ⇒ 原请求已落账（replayed:true）；重放 409 ⇒ 该 requestId 未落账（当前情景不含该条内容）。因此确认动作对 VERSION_CONFLICT 可以给出**可判定的诚实话术**，不猜测"必然已落账"。
5. **上下文归属（scenario）**：记录保存发生时的演示情景。恢复时/应用新 overview 时校验：记录.scenario ≠ 当前情景 ⇒ 记录失效（清除+提示），旧回执不得挂上新情景恢复条（R3）。
6. **当前尝试状态（通道记录）**：每通道至多一条 `未知结果` 记录，状态机：`发送前写入（覆盖发送中刷新窗口）→（NETWORK 保记录）/（确定性响应清记录）→ 成功回执清记录`。**存在有效记录时，同类型新提交**：同 todoId+同文本 ⇒ 重放原 body；内容不同 ⇒ 阻断并明确提示（先确认旧请求，草稿保留），不静默覆盖（R2）。损坏/旧版标记 ⇒ "恢复受限"提示 + 显式清除入口，无虚假确认按钮。
7. **草稿修订标识（draftRevision）**：组件内每次编辑自增。提交时冻结"提交时修订号"；成功回执**仅当当前修订号 === 提交时修订号**才清空草稿。A→B→A 序列中最终 A 与已发送 A 字符串相同但修订号不同 ⇒ 不清（R3）。恢复入口重放成功采用同一判定（以提交时修订号为关联）。

### 持久化边界

- sessionStorage 仅承载**客户端待确认命令**（两键：`jw:v5-preview:pending-note-request` / `jw:v5-preview:pending-message-request`，JSON 完整记录）+ 旧版哨兵键的迁移清理；业务事实始终以服务端轮询/响应为准。
- 旧版哨兵 `jw:v5-preview:pending-note = '1'` 挂载时迁移：无有效记录 ⇒ "恢复受限"提示，不当作完整请求恢复成功；随后移除旧键。
- 存储写入失败不阻断业务：记录保留在内存（当次会话确认仍可用），恢复条附加"刷新后可能无法恢复"说明。

### 协议影响评估

无冻结协议变更：端点、字段、错误码、幂等与乐观并发语义全部不变；恢复记录纯客户端。→ 按任务书 CP1 允许继续 CP2，无需停止。

## CP2：修复实现记录（完成）

**实现顺序**：先红后绿——`test/v5-preview-rework1.test.mjs`（11 项：9 项纯逻辑真值表 + 2 项接线断言）在实现前运行 **11/11 失败**（`evidence/repro/regression-red-before-fix.txt`），实现后转绿；未修改任何断言绕过缺陷。

### 修改文件（全部在允许写面内；SHA256 见 evidence/post-rework-SHA256SUMS.txt）

| 文件 | 变更 |
| --- | --- |
| `app/v5-preview/rows-logic.ts` | +235 行：`StoredNoteRequest/StoredMessageRequest` 恢复记录类型与 `parseStored*Request` 失败关闭解析（not-json/bad-shape/bad-fields）；`noteBodyFromRecord/messageBodyFromRecord` 逐字重放体；`decideRepeatSubmit`（new/replay/block）；`isSameRequestOwner`（槽位/裸记录双形状）；`isStaleRecordScenario`；`shouldClearDraftAfterConfirmation`（修订标识判定）；`shouldApplyWriteResponse`（情景上下文检查，M9 返修补入）；全部用户可见文案（恢复行/确认按钮/阻断/受限/失效/冲突话术）按类型区分 |
| `app/v5-preview/page.tsx` | 移除共享布尔标记（`pendingNoteVisible`/哨兵 '1'）与内存 attemptRef 机制；改为双通道恢复槽位（state+ref 镜像+sessionStorage JSON 记录，键 `jw:v5-preview:pending-note-request`/`pending-message-request`）；发送前建记录（覆盖发送中刷新窗口）；挂载恢复+损坏/旧哨兵迁移（恢复受限，不虚报）；`resolveRequest`（按记录原载荷重放，NETWORK 保留、确定性失败清理并如实提示，重放 409=未落账）；`submitNote/sendMessage` 接 `decideRepeatSubmit`（同内容重放/异内容阻断）+ 所有权检查 + STALE_REQUEST 陈旧回执不触发新横幅；seed 成功清两通道；`applyWriteResponse` 增加情景上下文门；sessionStorage 收敛为单一 writeStorageItem 出口 |
| `app/v5-preview/todo-card.tsx` | 恢复行 `PendingNoteRow` 对**所有待办状态**可见（不再挂 `!canSubmit`）；草稿修订标识（`draftRevisionRef`/`submittedRevisionRef`）+ `clearDraft` 唯一出口（提交成功与恢复重放成功都经修订判定）；恢复受限显示受限文案+显式清除；存储不可用如实标注；保留编辑提示（editKept） |
| `app/v5-preview/chat-panel.tsx` | 消息恢复行 `PendingMessageRow` 独立于说明通道、置于折叠区之外（收起仍可达）；输入修订标识同构；保留编辑提示 |
| `app/v5-preview/preview.module.css` | `.pendingNoteRow`→`.pendingRequestRow`（两通道共用）+ `.pendingRowHint`（+4 行） |
| `test/v5-preview.test.mjs` | 适配新机制的断言更新（存储白名单精确化为两记录键+旧键只迁移；接线断言从 reuseAttemptBody/attemptRef 改为 decideRepeatSubmit/恢复记录清理点；清空唯一出口 clearDraft/clearInput + 修订判定断言）——均为锚定新机制的等价或更强断言 |
| `test/v5-preview-rework1.test.mjs` | **新增** 12 项回归（红→绿） |
| `app/v5-preview/api-client.ts`、`domain-row.tsx`、`rows-view.tsx`、`lib/v5-preview/{service,store}.ts`、`test/v5-preview-v6fix.test.mjs` | **零修改**（SHA256 与返修前一致） |

协议影响：无——端点/字段/错误码/幂等与乐观并发语义全部不变；恢复记录纯客户端。依赖无新增。

## CP3：真实页面验收与交付（完成）

### 浏览器验收矩阵（10 行全过，逐项证据 `evidence/verify/browser-matrix.json`）

M1 未达→刷新→确认 ✅｜M2 已落账丢回执→确认（幂等不重复）✅｜M3+M4 消息两路径+类型准确 ✅｜M5 双通道同时未知、互不误清 ✅｜M6 损坏/旧哨兵/存储不可用（受限提示+显式清除，无虚假按钮）✅｜M7 A→B 与 A→B→A 修订保留（消息 DOM 级；说明跨表单卸载+情景切换留存 DOM 证明）✅｜M8 阻断+同内容重放+双击幂等 ✅｜M9 切换取消/确认/在途回执（**发现并修复真缺陷**：seed 版本碰撞下旧情景回执短暂覆盖 DOM，补 `shouldApplyWriteResponse` 上下文门后 25 采样全程不翻转）✅｜M10 延迟 GET 不回退 ✅｜M12 三视口无溢出+44px 触控+段名可达 ✅

### Gate（全部留档 evidence/verify/）

- 单元+行为回归：**59/59**（FE 22 + v6fix 26 + rework1 12，`unit-tests-green.txt`；v6fix 26 项与 service/store 零修改互相印证）
- typecheck：**exit 0**（`gate-typecheck.txt`）
- lint：**0 error**（1 条既有 v4life 测试 warning，与上批一致；`gate-lint.txt`）
- 隔离 HTTP 验证：**phase1 6/6**（确认重放语义/旧版本 409/REQUEST_MISMATCH/损坏失败关闭不静默重置/恢复）+ **phase2 1/1**（重启后数据与幂等表恢复、完整原载荷重放 replayed:true）——`http-verify-phase*.txt`
- build：`next build` exit 0（5 路由；转录自执行记录；产物 `.v6-runtime/.next-v6-runtime`）
- **生产模式演示（可实际打开）**：`next start --port 3399`（独立数据目录 production-data），实测 **无 Open Next.js Dev Tools 按钮**、页面完整渲染、真实提交交互成功（`screenshots/production-mode-3399.png`）
- 3311 现场服务：全程只读未动（无 POST/seed/注入/重启）

### 工具限制（如实）

- IAB `setViewportSize` 每标签页仅首次生效、截图管道间歇 30s 超时：三视口用独立新标签页逐档测量（实际 innerWidth 396/429/2112，1.1 映射，非真机）；软键盘无真机未测。
- 说明通道 M7 的"回执后草稿可见性"受既定产品语义限制（待复核卸载表单）：以"跨卸载+切换后重开表单草稿完整"作 DOM 级留存证明。

