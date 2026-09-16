# D路 STATUS（REPAIR_20260914_EVENING）

更新：2026-09-15 01:45 前后（**首轮完整验收完成**）。

## 当前状态：**ROUND-1 COMPLETE**（八项全过；E-01/E-02/E-03 低severity移交 owner=A；等 A 修复后进入 R1 复测）

## 交付物

- `ACCEPTANCE.md`：R-01～R-08 逐项判定+证据+未验证项（八项全过）。
- `DEFECTS.md`：E-01～E-03（一次归组 owner=A）+观察项 O-1～O-5+防回退抽查结论。
- `RESULT.md`：总判定+版本 hash+证据清单+轮次声明+复现方法。
- `RESULTS_LOG.md`：全过程时间线（含 dev 模式 harness 故障与生产模式定版的如实记录）。
- `QA_PLAN.md`：验收矩阵（含反模式清单）。
- 证据：evidence/ 截图 20+ 张（全部标注实例）、logs/ API 输出 JSON、runtime/ 可复现脚本。

## 首轮结论摘要

- **共享状态机制真实落地**（R-05/R-06 核心）：纠正→真实复核记录（rev-demo-*）+取代链（chainVersion/contested）→首页仅相关域标记（对照实验：政策/信审/商务逐字节不变）→投影永不改绿灯→人工门 409→退回保持未解决（red）→演示内限定词非业务规则。
- **首页/尽调页全部批注落地**（R-01～R-04）：无硬半屏、无合成控制、中文菜单收项目详情、重开图标+精确作用域确认、五阶段三色语义、四域近方格、消息1-2句+来源诚实、尽调现场主体+紧凑工具+客户视图6项零泄漏。
- **可靠性行**（R-07/R-08）：幂等/409族/重开隔离/中断恢复（UI 实测）全过；375/390/1920+125%/80% 无溢出（缩放=视口近似，真实 zoom 引擎/真机如实未验证）。
- 3 项低severity接口符合性/呈现缺陷（shared-state 缺 projectId、reset 指针未置 null、尽调页空态闪现）——全部 owner=A，等 R1。

## A 侧注意（反馈）

- **更正（01:55）**：A 的 main/STATUS、main/RESULT 已落地（声明"首次完整交付完成，自检全绿"）。D 曾记"A 未落地"系时序差；据此更正。A 的 RESULT 未回应 E-01～E-03（写于 D 缺陷清单交付前）——R1 触发以源码漂移为准（轮询 v4 已修正基线误报：首轮 poll4 用了与 poll3 不同的文件集导致假漂移，现基线=96c4e5d52e053fe1，与验收时源一致）。
- A STATUS 称 3467 story 已重置回 s00、专属会话空、10 个历史会话完整——与 D 的 3467 只读观察一致。
- 数据窗口实际执行：D 全部写测试在隔离实例 3469（data-d-r1）；3467 只读；未与 A 的 3481 自测实例冲突。

## 轮询日志（摘要，全量见 logs/）

| 时间 | 事件 |
| --- | --- |
| 22:40 | main/ 出现（BASELINE_GATE+INTERFACE）；home/remote 候选出现 |
| 23:56–00:08 | A 源码写入→稳定；3467 部署（指纹 2502fca3） |
| 00:40–01:20 | D 隔离实例重建（app-r1 生产模式）+hash 对齐+API 套件+对照实验+退回分支+regress 20/20 |
| 01:15–01:35 | 浏览器实测：R-01/02/03/04/05/07/08（真实操作+截图+泄漏断言）+3467 只读抽查 |
| 01:40 | 首轮 ACCEPTANCE/DEFECTS/RESULT 落盘 |

## 已完成（准备 + 交付信号响应）

1. R-01～R-08 矩阵（`QA_PLAN.md`，反模式嵌入）；A 写入前源码基线 hash（`source-baseline-2230.sha256`，15 文件）。
2. **A 已交 BASELINE_GATE.md + INTERFACE.md**（22:40 检测命中）：接口冻结 v1 含 shared-state 只读出口、demo/reset 重开、证据取代链 chainVersion、fixture→域映射、确定性 ID 幂等、投影不递增版本/不改灯色。D 测试用例将按此接口执行。
3. **D 注意点（跟踪中）**：A 的 Gate 写入清单仅共享状态 13 文件，未含首页 CSS/布局改造与 B/C 候选采用文件——R-01～R-04 的落地方式待 A 扩展清单或如实报告未完成。
4. B/C 候选已出现（home/site-mirror 组件+contract；remote/candidate RemoteInterviewStagePage+adapter+harness 证据）。**候选证据只作线索，验收以集成产品为准**（防"候选截图称产品截图"）。B 的 contract 复用 site 类型、来源保守推导规则明确。
5. **修复前基线留证完成**（`evidence/before-*.png/json`）：1920 首屏（客户行+合成控制+五阶段灰底+四域扁格+中部断层）、375 全页（**横向溢出实证**）、尽调页 1920、project/remote/story API JSON。全部标注实例=3469 隔离（源码 hash=A 写入前基线）。
6. **harness 定版**：隔离实例 3469 改用**生产模式**（`next build`+`next start`，data-d 数据目录）。dev 模式（turbopack）在隔离副本出现"SSR 正常但客户端永不挂载"故障，对照 3467 同代码正常后弃用并记录（`RESULTS_LOG.md`）。生产模式对确定性 QA 更优。
7. 快照/对比工具（`runtime/snapshot.mjs`）已含 shared-state 端点。

## 数据窗口（提议不变，待 A 确认）

- D 全部写测试在隔离实例 3469（生产模式，`qa/runtime/data-d`）；3467 只 GET+截图；如必须写 3467 仅 `[D-QA 合成]` 前缀 ≤2 会话；不清共享库；不碰 3311/3321/3399；真实模型调用 0。

## A 发布判定标准（D 侧，不变）

1. main/BASELINE_GATE + INTERFACE 存在（已满足）；2. main/STATUS 或 RESULT 声明**可测**+URL+实际运行 hash；3. D 独立 GET 核对 3467 与声明一致；4. 数据窗口确认。

## 轮询日志（摘要，全量见 logs/poll-20260914.log）

| 时间 | 事件 |
| --- | --- |
| 22:3x | 初始检查：main/home/remote 均不存在；3467 指纹基准建立 |
| 22:40 | **main/ 出现**（BASELINE_GATE+INTERFACE）；home/remote 候选出现；轮询 v1 退出 |
| 23:05 | 隔离实例定版（生产模式）+before 留证完成 |
| 23:08 | 轮询 v2 启动（等「可测」声明或源码漂移） |

## 已完成（准备）

1. 读 COMMON.md + 四路 GOAL + REVIEW_AND_ROUTING.md；旧轮输入只取了 NIGHT_SIMPLIFY qa/RESULT、qa/DEFECTS（防回退基线与上轮反模式），未广扫历史。
2. 源码现状核实（只读）：
   - `app/v5-preview/se-overview.module.css:35、:735` 仍为 `height: calc((100dvh - 22px)/2)`（首页硬半屏在位 → R-01 有真实差异可验）。
   - `app/v5-preview/page.tsx` 含 10 处"合成"标记（合成控制在位）。
   - `lib/v5-preview/demo-story-service.ts:3` 注释明示"不触碰 remote-store"（共享状态未接线 → R-05/R-06 核心差异在位）。
   - git 最近提交 63c41c3（旧归档），工作区 99 项 dirty/deleted —— baseline 硬门未满足前 A 不得写 site；D 监督其 BASELINE_GATE。
3. **A 写入前基线 hash 已固化**：`qa/source-baseline-2230.sha256`（page.tsx、remote-session/page.tsx、demo-story-panel.tsx、se-overview.module.css、se-interview.module.css、api-client.ts、store.ts、remote-store.ts、demo-story-service.ts、demo-story-data.ts、service.ts、remote-service.ts、remote-request-registry.ts、remote-types.ts、demo-story-types.ts 共 15 文件）。A 发布后以此 diff 判定实际改动面。
4. `qa/QA_PLAN.md`：R-01～R-08 矩阵（判据/方法/owner/反模式嵌入/轮次停止规则/证据规范）。

## 数据窗口提议（待 A 在 main/STATUS 或 INTERFACE 回复确认）

- D 全部写测试在**隔离实例 3469**（数据目录 `qa/runtime/data-d`，代码=发布版运行副本）；
- **3467 只读**（GET+截图）；如必须写，仅 `[D-QA 合成]` 前缀会话 ≤2 个，不清共享库；
- 不操作 3311/3321/3399，不抢端口，真实模型调用 0 次。

## A 发布判定标准（D 侧）

满足以下全部才开始运行测试：
1. `main/BASELINE_GATE.md` 与 `main/INTERFACE.md` 存在且 Gate 报告具体（精确范围/差异归属/恢复方法）；
2. `main/STATUS.md` 或 `main/RESULT.md` 声明**可测**，含实际运行 URL + 实际运行 hash（非候选 hash）；
3. 3467 实际内容与声明一致（D 独立 GET 核对，防"报告旧版本状态当当前事实"）；
4. 数据窗口经 A 确认（或 A 明示无异议，D 按上节提议执行）。

## 轮询日志

| 时间 | 检查 | 结果 |
| --- | --- | --- |
| 22:3x | main/ home/ remote/ 子目录 | 均不存在（A/B/C 未开始写入） |
| 22:3x | 3467 监听 | 在（PID 25748）；3311/3321/3399 在（不触碰） |
| 22:3x | 3469 端口 | 见 RESULTS_LOG（空闲则预留为 D 隔离实例端口） |

（后续轮询逐行追加）
