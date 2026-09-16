# JW 工作区执行约束

## 权威顺序

1. 当前用户最新明确决定；
2. `NORTH_STAR.md`；
3. `DECISIONS.md` 中标记为 `FROZEN` 的决定；
4. `CHALLENGE_LOG.md` 与 `ROADMAP.md`；
5. `jianwei-v3/site/docs/v4/CONTRACT.md` 与 `ACCEPTANCE.md`；
6. 项目实现、历史文档和归档材料。

## 工作区边界

- 当前唯一活动代码仓库是 `jianwei-v3/site/`；不得因整理材料而移动或重命名它。
- `materials/` 保存调研、学习、展示和输出，不拥有产品 authority。
- `archive/` 只作历史追溯和候选复用；除非当前任务明确需要，不进行宽扫，也不把归档内容恢复成当前决定。
- `.codex-remote-attachments/` 是 Remote 附件缓存，不移动、不手工整理、不作为产品权威。
- 全局产品方向、决定、挑战和路线记录在工作区根部；具体技术栈、实现契约、验收和代码修改记录在对应项目目录。

## Durable Local Context

- 不把 Context Window、线程历史或隐藏 Harness 状态作为长期项目记忆。
- 每轮包含实质信息的用户对话结束前，追加当前版本 `CONTEXT_LOG.md`；没有新决定也要记录新的事实、挑战、排除项或 `No Decision`。
- 新项目先建立根部权威文件、`context/`、`versions/`、`materials/` 和 `archive/`，再进入实质实现。
- 新版本建立独立 `versions/Vn/`，冻结上一版本的状态、证据与恢复路径，不覆盖旧版本。
- 定期在 observable checkpoint 整理重复 authority、失效链接和归档边界；只做忠实结构化记录，不持久化凭据或无关敏感内容。

## 当前 V4 Gate

- 顶层生命周期是“商机 → 尽调 → 政策 → 信审 → 商务 → 资产”。
- 现有派驻制、逐级报批、岗位责任和关键角色决定权不得改变。
- Human 是责任与 authority 主体；Agent/模型始终 `authority=none`。
- 在根部产品契约与项目实现契约完成对齐并获用户接受前，不扩张 FRONT/BACK，不画最终灰阶图，不声称 E2E 完成。
