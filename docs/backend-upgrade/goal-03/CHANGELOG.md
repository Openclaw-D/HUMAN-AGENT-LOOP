# goal-03 · CHANGELOG（backend-upgrade 轮 · Edge 与工作台数据）

- 轮次：2026-09-17；基线 main @ `1ec0ee4`；执行者 ZCode（goal-03 路）
- 性质：commit-ready，未 commit/push（按边界 awaiting 用户明确授权）

## 1｜Back/Edge（本路写域）

### src/kernel-store.mjs（C1）
- **明细缓存（桶内）**：assessments/financing-requests 明细按 id 缓存于本身份桶；失效=本桶新事件
  引用该 id（立即）或 TTL（默认 60s，`JW_EDGE_DETAIL_CACHE_MS` 可调，0=关 TTL）。客户主体/敞口/
  决策面/findings/object-inventory/会话**不缓存、每请求直查权威端点**。命中在
  `projection.freshness[label].cached=true` 如实标注。效果：热 workspace 的上游查询 10 → 7（种子数据形态）。
- **同请求合并**：同 `(customerId, principalId, 凭据指纹)` 的在途 `getWorkspace` 共享同一 Promise
  （重订风暴/多面板并发刷新不放大上游查询）；只在途合并，不跨授权上下文、不做结果级缓存。
- **查询计数**：`kernelFetch` 按 snapshot/events/detail/other 分类计数；`_qCounters/_resetQCounters/
  _dropDetailCaches` 供测试与性能口径（不改对外协议）。
- **撤权断流补强（404 语义）**：A 对越权/撤权统一 404（不泄露存在性）。对本桶**曾成功读取**的客户，
  事件轮询遇上游 404 视同撤权/删除信号 → `onAuthFail('CUSTOMER_ACCESS_REVOKED')` → SSE `auth` 帧
  终止 + 销桶。修复了"中途被撤权的订阅静默失联（不再收事件但也收不到 auth 帧）"的真实缺口
  （场景 S2 真实栈验证）。

### src/server.mjs（C3）
- 新增 `--serve-front <dir>`（默认关）：由 Edge **同源受控托管**前端构建产物（如 `Front/dist`）。
  仅接管非 `/api`、非 `/versionz`、非 `/healthz` 路径；未知非资源路径 SPA 回退 index.html；
  API 命名空间保持 JSON 404；`/harness` 路由优先。CSP `connect-src 'self'` 不放宽，不改变任何
  认证/CSRF 语义。对应"统一受控同源入口"验收项（同源部署无需 CORS 配置）。

### src/static.mjs（C3）
- 泛化静态服务：`urlPrefix=''` 根挂载形态（'/' 与 SPA 回退）；MIME 增 `.map/.woff2`；
  `/harness` 默认形态行为逐字节不变（既有测试覆盖）。

### scripts/edge-start.mjs
- 透传 `--serve-front` 到守护子进程（此前仅透传 --live/--auth-file/--allowed-origin）。
  说明：edge-start 属 Edge 启动入口（本路依赖/脚本面）；goal-04 若对启动脚本有归属主张，见 HANDOFF。

### contract/consumed-surface-v1.json
- revision `goal03-1`：登记明细缓存/合并/查询计数消费语义、事件 404 撤权断流补强、
  `--serve-front` 同源入口。upstreamGaps 不变（客户列表/按客户明细列表/事件提交序——均已在
  `docs/backend-upgrade/INTERFACE_REQUESTS.md` 并档跟踪）。

### test/（本路新增；run-all 自动发现，现 34 用例全绿）
- `g03-c1-kernel-store.test.mjs`（5）：明细缓存命中与 cached 标注、事件失效钩子（无关事件不误伤）、
  在途合并（含"不同凭据不合并"）、失败不缓存、**404 撤权断流**（曾可读桶 → CUSTOMER_ACCESS_REVOKED
  一次；从未读过的客户首查 404 不误伤）。
- `g03-c3-same-origin.test.mjs`（2）：根挂载/资产/SPA 回退/CSP 不放宽/API 404 不遮蔽；
  未配置 frontHandler 时行为与既有一致。

## 2｜Front（本路写域）

### lib/v5-preview/edge/use-edge-live.ts（P1-2/P1-3 + P2）
- **连接代际（epoch）守卫**：connect/disconnect/终态各 +1；一切异步回调（SSE 帧头、重取快照、
  消息回执）应用状态前核对代际——晚到旧流回调、旧客户响应不得污染新连接/新客户上下文
  （P1-3 connect 不停旧流 + 切换客户原子性 + refresh 竞态一并修复）。
- **重连回 live（P1-2）**：`openEvents` 新增 `onOpen`（SSE 200 即回调）；重连成功 → `setPhase('live')`
  + 退避计数清零 + 清除断连类错误。
- **指数退避**：断线重连 1.5s→3s→…→30s 封顶；`resync` 后重订同样有退避（≤5s）；此前为固定
  1500ms / resync 零退避。
- **有界去重**：`seenEvents` 上限 5000（FIFO 淘汰），防长会话无界内存。
- **unknown 消息对账回路**：502 结果未知 → 状态"对账中" + 4s 后以**同 requestId 幂等重发**一次
  （服务端同载荷 replayed/新回执裁决；不换新 ID、不产生重复投递）；仍未知则保持对账态等事件/快照确认。
- **撤权 404 终态**：已连接会话中客户面 404（A 越权统一 404）→ 终态提示"已不可读（可能已撤权或被
  删除）"，不再进入无意义的重连循环。
- 定时器统一登记：重连/对账定时器在卸载、断开、终态时全部清理（P2）。

### lib/v5-preview/edge/edge-client.ts
- `openEvents` +`onOpen` 回调（供 P1-2）。

### lib/v5-preview/edge/edge-logic.ts
- `parseSseFrames`：按 SSE 规范兼容 CRLF/CR 行尾与多行 `data:`（以 \n 连接）；行内冒号后空格可选。
- `deriveSessionActions`：**优先投影服务端 `availableActions`**（契约以服务端为准；服务端没有的
  动作键不渲染）；未提供字段时才按 runStatus 本地推导并如实标注 `fromServer=false`。
  返回形状改为 `{ acts, fromServer }`（有意变更，测试同步更新）。
- `EdgeSnapshotShapes.session` +`availableActions?: string[]`。

### app/v5-preview/edge-panels.tsx
- `EdgeSessionBar`：消费服务端 availableActions；本地推导兜底时显示"（服务端未提供
  availableActions：以上为本地推导，仅发起用）"。
- `EdgeStatusBar`：off 态明示"客户目录接口未提供：可办客户范围不完整，需手输客户 ID（缺失≠不存在）"
  （对应 IR-03-A① 等待期语义）。

### app/v5-preview/home-chat.tsx（P1-1 + 草稿隔离）
- **收起按钮修复（P1-1）**：`ChatMessageItem` 只在折叠态测量溢出——展开时移除 clamp 会使
  ResizeObserver 恒测得"无溢出"而卸载"收起"按钮（消息永远收不回）；展开期间保留最近测量结果。
- 输入草稿存储键按模式隔离（`draftStorageKey` prop）：训练/live 不共享草稿槽。

### app/v5-preview/home-overview.tsx
- 传模式化草稿键（live=`:live`，训练=`:training`）。

### Front/dist
- 源码改完 `npm run build` 重建（bundle：`assets/index-rCpDqpeM.js` + `index-Coao7djn.css`）；
  验证运行入口（Edge `--serve-front` 同源托管）使用新构建。未只改 dist。

### preview/test/edge-logic.test.mjs
- SSE 解析用例补 CRLF/多行 data；会话动作用例改为新返回形状并补"服务端 availableActions 优先/
  缺省兜底标注"断言。19/19 全绿。

## 3｜明确不做（本任务书边界）

- 不做视觉重设计/翻页动画/音效/人物建模/Unity；不新建通话或三维引擎；无真实媒体/三维处保持
  "未建（如实标注）"。
- 不改写 `Back/CONTRACT.md`、Back/A、Back/B、Back/C、Back/Connectors、Back/D、Back/Edge/test/e1
  任何文件。
- config/edge-auth.json 为 Git 排除的本地文件，本轮仅为撤权场景追加了公开合成演示令牌
  `tok-lim1`（与既有 tok-* 同族，禁止用于真实身份）。

## 4｜提交 goal-04 的测试点（不代写 e1）

1. S2 撤权断流的真实栈复测（grant 模式主体 + admin 撤销 → `CUSTOMER_ACCESS_REVOKED` auth 帧）。
2. 明细缓存正确性：事件失效/TTL 双路径下 workspace 明细与 A 直查一致（E1 可用 `_qCounters` 断言查询数）。
3. `--serve-front` 同源形态下浏览器真实 Sec-Fetch 头的 CSRF 四态矩阵（U05）。
4. 慢客户端（真实 TCP 背压）与 15s 心跳会话过期断流的长时复测。
