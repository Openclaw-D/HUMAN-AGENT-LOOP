# 任务01（board-round-02）· EVIDENCE_INDEX

更新：2026-09-20。全部证据在本目录 `evidence/`（截图均为 IAB 1440×900 横屏，合成栈/合成数据）。

| 编号 | 文件 | 内容 | 对应 TEST_RESULTS 步骤 |
|---|---|---|---|
| E-01 | evidence/j01-board-initial-1440x900.png | 看板初始：顶部摘要（融资/授信/采购分列）+阶段条七段（结清未支持）+六事项卡+右栏待办/四域/额度+沟通收起栏 | 步骤1/2 |
| E-02 | evidence/j02-board-after-upload-1440x900.png | 上传回写后看板：材料·处理卡「档案登记 2 件 · 处理任务 3 个 / 完成且已回写 A 1」（绿点） | 步骤6 |
| E-03 | evidence/j03-materials-panel-writeback-1440x900.png | 材料面板：A 清单 2 件（原件+派生件，unverified 如实）+任务表三态（本地完成未回写/重复跳过/已回写 A）+统一链卡+右栏事项依据 | 步骤6/8/9 |
| E-04 | evidence/j04-portal-materials-1440x900.png | 客户门户：我的材料（material.bank_statement=分析完成；parse_extraction=已登记待处理）+第一步绑定引导（新会话诚实阻断） | 步骤7 |
| E-05 | evidence/j05-result-reconcile-two-path-1440x900.png | 结果面板两路对账合一：A 回执口+通道对账口（ptx-…-mat found:true 渲染 a_links 收据全文） | 步骤10 |
| E-06 | 本文档同级 TEST_RESULTS.md §4 | 旅程 12 步逐条结果+API 核对（aRegistered/bridgeState/artifacts/skipped_duplicate） | 全部 |
| E-07 | Front 本地测试输出 | `npm test` 67/67、`npm run typecheck` 0 错误、`vite build` 通过（执行于 2026-09-20；可按 package.json test script 复现） | §1–3 |

## 复现指引（Codex/用户）

- 栈（当前仍在运行，验收配置全合成值）：`cd Back/Edge && node scripts/delivery-up.mjs --config config/delivery-runtime.acceptance.json --kernel-port 48190 --connectors-port 48110 --edge-port 48210 --serve-front <Front/dist 绝对路径>`；停止 `node scripts/delivery-down.mjs`（数据保留）。就绪核对：`GET http://127.0.0.1:48210/healthz/ready`。
- 前端测试：`cd Front && npm test` / `npm run typecheck` / `npm run build`。
- 页面旅程：Edge 48210 → 进入真实办理 → 受控身份 biz1；客户侧用受限邀请码兑换；完整 12 步见 TEST_RESULTS §4。
- 本轮合成案例数据：客户 cust-mu8inm2l-39babbdaacfa（喀什·邦德激光设备客户（合成案例02））；任务 ptk-26f65782af72d72a（done/已回写 A）；对账编号样例 ptx-ptk-26f65782af72d72a-mat。

## 层级声明

截图与旅程=执行者自验；组件测试=自动化行为级；**用户验收与 Codex 独立复核未做**，均不计 PASS。
