# INTEGRATION_LOG｜A 路逐文件变更（REPAIR_20260914_EVENING）

哈希总表：`main/final-hashes.sha256`（32 文件）。写入前快照：`main/baseline/`（11 文件 `.orig` + 2 数据文件 `.data-orig` + pre-hashes.sha256）。

## 一、后端（共享状态闭环，接口 = main/INTERFACE.md v1）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `lib/v5-preview/store.ts` | 改 | schema @1→@2：新增可选 `storyCursor`（稳定步标识）与 `sharedDemo`（专属演示会话指针）；@1 旧文件读取兼容（缺省补默认，非法值仍 STORE_CORRUPT）；写入一律 @2 |
| `lib/v5-preview/shared-facts.ts` | 新增 | 共享事实层：fixture→域冻结映射；取代链/复核状态计算（computeSharedFacts）；投影应用（域标记「证据纠正待复核」+待办标记+确定性 ID 消息，幂等可重算重建）；专属会话懒建（rs-demo-run，幂等自愈）；演示确定性证据/复核写入（`ev-demo-/rev-demo-<token>-<sessionId>`）；`resetDemoRun`（先清 remote 后重置 rows，非事务可恢复）；remote 不可用时 GET 侧诚实降级（sharedWarning） |
| `lib/v5-preview/demo-story-service.ts` | 改 | 当前步改稳定游标定位（@1 无游标回退签名并**先迁移后投影**，防投影改坏签名）；decide(correct)/补充类 hold 步经 `applyStoryFactOps` 写真实证据/复核；写入响应重放共享投影；响应增 `sharedWarning` |
| `lib/v5-preview/demo-story-data.ts` | 改 | 追加 `locateStepIdBySignature`（@1 迁移回退 + seed 重定位用；纯函数） |
| `lib/v5-preview/service.ts` | 改 | seedScenario 写入保留 sharedDemo、游标按签名重定位（approval→s00、settled→终态、post-rental→null=自由态）；notes/messages 写入保留游标与会话指针（notes 不再使演示脱离路线） |
| `lib/v5-preview/remote-service.ts` | 改 | 新增 `DEMO_SESSION_ID` + `buildDemoSessionRecord`（专属会话构造，复用 DEFAULT_PARTICIPANTS，参与者 ID 确定性）；既有命令语义零改动 |
| 路由 `project/notes/messages/seed` | 改 | 读写前接 `syncSharedProjection()`（读取即同步=声明的崩溃自愈路径）；project 响应降级时附 `sharedWarning` |
| 路由 `demo/reset` `demo/shared-state` | 新增 | 重开（仅当前专属演示作用域）与共享事实只读出口（INTERFACE §2/§3） |

## 二、前端

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `app/v5-preview/api-client.ts` | 改 | 新增 `postDemoReset`/`fetchSharedFacts` + SharedFactsView/SharedFactView 类型 + StoryStateView.sharedWarning；端点常量登记（契约测试同步） |
| `app/v5-preview/page.tsx` | 改 | 渲染层换 **B 候选 HomeOverview**（banners 收敛为 HomeBanner）；重开走 `postDemoReset`（作用域文案更新）；fetchStory 同时拉共享事实；情景切换 UI 随「合成演示·控制」下拉移除（用户批注；seedScenario 处理器与 /demo/seed API 保留服务端）；全部数据/恢复/版本门逻辑原样保留 |
| B 组件 10 文件（home-overview/home-contract/home-header/home-icons/home-chat/lifecycle-strip/domain-grid/story-strip/todo-row/home-overview.module.css） | 新增（B 交付，A 采用） | R-01/R-02/R-03 承载；**A 兼容修改**：home-contract+home-overview+story-strip 增 `shared` prop 与共享尽调事实条/降级提示；home-header 重开确认文案改精确作用域（demo/reset 语义）；home-header 内联类型 import 改顶层 import type（隔离契约） |
| `app/v5-preview/remote-session/page.tsx` | 重写 | C 方式1：本页仅数据接线层（loadState 专属会话优先、RequestRegistry、受控草稿持久、runWrite/重试/放弃、创建会话、模型状态）；渲染全部交 C 组件；回调逐项接线（submitRecord/pause/resume/escalate/ask/attach/simulate/analyze/calculation/转写演示/草稿变更）；D-01/D-02/D-04 修复语义保留 |
| C 组件 4 文件（RemoteInterviewStagePage.tsx / remote-interview.types.ts / remote-interview.module.css / session-adapter.ts） | 新增（C 交付，逐字节采用） | hash 与 C RESULT §2 冻结值一致（未改 C 组件内一行） |
| `demo-story-panel.tsx` `rows-view.tsx` `todo-card.tsx` `chat-panel.tsx` `domain-row.tsx` `se-overview.module.css` | 保留不动 | 旧渲染参考实现（部分契约测试仍引用其字符串）；page.tsx 不再引用 |

## 三、测试

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `test/v5-preview-shared-facts.test.mjs` | 新增 | 8 项：懒建/演示步建链升版/尽调页纠正→投影/演示纠正→真复核且推进不丢投影/notes 共存/重开隔离/并发重复/中断恢复（rows 写丢失同 requestId 自愈+投影重算）/remote 损坏降级 |
| `test/v5-preview-demo-story.test.mjs` | 改 | resetStoreTo 升级为 @2（签名重定位）；free 断言按新契约更新（notes 不脱离路线、@1 回退/迁移/悬空指因、seed 重定位）；**原"notes 签名脱离→free"断言按本轮目标（COMMON：稳定标识，避免文案变化导致 free）有意变更，非弱化** |
| `test/v5-preview.test.mjs` | 改 | 文件清单登记 B 新文件；UI 字符串断言随新渲染层更新（合成标识/演示控制→home-header；region/场景消费点→B 组件；重开=postDemoReset；存储键登记 home-chat/todo-row/home-overview） |

## 四、演示数据（3467 运行实例，非 Git）

- `runtime/data/rows-store.json`：首次 GET 自动迁移 @2（cursor=s00，版本 154 保留，演示位置不变）。
- `runtime/data/remote-store.json`：新增空专属会话 rs-demo-run（v94→95）；10 个历史会话与其记录逐字保留。
- 写入前快照与恢复方法见 BASELINE_GATE §四/§五。
