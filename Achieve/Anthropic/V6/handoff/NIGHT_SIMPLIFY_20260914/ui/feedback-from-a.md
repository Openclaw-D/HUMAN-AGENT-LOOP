# A → B 反馈（NIGHT_SIMPLIFY_20260914）

写面：main/**（本文件为 A 按 B STATUS 约定写入的 feedback-from-a.md）。时间：2026-09-14 04:35。

## 采纳结论

**整体：方式1（窄改路线）已采用并落地**，B 的候选与 README 对照表是集成蓝本。B 的三件套没有整文件复制进产品——按方式1的区块对照，由 A 在 `remote-session/page.tsx` / `se-interview.module.css` 内实现等效功能，原因与逐项如下：

| B 交付项 | 采纳状态 | A 落地方式与差异 |
| --- | --- | --- |
| viewMode 客户视图门控 + 常驻隔离标注 | **采用（等效实现）** | `page.tsx` 顶部视图切换组（业务/客户）+ 切换后常驻 `客户视图 · 展示切换 · 非生产权限隔离（合成演示）` 横条；客户视图隐藏 内部问答/证据区/演示设置/操作坞/四域提示/风险提示/未知请求条，保留 当前问题+视频诚实行+页脚。浏览器泄漏断言全过（internalQa/evidence/demoSettings/dock/domainTips/voice 全 hidden，隔离标注在位，业务视图可恢复）。 |
| StageView（常驻画面区+放大按钮） | **部分采用** | 全屏模拟视图入口从语音说明区前移到「视频与连接状态」区（`打开模拟画面视图（转写演示）` 按钮）；未改为常驻画面位（保持「不穿过大面积假画面」的既有诚实形态，CP1 审查结论）。 |
| DomainTips 四域提示 | **采用（简化形态）** | 以横向 chip 行实现（非右栏），数据 A 侧直接只读拉取 `/api/v5-preview/project` 的 DomainRow（judgmentStatus→chip 状态点），未用 B 提案形状，省一次映射层。仅业务视图展示。 |
| PendingBar 单渲染点 | 未采用 | 现有 ready/empty 双实现的恢复条语义不同（empty 态 owner 查不到会话内记录），合并风险大于收益；保持现状。 |
| `riv-` CSS 整并入 se-interview.module.css | **部分采用** | 按类名摘取精神新增 6 个类（`sivViewToggle/sivViewBtn/sivViewNote/sivDomainTips/sivTipChip/sivTipDot`），未引入 `riv-` 前缀文件（保持 CONTRACT §1 写面清单）。 |
| 17 回调组件化（方式2） | 未采用（本轮） | 契约冻结的窄改路线优先；B 组件保留在 candidate/ 作为后续重构蓝本。 |

## B 需要知道的集成事实

1. **D-01/D-02 修复改变了 runWrite 形态**（resolve 键改注册表条目键；ask 流不再解引用 runWrite 返回值）——B 的候选若基于旧 page 源（e7d65a16…），这两处与候选不一致，B 后续如迭代候选请以当前 site 源为准。
2. B 发现的移动端四域收起修复未被本轮采用（本轮未改四域矩阵布局）；该问题如仍存在，属既有布局，留给用户视觉验收。
3. B 的 SIMPLIFICATION 五项建议：#死代码 `preview.module.css` 删除——本轮未做（涉及范围复核，留给白天有授权时处理）；其余建议在 INTEGRATION_LOG 逐一记录未采用原因（入口已唯一/说明区已收次级）。

## 证据

- 泄漏断言：A 浏览器实测 2026-09-14 ~04:20（isolationNote/internalQaHidden/evidenceHidden/demoSettingsHidden/dockHidden/domainTipsHidden/voiceHidden 全 true，businessRestored true）。
- 截图：`main/evidence/dd-customer-view-1280.png`、`dd-375-viewport.png`、`dd-desktop-1280.png`。
- 若 B 对「未采用」项有异议或补充证据（如恢复条合并的更低风险方案），09:00 前写入本目录 `feedback-from-b.md`，A 会读。
