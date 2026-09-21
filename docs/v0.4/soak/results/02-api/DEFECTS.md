# V0.4 长程测试 02_API 包 · 缺陷清单与精确改动

## SOAK-02（长测中发现，已修复，白名单内）：SSE 带游标重订的"整窗重放洪泛"与同键桶错删

- **位置**：`Back/Edge/src/kernel-store.mjs`（`subscribe` 的定时器清理与 kick 首拉、`replayFrom`）
- **现象**（P1 相位 25 分钟内 3 次，探针 `probe-sse-replay.mjs` 秒级稳定复现）：带游标 SSE 重订后收到游标之前的全部历史帧。契约上重复投递合法（至少一次、客户端按 eventId 去重），但客户端游标被完全忽略属重连性能缺陷（长历史客户每次重订全量重放），且游标已失效时会"先洪泛后 resync"，违背 T5-1 resync-first 意图。
- **根因（两点竞态叠加）**：
  1. **同键桶错删（02a）**：上一订阅离开后定时器未即刻清理；同键新桶（由在途 workspace 或新订阅）建立后，旧定时器 tick 按 key 无条件 `buckets.delete(key)`，把**新桶**从映射中错删。新桶仍在（闭包持有）但丢失地图注册。
  2. **空桶订阅无视游标（02b）**：`subscribe` 先注册订阅再由 kick 首拉；若落在（被错删后重建/在途 workspace 合并共享的）空桶上，首拉把全缓冲按 fresh 事件全量投给本订阅，`replayFrom(after)` 只作用于其后的重放段，拦不住 fresh 洪泛。附带有两处连带问题：`replayFrom` 地图 miss 返回 `{events:[]}` 而非 expired（不 resync、静默）；expired 分支 `reason: r.reason` 引用 try 块内 const（潜在 ReferenceError，此前服务端侧先 resync 掩盖未暴露）。
- **修复（最小三点）**：
  1. 定时器清理改为 `buckets.get(b.key) === b` 才删除（只删自己，不伤同键新桶）；
  2. `subscribe` kick 重排：带基线游标且桶为空时**先补缓冲再注册订阅**（预取中撤权 → 补发 onAuthFail；提前退订 → dead 标志不注册），投递统一走 `replayFrom(after)`：游标之后才投递、未知仅 resync；
  3. `replayFrom` 地图 miss → `{expired:true}`（显式 resync 不静默）；expired 分支改 `replay.reason`（消除潜在 ReferenceError）。
- **hash**：`314c5f9f…`（SOAK-01 后）→ `32d4771ff128e47d5d0c239ba41a8b96b51e81438c2c2cf550a7f8c0f7fb6aea`。
- **回归**：相关面 95/95（matrix 9/9、s1-sse、g03-c1-kernel-store、v04-activity-http、takeoff-surface、g03c-workbench、g03e-message-thread、assistant-evidence-http、g03d-decision-channel、v04-evidence-provider/model-scope/upload-assembly/evidence-scope、e1-task3-inspection）；探针修复前 2 次违规/数秒 → 修复后连续 4 分钟零违规。P2 起相位以修复后源码快照重拷运行。

## SOAK-01（已修复，白名单内）

- **位置**：`Back/Edge/src/kernel-store.mjs`（`runWorkspace` 的 artifacts 装配段）
- **现象**：上游材料清单带 `nextCursor`（材料元数据 > 单页 limit=100，本包以 1000 条元数据客户复现）时，workspace 快照不披露截断。`listTruncated` 仅含 `findings`/`objectInventory`，`artifacts` 缺失、无 note。准入投影（01契约 §7）以材料清单为权威输入行——静默截断意味着 1000 条元数据只进 100 条且无任何提示，违反本文件自身披露纪律（头部 C1.3"大历史走 pageEvents 分页，不因缓冲窗口悄悄消失"及 findings/inventory 的既有 listTruncated 纪律）。
- **最小复现**：`Back/Edge/test/soak-v04-api/matrix.test.mjs`「1000 材料元数据」例（stand-in A `/artifacts` 返回 100 条 + `nextCursor`）。
- **修复（最小，+7 行）**：`artifactsTruncated = Boolean(artifactsRes?.nextCursor)`；`listTruncated` 增加 `artifacts` 键；截断时 push note「材料清单超过单页上限（limit=100）：快照仅含第一页，完整分页走工作本读面」。不改任何既有键语义，纯增量披露。
- **hash**：修复前 `3d8b6131d6f27dd4780a54f80c1e4ae58e9e3f3c36d3f2bde2e787c1b4ef2cee` → 修复后 `314c5f9f12476e92e4fe807447a6bcea24697901ab986db3cb38428e63903845`。
- **回归**：matrix 9/9 ×2 轮；`v04-activity-http + g03-c1-kernel-store + takeoff-surface` 24/24；消费 workspace 快照形状的 9 个测试文件（g03c-workbench / takeoff-surface / assistant-evidence-http / g03d-decision-channel / v04-evidence-provider / v04-model-scope.decisions / v04-upload-assembly / v04-evidence-scope / e1-task3-inspection）57/57。

## OBS-01（观察项，不在白名单，未改动）

`GET /api/jw/v2/customers/:id/messages` 路由（`server.mjs`，本包只读）丢弃了 `messageStore.list` 返回的 `truncated`/`retentionBase` 披露字段（仅解构 `messages`/`cursor`）。统一活动读面 `/activity` 的 thread 源 `sources[]` 携带完整披露（`encodeActivityCursor` 过期游标 → `truncated:true + retentionBase`），四页契约走 activity 不受影响；直连 messages 读面的消费者在保留窗口裁剪后看不到显式缺失提示。修复需动 server.mjs（他路在制文件），仅登记。

## OBS-02（观察项，设计内行为，登记备忘）

`GET /events-page` 是 A 的 `after/limit` 直读透传：若上游同一页内出现重复 eventId（A 侧按 seq 唯一，正常不会发生），直读面会原样透传重复（at-least-once 语义）；activity 聚合面经 `activityId` 命名空间去重不受影响。与契约「重复事件→客户端去重安全」一致，非缺陷。

## OBS-03（观察项，修复点在 server.mjs，本包只读，未改动）

`GET /events`（SSE）带游标重订且补播为空、又无新事件时，连接建立后到首个 15s 心跳之间字节级静默（`res.writeHead` 的响应头随首次 body write 才首刷）。协议上合法（心跳即活性信号），但对响应超时 <15s 的客户端/代理表现为"连接无响应"。规避：客户端先无游标订阅（cursor 帧立即写出）或容忍心跳时延。复现工具：`test/soak-v04-api/probe-sse-replay.mjs`。修复归属 server.mjs（他路在制文件），仅登记。

## 替身建模修正（harness，非产品缺陷）

初版 stand-in A 允许同 eventId 重复追加至事件列表——真实 A 的 seq/eventId 是存储主键，不可能重复。该建模失真曾触发两类误报（events-page 页内重复、churn-dup 条目数漂移）。已改为按 eventId 幂等去重（与真实 A 一致）；重复 DELIVERY 的覆盖由 kernel-store 重查窗口（每轮重拉最后 128 seq，byId 去重）持续执行。

## 判定依据

- 越权泄漏 = 0（跨客户 404、客户受众内部消息/模型回执 403 或显式排除、翻页撤权 403、读中撤权 auth 帧、非法游标 400——长测连续抽查 + 矩阵深断言）。
- GET 业务副作用 = 0（替身 A 只收白名单 GET；audit/线程存储/回执文件前后不变——矩阵断言 + 长测零写入场景）。
