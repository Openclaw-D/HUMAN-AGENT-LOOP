# UX_REVIEW · ROWS_FULLSTACK 前端只读审查

- 审查角色：UX/review worker（原生 sub-agent，只读；唯一写面 = 本目录）
- 日期：2026-09-11
- 审查对象（8 个前端文件）：`app/v5-preview/{page.tsx, rows-view.tsx, domain-row.tsx, todo-card.tsx, chat-panel.tsx, api-client.ts, rows-logic.ts, preview.module.css}`
- 交叉核对（只读，不属问题清单主体）：`lib/v5-preview/shared-types.ts`、`lib/v5-preview/service.ts`、`test/v5-preview.test.mjs`
- 依据：`V5/ZCODE_ROWS_FULLSTACK_TASK.md`、`V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md`（FROZEN）、参考图 `V5/design/20260911-business-five/06-horizontal-rows.png`（已实读）
- 方法边界：纯代码只读审查 + 参考图逐区块比对。390/1920 的响应式结论为基于 CSS/标记的推理（对比度经计算核对），浏览器证据由主 Agent 串行实测提供；本审查未做任何浏览器操作、未改任何代码。

---

## 一、总体结论

| 审查维度 | 判定 | 摘要 |
| --- | --- | --- |
| 1 语义与信息架构 | 基本一致 | 逐区块与参考图对齐；预览控制条替代生产导航属可接受偏差；差异见第三节 |
| 2 状态与进度分离 | 通过（1 处色彩纪律例外） | 灯色/灰度分离干净、无数字进度、"演示示意·非计算"到位；formError/formOk 用红绿超出契约字面（P2-2） |
| 3 可读性与响应式 | 无硬伤，若干打磨 | 对比度全部达标（muted≈7:1，三信号色 4.9~5.4:1）；触控目标与 11px 小字偏弱；轻玻璃不影响读字 |
| 4 越权与假联动 | 通过 | 无专业详情入口、无批准/放款/结清按钮；服务端角色/版本门失败关闭；无本地事实源、无乐观假状态 |
| 5 空态/错误/冲突文案 | 良好（2 处问题） | 合成标注覆盖面好、409 保留草稿流程正确；成功提示永不显示（P2-5）、NOT_FOUND 文案暴露内部 id（P2-4） |
| 6 键盘与 reduced-motion | 通过（2 处打磨） | focus-visible/label/aria-expanded/reduced-motion 全部到位；滚动区键盘可达性与 toolbar 语义待打磨 |
| 登记待修 ①（抬头编号重复） | 代码层已修复，待浏览器复验 | `projectLine` 去重 + 回归测试已存在（P2-1） |
| 登记待修 ②（待复核仍显示"提交材料"） | 确认存在 | 升级为 P1-1，含连带文案问题（P2-4） |

问题数：**16 条 = P1×2 + P2×5 + P3×9**。总体质量高于演示项目平均线：颜色纪律、失败关闭、幂等与冲突语义在代码层落实认真；主要风险集中在"验收闭环之后的展示态"（待复核态的入口与反馈），恰是评审者最容易触碰的区域。

---

## 二、参考图逐区块比对

参考图为 390 宽手机稿；实现为手机基准 + 桌面单列加宽（≥900px，max-width 980px），与任务书"横条方向"要求一致。

| 区块 | 参考图意图 | 实现（rows-view.tsx / preview.module.css） | 判定 |
| --- | --- | --- | --- |
| 顶部导航 | 居中标题"项目总览"+ 返回箭头 + "…"菜单 | 无生产导航；以 sticky 预览控制条替代（"交互预览 · 合成数据"徽标 + 正式审批禁用说明 + 演示情景 select + "演示控制·非业务操作"虚线框） | 可接受偏差：演示页不应有可用的返回/菜单假按钮，用演示控制条替代是对的；但页面因此缺一层"页面名"标题，h1 直接是客户名，层级比参考图少一级（见 P3-8） |
| 抬头 | 客户名大字（远山精密制造）/ "新客回租 · JW-2026-018" / "演示项目"灰字 | `customer` 28px/700、`projLine` 15px、`demoMark` 12px muted（rows-view.tsx:14-18）；编号去重由 `projectLine` 保证（rows-logic.ts:80-84） | 一致（比例、留白与参考图接近；编号重复问题已修复，见 P2-1） |
| 项目进展 | 左标签 + 灰度条（约 55% 填充）+ 右文字"审批推进中" | `progressRow` flex：标题 + track(flex:1, 10px 高) + 文字标签 + "演示示意·非计算"虚线 chip + 一行 overallDesc（rows-view.tsx:20-28） | 一致 + 有意增强：chip 与描述行是契约 §5/§3 要求的如实标注，超出参考图属正确方向 |
| 四横条 | 每条：域名大字 + 右侧信号灯（点+文字）/ 四段灰度分段条 / 一句灰字说明 | `domainCard`：`domainName` 18px、`lamp` 13px + 10px 圆点、`segments` 4×1fr 网格高 12px、`domainSummary` 13px（domain-row.tsx:36-56）；顺序 政策/信审/商务/资产 | 一致：结构、顺序、密度、留白与参考图对齐；四段不同名（政策/信审/商务/资产各按域配置）符合契约"不强制同名" |
| 当前待办 | "当前待办"小字 + 标题"补充设备清单" + 灰字说明 + 右侧黑底主按钮"提交材料" | `todoCard` 深色描边卡：kicker + 标题 17px + 说明 + 状态徽标 + 主按钮（todo-card.tsx:57-81） | 一致 + 有意增强：状态徽标（待补充/待复核）比参考图信息更明确；但"提交材料"入口不随状态收敛 → P1-1 |
| 项目沟通 | 折叠条：对话图标 + "项目沟通" + "业务与风控共同跟进" | `chatToggle`：标题 + "业务与风控共同跟进 · N 条（合成）" + 展开/收起（chat-panel.tsx:54-64）；展开后消息列表（fromKind 徽标 + marks + 时间）+ 输入行 | 一致 + 有意增强：条数计数与"（合成）"标注、消息源徽标均为正确的如实标注 |
| 页脚 | 无 | "合成数据 · 交互预览" + "版本 vX · 更新于 HH:MM:SS" + "不产生正式 Decision/Receipt"（rows-view.tsx:38-42） | 有意增强：版本号展示与 409 横幅（vX→vY）互为支撑，帮助理解冲突提示，保留 |

布局顺序 抬头→进展→四域→待办→沟通 与参考图完全一致；无拼图/四列/详情页回归。

---

## 三、问题清单

严重级定义：P1 = 影响演示正确性；P2 = 影响体验；P3 = 打磨。全部为建议修法，本审查未实现任何修改。

### P1（2 条）

**P1-1 待复核状态下"提交材料"入口仍然可用，点击后必然失败且报错措辞像系统故障**
- 位置：`app/v5-preview/todo-card.tsx:67-79`（按钮无条件渲染，不读 `todo.status`）；`app/v5-preview/todo-card.tsx:66`（状态徽标显示"待复核"）；服务端行为交叉核对 `lib/v5-preview/service.ts:324-326`（`status !== '待补充'` → 404 NOT_FOUND）。
- 现象：验收闭环（提交 → 待复核）完成后——正是演示的高光时刻——卡片仍显示可点的"提交材料"。评审者几乎必然点击：表单展开、输入、提交，然后看到"提交失败：待办不存在或已非开放状态：todo-device-list（草稿已保留，可修改后重试）"。这是"界面承诺可做 → 系统拒绝"的动线矛盾，且错误文案把内部 todoId 直接暴露给业务视角。
- 建议修法（前端即可解）：按 `todo.status` 分叉渲染——`待补充`：现状按钮；`待复核`：按钮替换为静态文字/禁用徽标（如"已提交 · 待专业复核（演示）"），不再提供表单入口；`已完成（演示）/已结清（演示）`：同理收敛。不要只禁用按钮（disabled 但可见仍诱导），直接替换为状态说明。连带 P2-4 一并处理。

**P1-2 成功提交后 requestId 引用不清空：重复发送相同文本会撞 409 REQUEST_MISMATCH，报错语义误导**
- 位置：`app/v5-preview/page.tsx:113-115`（note）、`page.tsx:134-136`（message）——复用条件仅"上次文本相同"，`noteAttemptRef/messageAttemptRef`（`page.tsx:46-47`）在任何确定性结果后都不清空；服务端交叉核对 `lib/v5-preview/service.ts:303-306 / 376-379`（幂等哈希含 `expectedVersion`，版本已变 → 哈希必不相同 → 409 REQUEST_MISMATCH"重试不得更换载荷"）。
- 现象：第一次发送"收到"成功后，再发一条同文本消息（演示问答中完全可能），客户端复用旧 requestId 而载荷已含新 expectedVersion，服务端判 REQUEST_MISMATCH，用户看到"发送失败：同 requestId 但载荷不同：重试不得更换载荷（内容已保留，可修改后重试）"——把正常的重复发言说成"换载荷"，语义错误且演示观感差。设计意图（网络错误后原样重试幂等安全）是对的，但引用的生命周期错了。
- 建议修法（纯前端）：仅在 `ApiFailure.code === 'NETWORK'`（结果未知）时保留 attempt ref 供原样重试；收到任何确定性响应（ok / conflict / 业务错误）即清空对应 ref，让下一次新动作拿新 requestId。两条写入路径同修。

### P2（5 条）

**P2-1（登记待修①核验）抬头项目编号重复：代码层已修复，待浏览器复验后可核销**
- 位置与证据：`app/v5-preview/rows-logic.ts:80-84`（`projectLine`：projectName 已含编号时只显示一次）、`rows-view.tsx:16`（抬头改用 `projectLine`）、`test/v5-preview.test.mjs:292-298`（回归测试，注释明确记录曾渲染成"新客回租 · JW-2026-018 · JW-2026-018"）。
- 判定：以当前源码推演，种子数据（projectName 已含编号）下抬头只显示一次编号，与参考图一致。两文件时间戳（00:45）晚于其余文件，判断为登记后已修复。**剩余动作在主 Agent**：用当前构建复验 390/1920 截图，确认交付证据与代码一致；若截图仍见重复即为旧构建未刷新。
- 建议：主 Agent 复验后在 CHECKPOINTS.md 核销本项；无需再改代码。

**P2-2 提交成功提示永不显示（死反馈）：ok 消息渲染在随同卸载的表单内**
- 位置：`app/v5-preview/todo-card.tsx:43-47`（成功分支 `setDraft(''); setFormOpen(false); setOk(...)`）与 `todo-card.tsx:82,103`（ok 段落渲染在 `{formOpen ? <form>…}` 内部）。
- 现象：React 状态批处理后 `formOpen=false`，整个表单连同 ok 段落一起卸载——"已提交（合成演示）；最新状态见总览"以及更重要的幂等重放提示"服务端幂等重放，未重复记账"永远不可见。用户只剩间接反馈（状态徽标变"待复核"、灯文字变化、沟通区两条新消息），刻意撰写的成功/重放文案成为死代码。
- 建议修法：ok 提示移出表单条件块（渲染在卡片尾部、表单之外），或成功后保持表单展开仅清空草稿并显示 ok，延时/下一次操作再收起。二选一，保证重放提示可达。

**P2-3 409 冲突横幅只在页面顶部，表单旁无内联提示，移动端易错过且不知可直试**
- 位置：`app/v5-preview/page.tsx:189-193`（横幅仅此一处）；`todo-card.tsx:49-51`、`chat-panel.tsx:45-47`（conflict 分支静默返回，依赖页面级横幅）；`preview.module.css:76-84`。
- 现象：390px 下待办卡/沟通表单在四条域卡之下，大概率在折叠线以下；顶部 `role="alert"` 横幅（"状态已更新（vX→vY），草稿已保留"）未必进入视野，且未说"可直接再次提交"——重试路径（刷新后直接再点提交）是通的，但用户无从得知。
- 建议修法：conflict 时在表单提交行附近追加内联 `role="status"` 短提示（如"版本已更新至 vY，可直接再次提交"）；横幅保留作全局告知。

**P2-4 NOT_FOUND 服务端文案暴露内部 todoId，业务视角出现技术标识**
- 位置：`lib/v5-preview/service.ts:325`（"待办不存在或已非开放状态：todo-device-list"）；前端原样透传于 `todo-card.tsx:102`。
- 现象：业务演示页面出现 `todo-device-list` 这类内部标识，破坏"业务只见业务语言"的观感（P1-1 修复后出现频率降低，但竞态——另一视口已处理待办——仍会命中）。
- 建议修法：属 Backend worker 写面——服务端消息去掉 id 尾巴（改为"该待办已不在可提交状态，请刷新后查看最新状态"）；或前端按 `code` 映射业务文案、不透传服务端 detail。两者取一即可，改后端更干净。

**P2-5 表单错误/成功文字使用红/绿信号色，超出冻结契约颜色纪律的字面边界**
- 位置：`app/v5-preview/preview.module.css:206-207`（`.formError { color: var(--sig-red) }`、`.formOk { color: var(--sig-green) }`）；使用点 `todo-card.tsx:102-103`、`chat-panel.tsx:99`、`page.tsx:195`（seed 错误）。
- 现象：IMPLEMENTATION.md §5 与任务书均写"红黄绿仅用于判断状态灯圆点/文字，其余黑白灰"。表单功能反馈色在惯例上可辩护，但与 FROZEN 契约文字冲突，且红色错误文字与"红线域"的判断语义可能在视觉上混淆（错误提示 ≠ 红灯判断）。
- 建议修法（二选一，需主 Agent 裁决）：a) 严守契约——formError 改 ink 加"提交失败："前缀已有、formOk 改 ink 或 muted 加"✓"字符；b) 主 Agent 在契约中补一条明示例外（"表单操作反馈可红/绿，判断语义除外"）。不要保持现状的模糊状态。

### P3（9 条）

**P3-1 触控目标偏小（390px 主要操作点）**
- 位置：`preview.module.css:209-216`（primaryBtn 7px 16px/13px，实测高约 34-36px）、`:71`（barField select 3px 6px，高约 26px）、`:257-266`（chatInput 高约 34px）。
- 影响：达 WCAG 2.5.8（24px）下限，低于 44px 移动最佳实践；情景切换 select 是演示常用控件，误触/难点最明显。
- 建议：移动基准下给 primaryBtn/select/chatInput `min-height: 44px`（或 padding 增至 10-12px），桌面可回落。

**P3-2 11px 字号偏多，中文小字可读性弱**
- 位置：`preview.module.css:135`（progressHint）、`:205`（fieldHint）、`:252-253`（mark/msgTime）、`:271-272`（footMeta/footNote）。
- 影响：对比度达标（#595959 ≈7:1），但 11px 中文在演示投屏/截图缩放下发虚。
- 建议：统一提到 12px 下限；11px 仅留 给纯装饰性重复信息。

**P3-3 390px 下"项目进展"示意条被固定文本挤压到约 90-120px 宽，示意力下降**
- 位置：`preview.module.css:130-135`（标题/标签/hint 三段 `white-space: nowrap` + track flex:1）。
- 现象：无横向溢出（主 Agent 已实测），但参考图中进度条约占 55% 宽，本实现窄屏下 track 仅剩零头，示意条近乎装饰。
- 建议：窄屏（<480px）将"演示示意·非计算"chip 换行到行下或隐藏（aria 文本已含该标注，信息不丢失），把宽度还给 track。

**P3-4 沟通消息滚动区不可键盘聚焦，新消息无 SR 播报**
- 位置：`app/v5-preview/chat-panel.tsx:67`（`<ol>` 无 tabindex）、`preview.module.css:243`（max-height 320px overflow-y）。
- 影响：键盘用户无法滚动历史消息；SR 用户对新消息到达无感知。
- 建议：`<ol>` 加 `tabIndex={0}` + `aria-label="项目沟通消息列表"`，并考虑 `role="log"`（顺带获得新消息播报）。

**P3-5 段条名称仅桌面 hover 可见（title 属性），移动端视觉用户看不到四段含义**
- 位置：`app/v5-preview/domain-row.tsx:45-53`（`role="img"` + aria-label 已覆盖 SR；`title` 仅 hover 生效）。
- 现象：参考图同样不显示段名，属可接受偏差；仅记录。SR 用户信息完整，视觉移动用户少一层信息。
- 建议：不阻塞；如需增强可在卡底加一行 sr-only 之外的折叠段名，或维持现状并在 DEMO.md 说明。

**P3-6 `role="toolbar"` 语义不精确**
- 位置：`app/v5-preview/page.tsx:167`。
- 现象：toolbar 语义要求子元素为控件集，其中含徽标/说明等非控件文本；对 SR 是过强承诺。
- 建议：改 `role="region"` + 现有 aria-label，语义更稳。

**P3-7 `resolveWriteConflict` 在 serverVersion 缺失时以 expectedVersion+1 兜底，横幅可能展示从未存在的版本号**
- 位置：`app/v5-preview/rows-logic.ts:33-35,39-41`；横幅渲染 `page.tsx:189-193`。
- 现象：异常响应下横幅显示"vX→vX+1"，该版本可能不存在；演示中几乎不触发，但一旦触发会引发评审追问。
- 建议：兜底文案退化为不带具体版本（"版本已更新，草稿已保留，可直接重试"），仅在 serverVersion 可信时显示 vX→vY。

**P3-8 页面缺"项目总览"层级标题；`scenarioLabel` 字段前端未消费**
- 位置：`app/v5-preview/rows-view.tsx:13-18`（h1 直接是客户名）；`lib/v5-preview/shared-types.ts:58`（scenarioLabel 无 UI 消费点，已 grep 确认）。
- 现象：对照参考图少了导航标题一层（本审查第二节）；契约字段 scenarioLabel 闲置。
- 建议：可在抬头之上以小字补一行页面题（可直接用 scenarioLabel，如"演示项目 · 审批推进中"），同时消掉闲置字段；不补则保持现状并记录为契约冗余。

**P3-9 桌面 980px 单列下，域卡"名称↔状态灯"两端距离过长，视觉扫描线拉远**
- 位置：`preview.module.css:147`（domainHead space-between）+ `:276`（rowsMain max-width 980px）。
- 现象：1920×1080 下域名与状态灯分居约 940px 宽的两端，单条信息横跨过宽；参考图为手机稿无此约束。无明显可读性错误（正文行长约 70 汉字以内，尚可），属桌面构图打磨。
- 建议：桌面断点内给域卡内容限宽（如 720-760px）或保持现状（单列加宽是任务书明示选择，属可选优化）。

---

## 四、专项审查详录

### 1. 语义与信息架构
结论：与参考图逐区块一致（详见第二节），偏差均为"演示控制替代生产导航"与"如实标注增强"两类正当差异。密度/留白：卡片圆角 10px、内边距 14-16px、段高 12px，与参考图比例吻合；桌面 980px 单列符合任务书"仅加宽容器"的限制。层级缺口仅 P3-8 一处。

### 2. 状态与进度分离
- 分离干净：信号色只出现在 `lampClass` 映射的圆点+文字（domain-row.tsx:19-30 → preview.module.css:151-158）；分段条三态 #595959/#8f8f8f/#dcdcdc 全部 r=g=b（css:16-18,162-164），且测试有 palette 断言把关。
- 不把进度暗示为数字：`trackFill` 仅宽度示意、无百分比文本；`scenarioProgressWidth` 未知情景失败关闭返回 0（rows-logic.ts:9-14）；aria 文本自带"演示示意·非计算"（rows-view.tsx:20）。
- 不暗示审批结果：提交后服务端只改 `judgmentText 待补充→待复核` 且保持黄灯、segments 不动（service.ts:333-342）——代码与文案均无"自动变绿/折算总进度"路径。
- 唯一例外：formError/formOk 红绿（P2-5）。

### 3. 可读性与响应式推理
- 对比度（按 WCAG 相对亮度计算）：正文 #1b1b1b ≈16:1；muted #595959 on 白 ≈7:1（AA 通过，含 11-13px 小字）；信号色 on 白：绿 ≈5.1:1、红 ≈5.4:1、黄 ≈4.9:1（均过 4.5:1，黄贴近下限，仅用于 13px 灯文字可接受）。
- 行宽：正文容器 390px 下约 358px（≈27 汉字/行），桌面 980px 下域摘要/消息约 60-70 汉字/行，均在可读区间（P3-9 为构图而非可读性问题）。
- 触控目标：见 P3-1。
- 轻玻璃：仅预览控制条 `rgba(255,255,255,0.9)` + `blur(6px)`（css:57-58），不透明度高、透出内容极少，13px 前景文字清晰度无实质影响；无满屏伪玻璃。sticky 吸顶在长页滚动时持续可见，符合"清晰可读优先"。
- 横向溢出风险点复查：progressRow 三段 nowrap + flex:1 track 可收缩、todoHead 可换行、chatFormRow `min-width:0`——与主 Agent"无横向溢出"实测一致。

### 4. 越权与假联动
- 无专业详情入口：全部组件无路由跳转/链接；域卡为纯展示 article；GET 投影（shared-types.ts:51-69）无专业细节字段。
- 无伪造审批："提交材料"展开的是补充说明表单，label 明示"不产生正式 Decision/Receipt"（todo-card.tsx:84-86）；全页无批准/放款/结清控件（grep 验证）；情景切换标注"演示控制·非业务操作"且 loading/切换中禁用。
- 无客户端绕过路径：`actorRole` 前端硬编码 'business'（rows-logic.ts:62-69），伪造其他角色被服务端 `requireBusinessActor` 失败关闭（service.ts:261-265,299,373）；版本门在服务端（service.ts:312-320）；无 localStorage/sessionStorage 读写（仅注释提及）；`applyOverview` 只消费服务端响应，无乐观假状态；草稿只在 ok 时清空（todo-card.tsx:43-47、chat-panel.tsx:41-43）。
- 残余问题即 P1-1/P1-2/P2-4：不是越权，而是"合法动作得到错误反馈"的联动质量问题。

### 5. 空态/错误/冲突文案质量
- 加载：骨架近似真实布局 + `role="status"` + srOnly 文案（page.tsx:197-206）。
- GET 失败：错误卡（标题/详情/重试），"合成演示数据暂不可用"如实（page.tsx:208-224）；已有数据时轮询失败降级为软提示并"保留当前显示"（page.tsx:73-75,194）——降级策略正确。
- 409：横幅 vX→vY + 草稿保留 + 自动重 GET + 追上版本自动撤下（page.tsx:66,189-193），机制完整；缺口是内联提示（P2-3）与兜底版本（P3-7）。
- NO_OPEN_TODO：settled 情景 UI 直接渲染无待办空态文案"当前演示情景无开放待办；项目沟通仍可留言留档（合成演示）"（todo-card.tsx:22-29），如实且指引清楚；竞态下服务端文案亦清楚（service.ts:322）。
- 幂等重放：文案如实（"服务端幂等重放，未重复记账"），但因 P2-5（死反馈）不可见。
- 合成标注覆盖：预览条、演示控制 hint、页脚、两个表单 label、空态、错误卡——覆盖面好，未发现未标注的专业断言。

### 6. 键盘与 reduced-motion
- `:focus-visible` 2px ink + offset（css:30-33）✓；三个输入均有可见 label + htmlFor（page.tsx:170-171、todo-card.tsx:84-88、chat-panel.tsx:83-85）✓；待办/沟通折叠钮 `aria-expanded`+`aria-controls` ✓；`<time dateTime>` ✓。
- `prefers-reduced-motion` 全局禁用 animation/transition（css:285-292）：骨架脉冲、trackFill 宽度过渡均被覆盖；聊天滚动为直接赋值无动画 ✓。
- 缺口：P3-4（滚动区键盘可达/SR 播报）、P3-6（toolbar 语义）。

---

## 五、已登记待修两项的状态核验（主 Agent 待办清单对照）

| 登记项 | 本审查核验 | 去向 |
| --- | --- | --- |
| ① 抬头项目编号重复显示 | 代码层已修复（rows-logic.ts:80-84 + rows-view.tsx:16 + 回归测试 test/v5-preview.test.mjs:292-298） | **P2-1**：待主 Agent 浏览器复验当前构建后核销 |
| ② 待复核状态仍显示"提交材料"入口 | 确认存在（todo-card.tsx:67-79 不读 status） | **P1-1**：本审查最高优先级，建议与 P2-4 同修 |

---

## 六、建议主 Agent 浏览器复验点（串行实测时顺带取证）

1. 当前构建 390px 抬头是否只显示一次编号（核销登记①/P2-1）。
2. 验收闭环完成后待办卡形态（P1-1 修复前：复现"提交材料→必然失败"的演示风险，留截图佐证优先级）。
3. 沟通区连续发送两条相同短消息（如两次"收到"），预期复现 P1-2 的 REQUEST_MISMATCH 误导报错。
4. 390px 观察提交成功后是否有可见成功提示（预期：无，P2-5），以及 409 场景下折叠线以下是否能看到任何提示（P2-3）。
5. 1920px 下域卡名称↔状态灯扫描距离（P3-9 取证，决定是否限宽）。

（本文件为 UX/review worker 唯一交付物；未修改任何代码、测试或 authority 文件，未做 git 与浏览器操作。）
