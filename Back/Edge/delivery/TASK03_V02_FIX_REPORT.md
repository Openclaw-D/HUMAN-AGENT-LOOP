# 任务03 修复轮交付报告（C1–C4 · PR#3 审核 F05/F09 关联项）

- 轮次：2026-09-17 下午（审核后四任务并行 N1 阶段）
- 执行者：ZCode（任务03 路；唯一写域 `Back/Edge/src/**` + `Front/**` + 本路消费面快照）
- 基线：PR #3 合并提交 `870e149`（与审核基线一致）；工作区另有任务 01/02/04 路并行在途改动，本报告只覆盖本路文件
- 性质：commit-ready，未 commit/push（按边界 awaiting 用户明确授权）

## 1. 输入与口径

- 输入：`tasks/03_SECURE_REALTIME_WORKBENCH.md`（冻结任务书）、`AUDIT_PR3.md`（F05 P0、F09 P1、F13 部分）、`probes/observed.json` 的 X08 反例语义。
- 消费面：`Back/Edge/contract/consumed-surface-v1.json`（revision=task03-repair-1；含 upstreamGaps 登记）。不改写 `Back/CONTRACT.md`（他人 writer）。

## 2. 修改文件（本路）

| 文件 | 变更 |
|---|---|
| `Back/Edge/src/kernel-store.mjs` | 重写：按 (customerId×principalId×凭据指纹) 分桶；401/403 断流（onAuthFail→销桶）；权威快照面（decision-status/findings/object-inventory + freshness 逐组件）；seq 字符串/BigInt；提交滞后重查窗口（128）+ eventId 去重 + seq 有序插入 + gap 标注；`pageEvents` 分页直读；空闲桶回收 |
| `Back/Edge/src/server.mjs` | csrfCheck 判定顺序修复（X08）；SSE 会话周期复检 + `auth` 帧 + 慢客户端 writableLength 背压上限；`/events-page` 路由（fixture 501）；外发权限点 `messages:external-send`（默认拒绝，`--external-send-roles` 显式授予）；live 装配接 validateTarget |
| `Back/Edge/src/messages.mjs` | validateTarget 目标客户校验（live）；requestId 幂等表（同载荷 replayed:true / 异载荷 409 REQUEST_ID_CONFLICT，表上限 1024）；审计补 threadId |
| `Front/site-mirror/lib/v5-preview/edge/edge-logic.ts` | +DomainVerdict/EdgeLiveMessage 类型；+toLiveChatMessage/deriveDomainRowsLive/deriveLifecycleLive/deriveDecisionLines/capabilityChips 纯函数 |
| `Front/site-mirror/lib/v5-preview/edge/edge-client.ts` | +sendMessage/eventsPage/readyz；openEvents +onAuth（终止性）+onDrop(status)；WorkspaceResponse 扩展（eventWindow/freshness/字符串 snapshotVersion）；versionz +capabilities |
| `Front/site-mirror/lib/v5-preview/edge/use-edge-live.ts` | 重写合并：+capabilities/readiness/eventWindow/freshness/liveMessages 状态；+sendLiveMessage（服务端回执状态，失败不回退本地）；auth/401/403 终态不复活旧会话 |
| `Front/site-mirror/app/v5-preview/home-overview.tsx` | live 分支移除 submitCaseTurn/completedTurns/scenario.domains 依赖；live 聊天/矩阵/生命周期全取后台；受众显式切换；训练模式保留、不共享草稿 |
| `Front/site-mirror/app/v5-preview/edge-panels.tsx` | EdgeStatusBar 能力位 chips + readiness/freshness 逐项 + 快照版本/事件窗口；EdgeCreditPanel +决策状态行（Gate rejected 不给绿灯）；+EdgeObjectLinks（C4 二维保底）；+EdgeChatAudienceToggle |
| `Front/site-mirror/app/v5-preview/home-role-view.tsx` | 渲染 EdgeObjectLinks |
| `Front/site-mirror/lib/v5-preview/edge/edge-panels.css` | chips/受众/对象清单样式 |
| `Back/Edge/contract/consumed-surface-v1.json` | revision=task03-repair-1：+3 消费读、upstreamGaps、edgeFacing 更新 |
| `Back/Edge/STATUS.md` | 追加本轮记录 |
| `Front/dist/**` | vite 重建（用户要求 dist 随仓库） |

## 3. 并行 writer 合并说明

同一工作区有另一 writer 在本路落了同方向补强，已全部保留并合并：凭据输入 `type=password`；会话动作 502 重试复用同一 requestId（ridMap，P3③）；SSE onDrop 401/403 终态（P3④，与我的 onAuth 语义合并）；消费面 inspection 写面/回执对账说明更新。合并后 typecheck/build/测试全绿。

## 4. 自验结果（隔离栈；临时脚本在系统 Temp，不入库）

栈：`v7d-` PG@15436（独立 runDir）+ A 内核@17921（001–004 迁移自动应用；任务01在途版）+ Edge in-process 随机端口。**不写 Back/Edge/test**（归任务04）。

- 单元（stub fetch）11/11：分桶互不串、凭据 403 → onAuthFail 一次 + 桶销毁 + 另一身份不受影响、反序提交（先 6 后 5）有序补齐各投递一次 + gap 清除、seq=2^53+1 无精度损失、未知游标 expired、回放不跨桶。
- 集成 28/28：readiness ok 且无 all_ok；CSRF 四态（白名单跨端口+cross-site 放行 / 恶意 origin 403 / null origin 403 / 无头放行）；workspace 权威块（customer/freshness/decisionStatus/eventWindow/字符串 snapshotVersion）；SSE cursor 基线 + 实时到达 + 信封字符串 seq；双身份双桶并存 + 各自实时；基线游标重连；events-page 分页（hasMore 正确、seq 保字符串）；消息受众路由（internal 200 / 外发无权限点 403 EXTERNAL_SEND_NOT_PERMITTED / 错 customerId 404 不投递 / 同 requestId replayed:true / 异载荷 409）；会话撤销后旧会话 401/403；fixture events-page 501。
- Front：`tsc --noEmit` 0 错；`vite build` 通过且 dist 重建；edge-logic 8/8、v5-preview 19/19。
- 未验项（如实）：慢客户端背压断流、15s 心跳会话过期断流（逻辑在 server.mjs，未做长时真实断连）；浏览器真实 Sec-Fetch 头全链路（需真实浏览器，归 E1/D 系）；U03 完整两事务反序提交的 PG 真实并发（Edge 窗口自愈已验，A 侧根修待任务01）。

## 5. 提交任务04 的独立测试需求（不代写 Back/Edge/test）

1. **U01 撤权**：双主体同客户订阅；撤销一方凭据（A 侧 401/403 或 Edge 会话撤销）→ 该方 SSE 收 `auth` 帧后终止、workspace 401/403；另一方事件流不中断、缓冲不串桶（`_stats` 桶键隔离）。
2. **U03 反序提交**：两事务 seq 分配与提交反序（可用双连接 + 锁控制）；断言 SSE 无静默丢失（eventId 去重后仍全到达）、envelope 按 seq 有序、gap 标注出现后清除；A 侧根修后回归。
3. **U04 大历史**：>4000 事件客户：workspace 当前对象仍完整（权威查询）；`/events-page` 全量分页无缺号；旧游标 → resync。
4. **U05 Origin 矩阵**：真实浏览器（带 Sec-Fetch-Site）四态：同源 POST 放行、白名单跨端口放行、恶意 origin 拒、null origin 拒；Node fetch 无头通过不得替代浏览器用例。
5. **U06 live 真实操作**：连接后主聊天（受众 internal/customer 各一）、四域矩阵、生命周期、会话操作条全部来自后台；断开后端 → 界面显示对账/断开，不出现本地假成功。
6. **U07 受众与外发**：confirmExternalSend 无 `messages:external-send` → 403；错 customerId → 拒投递；同 requestId 重放/异载荷 409；审计条目核对（confirmed/target_refused）。
7. **U09 会话不复活**：撤销会话后旧 sessionId 一律 401；SSE 不自动重连复活。
8. **U12/U13**：重放不重响（eventId 去重）；Front 源/lock/dist 错版 → 构建核对失败（dist 已重建，hash 见 Front/dist/assets/index-B5AqWFQa.js）。
9. **E1 回归**：`e1-d02-real` 等既有真实变体在本轮代码上重跑（冻结门照旧）。

## 6. 提交任务01 的需求（已在 consumed-surface upstreamGaps 登记）

1. 权威列表端点：`GET /api/v2/customers/:id/assessments`、`GET /api/v2/customers/:id/financing-requests`（Edge 切换权威快照、去掉 event_buffer refs 的非穷尽标注）。
2. 事件提交序：outbox seq 分配改提交序，或提供已提交水位/缺口检测（消除 Edge 滞后重查窗口 128 的残余漏事件风险）。

## 7. 边界与受限能力（如实）

- 手机实控人/厂长/财务分身份上传入口：not_wired（短期邀请绑定属后续授权范围；本轮无虚假二维码/上传 UI）。
- 实时视频/录制：blocked_external_access（企微/TRTC 未授权）。
- 三维多人场区：**D27-S BLOCKED**（本仓无 Unity 构建；EdgeObjectLinks 为二维清单保底，不冒充三维视图）。
- 模型：not_configured；真实出账：simulation_only。

## 8. 未决与移交

- 是否 commit/push 由用户决定（四路并行工作区共享，建议统一窗口收口）。
- `Back/Edge/.run/task3fix-selfcheck-*` 为本路自验残留（git 排除），可整目录删除；运行容器已全部销毁。
- 另一 writer 的 P3③④ 补强与本路合并无冲突，但其归属轮次/提交边界请总控与其确认。
