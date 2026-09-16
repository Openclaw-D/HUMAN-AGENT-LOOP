# candidate/ — 远程尽调页面候选（任务B · 供A审查集成）

## 版本历史

| 版本 | 时间 | 变化 | hash（tsx / css） |
|------|------|------|-------------------|
| v1 | 02:15 | 首版：StageView 主体/四域栏/viewMode/单一恢复点 | b240bc10 / 5a157188 |
| v1.1 | 02:58 | +viewMode 客户视图门控（对齐 CONTRACT §6） | （被 v2 覆盖） |
| **v2（当前）** | 第二轮 | ① 画面区浮层补 依据/风险 行（业务视图；信息不丢、不加区块）；② 操作坞"关键字段核对"默认折叠为一行开关（实测坞高 224→199px；A 集成版实测 304px，-35%），展开 266px；③ 其余同 v1 | **53fa8727 / 5bbda068** |

冻结版本 hash（sha256）：

| 文件 | hash |
|------|------|
| `RemoteInterviewPage.tsx` | `53fa8727…`（完整：见下） |
| `remote-interview.types.ts` | `2d394563b9e52db59d785b2c9d18f0ab4ec51e667be49b4dc1bc05dd517819df`（v2 未改） |
| `remote-interview.module.css` | `5bbda068…` |
| `session-adapter.ts` | `fec451c12d9be285ce7e79b2b24011a6c989fa0bb44da432f02d24191a728fff`（v2 未改） |
| `css-module.d.ts`（仅候选仓库类型用） | `7237ee59…` |

完整 sha256：
- `RemoteInterviewPage.tsx` = `53fa8727e53dee1f4eddcfd1969f7bbb8de4ce703cac54d05cb4e77bedfea252`
- `remote-interview.module.css` = `5bbda068deda46ff17c64b99aa49016830c3a75d9c9718e6ad8652e7677a6a63`

参考来源（只读复制/改写自，base hash 与 STATUS.md 01:31 基线一致；A 尚未改动这些文件）：

| 候选中的片段 | 来源文件 | base hash |
|------|---------|-----------|
| 顶部/徽章/折叠区/操作坞样式与交互 | `app/v5-preview/remote-session/se-interview.module.css`、`page.tsx` | `c3d51eed…f3d1` / `e7d65a16…4e04` |
| 图标规范（24 viewBox/1.8 描边） | `app/v5-preview/se-icons.tsx` + 原 page 内联 `iconBase` | 同上 |
| 四态文案（加载/失败/空）、恢复条、反馈行文案 | `remote-session/page.tsx:398-454,467-477,822-828` | 同上 |
| 转写列表/证据徽章/回复角色标注 | `remote-session/page.tsx:551-637,848-860` | 同上 |

## 一、集成方式（二选一，A 裁量）

**方式1（推荐，符合 CONTRACT §1 的窄改计划）**：A 窄改现有 `remote-session/page.tsx` 时，按本候选"逐区块"搬运：
- `StageView`（现场画面区）：替换原 `sivSection` 视频状态行（`:510-520`）+ 全屏覆盖层（`:832-886`）的组合 → 页内常驻画面 + `放大画面`按钮；`模拟画面`开关直接作用于画面区。
- `DomainTips`：新增四域提示（现页没有）；桌面右栏/手机一行收起，数据由 A 以现有 `overview.domains` 或新增 props 供给。
- `PendingBar` / 反馈行：替换 ready/empty 双实现（`:438-444,:467-477`）为单渲染点。
- `viewMode` 门控：客户视图隐藏 内部交流/复核留痕/证据区/模型按钮/业务操作坞（CONTRACT §6 要求），切换单元加常驻标注「客户视图 · 展示切换 · 非生产权限隔离」。
- 对应 CSS 类在 `remote-interview.module.css`（前缀 `riv-`，与 `siv-` 无冲突，可整文件并入或按类名摘取）。

**方式2（整页替换）**：把 `RemoteInterviewPage.tsx` + `remote-interview.types.ts` + `remote-interview.module.css` 复制到 `app/v5-preview/remote-session/`，现有 page 改为数据接线层（GET/Registry 保留在 page，把状态经 props 传入本组件）。组件本身**零 fetch、零存储、零注册表**。

**适配器 `session-adapter.ts`**：`mapDetailToProps(detail, opts)` 把现有 detail 响应（page.tsx:99-112 的 SessionDetail 形状）映射为组件 props（open 问题→currentQuestion、无 open→null 发起分支、reviews→中文留痕、modelStatus→业务话术、supersededBy 过滤已取代证据）；四域提示用 `buildDomains()` 组装。纯函数零副作用，A 可改名后直接放产品。

## 二、Props 约束（冻结候选版；A 可在评审后改名单，改后请回写 ADOPTION.md）

数据全部只读传入；写操作全部走回调（组件只调用，不实现业务，不等待返回值）：

- 页面：`phase`（loading/empty/error/ready）、`loadError`、`title`、`backHref`、`viewMode`（'business' 默认 | 'customer'）
- 会话：`live`、`paused`、`projectId`、`currentQuestion`（null = 业务发起分支）、`openQuestionCount`
- 列表：`domains[]`（B 提案形状 `{domainId,label,state?,tips:[{id,text,level}]}`；A 若用 shared-types 的 DomainRow 需做一次映射，字段名见 types 注释）、`evidence[]`、`questions[]`、`reviews[]`、`pendingRequests[]`、`transcript[]`、`internalMessages[]`、`humanPendingCount`
- 呈现：`simulationOn`（受控）、`modelAnalysisAvailable/Reason`（业务话术）、`busy`、`notice`、`actionError`、`voiceNote`（null=未展开）、`cameraSlot`（ReactNode，A 注入现有 CameraPanel；不传则显示占位说明）
- 回调：`onRetryLoad onCreateSession onSubmitRecord(text,fields) onPauseRound onResumeRound onEscalateHuman onAskQuestion(text) onAttachEvidence(fixtureId) onSelectEvidence(id) onSimulateToggle(on) onToggleVoiceNote onAnalyzeQuestion(id) onSimulateFollowups(id) onSendInternalMessage(text) onRetryPending(id) onDiscardPending(id)`

已知取舍（A 需知晓）：
1. 输入草稿（answer/ask/chat/fields）为组件内部 state，**不做 sessionStorage 持久**（原页有）；若 A 要保留刷新恢复，由 page 层以受控 props 接管或组件加可选 `initialDrafts`（未实现，避免假设 A 的恢复约定）。
2. `onSendInternalMessage` 调用后组件立即清空输入（乐观）；失败恢复由 A 在回调内处理（原页的草稿-请求关联语义属 page 层）。
3. 相机不在候选内（CONTRACT：演示流程不得触发摄像头/麦克风）；`cameraSlot` 空缺时显示占位说明，不加载 CameraPanel。

## 三、自测证据（见 ../evidence/）

- 布局断言：`layout-375-state04.json`（无横向溢出、四域收起 47px、主按钮≥44px）、`layout-1920-state04.json`（右栏 248px 侧栏、toggle 隐藏）、`layout-375-state10-longtext.json`（长文本无溢出）、`layout-1920-state06-paused.json`（暂停态/人工待处理/恢复按钮）
- 交互：`interactive-callbacks.json`（提交启用/回调载荷/暂停/转人工/模拟开关/内部消息发送后输入清空）
- 客户视图：`customer-view-leak-check.json`（内部内容全部隐藏 + 隔离标注在位）
- 截图：`m375-01…12`（12 态手机）+ `d1920-04/05/06/10/12`（桌面）——**由 harness 静态渲染产出，非 site 预览实例**
- 键盘：`keyboard-focus-programmatic-state04.json`（26 个可聚焦元素、无正 tabindex、DOM 序=焦点序、disabled 不可聚焦）；真实 Tab 键遍历未验证（harness 页 `document.hasFocus()=false`，按键不到达页面；`:focus-visible` 样式已按规范编写，待 A 集成后由 D 在预览实例核验）

## 四、harness 复跑方法（B 路内，不影响产品）

```
cd V6/handoff/NIGHT_SIMPLIFY_20260914/ui/candidate/harness
node render.mjs        # 产出 out/*.html（身份映射 CSS 类名）
node ../.. 无需安装依赖：esbuild/react 取自 jianwei-v3/site/node_modules（只读）
```
`out/interactive.html`（外链 bundle 版，供常规浏览器直接打开）与 `out/interactive-inline.html`（内联版，供 blob 注入）。harness 的 `next/link` 桩只渲染 `<a>`；类型检查：`tsc -p tsconfig.candidate.json`（strict）。
