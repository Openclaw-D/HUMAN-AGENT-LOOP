# D路独立审查记录（NIGHT_SIMPLIFY_20260914）

审查时间：2026-09-14 01:38–02:00。基线 hash：`source-baseline-site-sha256.txt`（site，343 文件）、`source-baseline-preview-sha256.txt`（预览副本 app/lib，233 文件）。
**本时点 site 与 se-preview-20260913 的 app+lib 233 文件 hash 完全一致**（预览副本未漂移）。

## 运行环境事实（验收对照）

1. **3467 实例**：`next dev -p 3467 -H 127.0.0.1`（PID 33380），数据目录 **`V6/handoff/SE_REBUILD_20260913/runtime/data/`**（`V5_PREVIEW_DATA_DIR` 指向；site/.v5-preview-data 是旧数据，无本晚会话，不混淆）。
2. **共享状态现状**（01:45 只读 GET）：
   - 首页 rows-store：scenario=approval，version=32；
   - remote-store：remoteVersion=80，8 个会话 = 共享首会话 `rs-mtzpo3q1-j33xtuqj`（JW-2026-018 远程尽调访谈）+ 7 个昨夜 `[D-QA 合成]` 会话（本路 2026-09-14 00:07–00:33 创建，可复用为专属测试会话）。
3. **旧 QA 结论适用范围**（../API_OVERNIGHT_20260913/qa/RESULT.md）：
   - 适用且列为本轮回归：F-001 并发覆盖修复（三层复测通过）；幂等/版本门/暂停门/取代链语义；
   - **不适用**：该轮验收对象是"模型接线+mock 闭环"，不是本轮"前端简化+固定演示"；本轮五阶段推进/人工决定/入口闭环均为新功能，旧通过结果不构成新验收；
   - 保留未测：真实 provider 端到端（接线完成、配置缺失、真实调用 0 次）——继续列为未测，不作为固定演示阻断。

## 基线源码事实（A 改动前，供验收对照）

### 入口与首页（app/v5-preview/page.tsx, rows-view.tsx, chat-panel.tsx）

1. 首页 `/v5-preview`：RowsView（上）+ ChatPanel（下）。远程尽调入口 = ChatPanel 工具行 `Link href="/v5-preview/remote-session"`（chat-panel.tsx:154）；返回 = remote-session 页顶部 `Link href="/v5-preview"`（page.tsx:459），导航不冒称结束通话。
2. 五阶段条：`[商机, ...lifecyclePosition(scenario).stages]` 五等宽；商机为呈现补充（currentIndex>=0 即完成）；状态 done/current/pending 由 scenario 推导——**当前 scenario 只有三档（approval/post-rental/settled），无逐级推进**；本轮"五阶段完整推进到结清"是 A+C 新增功能，旧代码无此路径。
3. 版本门/恢复通道（页级）：GET/写响应经 `shouldApplyOverview` 版本门 + 情景上下文门；两条 sessionStorage 恢复通道（note/message）；seed 切换确认流（取消不发写入，切换重置演示记录并明确提示）。这些是既有可靠状态机制，简化时**不得移除**（回归点）。

### 远程尽调页（app/v5-preview/remote-session/page.tsx，894 行）

4. `loadState` 固定取 `data.sessions[0]`（L233）——**UI 无会话切换器，永远打开最旧会话（共享首会话）**。两会话隔离基线缺口：若 A 引入"专属演示会话"，必须解决 sessions[0] 选择逻辑，否则 D 无法在不碰共享首会话的情况下测固定演示。
5. 草稿存储键全局非会话作用域：`jw:v5-preview:draft:answer`、`jw:v5-preview:draft:ask`（L197, L205）——两会话草稿串线的候选风险点。
6. 请求注册表 sessionStorage 键 `jw:v5-preview:remote-request-registry`（L80）同样全局；`begin` 上限（演示上限提示 L269）。
7. 人工语义现状：pause_round/resume_round/escalate_human 走 reviews 写路径，服务端 requireNotPaused 门；暂停中补证/纠正类仍可用（L824）；确认类动作被阻断。
8. 模拟声明现状：model_real/model_simulation/业务/专业域标签映射（L602）；全屏模拟视图有"模拟会议视图 · 非真实画面"标签（L846）；页脚"合成演示 · 不执行正式审批"（L678）；真实模型按钮按 model-status 降级禁用并给缺项清单（L610-621）。
9. 发起关键问题按钮（L793-815）：先确保证据存在再建 annotation，两段写入；`runWrite` 内部 loadDetail 刷新后重新 getRemote 取最新证据——**连续两写、每次 expectedVersion 用 remoteVersion state**，第二写用 `d.remoteVersion`（刷新后）正确；但 `fresh` 变量取自 runWrite 回调的 `attached.evidence` 与重新 GET 的 latest 并存，逻辑冗余（A 简化时留意）。

### 数据与重置作用域

10. v5 首页 seed（`/api/v5-preview/demo/seed`）重置整个 rows-store（overview+幂等表）；remote-store 独立文件，无 seed/reset 路由；v3 demo-reset 是另一 runtime（v3），与本演示无关。**"重新开始"若新增路由，作用域必须只影响当前演示会话/情景，不得触碰 remote-store 共享首会话**（重置污染检查点）。
11. 首页轮询 4s + visibilitychange/focus 重新 GET；remote-session 页**无轮询**，写后 loadDetail——第二视口一致性依赖刷新，A 的固定演示若引入服务端推进，需说明刷新读回约定。

## 五类重点风险初判（待 A 接口/C 状态图落地后复核）

| 风险 | 初判（基线代码） |
| --- | --- |
| 越过人工节点 | 基线无自动推进；本轮新增"一键推进常规动作"是最大新增风险面：人工 open annotation 存在时，advance 是否被阻断待查 C 模块 + A 集成 |
| 过时证据 | 取代链/过期标识基线已有（F-001 轮验证）；新演示流程若复用 evidence version 需复核 |
| 错误全绿 | 五阶段 done 由 scenario 推导；若新增逐步推进，"绿"必须来自步骤完成而非演示默认值；无前提域（如 approval 情景资产域）不得提前 done |
| 重置污染 | seed 全局重置 + remote 无 reset；"重新开始"新增作用域未定=主要检查点；sessions[0] 选择使 D 测试必然经过共享首会话（需 A 专属会话方案） |
| 固定/真实混用 | model-status 门 + SIMULATION 标签基线良好；新增固定演示消息须与 model-input 分开存储（C 任务），UI 不得把固定脚本冒充真实模型输出 |

## 给 A 的早期短反馈（FEEDBACK_TO_A 前置版，A 未落盘先记于此）

1. 请在 CONTRACT 明确：固定演示会话的创建/选择约定（sessions[0] 不可再作为唯一入口）、D 专属测试会话 ID 前缀、以及"重新开始"的精确作用域（哪些文件/哪些会话/哪些键）。
2. 草稿/注册表 sessionStorage 键若维持全局，请说明两会话演示隔离如何成立（或改为会话作用域键）。
3. 保留版本门/恢复通道/模拟声明这三组既有机制（回归点）；简化≠移除状态可靠性。
