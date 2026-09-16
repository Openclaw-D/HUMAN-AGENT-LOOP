# S5 · 备份/恢复演练 runbook 与回滚边界（任务04 §7）

状态：**本机隔离演练已执行 PASS（2026-09-16，12/12 步）**；正式环境/staging 演练需获准环境与授权（E2/E3 门），另行执行。
自动演练脚本：`Back/Edge/scripts/backup-restore-drill.mjs`（零依赖，一条命令可重复）。
证据：`docs/customer-next/acceptance/evidence/s5-drill-*/drill-result.json`。

## 1. 演练范围与判据

| 项 | 内容 |
|---|---|
| 环境 | D 路同款自有隔离容器：`v7d-pg-` 前缀、端口 15434、数据目录 `Back/Edge/.run/drill-pg`；绝不触碰 `v7next-a-pg`、`jw-v01-pg`、Dify 等其他容器/卷 |
| Schema | 应用 `Back/A/migrations/001_init.sql`（已冻结版本；002 尚在任务01 writer 手中，演练不依赖在制品） |
| 数据 | 全部合成（`drill-*` 命名，12 张表：模板/项目/目标/证据/任务分配/人工待办/执行回执/审计/outbox/订阅/投递簿/幂等） |
| 周期 | 建库 → 迁移 → 灌数 → 逐表行数+全行 md5 指纹 → `pg_dump -Fc` → **DROP DATABASE（模拟损毁/误删）** → 重建空库 → `pg_restore` → 指纹比对 → 容器销毁 |
| 判据 | 恢复后 12 表行数与全行指纹与备份前**逐表一致**（ALL_MATCH）；步骤任一失败 verdict=FAIL |
| 本轮结果 | **PASS**，12/12 步；dump 留存 `Back/Edge/.run/drill-backup-*.dump`（Git 排除，不入公开仓库） |

## 2. 运维 runbook（正式库适用于 jw-v01-pg / 后续客户授信库）

```bash
# 备份（自定义格式，含压缩；在库运行时执行）
docker exec jw-v01-pg pg_dump -U jw -Fc jw > backup/jw-$(date +%Y%m%d-%H%M%S).dump

# 校验备份可读（列出目录，不恢复）
docker exec -i jw-v01-pg pg_restore -l < backup/jw-<stamp>.dump > /dev/null && echo OK

# 恢复（目标库须为空库或先 DROP；pg_restore 不做"合并"）
docker exec -i jw-v01-pg pg_restore -U jw -d jw --no-owner --clean --if-exists < backup/jw-<stamp>.dump
```

演练频率建议：每次不可逆迁移发布前、每次版本发布前各一轮；脚本化判据（指纹比对）不得人工"目测通过"。

## 3. 回滚边界（任务书 §7 原则的落地说明）

1. **代码回滚 ≠ 数据库回滚**。Git revert 只还原代码；已提交的业务事实（客户消息、录制、授信记录、outbox/审计）在库与备份中，必须保留。
2. **可逆迁移**：新增表/可空列 → 回滚代码即可，旧代码忽略新对象。
3. **不可逆迁移**（删列/改约束/改类型）：禁止依赖"回滚迁移脚本"；发布前必须有**向前修复（forward-fix）方案**——即在新代码内兼容旧数据形态，或出具数据迁移脚本并在隔离环境演练通过。任务01 的 `002_customer_credit.sql` 冻结时须按此复核（当前该文件为在制品，本演练未依赖）。
4. **外部副作用不可随回滚消失**：已发送的客户消息、已发起的外部请求、已预占的额度不因代码/库回滚而撤销；撤销须走对账与正式人工动作。
5. **停服不删卷**：停止脚本/回滚流程一律不删除数据卷；`docker rm -f` 仅允许作用于 `v7d-` 前缀的自有演练容器。

## 4. 遗留门

- staging/真实租户环境的备份恢复演练与备份加密/留存期限策略：BLOCKED（需获准环境与合规授权）。
- 对象存储（录制/材料）的备份一致性演练：BLOCKED（任务02 对象存储未落地）。
- 演练脚本当前只覆盖 PostgreSQL 逻辑备份；物理备份/WAL 归档属部署形态决策，未在本轮范围。
