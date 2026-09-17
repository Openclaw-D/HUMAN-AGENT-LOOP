# goal-03 · Edge 与工作台数据设计（DESIGN）

- 轮次：backend-upgrade goal-03（2026-09-17）
- 执行者：ZCode（Edge 与工作台数据负责人）
- 基线：main @ `1ec0ee4`（含任务03修复轮的 kernel-store 分桶/撤权断流/SSE 语义/CSRF/慢客户端上限）
- 写域：`Back/Edge/src/**`、`Back/Edge/contract/**`、`Back/Edge/test/**`（非 e1）、`Front/**`；本文档目录
- 性质：设计先行——先固定数据面与性能目标，再实施，再按同一口径测 BEFORE/AFTER。

## 0｜现状与不重做的部分

上一轮（任务03修复轮，已合并）已交付且本轮**保留不动**的机制（只在其上补强）：

- 事件缓冲/订阅/回放按 `(customerId, principalId, 凭据指纹)` 分桶（缓存键含授权上下文）；
- 凭据被 A 拒（401/403）→ SSE `auth` 帧 + 终止 + 销桶（撤权断流，不因他人有权而续播）；
- SSE 至少一次 + Last-Event-ID/`?cursor=` 补取 + 游标过期显式 `resync`（不静默续播）；
- CSRF 写路由守卫（同源→白名单→无头非浏览器→same-origin 声明→其余拒绝）；CORS 仅显式允许列表；
- 慢客户端 `writableLength > 256KB` → resync 后断开；心跳周期复检会话；
- seq 全程字符串/BigInt；`/events-page` 大历史分页直读；动作代理白名单 + requestId 必带 + 502 回执对账。

## 1｜工作台数据规划（先数据后接口）

### 1.1 必要摘要（首次进入一次取全，`GET /api/jw/v2/customers/:id/workspace`）

| UI 块 | 数据来源（权威查询） | 说明 |
|---|---|---|
| 客户头（名称/状态） | `GET /api/v2/customers/:id` | 主读取：404/403 原样透传，不泄露存在性 |
| 额度区（已批准/预占/可用/敞口） | `GET .../exposure` | facilities + totalsMinor |
| 决策面（依据包/Gate/逐域 currency/可支用/复核队列/报告引用） | `GET .../decision-status` | 灰=未开始/未知；rejected 终态不给绿灯 |
| 发现/负向项 | `GET .../findings`（≤50，超出 `listTruncated` 标注） | |
| 对象清单（二维桥接保底） | `GET .../object-inventory`（≤50 + truncated） | |
| 检查会话（runStatus/closureStatus/availableActions/待办/外发） | `GET /api/v1/inspections/:sessionId` | sessionId 取自事件窗内最新 `INSPECTION_CREATED` |
| 待办（openItems） | 服务端状态推导（Edge 只回显，不发明结论） | |
| 事件窗（buffered/oldest/newest/gap/truncated）+ freshness 逐组件 | 本桶缓冲 + 逐查询结果 | 无 `all_ok` 汇总位 |

### 1.2 按需详情（不进首次摘要；逐请求授权）

- **评估/申请明细**：快照只带引用与状态；正文按引用 `GET /api/v2/assessments/:id`、
  `/api/v2/financing-requests/:id` 获取。单请求展开上限 `MAX_DETAIL_REFS=20`/类（超出截断标注）。
- **大历史**：`GET .../events-page?afterSeq&limit≤500` 分页直读（不经缓冲、不回放）。
- **报告**：`reportRefs` 只给入口；取阅走 A 的 audience 分权（Edge 不复制、不缓存报告正文）。
- **范围不完整的如实标注**：A 尚无 per-customer assessments/financing-requests 列表端点
  （IR-03-A②），快照 `refsSource='event_buffer'`、`refsExhaustive=false`；A 尚无客户列表端点
  （IR-03-A①），客户选择无法枚举。**缺失显式显示为"范围不完整/接口未提供"，不解释为"不存在"**。

### 1.3 授权范围（查询/缓存/回放/订阅/附件一体）

- 每请求由 A 按租户/客户/角色裁决；Edge 不缓存授权结论。
- 缓存/缓冲/订阅键一律 `(tenant≡kernel, customerId, principalId, 凭据指纹)`；同客户不同身份
  不共享未筛选数据。
- 撤权：本桶凭据 401/403 → `auth` 帧终止 + 销桶 + 停止新分发；会话撤销 → SSE 心跳复检断流 +
  HTTP 401。前端一律转终态（要求重认证），不自动重连复活。
- 角色视角/三维 Host/上帝镜头不产生审批权限（本轮无三维面；前端隐藏按钮不构成授权实现——
  写权限全部由 A 侧矩阵/角色裁决，Edge 只透传拒绝）。

### 1.4 分页与展开上限

| 面 | 上限 | 超出行为 |
|---|---|---|
| A 事件单页 | 500（A 上限） | `hasMore` 继续；客户端按页取 |
| Edge `/events-page` 单页 | 500 | `hasMore` + `nextAfterSeq` |
| 快照 findings/object-inventory | 各 50 | `listTruncated.*` 如实标注 |
| 快照明细展开 | 每类 20 条引用 | 截断标注；正文按需逐条 |
| Edge 事件缓冲 | 4000/桶 | 裁剪至 2000；裁剪区游标 → resync |

### 1.5 缓存与失效（本轮 C1 新增）

- **详情缓存（per-bucket）**：assessments/financing-requests 明细按 `(id → {data, fetchedAtSeq})`
  缓存在**本身份桶**内。失效钩子（任一满足即重取）：
  1. 本桶新事件 payload 引用该 id（`assessmentId`/`frId`）；
  2. 缓存年龄 > 60s（兜底 TTL）；
  3. 上游对该 id 查询失败（不缓存失败）。
- **正确性边界**：缓存只用于"重复读取未变对象"的降载；客户主体/exposure/decision-status/findings/
  object-inventory/session **每请求必直查权威端点，不缓存**（这些是"当前对象"语义的载体）。
  缓存命中与否在 `projection.freshness` 如实标注（`cached:true/false`）。
- **同请求合并（coalescing）**：同 `(customerId, ctx)` 的进行中 `getWorkspace` 共享同一 Promise；
  合并不跨授权上下文、不跨版本（返回即快照时点）。

### 1.6 事件与重连策略（客户端）

- 业务事件 → 定位失效 + 200ms 防抖重取快照；不逐事件全量刷新 UI 动效；成功动效只由真实回执/
  权威状态触发；重放（eventId 重复）不重复提示。
- 断线重连：指数退避 1.5s→3s→6s→12s→24s→30s 封顶；**成功回到 live 才重置**。
- 401/403 / `auth` 帧 → 终态（清会话，要求重认证），不退避不复活。
- `resync`（游标过期/慢客户端）→ 清游标 → 权威重取快照 → 以新基线重订（有退避）。
- `seenEvents` 去重集有界（5000，FIFO 淘汰），防长会话无界内存。
- SSE 解析按规范处理 CRLF 与多行 `data:`（服务端当前单行 `\n\n`，兼容经代理改写的中间层）。

## 2｜性能目标（先固定，再实现；同一口径测 BEFORE/AFTER）

栈：本机 loopback，交付形态（PG@15442 + A@48180 + Edge@48200；种子客户：2 设备材料+评估+批准激活
设施+两笔申请+检查会话）。口径：Node fetch 客户端（协议层）+ 真实浏览器（C3 回归）各测其适用项。

| # | 指标 | 目标（固定） | 测法 |
|---|---|---|---|
| T1 | 首次 workspace 读取（冷桶，含明细展开） | p95 ≤ 1500ms | 临时脚本，100 次×新建桶 |
| T2 | 稳态 workspace 读取（热桶） | p95 ≤ 400ms；**A 查询数 ≤ 9 次/读**（BEFORE ~7+2N） | 同上 + Edge 侧计数 |
| T3 | 写入→其他获准端 SSE 可见延迟 | p95 ≤ 1200ms（轮询 600ms×2 上界内） | 动作提交→事件帧到达 |
| T4 | 写入→另一端 workspace 反映（重取后） | p95 ≤ 1200ms | 动作提交→重取快照见变化 |
| T5 | 并发负载：5 会话同客户 + 5 客户并行，5 分钟 | 0 错误；Edge RSS/heap 无上升趋势；每会话稳态 A 查询 ≤ 2 次/s | 并发脚本 + `process.memoryUsage()` |
| T6 | 浏览器：连接→快照渲染完成 | ≤ 2500ms（本机） | 真实浏览器性能时间线（C3）※实测 994ms（单样本，见 TEST_RESULTS §3/T6） |
| T7 | 历史扩大（追加 500 事件后）当前对象不消失 | 快照仍含全部当前对象；大历史走 events-page 全量可取 | 脚本断言 |

注：T2 的"A 查询数/读"以 Edge 内部计数器（`kernelFetch` 计数）为准，BEFORE/AFTER 同法测。
BEFORE 数字落 `PERF_BEFORE_AFTER.md`（本轮实施前实测）；不达标项如实报告，不以改口径冒充达标。

## 3｜三阶段实施与回退

### C1 权威查询与授权（Back/Edge）
- 详情缓存 + 失效钩子 + 命中标注（§1.5）；`getWorkspace` 同请求合并；
- A 查询计数器（`_stats` 暴露，供 T2 与 E1 用）；
- 客户列表缺失的 UI 语义配合（§1.2）。
- 回退：缓存与合并均在 `kernel-store.mjs` 内，可独立关闭（环境变量 `JW_EDGE_WS_CACHE_MS=0` 关 TTL 缓存）；不改变任何对外协议。

### C2 实时同步与负载控制（Back/Edge + Front lib）
- 服务端：SSE 建流复用 coalescing（降低重订风暴放大）；维持既有背压/心跳语义；
- 客户端（`use-edge-live.ts`/`edge-client.ts`/`edge-logic.ts`）：指数退避、resync 退避、
  去重集有界、SSE CRLF/多行解析、unknown 消息对账回路（同 requestId 幂等重发一次 → 服务端
  replayed/新回执裁决状态）；
- 快照↔订阅窗口：维持"workspace 基线游标起步 + eventId 去重"（无缺口），补测断言（协议层）。
- 回退：客户端行为改动限于 Edge 接线三文件，训练模式零依赖；服务端改动可按环境变量回退默认行为。

### C3 必要页面接线与真实浏览器回归（Front）
- P1×3 修复：①消息"收起"按钮在展开后消失（ResizeObserver 在非 clamp 态测量）；②重连成功
  不回 `live` 态；③`connect` 不停旧流（旧流回调可污染新连接，假 live）。
- P2（目标相关）：刷新竞态（晚到旧响应覆盖新客户）→ 连接代际（epoch）守卫；卸载清理重连定时器；
  unknown 消息对账回路；会话操作条改用服务端 `availableActions`（缺失时才回退本地推导并标注）；
  训练/live 草稿槽隔离；`seenEvents` 有界；SSE 解析修正（与 C2 同项）。
- 同源受控入口：Edge 增 `--serve-front <dir>`（默认关）以受控静态服务托管 `Front/dist`
  （CSP/no-store/路径穿越防护沿用 harness 机制），浏览器与 Edge 同源 → CSRF 同源路径、无 CORS 依赖；
  现有 3618 预览形态保留（跨端口用 `--allowed-origin`，不为此放宽任何认证）。
- dist：源码改完 `npm run build` 重建（仓库交付要求），验证运行入口使用新构建。
- 明确不做：视觉重设计/动画/音效/建模/Unity；无真实媒体/三维处保持如实标注。

## 4｜验收映射（任务书 §六 → 执行）

| 验收项 | 层 | 方式 |
|---|---|---|
| 登录与拒绝 | 浏览器 | 真实凭据连接成功；错误凭据/无会话 → 明确拒绝文案 |
| 跨端口/同源策略 | 浏览器 + Node | 同源（`--serve-front`）POST 通过；跨端口未列白名单被拒；列白名单通过；恶意 origin 403 |
| 真实读写 | 浏览器 | live 聊天（internal/customer）服务端回执状态；会话操作条动作 → 快照变化 |
| 刷新保持 | 浏览器 | F5 后重连，快照/游标语义一致，不串客户 |
| 甲撤权乙继续 | Node + 浏览器 | A 侧撤 grant → 甲 SSE `auth` 终止、workspace 401/403；乙流不中断 |
| 旧游标 / 乱序 / 重复 / 延迟事件 | Node（协议层） | `?cursor=` 过期 → resync；反序提交窗口内补齐有序；eventId 去重 |
| 慢客户端 | Node | 停读接收端 → 服务端 writableLength 超限 → resync+断开；他人不受影响 |
| 切换客户 | 浏览器 | 断开-重连原子换上下文；晚到旧响应不得覆盖（epoch 断言 + UI 核对） |
| 并行写入 / 后台重启 | Node | 双会话并发写同客户；重启 Edge → 旧游标 resync、A 重启 → 502/恢复如实 |
| 多角色同客户 / 多客户并行 + 指标 | Node + 浏览器 | §2 T1–T7 |

未具环境条件的子项（如真实三物理终端、真实设备）→ `TEST_RESULTS.md` 记 `NOT_RUN` 并注明原因，
不用静态检查冒充。

## 5｜协调与边界

- 上游接口需求 → `docs/backend-upgrade/INTERFACE_REQUESTS.md`（IR-03-A①②③）；
  等待期 UI 如实标注范围不完整。
- goal-04 的 e1/交付/性能脚本不代写；临时测量脚本放系统 Temp 不入库；本路新增非 e1 测试进
  `Back/Edge/test/`（本轮写域）。
- 资源：交付栈端口 15442/48180/48200（已登记形态）；不抢占/不停未知进程；测试凭据全部为仓库
  公开合成演示令牌，不启用真实账号/费用/模型。
