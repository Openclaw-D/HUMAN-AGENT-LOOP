# backend-upgrade · 跨目标接口协调（INTERFACE_REQUESTS）

规则（源自本轮任务书）：goal-03（Edge/Front）所需上游接口或脚本变更，一律在本文件登记协调；
不跨目录抢写他人写域。各条目状态由**目标域 owner** 回填（接受/拒绝/已交付+落点），
申请方不得代填状态、不得以"已申请"冒充"已提供"。

- goal-01 = Back/A 与共享契约（writer：任务一路）
- goal-02 = Back/B / Back/C / Back/Connectors
- goal-03 = Back/Edge/src、Back/Edge/contract、Back/Edge/test（非 e1）、Front（writer：本路）
- goal-04 = Back/Edge/test/e1、交付/扫描/性能脚本、Back/D

---

## IR-03-A（goal-03 → goal-01，2026-09-17 申请）

**① 客户列表端点（工作台客户选择的事实源）**

- 需求：`GET /api/v2/customers`（按调用 principal 的授权范围过滤：`customers:'all'` 返回租户内全部，
  `'grant'` 模式按 `principal_customer_grants`；建议支持 `limit/cursor` 分页；响应不含未授权客户的存在性）。
- 用途：工作台"客户选择"当前要求手输 customerId（无法发现可办客户）；拿到列表后 Edge 才能提供
  授权范围内的客户选择器。**等待期间 Edge 不伪造列表**，UI 明示"客户目录接口未提供，范围不完整"。
- 语义要求：与 getCustomer 同一授权裁决（越权不可枚举：无权限时返回空/404 语义一致，不泄露存在性）。

**② 按客户列出 assessments / financing-requests 的权威端点**

- 需求：`GET /api/v2/customers/:id/assessments`、`GET /api/v2/customers/:id/financing-requests`。
- 用途：Edge 工作台快照中这两类引用当前只能取自事件缓冲（`refsSource='event_buffer'`、
  `refsExhaustive=false`）——历史超过缓冲窗口后"当前对象"会从快照消失。此需求自任务03修复轮
  起已登记于 `Back/Edge/contract/consumed-surface-v1.json` upstreamGaps，本轮延续申请。
- 交付后 Edge 动作：切换为权威查询并移除非穷尽标注（Design §缓存与失效的失效钩子同步生效）。

**③ 事件提交序 / 已提交水位**

- 需求（三选一）：outbox `seq` 改为提交时分配；或提供已提交水位（high-watermark）查询；
  或提供缺口检测接口。
- 用途：Edge 现以"滞后重查窗口 128 + eventId 去重 + gap 标注"缓解反序提交；晚于窗口的极端
  反序仍可能漏事件。A 侧根修后 Edge 收窄窗口并回归。
- 风险陈述：现状不阻塞交付（窗口内自愈已验），但"完整性保证"依赖 A 语义修正。

## IR-03-D（goal-03 → goal-04，2026-09-17 申请）

**① perf 脚本的 live 内核形态**：`Back/Edge/scripts/perf-baseline.mjs` 目前为 fixture/loopback
形态（其 STATUS 已声明）。本轮 goal-03 的 PERF_BEFORE_AFTER 使用**本路临时测量脚本**（系统 Temp，
不入库）对真实栈（PG+A+Edge）测量；若 goal-04 的 perf 脚本后续支持 `--kernel-base` live 形态，
请告知，goal-03 愿意改用统一脚本复测，避免口径分叉。

**② E1 回归清单确认**：任务03修复轮 §5 的 U01–U13 测试需求（见
`Back/Edge/delivery/TASK03_V02_FIX_REPORT.md`）+ 本轮 goal-03 新增行为（见
`docs/backend-upgrade/goal-03/CHANGELOG.md`"提交 goal-04 测试点"节）。goal-03 不代写 e1。

---

## 状态登记（owner 回填）

| 编号 | 目标域 | 状态 | 落点/说明 |
|---|---|---|---|
| IR-03-A ① | goal-01 | 已交付 | `GET /api/v2/customers`（CONTRACT §11 G1）；任务03 增补 search 匹配 customerId/legal_entity_ref（§12.2）。越权不可枚举语义同 getCustomer（404/不泄露存在性） |
| IR-03-A ② | goal-01 | 已交付（A 侧） | `GET /api/v2/customers/:id/assessments`、`GET /api/v2/customers/:id/financing-requests`（CONTRACT §12.1；迁移 011）。Edge 切换权威清单并移除 `refsExhaustive=false` 由 goal-03 落地后回归 |
| IR-03-A ③ | goal-01 | 分析后不交付（本轮） | 根修需提交时分配 seq（全事务串行点代价，与性能收口冲突）；bigserial 回滚缺口使"已提交水位"不可靠推导。结论与建议见 CONTRACT §12.5；Edge 窗口自愈缓解继续有效 |
| IR-03-D ① | goal-04 | OPEN | |
| IR-03-D ② | goal-04 | OPEN | |
