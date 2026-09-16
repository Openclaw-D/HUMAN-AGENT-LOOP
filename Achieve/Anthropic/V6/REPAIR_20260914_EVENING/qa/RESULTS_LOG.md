# D路 RESULTS_LOG（REPAIR_20260914_EVENING）

时间线式记录：操作、观察、判定依据。截图/API证据在 qa/evidence/，脚本在 qa/runtime/。

## 准备阶段（22:17–23:05）

- 22:17 包生成（A/B/C/D GOAL + COMMON + REVIEW_AND_ROUTING）。D 开始读包。
- 22:2x 源码基线核实（只读）：`se-overview.module.css:35/:735` 硬半屏 calc 在位；`page.tsx` 含合成控制；`demo-story-service.ts:3` 明示不触碰 remote-store（共享状态缺口）。git 最近提交 63c41c3，99 条 dirty（历史累积）。
- 22:30 **A 写入前基线 hash 固化**：`source-baseline-2230.sha256`（15 文件）。
- 22:35 3467 GET /v5-preview 200；完整 HTML hash 含每请求随机 `__next_r`，剥离后得**稳定指纹 `f6b4c707f872c320`**（两次验证一致）作发布检测基准；CSS chunk `se-overview_module_0o2b3x6.css`。
- 22:40 `QA_PLAN.md`（R-01～R-08 矩阵+反模式清单）、`STATUS.md` 完成；`runtime/check_publish.mjs`（发布检测）、`snapshot.mjs`（快照+语义 diff）、`sync_isolated.sh`（隔离实例同步/启动）就绪。
- 22:45 **隔离 harness 验证**（仅写 qa/runtime/**）：site→qa/runtime/app 同步（cp 回退路径）；node_modules junction 用 `fs.symlinkSync('junction')`（git-bash mklink 语法失败弃用）；**QA 专用 next.config.ts（turbopack.root=Anthropic）必须在 junction 前写入**（首跑 set -e 中断漏写导致 junction 报"out of filesystem root"，已修正脚本顺序）。dev 模式起 3469 成功（200+API）。

## A 交付信号（22:40 轮询命中）

- 22:40 `main/` 出现：BASELINE_GATE.md（精确 13 文件写入清单+快照+恢复方法，快照声明"非 Git commit/tag"）、INTERFACE.md（**冻结接口 v1**：rows-store v2 `storyCursor.stepId`+`sharedDemo.sessionId`；证据取代链 `chainVersion`；fixture→域冻结映射 inspection→asset/equipment→credit/contract→commerce；`GET /api/v5-preview/demo/shared-state` 只读投影出口（读取可触发自愈落盘，诚实声明）；`POST /api/v5-preview/demo/reset` 重开=仅清当前专属演示；确定性 ID `ev-demo-*`/`rev-demo-*`；投影不递增 overview.version；投影永不把判断灯改绿）。B `home/`（evidence/preview/src）、C `remote/candidate` 同步出现。
- **D 注意点（记录，不预判）**：A 的 BASELINE_GATE 写入清单仅覆盖共享状态 13 文件，**不含 se-overview.module.css/首页布局改造或 B/C 候选采用文件**。R-01～R-04 是否以"扩展写入清单"或"报告未完成"处理，待 A 后续动作/INTEGRATION_LOG 验证。

## 修复前基线留证（22:50–23:05）

- 目的：防"报告旧版本状态当当前事实"——先把缺陷态固化为 before 证据。
- 22:50 API 快照（隔离实例 3469，data-d 空库种子态）：`evidence/before-project.json`、`before-remote-session.json`、`before-demo_story.json`。
- **harness 故障与定位（如实记录）**：3469 以 `next dev`（turbopack，dev 默认）启动后，页面 SSR 正常但**客户端 React 永不挂载**（骨架永驻、0 个 /api 请求、无错误覆盖层内容、HMR touch 不触发重编译）。对照实验：**3467（同代码、同 runner `next start-server.js`、同 IAB）同窗口加载完全正常** → 排除 IAB/环境/代码，锁定为隔离副本 dev 管线问题（dev.watch 机械或 turbopack.root 全工作区 watch 范围疑因，未定论）。曾疑缓存损坏（taskkill 强杀后）清 .next 重启未解决。
- **解决**：改**生产模式** `next build` + `next start -p 3469`（exit=0，构建路由含 /v5-preview 与 /v5-preview/remote-session）→ 页面完整渲染（project+story 轮询正常）。**本轮验收全部采用生产模式实例**（对确定性 QA 更优）；dev 模式故障不再追查，记录在案。
- 23:00 截图留证（隔离实例=源码基线同 hash 版本）：
  - `before-home-1920-viewport.png`：首屏可见 客户信息整行（远山精密制造）+「合成演示·控制」下拉、五阶段灰底无状态着色、四域扁宽格、中部大空洞（硬半屏断层视觉）、固定演示条 1/22、消息 source 标注「系统·演示情景」「信审·张信审（合成）·专业预」。
  - `before-home-375-full.png`：**375 视口横向溢出实证**（全页宽≈750px，双列并排）——R-01/R-08 before 缺陷证据。
  - `before-dd-1920-viewport.png`：尽调页空状态（隔离实例无会话；诚实占位文案在位）。
  - 截图管线备注：IAB screenshot 一次 30s 超时，重试成功（上轮已知间歇问题）。

## 当前状态

- 3469 生产模式实例运行中（data-d）；IAB 两个 3469 标签+一个 3467 对照标签开着。
- 等待：A 的"可测"声明（main/RESULT 或 STATUS 含可测+URL+运行 hash）；期间轮询源码漂移。

## 首轮 API 实测（00:40–01:20，隔离实例3469生产模式，源hash与A final-hashes一致）

- **版本对齐**：QA副本(app-r1)源hash == main/final-hashes.sha256（store 8292af60/shared-facts b0f42ce2/home-overview ca684f1f 抽查一致）。B组件已实际进入site。
- **共享状态套件 v2**（`logs/shared-state-r1.json`）：**30/33 PASS**。
  - 核心通过：懒建会话/确定性ID(ev-demo-\*/rev-demo-\*)/纠正→contested+pendingReview(reason=correct)/**人工门409**/纯读不递增版本/同requestId幂等重放+换载荷409/共享消息确定性ID且不冒充真实模型/**重开隔离**（独立对照会话保留、旧专属会话记录清空、版本单调、回起点）。
  - **FAIL×3**：
    - SS-01b（低，owner A）：`GET /demo/shared-state` 响应**缺 INTERFACE §3 承诺的 projectId 字段**。
    - SS-06f（探针缺陷，作废重测）：初版探针字段名错（domains是列表、todo单数）→ 以**对照实验**重做（见下）→ 真实结论=通过。
    - SS-11c（低，owner A）：reset 后 sharedDemo 指针未按 INTERFACE §1 "清除为 null"，而是保留固定指针 `rs-demo-run`（记录已清空、会话壳保留）。行为效果与设计意图一致（无业务事实残留），属接口符合性偏差。
- **对照实验**（correct vs confirm，同停s15门，`projection_control_probe.mjs`）：两路径payload差异**仅** 资产域 judgmentText（correct路径="待投前复检；证据纠正待复核"、confirm路径无标记）+ 共享消息 msg-shared-rev-\* + 文案；政策/信审/商务三域两路径完全一致。**R-05"仅相关域变更"确证通过**。投影灯色保持yellow（永不改绿✓）。
- **退回分支**（`return_path_probe.mjs`）：s09三选项含退回✓；退回即时信审域=**red**（未解决保持，不着绿✓）+ todo转"退回补充·待补充"✓；退回后s12门仅confirm/correct（无return）✓且提示带"本演示内"限定✓；s15→s17门仅confirm✓与提示一致✓；全payload无"业务规则/次数用完"等规则化措辞✓。
- **防回退抽查**：`regress_base.py --remote` **20/20 PASS**（幂等/409族/暂停门/并发F-001/会话隔离全保持）。
- 注意：correct/confirm路径按分支设计跳过s12/s17（退回专用"补充后"步）——非缺陷，分支路由正确。
