# Projection 契约草案（未冻结）

本草案只约束 P1 前端原型的读取面，所有数据来自一个 `WorkProjection`；fixture 明确以 `fixture: true` 标识，不能当作后端或客户事实。

## 统一 envelope

`projectionIdentity`、`projectionVersion`、`eventCursor` 必须同时出现。页面将三者作为同一读取快照：缺失时显示“Projection 不可用”；版本或游标不一致时停止混排并显示“版本不一致，请刷新 Projection”。前端不持久化或派生独立的 owner、Goal、Gate、Action、Receipt 权威状态。

`work` 包含 `id/title/goal/goalVersion/stage/status/owner/nextStep`；`actors` 包含具名 `id/name/type/role/authority/state`；`stages` 是场景阶段投影；`matrix` 是参与者与场景阶段的责任、权限、状态投影。

## 三个 selector

- 关系：`actors` + owner + handoff 关系；突出 Human、Agent、System 与 `authority`。
- 进度：`work.goalVersion` + `stages` + Activity 中的 Challenge/Gate/Receipt。
- 矩阵：`matrix.rows`、`matrix.columns`，并回引 `actors`。

三者由同一个 `state.projection` 读取；切换只改变 selector，不切换数据源。

当前已确认的 P1 交互语义：默认场景为风控业务协同、默认视图为进度；十个场景的默认视图映射在 fixture 的 `defaultViews` 中。关系视图以 Work 为中心并强调当前用户；进度只呈现目标、阶段、阻塞与下一步；矩阵固定为参与者 × 任务/阶段，不能切轴。右侧默认全局 Activity，选择对象后仅过滤同一投影的局部流，可返回全局。

## Activity

允许的 `type` 是 `message`、`artifact`、`challenge`、`handoff`、`gate`、`action`、`receipt`、`system`。`message` 只表达沟通，不改变权威对象。`gate/action/receipt` 可带 `authoritative: true`，前端显示显式操作入口；本原型入口不执行写入。

普通消息不创建 Agent Run；只有显式 `@Agent`、选择 Agent 或“继续执行”才允许创建 Run（本原型仍只作预览）。普通 system/event 可压缩；当前 Challenge、Gate、failed、unknown 默认展开。每张操作卡最多一主操作和一次次要操作。Gate 内联显示依据与影响；真实副作用在未来运行时需二次确认。

空列表显示“暂无匹配 Activity”；加载中显示“正在读取 Projection”；读取失败显示“Projection 不可用”；`receipt` 为 `unknown` 时显示“未证实即 unknown”，禁止渲染为成功或已完成。
