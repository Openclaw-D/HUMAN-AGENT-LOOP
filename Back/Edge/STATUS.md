# Edge · STATUS

更新：2026-09-17（任务04 S1 全量 + S2 传输语义 E0 + S3 骨架 + S5 演练/S4 D25 轮）

## 契约核查（2026-09-17 多次复核；最近一轮要点）

任务 01/02/03 均未冻结，但进展显著：
- **01**：`Back/A/src/http/server.ts` 已出现约 30 处 `/api/v2/customers|facilities` 路由（在制品、仍在修改）；但 `Back/CONTRACT.md` 仍 v1.3、API v2 提案仍自标待冻结 → 契约未发布、实现未固定，E1 集成继续 BLOCKED（不抢先集成在制品）。
- **02 Connectors**：实现成形 + 自建 E0/E1 测试计划（自有 PG@15443）；其 E0 实测 5/5 PASS（显式文件清单；其 npm 脚本撞本机 `node --test <目录>` 已知怪癖）；跨 lane 契约未发布（docs/ 空）。
- **03 C**：四域 E0 面成形（four-domain.test.mjs 单独 27/27 PASS）；统一 runner 同跑时两个 four-domain 文件失败（套件干扰，C lane 事项）；无已发布接口变更。
- 以上为只读运行观察，非验收、不代修；触发条件不变：01 契约汇入 CONTRACT.md 且实现固定 → E1 集成。

## 已完成

- **S1 全量**：D01–D28 验收矩阵、版本封存协议与 CLI、liveness/readiness 拆分、端口/容器假设审计、安全启停、最小自检（Edge 27/27、D g0 8/8、D g1 4/4、A typecheck）。
- **S2 传输语义 E0**：SSE 至少一次 / Last-Event-ID / 游标过期 resync / 无权限零回放 / 404 不泄漏存在性（fixture store seam）。
- **S3 骨架与判据**：
  - 动作代理：固定上游 + 显式路由白名单（无任意 URL 代理）、会话→上游凭据服务端映射（浏览器伪造凭据头不透传、无会话 401 先于路由表披露）、requestId 必带不代生成、上游未知 502 回显原 ID 不自动重试（D13/D17 种子）。
  - 消息受众路由：customer/internal 分离，内部外发默认 403 AUDIENCE_MISMATCH 留审计，显式 confirmExternalSend 放行且审计记 confirmed，送达未知不标已读（D09 种子，守护进程实测）。
  - 审计 sink（只追加）与 `/api/jw/v2/audit` 只读面。
  - CSRF 守卫（本轮新增）：全部 POST 写路由先过 Origin/Sec-Fetch-Site 校验——同源放行、跨站/null origin/信号不一致一律 403 CSRF_ORIGIN_REJECTED、非浏览器客户端放行、staging 允许列表可配（D17 种子 E0 PASS，6 用例 + 守护进程实测）。
  - browser-harness 最小操作页（`Back/D/browser-harness/`，经 `/harness/` 同源提供，CSP+穿越防护）：客户切换防错绑、面板开合不重建媒体占位/订阅、requestId 重试演示、受众守卫演示、审计查看。
- **S4 D25（本轮新增）**：提交前公开提交扫描器（`scripts/public-submission-scan.mjs`，git 文件集 8153、文本扫描 6466）：HARD=0；REVIEW 40 项已人工分类全部良性（占位符/Achieve 历史大文件）；证据 `evidence/d25-scan-*/report.json`。
- **S5 备份恢复演练（本轮新增）**：`scripts/backup-restore-drill.mjs` 真实执行 PASS（12/12 步）：v7d- 隔离容器 → 001 迁移 → 12 表合成数据 → pg_dump → DROP 模拟损毁 → pg_restore → 逐表指纹 ALL_MATCH → 容器销毁；runbook 与回滚边界（代码回滚≠数据库回滚、不可逆迁移向前修复）见 `docs/customer-next/acceptance/BACKUP_RESTORE_DRILL.md`。
- 证据：`docs/customer-next/acceptance/evidence/`（version-seal / d25-scan / s5-drill）、`Back/D/evidence/s1-g1-jw/`。

- **E1 集成测试骨架（本轮新增）**：`test/e1/` 冻结门（CONTRACT≥v2 + 提案状态 + Back/A 实现固定 + docker 可达，四判据实时探测）+ E1-D02 真实变体（自有隔离 PG + 全部迁移 + JW 内核 17919 段 + Edge 真实探针；停库→live 保持/ready 翻转→恢复）。门未过时用例如实 SKIP 并打印原因（当前实测：skipped，原因=契约未发布+实现 11 文件在制品）；门过即一条命令可跑。D03–D05 真实变体待 v2 事件 API 冻结后补写（见 test/e1/README.md）。

- **性能基线（本轮新增，Edge 层）**：`scripts/perf-baseline.mjs`——M1 快照 p95=0.53ms / M2 会话 p95=0.41ms·消息 p95=0.41ms / M3 事件→5路SSE p95=0.66ms，全部满足提案 SLO 且余量巨大（fixture+loopback 属预期）；60s 浸泡 heap 无增长趋势；2h 浸泡与全链路（含内核 DB 段）NOT_RUN。证据 `evidence/perf-baseline-*/perf.json`。

## 遗留门（不冒充完成）

| 门 | 阻塞原因 |
|---|---|
| S2 内核集成（E1：D02–D05 真实变体） | 任务01 v2 路由已在制品但契约未发布、实现未固定；`src/store.mjs` 为 fixture seam；E1-D02 骨架已就绪（冻结门后一条命令可跑） |
| S3 剩余 | 真实客户绑定 scope（auth seam 按 principal×customer×action）、Cookie 会话/HTTPS/staging 部署形态、真实浏览器层端到端 CSRF 验证（守卫 E0 已覆盖） |
| D06–D12/D14/D23/D28 场景执行 | BLOCKED(01/02/03) |
| D19/D21/D22 稳定性 30 轮 | BLOCKED(B 修复固定 hash) |
| D26 完整回滚演练 / staging 备份策略 | BLOCKED(部署形态/获准环境) |
| D27 真实设备/官方视频/获准模型 | BLOCKED(用户授权/账号/费用) — E2 门 |
| 性能基线测量 | 未执行；任务书 p95 目标为待确认提案 |

## 环境注意

- 48080/15432 为旧 Anthropic 工作区遗留实例占用，未触碰；JW 自有形态 A@48180/PG@15442（见 `Back/START.md`）。
- Docker Desktop 引擎在本会话内出现两次不可达/半启动（ServerVersion 为空但 info 可答）；演练前用 `docker ps` 作为就绪判据而非 `docker info`。
- 检测到并行 writer（Back/Connectors、Back/A 002 迁移、Back/C 四域、docs/customer-next 提案）；Edge 未读写这些路径。
- `--fixture-auth` 的 `harness-demo-cred` 是公开合成演示凭据（仿 A tok-* 模式），禁止用于真实身份；不启用时登录/写面一律失败关闭。

## 任务03 修复轮（2026-09-17 下午；PR#3 审核后四任务并行 N1）

本路（Back/Edge/src + Front 接线；独立测试归任务04）针对审核 F05/F09 及任务书 C1–C4 的修复已落地并隔离栈自验：

- **C1（F05 修复）**：`src/kernel-store.mjs` 重写——事件缓冲/订阅/回放按 (customerId × principalId × 凭据指纹) 分桶（缓存键含授权上下文，不再按 customerId 共用广播）；本桶凭据遇上游 401/403 → onAuthFail 通知并销桶（server 发 SSE `auth` 帧后终止，撤权断流）；快照权威面扩展（decision-status / findings / object-inventory 逐查询 + freshness 逐组件、无 all_ok）；assessments/FR 引用显式标注 `refsSource='event_buffer', refsExhaustive=false`（A 缺列表端点，需求提交任务01）；seq 全程字符串/BigInt（不无条件 Number 转换）；提交滞后重查窗口 128 + eventId 去重 + 有序插入 + gap 标注（反序提交窗口内自愈）；新增 `/events-page` 分页直读（大历史不因缓冲窗口消失，fixture 形态如实 501）；空闲桶自动回收。
- **C1.2/C2（server/messages）**：SSE 心跳周期复检会话（过期/撤销 → auth 帧 + 终止，仅对建立时有会话的流）；慢客户端 `writableLength` 超限 → resync 后断开（背压有界）；csrfCheck 判定顺序修复（X08/F09：同源 → 显式白名单 → 无头非浏览器 → same-origin 信号 → 其余拒绝，合法跨端口源不再被 same-site 先拦）；内部内容外发 `confirmExternalSend` 不再万能豁免——须过 `messages:external-send` 权限点（默认拒绝，`--external-send-roles`/`JW_EDGE_EXTERNAL_SEND_ROLES` 显式授予）+ live 模式目标客户可读校验（store.checkCustomer，防错 customerId）；消息 requestId 同载荷重放 `replayed:true`、异载荷 409。
- **C3（F09 前端）**：`home-overview` live 分支移除对 submitCaseTurn/completedTurns/scenario.domains 的依赖——live 聊天走 Edge 消息路由（服务端回执状态 sending/sent/unknown/failed，失败不回退本地模拟）、四域矩阵来自 decisionStatus 逐域 currency（灰=未开始/未知，绿=依据当前≠批准）、生命周期来自会话 runStatus/closureStatus；训练模式原样保留且与真实会话不共享草稿。`edge-logic` 新增 live 投影纯函数（deriveDomainRowsLive/deriveLifecycleLive/deriveDecisionLines/capabilityChips/toLiveChatMessage）；额度区区分 候选/已批准/可用/可支用 + Gate 结论（rejected 终态不给绿灯）+ 决策就绪/缺口/阻断；状态栏新增能力位 chips（逐项独立）+ readiness 逐依赖 + freshness + 快照版本/事件窗口。撤权/会话失效（auth 帧、HTTP 401/403）为终止性，不自动重连复活旧会话。
- **C4**：EdgeObjectLinks 二维桥接保底面板（object-inventory：objectId/siteSnapshotId/sceneVersion 锚定状态）；手机邀请上传/实时视频/三维多人场区如实标注 not_wired / blocked_external_access；**D27-S BLOCKED**（本仓无 Unity/三维构建，不冒充）。本交付不含三维厂区。
- **并写合并**：同一工作区有并行 writer 落了同方向补强（凭据输入 password 化、会话动作 502 重试同 requestId 复用、SSE onDrop 401/403 终态、消费面 inspection 写面更新）——已保留并合并，未回退任何人改动。
- **自验**（隔离栈 PG@15436 + A@17921 + Edge 随机端口；临时脚本在系统 Temp，不入库；不写 Back/Edge/test）：单元 11 项（分桶/撤权断流/反序提交窗口/BigInt 精度/回放分桶隔离）+ 集成 28 项全绿（CSRF 四态、会话交换、权威快照块、SSE 实时+双身份双桶、events-page、消息受众/外发门/目标校验/幂等、会话撤销 401/403、fixture events-page 501）。A 侧为任务01在途版内核（其 createCustomer 已要求可信 principal——消费面已兼容）。Front：typecheck 0 错、vite build 通过、dist 已重建、纯逻辑测试 8/8。
- **提交任务01 的需求**（upstreamGaps 已登记 consumed-surface）：① 按客户列出 assessments/financing-requests 的权威 GET 端点；② events 的 seq 提交序语义或已提交水位/缺口检测（消除滞后窗口残余风险）。
- **给任务04 的测试需求**见 `Back/Edge/delivery/TASK03_V02_FIX_REPORT.md` §5（不代写 Back/Edge/test）。

## goal-03 轮（2026-09-17 晚；backend-upgrade 目标框架 · Edge 与工作台数据负责人）

- **C1**：kernel-store 明细缓存（本身份桶内；事件失效+TTL `JW_EDGE_DETAIL_CACHE_MS`，客户主体/敞口/决策面/清单/会话不缓存每请求直查）、同 (客户×身份×凭据) 在途 workspace 合并、`_qCounters` 查询计数；**撤权断流补强**：A 对越权统一 404 → 曾可读桶遇 404 视同撤权 → `CUSTOMER_ACCESS_REVOKED` auth 帧 + 销桶（修复"中途撤权订阅静默失联"）。热 workspace 上游查询 10→7（-30%），热读 p95 295→234ms。
- **C3**：`--serve-front` 同源受控前端（static.mjs 泛化根挂载 + edge-start 透传）；前端 3×P1 修复（收起按钮根因=line-clamp 下 scrollHeight 恒等于 clientHeight；重连回 live；connect 停旧流+epoch 代际守卫）+ P2（刷新竞态/退避/有界去重/unknown 同 requestId 幂等对账/服务端 availableActions/草稿隔离/定时器清理）；dist 重建（index-C4ixqN64.js）。
- 验证：run-all 34/34（+7 新用例）、Front 19/19+typecheck、真实栈场景 S1–S6 全过（撤权/重启回补/慢客户端/并行写/后台重启）、真实浏览器回归 10 项（同源入口/回执/拒绝/切客户/刷新/撤权显示/P1-1 两轮稳定/T6=994ms）。
- 交付文档：`docs/backend-upgrade/goal-03/`（DESIGN/CHANGELOG/TEST_RESULTS/PERF_BEFORE_AFTER/HANDOFF）；接口需求协调 `docs/backend-upgrade/INTERFACE_REQUESTS.md`（IR-03-A①②③ OPEN）。delivery-seed 与 A2 门冲突移交 goal-04（本轮以 `--allow-legacy-basis` 兼容核绕行）。
