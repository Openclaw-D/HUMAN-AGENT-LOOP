# 见微 V3 历史语境包

更新：2026-08-29  
用途：把与当前 V3 有关的归档任务、用户背景注入和原始材料提取到当前工作区，供产品方向、演示设计与后续 Control 阶段查阅。

## 权威顺序

本目录不是新的业务权威，也不是运行时数据源。发生冲突时按以下顺序处理：

1. `../V3_DIRECTION_FREEZE.md`：用户逐项确认的 Direction Gate；
2. `../V3_DIRECTION_HANDOFF.md`：唯一冷启动交接总纲；
3. 当前已验收的代码契约、测试与运行证据；
4. 本目录：历史背景、旧产品经验、视觉与交互参考。

历史材料可以帮助理解“为什么”，但不能绕过 Direction Gate，也不能直接生成第二套 backend authority（后端权威）。

## 本次整理原则

- 没有恢复任何 archived task / thread，也没有改变其归档状态。
- 原归档与 Archive 目录均保持不动；这里采用复制，不做破坏性移动。
- 只迁入对 V3 仍有解释力的原始材料，不复制完整 Codex transcript、工具日志、构建缓存或旧 Git 历史。
- 旧代码只作为 interaction / organization reference（交互或组织参考），不得直接接入 V3 runtime。
- 用户口述的组织与业务背景被整理为 context，不自动硬编码成 Aggregate、表、API 或流程规则。

## 目录

- `01_DURABLE_CONTEXT.md`：跨历史任务仍有效的业务、组织、产品与技术语义。
- `02_SOURCE_TASK_INDEX.md`：相关归档任务清单、提取结论和处理方式。
- `03_STRATEGIC_CORRECTION_QUESTIONS.md`：仍需要用户参与纠偏的宏观问题。
- `04_ASSET_MANIFEST.md`：复制材料的来源、用途、大小与 SHA-256。
- `assets/tq/`：TQ 组织架构与协同工作台参考。
- `assets/jw-v02/`：旧版登录、项目池、多项目与材料工作台参考。
- `assets/race/`：见微比赛叙事、五页视觉和现场提示卡。

## 使用边界

可以继承：组织职责、协同语义、信息损耗问题、共享 Context、版本与 Diff、Evidence 可追溯、Human Gate、Case Panel、领导经营视角、演示叙事经验。

不能直接继承：旧四阶段或六维作为 V3 总架构、12 套 Agent 系统、通用企业管理后台、Unity/机甲视觉本身、旧硬编码账号、旧 mock 数据权威、旧后端状态机、未验证 KPI 数字、生产化声明。

