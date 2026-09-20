# 02路 交付记录 · 2026-09-20（writer：ZCode 02路）

TAKEOFF-FA-1.0.0 真实前端：二十格主屏 + 六助手 + 旧展示清理 + 既有 Edge 读面真实投影 + 构建/测试/视觉证据。交接基线 8c6d3b0 未回退；未 commit/push/切分支/worktree；未动 Back/共享根文档；未调用收费 API；未用真实客户资料。

## 1. 交付物与源码/构建对应

- 新增（Front ownership 内）：
  - `site-mirror/lib/workbench/takeoff-projection.ts` — 二十格/顶栏/待办纯投影（零 import 可单测）。displayBucket 只从服务端字段计算：分母未知=null；100% 绿唯一来源=依据包内该域结论 current；currency=changed → 白霜冻结+卡点（解冻动作=按当前证据更新域结论）；事实冲突=输入行红项+'!'；处理链在途=浅黄运行环。每格 basis 注明服务端字段来源。
  - `site-mirror/app/takeoff/`：`takeoff-screen.tsx`（主屏装配/抽屉单上下文/结束对话框）、`takeoff-board.tsx`（五列四行、行列高亮）、`takeoff-cell.tsx`（SVG 扇区：右上 0–90° 顺时针、绿圆无勾、运行细外环、'!' 角标、灰黑锁形）、`takeoff-detail.tsx`（当前问题→依据位置→需要谁→允许动作→输出与历史）、`takeoff-assistants.tsx`（六助手一区一草稿、@入口+长按、Enter/Shift+Enter、IME 守卫、未接扩展能力明确禁用）、`takeoff-aux.tsx`（流程只读 SVG 缩放/记录事件时间轴/材料复用 OriginalsPanel+邀请/待办回原格子）、`takeoff.css`（纸感令牌：#F8F5E9/#222/#737373/#B8B8B8/#EED267/#4B7B45/#B63737、白霜磨砂、reduced-motion）。
  - 测试：`preview/test/takeoff-projection.test.mjs`（11 用例）、`preview/test/behavior/takeoff-board.behavior.test.mjs`（8 用例，含 T01 反例/无正式额度入口/撤回幂等路径/IME/视觉语义 aria）。
  - dev-only 视觉夹具：`preview/harness-takeoff.html/.tsx`（顶部常驻"合成数据"横幅；不进 build/dist）。
- 修改：`root-app.tsx`（断训练分支、唯一入口=首次预评估）、`proposal-panel.tsx`（移除 facility/fr 入口，见 CLEANUP.md §D）、`wb-logic.ts`（退役 lifecycle/boardSummary）、`use-workbench.ts`（注释）、`package.json`（test 清单）、`tsconfig.json`、`index.html`。
- 删除：26 文件，逐项理由/恢复方式见 `CLEANUP.md`。
- **dist 已重建**（与源码同版）：`dist/index.html`=2baf8861…、`dist/assets/index-BSowG_rQ.css`=2b0f6500…、`dist/assets/index-VBE3iKrR.js`=93ca9aa7…（SHA-256）。

## 2. 运行入口

- 正式：`cd Front && npm run build`（产物 dist）→ 任意静态托管/Edge --serve-front 同源托管；开发 `npm run dev`（3617）。
- 本路自验入口（当前仍在运行，均为本路自有进程，可随时停止）：
  - `http://127.0.0.1:3632/harness-takeoff.html` — vite dev 视觉夹具（合成数据，页面自带标注）。
  - `http://127.0.0.1:3634/` — 同源代理（工具 `tools/serve-dist-with-edge-proxy.mjs`：静态 dist + /api 透传 Edge 48210，Origin 归一；仅自验用）。
- 真实登录（04 联调后可用）：登录页受控身份目录（biz1/cred1/comm1/asset1/jw1/app1/dir1/cust1/adm1）读自 Edge 48210 实测。

## 3. 测试与验收证据

- `npm run typecheck` 绿；`npm test` **70/70 通过 0 失败**（edge-logic 5 + wb-logic 25 + takeoff-projection 11 + 行为 29）；`npm run build` 绿；均于删除与改造完成后复跑。
- T 编号适用项（本页面侧）：T01 结构/反例（行为测试断言无提款/租后/结清/合作历程/总进度/使用率/底部演示卡/正式额度按钮）、T02 上传单链（OriginalsPanel/ChannelCard 复用未改）、T03 部分并行（投影+行为测试：域独立收口、资产不锁商务）、T06 冻结语义（changed→霜+禁正面确认+解冻动作）、T13 视觉（扇区/绿圆无勾/白霜/行列高亮/IME 不误发——aria+截图）、T14 辅助页（流程只读/记录同源事件/待办回格）。T09 正面确认=入口+未接入态（01 未冻结，禁止伪装）；T04/T05/T07/T08/T10–T12 的业务断言需 01/03/04 路数据与真实持久化，本路仅备好读面投影与命令入口（撤回已接真实 decide 路径）。
- 截图（`evidence/`，SHA-256 见文件名清单于 DELIVERY 记录末尾）：
  - `01` 入口页（真实 3634 托管 dist）1920×1080；`02` 登录页读真实身份目录（Edge 48210）。
  - `03` 1920×1080 主屏（合成夹具）：五列四行铺满、绿圆无勾（政策/信审完成）、资产白霜+锁+冻结标、运行黄环、'!' 角标、右助手 20%。
  - `04` 冻结格详情抽屉：分层（当前问题/依据位置/需要谁/允许动作/输出与历史）+解冻所需动作（原因 new_evidence）。
  - `05` 结束对话框：支持/附条件/不支持=禁用+待01说明；行政撤回=可用（走既有 decide withdraw，二次确认+幂等）；scope=preassessment_only。
  - `06` 1366×768 主屏。
- 实测比例（getBoundingClientRect）：1920×1080 → 左看板 80.0% / 右助手 20.0%；1366×768 → 78.7% / 21.3%（右侧 320px 可读下限优先，符合 02 §1）。两尺寸整屏无滚动，正文两区铺满剩余高度。

## 4. 外部依赖状态（阻塞与移交）

- **01 契约未冻结**（Back/CONTRACT.md 无 confirm-preassessment）：结束对话框三类确认=禁用+说明；冻结后仅改 takeoff-projection/wb-client/结束对话框接线，无第二套状态机。
- **04 路 Edge 栈装配中**：48210 /healthz/ready 实测 kernel-a/connectors/connectors-channel=ECONNREFUSED（db ok）→ 本轮无法真实登录/真实数据看板截图（登录页身份目录可读，PRINCIPAL_UNTRUSTED=上游 A 未起所致，已留证据）。主屏真实读投影逻辑由行为测试以真实 client 代码路径覆盖；待 04 集成后复验。
- **03 路分析协议**：助手智能应答未接（页面明示"待03/04受控工具接入"）；消息线程走既有真实 messages 面。
- 共享接口变更回报 owner：本轮**未要求** Edge/A 新增面（全部消费既有读面+既有 decide 撤回）；01 冻结的 confirm-preassessment 由 01 路发布即可。
- 资源：本路自建进程=2（3632 vite dev、3634 node 同源代理），端口未占他人；未停任何既有进程；Edge 48210/旧预览 3617/3618 等保持原状。

## 5. 遗留与下一步

1. 01 冻结后：结束对话框接线 confirm-preassessment（含确认读回+需复核投影），顶栏补建议期限/参考价格/需求登记字段（投影已留"待评估/待补"位）。
2. 04 集成后：真实数据登录走 T02–T12 页面侧复验 + 重截真实数据截图。
3. 04 发现的前端缺陷由本路持续修复、重建、重测。
4. 视觉细节可调项：纸纹强度、抽屉默认宽（现 46%/放大 92%）等均为令牌/常量，不动信息架构。

## 6. 二轮（同日）：01 契约 §13 冻结后接线 + 真实栈验证（04 栈 Edge 48214）

- **契约消费**：Back/CONTRACT.md §13/v2.6 已冻结（01路交付）。本路完成：
  - （Edge 路由 /api/jw/v2/actions/assessments/:id/confirm-preassessment，04路已登记白名单）；
  - EndDialog 真实确认：三类结论（support/support_with_conditions/not_support）+ rationale 必填 + 附条件条件必填（本地预检与 A 同口径）+ assessmentVersion/candidateRevision 版本绑定；状态门如实提示（正/附条件须 awaiting_human_review；有未解冲突/依据变化时正面禁用——服务端 REVIEW_REQUIRED/STALE_BASIS 同口径）；已确认读回=终态（全部禁用+需复核卡）；撤回仍走 decide withdraw；
  - 投影升级消费 Edge admission 视图（04路 §13.3 聚合，snapshot.admission）：申请金额/建议期限/参考价格+单位口径/候选 r+输入 v 上顶栏；到件数/运行/PROCESSING_FAILED 入格；preassessment 读回（结论/需复核不重开）入完成行与方案标记；edge-logic 评估形状按 §13.2 加法扩展；
  - proposal-panel CandidateForm 增 建议期限（1..240）/参考价格+单位+口径（价格三字段一体预检）。
- **测试**：74/74（+4：确认状态门/版本绑定 payload/附条件本地拦截/已确认终态/admission 合并）；typecheck/build 绿；**dist 重建**：index.html=4695e1ab…、index-BFaLCFys.js=e9523874…、css=2b0f6500…（SHA-256）。
- **真实栈验证（04 栈 takeoff-up，Edge 48214；经本路同源代理 3634）**：
  - 真实受控登录（biz1/business）→ 权威客户目录 → 真实数据主屏：预评估结论读回（支持，tkcred1，confirmationId pac-mu8v03lc-…）、评估状态 preassessment_confirmed、候选 r1·输入 v0、参考价格 240.56 元/含息平均月租（合成名义口径）全部如实投影；未知倾向 cautious_do 原样保守展示；
  - 已确认终态：3/3 诊断客户 结束对话框全部禁用（含撤回），需复核语义就位（真实 T09 读回证据 08 号截图）；
  - 负路径（biz1 发确认→403）因全部客户已确认而无法从 UI 触发（终态禁用=正确行为）；角色门由 A 服务端测试（01路）与本路行为测试覆盖，不在 04 诊断库强造写入。
- **二轮截图**（evidence/）：07 真实看板 1920×1080；08 真实已确认终态对话框；09 真实看板 1366×768。
- 本路自验工具修正：serve-dist-with-edge-proxy.mjs 端口参数解析优先级 bug（Number([1]) ?? default 恒取默认）已修复；当前 3634→48214。
- 遗留移交：D-03（Gate 回执硬门，01路）；T09/T10 真实写入 E2E 归 04 最终验收（本路 UI 已就绪）；确认后 decide 409 NOT_READY 已由读回态前置禁用+服务端双保险。

—— 截图 SHA-256 ——
01 b6cbc151…／02 8365e6f0…／03 f04177f3…／04 57a39877…／05 f7c11eca…／06 3dee7b8d…（全文见 `evidence/` 目录 sha256 记录）
