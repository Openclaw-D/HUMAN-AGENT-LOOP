# 代码核对基线与资料来源

日期：2026-09-20。这里只记录本次实际获得的证据；不宣称全库代码审计、产品运行或本地测试已完成。

## 1. 本次远端事实

读取到的`main`：`8c6d3b0edc7d0c467ab6876a765b80a30b1e268b`，提交信息为`docs: remove retired 3D plans and record prototype cleanup`，提交时间2026-09-19 17:51:12 UTC。

相对前次`8f8d962`，比较接口记录新增两笔提交，包括`ca20ae8154556527a260c1f6ff4315cf1ea9e215`（`chore: snapshot frozen 2D workbench and backend integration progress`）。这说明不能继续把云端一概视为“只有新文档、源码仍完全停在更早版本”。具体功能仍须逐文件和运行验证。[R1]

本次`customer-workbench.tsx`可见已经改为事项卡二维工作本；`originals-panel.tsx`采用统一`ChannelCard`上传链，取消此前A直传/通道二选一。不能把旧缺陷说明当成这些文件当前完全未修的证据。[R2][R3]

但`HANDOFF.md`仍写“仅文档同步、未发布本地在制代码”，而`AGENTS.md`仍写全生命周期和“不以表格为主界面”。这是需要同步的旧入口，不是本轮最高产品方向。[R4][R5]

## 2. 已读取文件与适配意义

| 编号 | 固定快照路径 | 本次读取范围/用途 |
|---|---|---|
| R1 | branches/main；compare/8f8d962…8c6d3b0 | 确认当前HEAD及新增提交；未做完整diff审计 |
| R2 | `Front/site-mirror/app/workbench/customer-workbench.tsx` | 前160行；当前二维事项卡、生命周期投影、待办等入口 |
| R3 | `Front/site-mirror/app/workbench/originals-panel.tsx` | 前75行；统一上传入口和原件/处理状态读回 |
| R4 | `HANDOFF.md` | 全文；识别已过时“仅文档”说法 |
| R5 | `AGENTS.md` | 全文；旧产品方向与仍需保持的施工/安全纪律 |
| R6 | `Back/A/migrations/002_customer_credit.sql` | 前145行；客户、证据、评估、额度和融资申请分层；新预评估不应为了建申请而创建额度 |
| R7 | `Back/A/docs/CUSTOMER_CREDIT_V2.md` | 当前实现说明；评估决定reject/withdraw与facility.approve的区分。另搜索了decideAssessment的源码/路由引用，未完整走读全部实现 |
| R8 | `Back/CONTRACT.md` | 前75行；头部增量登记已至§12/v2.5，但保留历史v1语义；不能把旧候选自动当成本轮已批准政策 |
| R9 | `Front/package.json` | 全文；现有React/Vite/TypeScript、测试与构建入口 |

固定基地址：`https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/`。在此后追加表内文件路径可定位核对版本。

主要来源：

- R1：https://api.github.com/repos/Openclaw-D/HUMAN-AGENT-LOOP/branches/main
- R1比较：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/compare/8f8d9621cc51e44e192b3288fa8731ecc139bf43...8c6d3b0edc7d0c467ab6876a765b80a30b1e268b
- R2：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/Front/site-mirror/app/workbench/customer-workbench.tsx
- R3：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/Front/site-mirror/app/workbench/originals-panel.tsx
- R4：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/HANDOFF.md
- R5：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/AGENTS.md
- R6：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/Back/A/migrations/002_customer_credit.sql
- R7：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/Back/A/docs/CUSTOMER_CREDIT_V2.md
- R8：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/Back/CONTRACT.md
- R9：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP/blob/8c6d3b0edc7d0c467ab6876a765b80a30b1e268b/Front/package.json

上述URL是审阅证据，不是本地执行指令。接续时先读取最新工作树，再决定最小适配，不能回退到此SHA覆盖在制改动。

## 3. 没有被本次验证的事项

未验证：用户本地HEAD/dirty状态、当前运行数据库、全部后端方法、新版§12的全部消费路径、统一上传链的真实端到端效果、模型配置/费用、最新用例运行结果，以及生产政策。

因此本包没有“后台已通过”“可以删掉整个模块”“现有API已足够”的结论。明确可用的是产品范围、关键源码位置和需要补齐的语义。

## 4. 视觉与交互的官方技术依据

以下官方技术资料于2026-09-20检索/读取。它们支持实现选项，不决定产品范围，也不构成安装新依赖的要求。

- MDN `conic-gradient()`：可用角度色标做圆形扇区，默认从顶部顺时针，适合右上第一象限。https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/gradient/conic-gradient
- MDN `prefers-reduced-motion`：根据用户减少动效偏好降级过渡。https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- MDN SVG `feTurbulence`：可生成噪声纹理；本设计优先静态纸纹，不每格实时运行滤镜。https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence
- React Flow组件API：提供节点拖动、视口及平移/缩放控制；仅在既有SVG方案不足时考虑，并关闭节点编辑能力。https://reactflow.dev/api-reference/react-flow

当前`Front/package.json`声明React 19.2.6、TypeScript 5.9.3、Vite 8.0.13及现有测试依赖。这是仓库声明，不是本包推荐升级目标；运行与兼容以锁文件和实际环境核验。[R9]

## 5. 待确认项不扩大范围

仅有机构真实政策、权限目录、模型提供方/预算、价格口径及具体进度里程碑等需要来自业务或本地证据的内容。缺失时显示待确认或使用明确合成测试配置。

无需再次向用户询问是否要项目制、是否做全生命周期、是否保留二十格、是否允许资产提前核验、是否用已用额度图；这些已经被最高基线决定。
