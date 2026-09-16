# 客户授信内核 v2（任务01 实现）· 运行与设计说明

实现依据：`docs/customer-next/S1_CREDIT_DOMAIN_ADR.md`（D1–D10）、`S1_API_V2_SCHEMA_PROPOSAL.md`、`S1_MIGRATION_AND_COMPAT.md`。实现范围 `Back/A/**`；`/api/v1/**` 行为零改动（48/48 回归见 §5）。

## 1. 新增组件

| 文件 | 内容 |
|---|---|
| `migrations/002_customer_credit.sql` | customers / customer_relationships / evidence_artifacts / fact_assertions / credit_assessments / credit_facilities / financing_requests / exposure_entries / decision_records / permission_matrix / v2_idempotency；`projects.customer_id` 可空列；`outbox_events.customer_id` 列。不种子任何权限矩阵行（fail-closed） |
| `src/domain/credit.ts` | v2 全部命令、作用域幂等、账本推导、锁序、矩阵/集中度/依据复查 |
| `src/http/server.ts` | `/api/v2/**` 26 条路由 |
| `src/config.ts` | principal 第 5 段租户范围；`--credit-cap-minor`（默认 1e9 分=1,000 万元）、`--credit-matrix`、`--credit-concentration`、`--credit-group-cap-minor` |

## 2. 关键机制（与测试映射）

- **并发防线（A07/A14/A24）**：所有客户域写命令按固定锁序 `customers FOR UPDATE → credit_facilities FOR UPDATE → evidence_artifacts FOR SHARE`；审批的依据复查用 FOR SHARE 与工件 supersede 的 FOR UPDATE 互斥，封闭"检查后提交前被取代"竞态（A15）。
- **作用域幂等（A08/A09/A11）**：`v2_idempotency(scope_hash, request_id)`；scope = sha256(tenant|principal|action)；载荷哈希含 body + 路径资源（`__path` 由 HTTP 层注入；v1 哈希显式剔除 `__path`，行为不变）。并发重放在锁内二次复查，命中返回原效应。
- **账本（D4）**：`exposure_entries` 追加式；桶推导 reserved/committed_undisbursed/outstanding = 账目净和，不是可覆盖字段。非循环（默认）`available = approved − lifetimeDisbursed − committed − reserved`（还款不恢复，A17/P-02）；循环额度还款恢复。`over_limit` 如实显示超额（A16）。
- **惰性过期（A12）**：仅 `external_state='none'` 且仍 reserved 的预占可自动过期；unknown/已承诺绝不自动清理，唯一退出路径是矩阵授权的 `confirm-external`（confirmed / release_after_review，均写 DecisionRecord）。
- **正式权限（S4/P-05）**：批准/激活/暂停/降额/对账确认必须人类 principal + `permission_matrix` 激活版本中有 allowed 条目（金额档可选）；矩阵未配置或无条目 → 409 `POLICY_PENDING`。jianwei 无任何默认额度权限。载荷角色声明一律无效（A19）。
- **评估/候选（A18/A21）**：候选走严格字段白名单（tendency/supportableAmountMinor/currency/conditions/rationale/producedBy/warnings），`authority` 字段禁入、服务端强制存储 `authority:"none"`；agent 可产出候选，但无任何正式命令通道。评估的正式决定只有 reject/withdraw；批准走额度命令通道。rejected 评估不可提案（A21）。
- **证据（A04/A20）**：同客户同内容重复提交 → `duplicate_of` 关联首件，不产生新证明力；评估快照按工件去重。发票/合同并存，同事实键多断言显式报 `factConflicts`；只有显式 `supersedes`（且内容不同）才取代，并按依赖映射把引用评估标 `stale`（阻断批准与新增支用）。
- **租户隔离（A10）**：principal 目录第 5 段租户范围；行级校验失败统一 NOT_FOUND（不泄露存在性）；v2 回执按 (tenant, principal) 归属过滤。

## 3. 与 S1 提案的实现差异（已定案）

1. `facility.activate` 承载两种语义：`approved_inactive→active`（首次激活）与 `suspended→active`（人类复核后恢复）——S1 状态图未定义 suspended 出口，此处补齐（A14 需要恢复路径）。
2. 领域不变量（币种/产品上限/客户合计上限/集中度）先于矩阵权限检查：上限不是权限问题，任何档位都不能批准超限额度（A06 语义）。
3. 集中度合计排除当前设施自身（提案行已在表内，避免双重计入）。
4. `decideAssessment` 仅接受 reject/withdraw；"批准"是额度通道的 `facility.approve`（拒绝是评估决定，不存在"被拒额度"）。
5. 正式动作金额档与产品上限独立：合成开发矩阵档位=产品上限；生产矩阵由公司批准录入后两者可不同。

## 4. 运行

```bash
# 隔离数据库（本任务自有容器；不触碰 v7next-a-pg@15432 / jw-connectors-pg@15443 / jw-v01-pg）
docker start jw-cc-kernel-pg   # postgres:16, 127.0.0.1:15444, db jwcc, 卷 jw_cc_kernel_pgdata

export JW_A_ADMIN_DB_URL='postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/postgres'
export JW_A_TEST_PG_CONTAINER='jw-cc-kernel-pg'
export JW_A_TEST_PG_ISREADY='docker exec jw-cc-kernel-pg pg_isready -U jwcc -d jwcc'
npm run typecheck
node test/run-all.mjs            # v1 回归 23 + A01–A24 + 属性测试 = 48
```

内核启动示例（v2 合成政策；matrix/concentration 未配置时正式动作一律 policy_pending）：

```bash
node src/index.ts --port 48280 --db postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/jwcc \
  --credit-matrix matrix-dev-synthetic-1 --credit-concentration conc-dev-synthetic-1 \
  --principal-tokens "tok-biz1=biz1:human:business:all:t1,..."
# 权限矩阵行本身由公司批准后经受控流程写入 permission_matrix 表；测试插入的是合成开发矩阵
```

## 5. 验证记录（2026-09-17）

- `npm run typecheck`：0 错误。
- `node test/run-all.mjs`（隔离容器 + 参数化 env）：**48/48 pass / 0 fail / 0 skipped**，含 v1 全部回归（crash 容器重启用例指向 jw-cc-kernel-pg）与 v2 24 场景 + 固定种子属性测试（seed=20260917，120 步随机序列，逐操作对照模型，无失败序列留档——全过）。
- 已知不在通过范围：真实业务规则/生产身份/资金接口（P-03/05/07 safe default 生效）；A 全量对 15432 旧容器的历史假设已参数化但旧容器本身未触碰。
