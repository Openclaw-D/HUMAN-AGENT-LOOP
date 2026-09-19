# 任务03 · CURRENT_STATE（权威查询与授权支撑）

更新：2026-09-19。基线：`main@8dcef63`（与本轮启动时工作区 HEAD 一致；dirty 项均为根文档与其他任务的未跟踪文件，本任务未触碰）。writer 范围：`Back/A/**`、`Back/CONTRACT.md`、`docs/v02-remediation/task-03/**`。

## 本轮已交付（代码全部落在 Back/A/**，共享契约升级至 §12）

1. **权威清单（IR-03-A ② 已交付，A 侧完成）**：
   - `GET /api/v2/customers/:id/assessments`、`GET /api/v2/customers/:id/financing-requests`：租户/grant/角色过滤、键集分页（游标仅基于业务 id）、排序=id 降序、单件 GET 同一投影。迁移 `011_authoritative_reads.sql`（两条排序索引，只新增）。
   - 单件读同权收紧：客户联系人身份对评估/融资申请的单件与清单读一律 403（B13 some 口径；越权仍统一 404）。
2. **目录搜索统一**：`?search=` 现在匹配名称/customerId/legal_entity_ref（ILIKE）；授权过滤先行。前端"按名称/标识搜索（回车）"的宣称由此成立。
3. **材料处理引用**：`GET /api/v2/customers/:id/artifacts` 每件新增 `processing` 投影（additive）。
4. **五项风险复验**（真实 PG 反例，`test/risk-recheck-task03.test.mjs` 11/11）：结论与契约引文见 CONTRACT §12.4。两条"反例"如实断言（Gate 回执输入不绑定；冻结后豁免撤销不追溯），已升级为待裁决项而非静默放行。
5. **IR-03-A ③（事件提交序/水位）**：分析后本轮不交付根修（bigserial 回滚永久缺口使"已提交水位"不可靠推导；根修=提交时分配，含全事务串行点代价）。A 侧零改动，结论登记 CONTRACT §12.5。
6. **测试**：新增 `test/authoritative-reads.test.mjs`（6 用例：分页边界/排序/授权矩阵/搜索/处理引用/内部读回归）与 `test/risk-recheck-task03.test.mjs`（11 用例）。**全量回归 149 项 → 148 pass / 0 fail / 1 skip**（skip=容器重启用例按边界守卫）；typecheck 0 error。A22 迁移清单断言按惯例适配 001–011。

## 尚未完成 / 依赖他人

- Edge 侧切换权威清单并移除 `refsExhaustive=false` 标注（03 路消费动作，A 已交付接口）。
- 目录搜索的 UI 复测（页面旅程）需前端联调；A 侧仅 API 级实测。
- 待裁决项 P-03a/b/c/d（见 POLICY_PENDING.md）需用户/Codex 裁决后才动代码。
- 联合验收：本文件所列测试均为 A 包独立实测；跨路联调（Edge 快照切换、Connectors 消费契约）未跑。

## 运行资源

- 测试容器 `jw-t03-pg`（postgres:16，127.0.0.1:15461，库 jwt03，卷 jw_t03_pgdata，本任务登记的隔离资源；未清空/未触碰既有容器）。回归后已按惯例 `docker stop`；复跑测试前 `docker start jw-t03-pg`，然后：`JW_A_ADMIN_DB_URL='postgres://jwt03:jwt03-local-demo@127.0.0.1:15461/postgres' node test/run-all.mjs`（在 Back/A 下）。
