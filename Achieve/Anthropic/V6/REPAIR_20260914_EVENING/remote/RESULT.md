# RESULT — C 路远程尽调现场界面（首次完整交付）

日期：2026-09-14 晚。执行：ZCode（GLM 5.3 Flash · max thinking）。全部产物仅 `remote/**`，产品与预览只读。

## 1. 交付总览（对照 C_GOAL）

| C_GOAL 要求 | 状态 | 证据 |
|---|---|---|
| 完整响应式尽调界面：现场为主、工具紧凑、下方进度/操作/聊天 | ✅ | 组件 v3 布局；`d1920-04-ready-live.png`（桌面双栏）、`m390-04-lower-progress-dock-chat.png`（下部三段） |
| 接 A 同一状态接口，不存第二份业务事实 | ✅ | 组件零 fetch/零注册表/零存储；数据全 props、写全回调（README §二对照表）；adapter 对准现网 SessionDetail |
| 复用旧 B F1/F2 候选，不重新发明 | ✅ | F1 折叠开关（默认收起，展开 2 输入+载荷）；F2 静态标题——均落地为 v3 默认行为；旧 v2 候选被本版取代（README 头部声明） |
| 复用现有 CameraPanel/证据/消息组件形态 | ✅ | `cameraSlot` 注入口（占位断言过）；证据清单/徽章/转写/回复角色标注沿用现网组件形态；相机逻辑未复制 |
| 不建设真实视频接入、不改摄录权限 | ✅ | 诚实徽章「视频未接入·合成演示（不申请摄像头/麦克风）」；连接状态「未配置（不采集）」 |
| 画面首要视觉 + 右侧紧凑工具（四域/证据/参会） | ✅ | 工具单开面板，桌面 280px sticky 右栏（`d1920-09`），手机工具行（`m375`） |
| 小屏保留画面可理解面积 | ✅ | 375：画面 267px；390：338px（40dvh clamp） |
| 顶部不机械占 50%；主问题只主要呈现一次 | ✅ | header 紧凑换行；问题文本全页主呈现=1（画面浮层；header 静态、细节条无问题文本、聊天流不带当前问题文本）——`layout` 断言 `stageQuestionCount=1, headerContainsQuestion=false, detailContainsQuestion=false` |
| 核对字段默认收起；人工待办需要时展开 | ✅ | F1 `aria-expanded=false` 默认；展开+载荷实测；人工待办=顶部徽章+进度行+历史折叠区按需展开 |
| 聊天避免重复系统标签 | ✅ | 连续同源回复合并单标签（`chatKindLabels=["实控人","模型（模拟）"]`） |
| loading/error/empty/simulation/pending-human 状态 | ✅ | 14 态渲染（01/02/03/05/06/07/13…）+ 断言 |
| 当前证据版本、旧意见待复核清楚但简短 | ✅ | 细节条「依据：现场证据 v2·未核实」；进度行「旧版证据 n 条已更新」；警告行「有 n 条旧意见基于过期证据·待复核」一行带过（`m390-13-superseded.png`） |
| 客户展示隐藏内部内容 + 非生产权限说明 | ✅ | 泄漏检查 7 项全过 + 常驻隔离标注（`m375-12-customer.png`） |
| 测试进入/返回、切视图、展开工具、错误后恢复、长文字 | ✅ | `interactive-enter-back.json`（进入→ready、back 链接 /v5-preview 在位、浏览器历史返回恢复）；interactive-*.json：视图往返、工具单开、错误→重试→ready、空态→创建→ready、长文本无溢出 |
| 375/390/桌面 + 独立缩放 80/100/125 | ✅ | `layout-all-states-375.json`（14 态无溢出）、`zoom-390.json`（scrollX=0）；1920 桌面断言（右栏 280px） |
| 不改变用户当前浏览器 | ✅ | 全部实测在 ZCode IAB + 本地 3477 静态服务；3467 预览与用户浏览器未触碰 |
| 交组件/样式/适配器/交互回调说明 + 真实候选证据 | ✅ | candidate/README.md（回调对照表）+ evidence/（JSON×6 + 截图×13） |
| A 集成后验证实际布局与动作结果 | ⏳ | 待 A 采纳后在 R1/R2 内复验（CameraPanel 原位、实页布局） |
| 最终列采用 hash 与未采用项 | ✅ | 见下 §3 |

## 2. 冻结 hash（sha256）

| 文件 | hash |
|---|---|
| `candidate/RemoteInterviewStagePage.tsx` | `4b4cdd802976939b019c1a8bb7c7d7379910befb2c5ced5277bf581d912d38e7` |
| `candidate/remote-interview.types.ts` | `c46b471d0863dd6692fe6076661e87272e1630c140f3e0fd5bd28a6b1d949876` |
| `candidate/remote-interview.module.css` | `87d4eee81ce0446de32c8ae5d9d8930bc2330e970042ecd6a256d0e604926cc4` |
| `candidate/session-adapter.ts` | `e9d40c13ceb432e42713c94678028a622616f8a917385d664468c57036650102` |
| `candidate/harness/render.mjs` | `ffa64f2e3a167da395abbbc0144e5c6c55133325d79e58b2215225c20cb68e41` |
| `candidate/harness/serve.mjs` | `bedbbae2678a37e0140fc73bbe6b219ce136c389857f647a193a91086b7fd318` |

类型检查 strict 通过；无产品写入（无实际运行 hash——运行实例为候选 harness 静态服务 3477，非产品预览）。

## 3. 采用与未采用清单

### 已采用（本候选内实现）

| 项 | 来源 | 说明 |
|---|---|---|
| F1 关键字段核对折叠 | 旧 ui 候选 v2（未进产品的 6.2 项） | 默认收起；坞高 237px@375（旧线上 304px 占首屏 46%） |
| F2 问题去重 | 旧 ui 候选 v2 6.2 项 | 静态标题 + 画面浮层唯一主呈现；细节条只留依据/风险 |
| StageView 常驻画面 | 旧候选 v1/v2 + A 已集成版 | 沿用诚实徽章/浮层/控制条语义，重排为上部主体 |
| PendingBar 单渲染点 | A 已集成版 | 保留 |
| 客户视图门控 + 隔离标注 | A 已集成版（CONTRACT §6） | 保留并扩展（工具/聊天/进度全隐藏断言） |
| 四域提示 | 旧候选 + A 已集成版 | 收进右侧紧凑工具（不再双渲染 inline+侧栏） |
| 参会信息面板 | 本次新增（COMMON 参会要求） | 只读 session.participants + 现场要求说明 |

### 未采用 / 有意移除（避免 A 误判为遗漏）

| 项 | 理由 |
|---|---|
| 旧候选 `internalMessages` + `onSendInternalMessage` 内部交流区 | 后端无此数据源；聊天由访谈对话流（annotations/replies）承担，避免第二套无事实聊天 |
| 旧候选方式2「整页替换」的默认推荐 | 改为推荐方式1（page 保留接线层），保住 RequestRegistry/草稿持久/恢复语义 |
| 转写在业务视图主体的独立列表 | 移入放大画面层（演示回看）+ 客户视图折叠区，避免第三处重复 |
| 「演示来源如实区分」预设话术改动 | 回复 kind 标注沿用现网映射（模型辅助（真实）/模型（模拟）/业务/专业域/实控人），未发明新标签 |
| 真实视频/ASR/新供应商 | COMMON 禁止；诚实占位保留 |

## 4. 过程限制（如实）

- IAB fullPage 截图在本会话产生拼接伪影（DPR 震荡已知问题）；已改用视口截图+DOM 断言作为证据基准，伪影样本仅存档标注。
- 截图管线两次 surface 超时（窗口前台化后恢复）；错误恢复/空态创建两次截图未成，以交互断言 JSON 为准。
- 缩放验证为独立上下文 CSS zoom（Chrome 同源原语）；未改用户当前预览设备/zoom。
- 本候选未在产品预览 3467 实例化（写面受限）；「实际布局与动作结果」的实页复验留待 A 集成后（R1/R2）。

## 5. 剩余工作

1. A 采纳后：C 按本 RESULT §1 复验实页（布局、动作结果、CameraPanel 原位）。
2. A 冻结 INTERFACE 后：字段名如有变更，仅 adapter 一层适配；types 变更需回报 C。
3. R1/R2 批量缺陷修复窗口照 COMMON 执行。
