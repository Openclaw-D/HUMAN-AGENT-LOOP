# 前端决策（P1 原型）

## 信息层级

顶部只保留品牌、场景、事项、三视图与 Projection 身份；左侧是 80% 协同理解面；右侧 20% 是接续面。先回答“我是谁、谁负责、下一步是什么”，再显示低频技术身份信息。

## 已确认的默认视图

默认场景为风控业务协同、默认视图为进度。十场景默认映射写入 fixture；仍复用同一个三视图结构，不提供自定义视图。

## 右侧密度

右侧默认全局 Activity；选择参与者后进入局部流，可切回全局。普通消息与 system/event 压缩，当前 Challenge、Gate、failed、unknown 展开。Activity 区独立滚动，输入框固定在底部；Gate 内联依据和影响，每卡最多一主一次操作。

## 已确认边界

顶部第二行只显示当前目标摘要、owner、阶段、Challenge、Gate、Receipt、更新时间；没有真实指标时显示 `—` 或“暂无真实数据”。普通消息不调用 Agent；只有显式 @Agent、选择 Agent 或继续执行才可创建 Run。矩阵不支持轴切换。复杂详情最多用约 45% 的覆盖层；移动端仅保证可读、可操作，正式视觉 Gate 仍为 1920×1080。

## 真实 API 连调（2026-08-27）

- 产品运行路径现从同源 `/api/v1/**` 读取完整真实 `WorkProjection`；`serve.mjs` 仅代理该受限前缀至 `127.0.0.1:4179`。
- `projection-fixture.json` 保留为离线视觉证据，产品不自动 fallback，也不混入 `state.projection`。`schemaVersion`、`fixture:false`、identity、version=cursor 或必需结构失效时隐藏工作台并 fail closed。
- Scenario catalog 决定入口：前三个 active 场景读取真实 Work，后七个 catalog-only 只显示目录状态。`availableCommands` 决定可用操作；普通消息和显式 Agent Run 分离。
- 详见 `C:\Users\22673\Desktop\Anthropic\integration\p1\INTEGRATION_CHECKS.md`；后端检查点 D 已修复并复验“第二次及后续显式 Run 后重启”路径，当前只保留其本地 sample 边界。

## 明确排除

不含后端、真实 Projection、API、数据库、认证、Connector、模型调用、事件写入、最终契约冻结或任何实际 Gate/Action/Receipt 执行。
