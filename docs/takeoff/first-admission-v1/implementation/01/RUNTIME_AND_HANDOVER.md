# 运行依赖与遗留 · A 权威路（TAKEOFF-FA-1.0.0 v2.6）

日期：2026-09-20。给 04 集成路 / Codex 复核 / 后续接手者的最小说明。

## 1. 本路交付了什么

| 交付 | 位置 |
|---|---|
| 冻结契约（先于实现发布） | 本目录 `CONTRACT-PREASSESSMENT.md`；登记 `Back/CONTRACT.md` §13（v2.6） |
| 加法迁移 | `012_takeoff_preassessment.sql`（确认/候选历史/新列/枚举+1/legacy 回填）+ `013_five_domain_vocab.sql`（五域词表）+ `014_admission_request.sql`（首次回租需求）；回退=保留对象停用入口 |
| 实现 | `Back/A/src/domain/credit.ts`（confirmPreassessment / submitCandidate 扩展 / 候选历史 / 确认读回 / 新证据 needs_review 投影）、`Back/A/src/http/server.ts`（2 条路由） |
| 测试与证据 | `Back/A/test/preassessment-confirm.test.mjs`（15 例）；本目录 `TEST_RESULTS.md`、`SAMPLES-OBSERVED.md` |
| 清理记录 | 本目录 `CLEANUP_LOG.md`（结论：零删除，逐项理由） |

## 2. 运行依赖（04 联调需要知道的最小集）

- A 内核启动：`cd Back/A && node src/index.ts --port <port> --db <dbUrl> --principal-tokens "<合成目录>"`（详见 `Back/A/README.md`）。本轮**未新增任何启动参数**；预评估确认授权走服务端目录角色 `credit`（例如 `tok-credit=cindy:human:credit:all:t1`），不依赖权限矩阵，不 seed 政策数据。
- 迁移自动应用：内核启动时顺序执行 `migrations/*.sql`（新库自动含 012；**存量库下次启动自动补 012**，幂等记账于 `schema_migrations`）。
- 测试：`JW_A_ADMIN_DB_URL=postgres://jwcc:***@127.0.0.1:15444/postgres node --test test/preassessment-confirm.test.mjs`（容器 `jw-cc-kernel-pg@15444` 为本路登记的自有测试资源；**运行中**，本轮未停止任何在跑资源）。
- 端口纪律：A 测试内核在 48100–49100 随机段（`test/utils.mjs`，撞口自动换口）；与其他路无固定段冲突。

## 3. 给消费方的对接要点

- **Edge（04）**：代理 `POST /api/v2/assessments/:id/confirm-preassessment` 与 `GET /api/v2/assessments/:id/candidates`；凭据服务端保管；客户归属从权威上下文确定。确认交互必须绑定 `assessmentVersion + candidateRevision`，收到 `VERSION_CONFLICT` 按 `serverVersion/serverCandidateRevision` 刷新重试。
- **Front（02）**：确认后展示 `scope=preassessment_only`；`preassessment.needsReview=true` 时显示"需复核"，不得展示为额度批准；绿=工作完成，结论看 `outcome`。
- **Gate 硬门（D-03 修复后）**：客户最新 Gate 回执非 `CLEAR`（HARD_BLOCK/NEEDS_EVIDENCE/HOLD_FOR_REVIEW）时正/附条件确认返回 409 `GATE_BLOCKED`（extra 含 `gateReceiptId/gateResult/ruleIds/reasonCodes`）；回执规则版本已换版 → 409 `STALE_BASIS`（须 03 链按当前规则重新收口后重试）。负面结论（not_support）不受该门约束。前端应把 `GATE_BLOCKED` 展示为"冻结/待重新收口"，不是系统故障。
- **首次回租需求（契约 §12，迁移 014）**：`createAssessment` 可选 `request`（产品恒 sale_leaseback + 申请金额/用途/设备范围，客户表述）；创建后经 `POST /assessments/:id/admission-request` 修正（business/credit + `assessmentVersion` 乐观锁；整块替换；结论确认后冻结）。读回 `request{...}` + 顶部镜像 `requestedAmountMinor`——**Edge admission-projection 既有 `assessment?.requestedAmountMinor` 读取零改动即取到值**；未登记时仍 null（页面待补）。需求登记绝不产生融资申请（PA-18 账本断言）。
- **验收（04）**：T09/T10/T11/T12 的机器断言样例见 PA 套件；账本零变化断言可直接复用 `ledgerSnapshot()` 思路（整表前后比对）。

## 4. 遗留与边界（如实）

1. **评估级 stale 的恢复路径沿用既有语义**：快照工件被取代后 `stale=true`，候选不得再提交（原语义"重建快照后重评"=新建评估）。本轮未新增"同评估换快照"命令——如集成后发现 03 页面需要，走 interface-change-request，不在本轮擅自扩。
2. **inputVersion 的历史值从 0 起**：迁移不推定历史评估的输入版本（回填 candidate 历史行 input_version=0）；只有本轮之后的取代事件才 +1。
3. **负面结论（not_support）允许在事实冲突/stale 下记录**：这是契约 §2.2 第 9 条的明确设计（依据冲突可作为负面理由入档），不是缺陷；正面结论被同一冲突阻断已由 PA-04 断言。
4. **真实模型、价格口径、机构政策**：未获本轮授权，未调用、未配置、未编造；候选的 `priceBasis` 只是调用方自报的口径文本。
5. **性能**：confirm 单评估事务（行锁+快照 FOR SHARE+两个聚合查询），未做专项压测；与既有 decide 同量级。
6. **20 格投影、Edge 聚合、Front/dist**：他路范围；本路未改 Front，`Front/dist` 无需因本路改动重建。

## 5. 缺陷响应承诺

04 集成发现的 A 域缺陷：在本路 ownership（`Back/A/**`、`Back/CONTRACT.md`）内修复并定向复测，结果补录本目录；跨域分歧按仓库约定写 interface-change-request，不代写他路。
