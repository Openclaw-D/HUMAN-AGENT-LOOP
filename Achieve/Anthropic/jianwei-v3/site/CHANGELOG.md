# Changelog

本文只记录产品方向与可验证实现，不把计划或候选写成已完成。

## 2026-09-04｜排队整夜 `/work` 前后端 Goal

- 新增 `docs/v4/ZCODE_OVERNIGHT_WORKSPACE_GOAL.md`，要求当前后端 DoD 通过后连续构建真实 API 驱动的单事项工作台；
- 页面范围冻结为一个小微业务 mobile-first 协同入口与政策、信审、商务、资产 desktop-first 专业作业；
- 任务包要求退出直租/供应商/静态聊天/假在线/仅信审旧叙事，并补足四域 Gate、demo reset、错误/冲突和 E2E；
- 根 `/` 管理页、领导大屏、观众二维码、部署、认证、数据库、真实模型和其他事业部明确排除；
- 本条只记录任务书与 authority 变化，尚未声称页面或 E2E 已完成。

## 2026-09-04｜ZCode 20 路并发试验追加书

- 新增 `docs/v4/ZCODE_CONCURRENCY_TRIAL.md`，仅替代原 Goal 的固定四并发措辞；
- 更新项目执行约束为自适应 Harness 并发：最多 4 个互斥 writer，其余为只读审计/验证；
- 20 作为一次试验目标，不声明为平台硬上限或长期默认值；
- 未修改 `lib/v4life/**`、API、测试、CONTRACT、ACCEPTANCE、依赖或运行时。

## 2026-09-03｜V4-LIFE 文档分层

- 将产品级 North Star、Decisions、Challenge Log 与 Roadmap 提升到 JW 工作区根部；
- 将旧 `docs/v4/` 完整归档为 `docs/archive/v4-pre-life-20260902/`；
- 新建 `docs/v4/CONTRACT.md` 与 `docs/v4/ACCEPTANCE.md`，明确当前仍是契约壳和 Gate，未获得实现/E2E 接受；
- 更新项目 `AGENTS.md`、README 和 STACK 的权威指向；
- 未修改 FRONT/BACK、测试或运行时。

## 2026-08-31｜V3 诚实归档

- 保存 V3 前端、后端、API、测试、脚本与原始冻结契约的自包含历史快照；
- 增加 V3 归档清单（现位于 `docs/archive/v3-archive/V3_ARCHIVE_MANIFEST.md`），区分已验证能力、已知漂移、外部资产和排除项；
- 修复服务重启后 demo reset 复用旧幂等键、导致旧 Authority Event 未被清空的问题；
- 明确本地 SQLite、合成数据、演示身份与 stub Adapter 不构成生产能力；
- 明确 V3 的固定直租 Golden Case、五路并行和旧信息架构不再约束 V4；
- V4 从独立 contract 启动，不删除 V3，不在 V3 tag 上继续开发。

## 2026-08-28｜V2 融资租赁收敛

- 冻结唯一融资租赁事项，以及业务与政策、信审、商务、资产协同；
- 将商机与现场尽调纳入事项前段，不再作为额外顶级板块；
- 冻结四板块各五个顺序流程；
- 建立二十个差异化 Flow Workspace；
- 建立单次 Evidence、共享 Context Version 和四路候选 Projection；
- 增加具名 Human Gate、Decision Receipt 和事实确认；
- 增加输入上限、幂等冲突、超时、失败关闭和并发测试；
- 增加进程期 append-only Authority Event Ledger、四路 Stage Run 历史、只读分页事件接口与 Projection 审计计数；
- 修复请求超时与 `reader.cancel()` 的竞态，补齐产品模型响应上限及 Authority Event/Stage Run 回归测试；
- 建立 1920×1080 黑白灰工作台、全域图谱、业务矩阵和可调接续台；
- 明确 live GLM 未验证、runtime 进程内、Adapter 为 fake/stub。

## 2026-08-28｜P2 产品发现与研究

- 重新分析全球与国内 Human–Agent 产品、决赛竞品和最小融入 Gate；
- 否定“市场空白”“共享上下文独有”“通用 AI 控制平面”等过宽主张；
- 把差异化收敛到融资租赁同一事项的证据、责任、人工权威和回执连续性。

## 2026-08-25 至 2026-08-28｜P1 通用协同探索（历史）

- 探索十个场景、通用 `CollaborationCase`、图谱、矩阵和接续台；
- 前端、runtime 和 integration 均未获得最终产品验收；
- 十场景/通用平台方向退役；
- 仅把图谱交互、事件投影、幂等和失败关闭等模式作为候选资产重新验证。

## 更早｜Unity 概念展示（历史）

- 形成“见微之眼”与共创、协同、全域的决赛叙事；
- 明确 Unity 只作开场和全局态势展示，Web/后端拥有唯一业务状态。

## 2026-09-04｜V4-LIFE 四域后端切片 + /work 五角色工作台 Candidate

- 新增 `lib/v4life/**`：四域事件溯源内核（命令幂等/乐观并发/Evidence 自然键/Human Gate→Receipt/否决级联/退回重做/确定性 Candidate/追加事件账本/存储 port 与重放）与最小扩展（Projection.actors、WI-B2/BG-1、WI-A2/AG-1、demo reset production 失败关闭）。
- 新增 `app/api/v4life/**`：projection/evidence/work/decisions/events + demo/reset 路由，统一错误 envelope 与 §12 状态映射。
- 重写 `app/work/**`：移除静态直租演示叙事，改为读取真实 V4Life Projection 的五角色 responsive 工作台（业务 mobile-first 补件协同面 + 四域 desktop-first 工作台 + 检查轨 + Case Chat 协同框架）。
- 新增 `test/v4life-*.test.mjs`（7 文件 106 用例）、`scripts/v4life-http-quality.mjs`（27 步）；重写 `test/v4-work-surface.test.mjs` 为新工作台不变量。
- 文档：`docs/v4/CONTRACT.md` §1–§14 冻结；ACCEPTANCE/BACKEND_PROGRESS/RUN_STATUS 更新；evidence/workspace/ 存浏览器截图证据。
- 遗留：管理页/evolve 测试 2 项与 lint 2 error 在禁止修改的遗留文件中（会话前已存在），待授权处理。
