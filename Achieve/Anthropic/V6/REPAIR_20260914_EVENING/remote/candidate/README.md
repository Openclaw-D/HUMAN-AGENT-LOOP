# candidate/ — 远程尽调现场页候选 v3（C 路 · 供 A 审查集成）

日期：2026-09-14 晚；交付目录 `V6/REPAIR_20260914_EVENING/remote/candidate/**`。
本候选**取代**旧 `V6/handoff/NIGHT_SIMPLIFY_20260914/ui/candidate/`（RemoteInterviewPage v2, tsx 53fa8727…）；F1/F2 已在本版落地为默认行为，A 不应再合并旧 v2 文件。

## 版本与冻结 hash（sha256）

| 文件 | hash |
|------|------|
| `RemoteInterviewStagePage.tsx` | `4b4cdd802976939b019c1a8bb7c7d7379910befb2c5ced5277bf581d912d38e7` |
| `remote-interview.types.ts` | `c46b471d0863dd6692fe6076661e87272e1630c140f3e0fd5bd28a6b1d949876` |
| `remote-interview.module.css` | `87d4eee81ce0446de32c8ae5d9d8930bc2330e970042ecd6a256d0e604926cc4` |
| `session-adapter.ts` | `e9d40c13ceb432e42713c94678028a622616f8a917385d664468c57036650102` |

类型检查：`tsc -p tsconfig.candidate.json`（strict，含 harness 源）通过，0 错误。

## 一、布局（对照 COMMON 20260914 尽调条）

```
┌──────────────────────────────────────────────┐
│ header：返回 · 状态徽章 · 静态标题(F2) · 视图切换  │  ← 不含问题文本
├───────────────────────────────┬──────────────┤
│ 现场画面（首要视觉，约半屏参考）    │ 紧凑工具（单开）│  ← 桌面 280px 右栏
│ 诚实徽章 + 问题浮层(唯一主呈现)    │ 四域/证据/参会 │     手机为工具行
│ 控制条 + 依据/风险细节条           │              │
├───────────────────────────────┴──────────────┤
│ 进度：闭环 n/m · 轮次 · 待办 · 人工待处理 · 旧版证据 │
│ 当前操作：输入草稿 + F1字段折叠 + 提交/暂停/恢复/转人工│
│ 聊天：访谈对话流（同源标签去重）+ 历史问答/复核留痕折叠│
└─────────────────────────────────────────────┘
```

- 顶部/画面区高度由内容与视口决定（移动 40dvh、桌面 46dvh 的 clamp 参考值），**无机械 50%**。
- 小屏（375/390）画面保留 220–340px 可理解面积；359px 以下字段纵排。
- F2 落实：header=静态标题 `远程尽调访谈 · {projectId}`；问题文本仅在画面浮层主要呈现一次；
  细节条只呈现 依据/风险（不含问题文本）。全页主呈现计数=1（证据 layout 断言）。
- F1 落实：关键字段核对默认折叠（aria-expanded=false），展开后两输入 + 载荷进入 `onSubmitRecord`。

## 二、集成方式（建议；A 裁量）

**方式1（推荐）**：现有 `remote-session/page.tsx` 保留为数据接线层（GET/RequestRegistry/sessionStorage 草稿持久全部不动），
把本组件复制到 `app/v5-preview/remote-session/`，用 `session-adapter.ts#mapDetailToProps(detail, opts)` 组装 props，
回调逐个接到现有 `runWrite` 动作。对应关系（现 page 行为 → 候选回调）：

| 现 page 动作 | 候选回调 |
|---|---|
| `submitInterviewRecord`（annotations/replies） | `onSubmitRecord(text, fields)`（字段拼装 line 可留 page 层） |
| `pauseRound / resumeRound / escalateHuman`（reviews） | `onPauseRound / onResumeRound / onEscalateHuman` |
| 发起关键问题（annotations + evidence） | `onAskQuestion(text)` |
| 附着证据（evidence fixtures） | `onAttachEvidence('fixture-inspection' \| 'fixture-equipment')` |
| 选中证据 | `onSelectEvidence(evidenceId)` |
| 模拟画面开关 / 语音说明 | `onSimulateToggle(on)` / `onToggleVoiceNote`（voiceNote 文本仍由 page 给） |
| 模型辅助分析 / 模拟追问 | `onAnalyzeQuestion(id)` / `onSimulateFollowups(id)` |
| 尝试核算 | `onAttemptCalculation`（结果经 `calculations` prop 回流） |
| PendingBar 原样重试/放弃 | `onRetryPending / onDiscardPending` |
| 加载重试 / 创建会话 | `onRetryLoad / onCreateSession` |
| 视图切换 | `onViewModeChange('business'\|'customer')`（viewMode 仍为受控 prop） |
| 添加合成转写事件（演示） | `onAddTranscriptDemo`（转写仍由 page 持有，经 `transcript` prop 回流） |

**方式2（备选）**：整页替换后 page 仅留接线层。组件**零 fetch、零注册表、零存储**；
草稿支持受控（`drafts` + `onDraftsChange`，page 可继续 sessionStorage 持久）或组件内自持（不持久）。

CSS：`riv-` 前缀与 `siv-` 零冲突；建议 A 集成时整文件并入新 `remote-interview.module.css`（或按类名摘取进 `se-interview.module.css`）。

## 三、相对现网 page 的行为差异（A 需知晓）

1. **演示设置区简化**：技术行/模型通道行/核算按钮经 `techNote`/`modelStatusLine`/`calculations`/`onAttemptCalculation` 注入；
   四者皆未传时该区只显示说明行（不重复渲染 page 已有实现）。复核留痕移入聊天「历史问答与复核留痕」折叠区（近 4 条）。
2. **历史问答仅列已闭环（closed 且未过期）问题**；当前 open 问题的回复进聊天流（不带问题文本，问题在画面浮层）；
   过期意见只以计数行呈现（`expiredOpinionCount`，"待复核"），不在历史列表展开。
3. **每个问题仍保留**「模型辅助分析 / 模拟追问」按钮（当前问题在聊天头部，历史在折叠区）。
4. **转写**：业务视图在放大画面层回看；客户视图有「访谈转写回看」折叠区；业务视图页面主体不再重复转写列表。
5. **客户视图**：依据行可见（问题上下文属共享会议信息）；风险提示/四域/证据/聊天/进度/操作坞全部隐藏；
   工具只剩参会信息；常驻「客户视图 · 展示切换 · 非生产权限隔离」标注（leak 断言全过）。
6. **参会信息**为新增只读面板（来自 `session.participants`，诚实呈现到场/核实状态 + 现场要求说明），无写操作。

## 四、自测证据（../evidence/）

- 布局：`layout-all-states-375.json`（14 态 @375 无横向溢出）；`zoom-390.json`（80/100/125% 无横向滚动，scrollX=0）。
- 交互：`interactive-tools.json`（工具单开/证据面板/参会 3 行）、`interactive-fields-views.json`
  （F1 展开→提交载荷含 `{"deviceCount":"3","quote":"486"}`；客户视图 7 项隐藏断言 + 返回恢复）、
  `interactive-fullscreen-voice.json`（放大进/出、语音说明开/关、转写演示、暂停回调、拍照/选图直达证据）、
  `interactive-error-empty.json`（错误→重试→ready；空态→创建会话→ready）。
- 截图：`m375-04-ready-live-viewport.png`、`m375-12-customer.png`、
  `m390-04-lower-progress-dock-chat.png`、`m390-06-paused.png`、`m390-10-longtext.png`、`m390-13-superseded.png`、
  `m390-04-zoom-080/125.png`、`d1920-04-ready-live.png`、`d1920-09-tools-evidence.png`。
  全页(fullPage)截图在本 IAB 会话存在拼接伪影（DPR 震荡），**以视口截图 + DOM 断言为准**；
  `m375-04-ready-live-full.png`/`m390-04-ready-live-full.png` 为伪影样本仅作记录。
  错误恢复与空态创建无稳定截图（截图管线两次超时），行为以 `interactive-error-empty.json` 断言为准。
- 复跑：`node harness/render.mjs`（重渲 14 态+交互页）；`node harness/serve.mjs 3477`（本机静态服务，
  本轮实测在 `http://127.0.0.1:3477/` 进行；不占用 3467/3311/3321/3399）。

## 五、遗留（如实）

1. harness 键盘 Tab 遍历未验证（同旧候选限制）；无正 tabindex、按钮均原生可聚焦。
2. 相机面板经 `cameraSlot` 注入（候选不复制相机逻辑）；本轮证据用占位说明断言，CameraPanel 原位复用待 A 集成后核验。
3. 缩放为独立上下文 CSS zoom 模拟（Chrome 同源原语）；用户当前浏览器预览未触碰。
