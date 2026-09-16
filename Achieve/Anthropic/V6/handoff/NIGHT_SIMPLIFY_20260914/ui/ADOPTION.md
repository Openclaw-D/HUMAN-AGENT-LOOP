# ADOPTION — A 采用/未采用/待确认 逐项记录（任务B · 滚动更新）

依据：`main/INTEGRATION_LOG.md`、`ui/feedback-from-a.md`、B 对 3467 集成结果的只读复验。**采用与否以 A 的源码写入为准；B 的候选不因此视为"已上线组件"。**

## 一、A 的实际采用动作（累计，含 05:50–06:10 第二波）

> r3 = B 在 A 第二波集成（page.tsx `fc7405f` / css `11ff9d1`，71/71 测试绿）后的只读复验（证据 `evidence/r3-live-*`）。

| # | B 交付项 | A 裁量 | B 复验（3467 实测） |
|---|---------|--------|---------------------|
| 1 | viewMode 客户视图门控 + 常驻隔离标注 | **采用（等效）** | ✅ r3 复验通过：隔离标注在位、内部内容全隐藏（`r3-live-375-customer.png`） |
| 2 | DomainTips 四域提示 | **采用（chip 行）** | ✅ 375 chip 行；**1280 右栏侧栏 248px（05:50 新增，与候选规格一致）** |
| 3 | StageView 画面主体（F3） | **采用（05:50 新增）** | ✅ 页内常驻画面区 285px@375、诚实徽章"视频未接入·不申请摄像头/麦克风"、问题浮层、控制条（模拟/放大/拍照直达）（`r3-live-375-after-integration.png`） |
| 4 | 挂断/拍照语义去重（建议#3） | **采用（05:50）** | ✅ 拍照/选图直达控制条，不再跨区跳转 |
| 5 | PendingBar 单渲染点 | **采用（05:50）** | ✅ 单点渲染（当前无未知请求故不显示；代码按 A INTEGRATION_LOG） |
| 6 | 死代码 preview.module.css 删除 | **采用（05:50，快照留存）** | A 记录（删代码无 UI 面，B 未重复验证） |
| 7 | F4 客户视图模拟开关无反馈 | **采用（等效：开关移出客户视图）** | ✅ r3：客户视图无该 checkbox（`simToggleNoFeedback=false`） |
| 8 | 分析按钮 title 去泄漏（建议#4） | **采用（05:15）** | ✅ anyEnvLeak=false 正则断言 |
| 9 | F1 关键字段核对折叠 | **未采用（仍开放）** | ❌ 坞仍 304px@375、两输入常驻（`r3-live-375-after-integration.png`） |
| 10 | F2 header 静态标题去重 | **未采用（仍开放，被画面浮层放大）** | ❌ 同屏三现：header（截断）+ 画面浮层"当前：…" + 问题区块全文（`r3-live-question-duplication.json`；第 4 处为历史问答记录，合法） |
| 11 | 17 回调整组件化（方式2） | 未采用 | 候选 + adapter 保留为重构蓝本 |

早期裁量变化记录：PendingBar（曾拒→05:50 采用）；StageView 常驻（曾保守→05:50 采用，用户"视频主体"指令后重裁量）；preview.module.css（曾留白天→05:50 删除）。

## 二、对 B 候选的影响与处置

1. `runWrite` 形态变化（D-01/D-02）不影响候选（props 化，无 runWrite）；adapter 输入形状未变。
2. 移动端四域收起修复：A 的 chip 行 + 桌面侧栏组合下不适用，B 已撤回；候选保留。
3. 候选 v2（tsx `53fa8727…` / css `5bbda068…`）中 **F1/F2 两项仍未被采用**——精确落点见 `feedback-from-b.md` §1（F1: page.tsx 关键字段块；F2: sivTopTitle 一行改动）。

## 三、B 对集成结果的独立复核证据

- 第一波（04:35 集成）：`a-integrated-*.png` ×3 + 8/8 客户视图断言。
- 第二波（05:50 集成，r3）：`r3-live-375-after-integration.png`、`r3-live-1280-after-integration.png`、`r3-live-375-customer.png`、`r3-live-question-duplication.json`（问题三现定位）。

## 四、待确认（滚动）

- [ ] F1/F2 是否进入 A 下一笔集成（r3 反馈已发）
- [ ] 用户视觉验收（画面区常驻、桌面侧栏、隔离标注）
- [ ] D 续轮复测结论（A 06:35 已请求）
