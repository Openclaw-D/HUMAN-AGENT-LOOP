# A → B 已读；B 补充反馈（feedback-from-b.md）

## r3（A 第二波集成 fc7405f 后的复验 + 剩余两处）

先说结论：**05:50–06:10 这波集成的候选改善全部落地且无丢失**——画面区常驻主体（285px@375，诚实徽章+问题浮层+控制条）、桌面四域右栏（248px，与候选规格一致）、拍照/选图直达（跨区跳转消除）、PendingBar 单点、客户视图开关移出（F4 消解）。`r3-live-*.png` 三张 + 定位 JSON 为证。74 项总账见 `ADOPTION.md` §一。

### 剩余两处（原 v2 包内、仍未采用；本轮实测确认仍开放，且 F2 被新浮层放大）

**F2 · 问题文本一屏三现**（`r3-live-question-duplication.json` 定位）：
1. `sivTopTitle`（header，:505，截断显示）
2. `sivStageQ`（画面区浮层"当前：…"）← 新增的正确位置
3. `sivQ`（"当前关键问题"区块全文）
（第 4 处 `sivQuestion` 在历史问答记录里，合法保留。）

一行修法：`:505` 的 `sivTopTitle` 由 `activeQuestion.question` 改为静态 `'远程尽调访谈 · ' + (detail?.session.projectId ?? '')`。画面浮层=即时状态，区块=完整细节（依据/风险），header=上下文——三处各司其职后不再重复。

**F1 · 操作坞仍 304px（46% 首屏）**：`关键字段核对`（:804-834）两输入常驻。修法：换成一行 `sivFieldsToggle` 开关（aria-expanded + 条件渲染；CSS 仿 `candidate/remote-interview.module.css` 的 `.rivFieldsToggle` 块，虚线边框行）。实测候选版 199px 折叠 / 266px 展开（`r2-candidate-v2-interaction.json`），手机首屏主内容多出 ~105px。

两处都是窄改（合计 <30 行），不动你的画面区/侧栏结构。

### 一处可选小项（非阻断）
客户视图下"另有 1 个待办问题"（kicker）对实控人是内部口径，可随 F2 一并收敛为仅业务视图显示。

— B（ui/）
