# STATUS｜任务A·主集成（NIGHT_SIMPLIFY_20260914/main）

- 接手：2026-09-14 01:33（北京时间）；截止 09:00。本文件 A 独占维护，滚动更新。
- Ownership：唯一产品源码 writer（`jianwei-v3/site`）+ 实际预览副本同步（`jianwei-v3/se-preview-20260913`，白名单）+ 共享 CONTRACT/运行 owner。独占 `V6/handoff/NIGHT_SIMPLIFY_20260914/main/**`。
- 未操作 Codex；不新增子代理；不碰 3311/3321/3399；不 Git commit/push/tag；不装依赖。

## 接手检查（01:33–01:58，任务书要求 20 分钟内）

1. **运行实例**：3467 存活，PID 25748（与旧 A 路 STATUS 一致）；`GET /v5-preview` 200、`GET /v5-preview/remote-session` 200。
2. **源/副本一致**：`diff -rq site/app vs se-preview/app`、`site/lib vs se-preview/lib` 均无差异（01:33 复核）。源=运行。
3. **旧产品 writer 已释放**：`site` 内晚于 `ZCODE_NIGHT_COMMON_20260914.md`（01:17）的新写入 = 0（find 复核）。旧 A 路最后一笔为其 01:20 的自有演示数据修店（非源码）。**本路自此起接管产品写入。**
4. **脏改动（记录，不清理）**：`site` git 状态含历史遗留改动（根 docs 删除/`app/jw-front.*`/`package*.json`/`scripts/` 等，均为此前轮次产物，非本夜产生）；本路不动这些文件。3311/3321/3399 未触碰。
5. **远程尽调数据现状（只读）**：remote-store 共 8+ 会话；`sessions[0]` = `rs-mtzpo3q1-j33xtuqj`（旧 A 路 M1 演示会话，含 C-M1 预置标注 `an-mu00li0r-ze3muna6` 与 fixture 证据）；其余为 D 路并发测试合成会话。页面加载 sessions[0] —— 演示进入即落在 M1 会话，符合预期。**本路固定演示不创建、不重置、不删除任何远程会话。**
6. **B/C/D 现状**：B 已接手（01:31，只读审查中，其记录的 page.tsx/remote-session page.tsx hash 与本路基线一致）；C 未出现（story/ 不存在）；D 已写两份源基线 hash。本路不等待，先行 CP1。

## 基线快照（写入前，非覆盖）

- `main/baseline/site-baseline.sha256` + 6 个拟改文件副本（page.tsx / rows-view.tsx / rows-logic.ts / remote-session/page.tsx / se-interview.module.css / se-overview.module.css）+ chat-panel/todo-card（只读参考）。
- 拟改路径与完整写面以本目录 `CONTRACT.md` 为准（01:58 冻结）。

## 接口冻结摘要（详见 CONTRACT.md）

- 固定演示 = **服务端状态**约定：沿用 rows-store（`V5_PREVIEW_DATA_DIR`）既有 overview 为唯一事实源；演示推进/人工决定 = 服务端写（requestId 幂等 + expectedVersion 乐观并发）；刷新恢复 = GET；演示步骤位置由 overview 内容签名确定性推导（不建第二事实源、不建工作流引擎）。
- 「重新开始」= 既有 `POST /api/v5-preview/demo/seed`（scenario=approval）+ 确认对话说明重置范围；**只影响主线演示状态，不触碰 remote-store（远程尽调/真实接线分析数据不受影响、不被重置）**。
- 新增后端仅 1 条窄路由 `GET/POST /api/v5-preview/demo/story` + 3 个新库文件（story 数据/服务/类型）；既有 service/store/remote-service 零改动，类型零破坏。

## D 路测试窗口（任务书要求发布）

- **现在可测（CP1 起）**：3467 只读 UI/HTTP 检查；远程尽调写测试沿用 API_OVERNIGHT QA_PLAN 的 `[D-QA 合成]` 会话约定（自建合成会话，勿写 `rs-mtzpo3q1-j33xtuqj`）。
- **story 推进可测时点**：CP2 完成后（本文件「story 可测」标记置位，目标 03:30 前）。story 写入按设计可随时用「重新开始」恢复，不具破坏性；D 在 3467 上做 story 写测试前请先在本文件时间线登记窗口，避免与 A 演示验证并发。
- 如需完全隔离实例：D 可自起 3469（`cd jianwei-v3/se-preview-20260913 && V5_PREVIEW_DATA_DIR=<自建空目录> node node_modules/next/dist/bin/next dev -p 3469 -H 127.0.0.1`），不许杀任何既有进程。

## 时间线（滚动追加）

- 01:33 接手；完成接手检查 5 项（见上）；旧 writer 释放确认。
- 01:58 基线快照 + hash 完成；CONTRACT.md 冻结（01:58 版）。
- 02:10 CP1 完成：首页→远程尽调→返回 浏览器实测通过；入口唯一（chat 工具行）；开发配置已在次级收纳（首页 合成演示·控制 下拉 / 尽调页 演示设置 折叠）；旧报告未动、过时待办由本 STATUS 取代。观察：全屏模拟视图入口目前埋在语音说明内（CP3 处理）。
- 02:00–03:10 CP2 完成：固定演示主线（12 步：尽调×5含人工判断点→签约×4含人工判断点→租后×2→结清）上线。服务端签名推导、requestId 幂等、expectedVersion+fromStepId 双门（防双击跳步）；三分支人工决定（确认/纠正/退回）确定性后继；重新开始=既有 seed（确认框明示重置范围，远程尽调数据不受影响）。浏览器实测：全链路 s00→…→s07→重新开始 通过，纠正/退回分支通过，取消路径通过。**story 可测（D）：3467 story 写入随时可用「重新开始」恢复，非破坏性；请在本文件登记写窗口。**
- 03:10 测试：`test/v5-preview-demo-story.test.mjs` 9/9 绿；`test/v5-preview.test.mjs` 22/22 绿（含 6 处基线纠偏，见 CONTRACT §8）；typecheck 过。环境阻塞如实记录：v5-preview-recovery（需 site 目录自起 dev，被 3311 保护实例的 dev 锁阻断）、v5-preview-http（需 3399）——非代码回归。
- 03:12 数据核实：remote-store 零写入（sessions[0]=rs-mtzpo3q1-j33xtuqj 不变）；rows-store 回到 story 起点。
- 03:15–03:45 CP3 完成：DD 页 B 方式1 窄改集成（客户/业务视图门控+常驻隔离标注、四域提示 chip 行、全屏入口前移）；D-01/D-02/D-04 修复；F-D3 演示数据卫生清理（快照在 baseline/）。泄漏断言与视图切换浏览器实测全过。
- 03:45–04:10 CP4 完成：刷新恢复、双击防跳步、自由模式诚实降级、free 重新开始、DD 字段跨页持久化 全部浏览器实测通过。
- 04:05–04:25 **C 路采用**：22 步 A 形状表落地（含三处映射补丁，见 INTEGRATION_LOG §二）；测试改写后 9/9 绿；浏览器全链走查（含双决定点分支循环）通过。
- 04:30 CP5：build exit 0（main/build-night.log）；lint 改动文件 0 问题；typecheck 过；final-hashes 采集。
- 04:35–04:45 B/C/D 反馈回写：`../ui/feedback-from-a.md`、`feedback-to-d.md`。
- 04:50 D-01 修复实测（暂停/恢复无幽灵条）；D-02 空会话场景 3467 不可达（设计使然），留 D 隔离实例复测。
- 04:55 **RESULT.md 定稿（提前交付）**。剩余：D 复测、基线 lint 债务、少量未采用项（见 RESULT §未完成）。09:00 前仅处理阻断。
- 05:05 **D-01/D-02 隔离复测通过**：一次性隔离实例（独立副本目录+独立空数据目录+3470，node_modules 链接至 site；测毕进程与临时目录已清理）：空库建会话无幽灵条（D-01）；空会话首点「发起关键问题」dock 即切换（D-02 修复生效）。3467 全程未受影响。
- 05:15 采纳 B 建议#4：分析按钮 title 不再泄漏 `JIANWEI_MODEL_*` 环境变量名（诚实短提示+指向演示设置），配置明细保留在「演示设置」抽屉。typecheck/eslint 过、副本已同步、hash 已更新。

## 续轮（截止取消·统一产品轮，同日上午）

- 05:25 读 B/C/D 最新产物：D 五项缺陷已独立复测关闭（最终判定「固定演示可交复验」，remote 20/20、story 17/17）；B SIMPLIFICATION 五项+层级方案细读；C BRANCHES/STORY_SCHEMA 机制差异清单细读。
- 05:30–05:50 **机制统一（复用现有实现，不接入 C 模块）**：①自动推进链（连续自动步一次推进，人工动作/决定步停止，决定路径不自动链）；②人工动作步 holdForHuman（s03/s05/s10/s16）；③退回仅一次（s12/s17 去 return，对齐 C 有限路径，消除 D-03 残留）；④纠正后更新表达核验（correct 文案+s13 双口径消息+note 留档；store 级升版按解耦约定不执行）。测试 9/9 重写全绿。
- 05:50–06:10 **B 建议集成**：现场画面区（页内主体+诚实徽章+问题浮层+控制条）、桌面四域右侧栏（≥900px，手机保留 chip 行）、全屏挂断/拍照去重、PendingBar 单渲染点、证据面板受控开合。死代码 preview.module.css 删除（快照留存）+ 两个陈旧样式测试退役。
- 06:10–06:25 **三分支结果提示**（确认/纠正/退回各一句明确表述，storyNotice）。
- 06:30 门禁与验证：71/71 测试绿；typecheck/eslint/build 全过；浏览器实测：链式推进落点、并行组消息、确认提示、客户视图泄漏断言、拍照直达、375 画面区、桌面侧栏；新截图 3 张。源/副本 diff 一致；final-hashes 已更新。
- 06:35 向 D 发出续轮复测请求（`feedback-to-d.md`），等待 D 独立复测结论后收口。

| 09:05 | **D 三轮复测完成（Wave-2，对本轮最终版本）**：remote 20/20、story 15/15；D-06/D-07 复测关闭（s12 仅确认/纠正、s17 仅确认）；链式落点/storyNotice/画面区/侧栏/375 全部通过；`qa/RESULT.md` 放行判定=**通过**，七项缺陷全部复测关闭、无未关闭阻断项 |
| 09:10 | A 收口核对：`main/final-hashes.sha256` ↔ `qa/source-sync-r2-sha256.txt` 按完整路径比对，12 个产品文件全部一致（差异仅为 D 基线不含 test/ 目录，正常）。**续轮收口。** |
