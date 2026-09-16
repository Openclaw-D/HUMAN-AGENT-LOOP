# A → D 反馈（NIGHT_SIMPLIFY_20260914）

写面：main/**（A 只写自己目录；D 复测口径如下）。时间：2026-09-14 04:40；05:05 更新（A 已自行完成隔离复测，见文末）。

## D 缺陷处置状态（全部已在 site 源 + 预览副本修复，待 D 独立复测）

| 缺陷 | 处置 | 修复位置 | 复测口径建议 |
| --- | --- | --- | --- |
| **D-01**（高）幽灵 unknown 条目 | **已修复** | `remote-session/page.tsx` runWrite：新增 `registryKey`（retry 路径=条目键；新请求=`began.entry.requestId`），`registry.resolve(registryKey, …)`；载荷内 requestId 仅作服务端幂等标识 | D 原口径（连续 3 种写后 unknown=0）。**注意：D 的 3469 runtime 副本（01:40 版）不含修复，请从 `jianwei-v3/se-preview-20260913/` 重新同步 app/ 后复测**（或按 STATUS 的 3469 配方自建新隔离实例） |
| **D-02**（高）发起关键问题首次静默失败 | **已修复** | ask 流去掉对 runWrite 返回值的 `(attached).evidence` 解引用（runWrite 本就返回 void）；两条分支统一「重新 GET detail 取最新证据 → 发起标注」，异常不再吞（置 writeError 提示可安全重试） | D 原口径：空会话→单次点击→标注创建+dock 切换；另可加断言「无控制台 TypeError」 |
| **D-03 / F-D1**（较高）分支混排 | **已修复（方案 a + C 数据采用）** | ① 服务端 advance 改为显式 `nextStepId` 优先（分支步回跳，不再线性 idx+1）；② 已采用 C 路 22 步 A 形状表：s09 决定点 return→s10→s11→s12（再判断点）→confirm/correct→s13；s15 return→s16→s17→confirm→s18。纠正/退回各自品牌步骤不再混排 | story 已可测（3467）：全分支 HTTP/UI 走查 |
| **D-04**（低）字段持久化不一致 | **已修复** | 关键字段核对值持久化到 sessionStorage `jw:v5-preview:draft:fields`（与访谈记录草稿同模式，损坏回退空值） | 填字段→返回首页→再进入→两输入均保留 |
| F-D2 数据不变量断言 | **已完成** | `test/v5-preview-demo-story.test.mjs`：签名唯一 22/22、s00==approval 种子、终点==settled 种子、后继存在、决定分支恰 3 | 已在 A 套件常绿；D 可复跑 |
| F-D3 演示数据卫生 | **已清理** | M1 会话（rs-mtzpo3q1-j33xtuqj）：两组标注各去重至 3 条不重复回复（删 12 条重复模拟回复）；当前问题去除「（闭环验证）」测试后缀。**清理前快照：`main/baseline/remote-store.pre-cleanup.json`** | 只读目验 3467 DD 页 |

## A 侧环境记录（供 D 排程）

- 3467 story 写测试随时可做（非破坏性，`重新开始` 即恢复）；请按 STATUS 登记写窗口。
- `v5-preview-recovery` 套件在本机被 3311 保护实例的 dev 键阻断（`Another next dev server is already running`）——非代码回归，属环境限制；`v5-preview-http` 同理需 3399。
- 修复涉及文件（D 复测引用版本）：`app/v5-preview/remote-session/page.tsx`、`app/v5-preview/api-client.ts`、`app/v5-preview/demo-story-panel.tsx`、`app/v5-preview/page.tsx`、`app/v5-preview/rows-view.tsx`、`app/v5-preview/rows-logic.ts`、`lib/v5-preview/demo-story-{types,data,service}.ts`、`app/api/v5-preview/demo/story/route.ts`。hash 见 `main/RESULT.md` 末节。

## 05:05 更新：A 已自行完成隔离复测（两阻断级）

A 起了一次性隔离实例（独立目录副本+独立空数据目录+3470，node_modules 为指向 site 的链接；测毕进程与目录已清理，3467 未受影响）：**空库→建会话→首次点击「发起关键问题」→ dock 即切换「轮到实控人回答」，全程无幽灵 unknown 条、无静默错误** —— D-01、D-02 修复在真实 HTTP+UI 路径生效。D 仍可按上表口径独立复测（D-03/D-04 的走查也在 RESULT 测试表）。

---

# 续轮复测请求（2026-09-14 上午 · 截止已取消）

用户要求：本轮以「统一产品」收口，A 改动后**由 D 独立复测，无新问题才结束**。

## 本轮 A 变更（请 D 复测）

1. **自动推进链**（`demo-story-service.ts` chainFrom + `demo-story-data.ts` holdForHuman）：一次 advance 连续应用常规自动步，在人工动作步（s03/s05/s10/s16）与人工决定步应用后停止；版本按应用步数递增；决定路径不自动链。
2. **退回仅一次**：s12-dd-07b / s17-sg-02b 去除 return 选项（D-03 残留项对齐 C 有限路径）。
3. **DD 页**：现场画面区（sivStage，含诚实徽章/问题浮层/控制条 模拟画面·放大·拍照选图）；桌面 ≥900px 四域右侧栏（业务视图专属）；旧「视频与连接状态」行移除；全屏「挂断」改「退出」并删除全屏「拍照」重复按钮；未知请求恢复条 PendingBar 单渲染点（empty/ready 统一文案）；证据面板受控开合。
4. **首页**：三分支决定结果提示（storyNotice，推进时清除）。
5. **删除死代码** `app/v5-preview/preview.module.css`（快照 `main/baseline/preview.module.css.deleted`）；对应两个样式纪律测试退役。

## 复测口径建议

- 回归：`python qa/regress_night.py http://127.0.0.1:<port> --remote`、`--story`（story 套件对链式推进的落点断言需按新语义更新：s00→s03、s03→s05、s05→s09；重放/版本门/防跳步语义不变）。
- UI：3467 桌面（画面区/侧栏/控制条）+ 375（画面区 16:9 无挤压、chip 行在位）+ 客户视图（画面区保留、控制条/侧栏/内部隐藏、隔离标注在位）。
- 一致性：`main/final-hashes.sha256`（已更新）↔ 你的 source-sync 基线需重采（本轮变更后）。
- 3469 副本同样需从 se-preview 重同步后再跑（本轮变更未含在你的 03:58 基线内）。

A 侧自测已全绿（71/71、typecheck/eslint/build、浏览器全链+客户视图断言+375/1280 截图）。请复测后把结论写回 `qa/RESULT.md` 或 DEFECTS.md；无新问题 A 即收口。

---

# 续轮补充（08:45）：D-06/D-07/O-1/O-2 已修复，请三轮复测

- **D-06**：s12 选项已为 [confirm, correct]（与提示「不再提供退回；仅可确认或纠正」一致）——「退回仅一次」数据补丁使提示与选项一致。
- **D-07**：s17 选项已为 [confirm]（对齐 C 机制 SG-02B「仅确认」，与提示「仅提供确认选项」一致）。
- **O-1**：s15 纠正标签具体化（「纠正：按人工意见修订条款（转商务补充后重新复核）」）；s16 标题/消息中性化（同时承载纠正/退回来路）。
- **O-2**：s13 汇总去条件式（「如人工已更正记录口径，以更正后口径为准…见上方决定留档」）。
- **O-3**：自动推进链已使 s06–s08+汇合点一次推进完成（s05 保留独立人动作点击）；「任意顺序」语义仍仅 C 模块可交互——已在 INTEGRATION_LOG §十如实记录。
- CONTRACT §3「恰 3 类」已修订为「确定性集合 ⊆ 三类（再判断点按 C 机制裁剪）」。
- 另：本轮还有**自动推进链**（advance 语义升级：连续自动步一次应用，s00→s03、s03→s05、s05→s09、s18→s21；版本按应用步数递增；决定路径不自动链）与 DD 页画面区/侧栏改版，均在你 08:2x 复测的版本（d3c8aa6c）之后——**请以当前 se-preview/源码（final-hashes.sha256，06:40 采集，demo-story-data=b0647d2d）重同步 3469 后做三轮复测**：①链式推进落点（s00→s03→s05→s09）与版本递增；②s12/s17 提示与选项一致（D-06/D-07 复测口径）；③DD 页画面区/侧栏/客户视图泄漏断言；④remote 20/20 回归。
- A 侧自测：71/71（story 9/9 按链语义重写）、typecheck/eslint/build（build-night-r3.log）、浏览器全链走查（含 D-06/D-07 复测口径全部过）。演示现停在起点（1/22）。
