# F 轮报告 · 六角色可操作预览与小微商业融资租赁案例（V7 SIX_ROLE_COMMERCIAL_LEASING_20260915.md）

日期 2026-09-15。STATUS：**F_SEED_DELIVERED（种子版交付：六角色 UI + 4 合成案例 + 模拟闭环全通；
C 包未交，按 F6 以种子先行，后续单 writer 接入）**。写面仅 `home/**`；已先存可恢复副本
`home/backup-pre-sixrole-20260915/`（11 文件）。无 Git 操作、无真实密钥、无付费调用、未接 V7 真实后端
或真实 LLM——本地模拟闭环，如实标注。

## 访问入口

- **3607**：http://127.0.0.1:3607/ （vite 隔离预览；加载源 = `home/preview/main.tsx` →
  `home/site-mirror/app/v5-preview/home-overview`，已复核 import 链）。预览壳 `index.html` 补 body
  margin 重置（仅 harness）。

## 新增/修改文件（全部在 home/**）

| 文件 | 内容 |
|------|------|
| `site-mirror/app/v5-preview/role-contract.ts` | 新增：RoleId 六值/RoleView/FactStatus/Tendency/CaseFact/CaseTurnScript(key)/CaseScenario/CaseState（形状对齐 six-role-v1） |
| `site-mirror/app/v5-preview/role-mock-adapter.ts` | 新增：异步 mock adapter（`submitCaseTurn`）+ `initialCaseState` + `jianweiGaps`；纯逻辑零值导入（可被 node strip-types 直载） |
| `site-mirror/app/v5-preview/role-cases.ts` | 新增：4 个种子案例（见下），每个 6 角色 roleViews（summary/questions≤3/tasks/tendency/conditions）+ 2 步补证脚本 + 四域矩阵行 |
| `site-mirror/app/v5-preview/home-role-bar.tsx` | 新增：案例切换 select + 六角色图标按钮（选中态/aria-pressed/完整可访问名称） |
| `site-mirror/app/v5-preview/home-role-view.tsx` | 新增：角色视角面板（摘要/任务状态联动/≤3 问/倾向+条件/共享事实含证据版本；见微加全局缺口） |
| `site-mirror/app/v5-preview/home-header.tsx` | 改：编号左移与项目名相连（`金属加工直租 · SL-2026-101`），替代 R1 右对齐 |
| `site-mirror/app/v5-preview/home-icons.tsx` | 增：CompassIcon（见微）、BriefcaseIcon（业务）；政策/信审/商务/资产复用 se-icons |
| `site-mirror/app/v5-preview/home-overview.tsx` | 重写：案例/角色状态机接入（案例间隔离、角色零副作用、50/50 布局保留） |
| `site-mirror/app/v5-preview/home-chat.tsx` | 增 `inputPlaceholder` prop（随角色变化） |
| `site-mirror/app/v5-preview/home-overview.module.css` | 追加 F 轮样式（roleBar/roleGrid/roleView/375 两行） |
| `preview/main.tsx` | 改：挂载六角色预览（旧固定演示 harness 退役，备份在 backup 目录） |
| `preview/test/role-mock-adapter.test.mjs` | 新增：11 项纯逻辑测试 |

旧固定演示组件（story-strip/todo-row/lifecycle-strip/domain-grid 等）文件保留未删：lifecycle-strip 与
domain-grid 仍被案例模式复用；story-strip/todo-row 本轮不再渲染（演示主线被案例模拟取代，见"交回 A"）。

## DoD 对照

| DoD | 结果 | 证据 |
|-----|------|------|
| 3607 首屏六角色可点 | 六按钮常显平铺（不藏入口），选中蓝底+aria-pressed，触控≥40px；375 自动 3 列×2 行（"不强挤六个过小按钮"） | F-01/F-04 |
| 编号左移与项目名相连 | 标题=`案例名 · 编号` 单行左侧 | F-01/F-05 |
| 六种视角真切换 | 视角面板（摘要/任务/问/倾向/条件）随角色变化；输入提示随角色变化；消息发言归属=当前视角（"业务 · 我（演示视角）"）；见微多"全局缺口" | F-03 + 浏览器文本记录 |
| ≥2 场景走完 缺证→补证→相关域更新→见微汇总 | 案例1（发票→v2 已确认→资产回复+见微汇总；合同→商务/信审→最终汇总）与案例4（口径→覆盖复算+矛盾解除；方案→倾向=调整条件后做）UI 实测走通；案例3（确权函解除权属红线）单测+UI 验证 | F-02 + adapter 测试 5/7/9/10 |
| 角色切换不丢状态/零副作用 | 切换只改 UI 视角（代码路径仅 setActiveRole）；测试断言不同视角提交仅归属不同、facts/turns/taskStatus 全等 | 单测 11 |
| 案例隔离 | 每案例独立 CaseState；切到案例4（仅 1 条载入消息）再切回案例1（7 条历史完整） | 浏览器量测记录 |
| 错误/未知输入不假成功 | 空输入=拒绝；未识别文本=「未能识别该补充内容（本地模拟…不假装真实模型理解）+当前待补」；重复证据=已登记不重复记账；adapter 异常=根级错误横幅且无状态变化 | 单测 3/4/6 + 浏览器记录 |
| 375×667 与宽屏自查 | 375：顶栏两行（标题+案例 / 六角色 3×2）、上下 50/50、首屏含四域与下半入口；1920：六角色单行、529/529 等分、无横向溢出 | F-04/F-05 + 量测 |
| 测试与截图在自己目录 | 11/11 逻辑测试通过（`home/preview/test/`）；截图 `home/evidence/F-01～05` | — |
| 不冒充真实后端/LLM | 全部回复 origin=preset/model 且 marks=「模拟回复/模型建议（模拟）」；案例载入文案明示本地模拟；无密钥/付费/部署 | F-02 徽章可见 |

## 4 个种子案例（不同风险机制，全部标注合成）

1. **金属加工直租**（SL-2026-101，苏州·合成）：基线案例，缺发票与购销合同，倾向=谨慎做（条件：票合同一致+首付两成+覆盖≥1.2）。
2. **印刷老客回租**（SL-2026-102，东莞·合成）：老客履约好但缺流水与所有权凭证，倾向=谨慎做（无二次抵押+成数≤七成）。
3. **注塑权属疑点**（SL-2026-103，宁波·合成）：经销商融资池隐性共有=全局阻塞，确权前资产域红线"不做（现状）"，确权后解除。
4. **包装现金流口径变化**（SL-2026-104，长沙·合成）：申报 3000 万 vs 流水 4100 万两套口径，书面解释前不作收入结论，倾向=调整条件后做（按制造口径覆盖≥1.2+成数六成）。

## C 包接入点（V7/backend/C/scenarios/six-role-v1.json 交付后）

- 形状已对齐（schemaVersion/scenarios/id/title/industry/region/leaseMode/customerContext/facts/unknowns/roleViews/turns/expectedChecks/sourceRefs）。
- 接入步骤（单 writer，本轮不执行）：按版本复制 JSON 至 `home/preview/cases/`，记录来源 sha256；
  新增 loader 将 C 案例投影为 `CaseScenario`（C facts→CaseFact 证据分级、turns→CaseTurnScript 需 C
  侧提供命中关键词与 effects 映射——若 C 形状不同，在 loader 内适配并逐条记录差异，不改 C 目录）。
- 若 C 包 turns 无关键词字段，先以种子规则兜底并在报告标注"匹配策略=本地兜底"。

## 已知限制（如实）

1. 模拟对话=关键词匹配脚本（每案 2 步），非自然语言理解；未命中一律待澄清。
2. 四域矩阵的 segmentLabels 在案例模式下为通用呈现列（接收/处理/协同/核验），未按域定制。
3. 生命周期条按"已完成补证步数"推进（演示示意，aria 已注明非时间/工作量比例）。
4. 旧固定演示主线（22 步 story/待办卡）在本候选不再渲染（被案例模拟取代）；组件文件保留，A 集成时自行取舍。
5. C 包未交付，种子案例的业务数值全部合成，不代表真实客群。

## Gate

- tsc（strict）：0 错误。
- vite build：✓。
- node --experimental-strip-types --test test/role-mock-adapter.test.mjs：**11/11 通过**。
- 浏览器实测：六角色切换/两案例闭环/待澄清/案例隔离/375+1920 布局（记录见上）。
