# goal-01 · 测试结果（TEST RESULTS）

日期：2026-09-17。全部数字为本地实跑记录（非转抄历史）；日志存 `evidence/`。

## 1｜命令与入口

```bash
cd Back/A
npm run typecheck        # tsc --noEmit → 0 错误
# 隔离容器（本任务自有；crash 用例也指向它，不受其他会话共享容器活动干扰）
export JW_A_ADMIN_DB_URL='postgres://goal01:goal01-local@127.0.0.1:15446/postgres'
export JW_A_TEST_PG_CONTAINER='jw-goal01-pg'
export JW_A_TEST_PG_ISREADY='docker exec jw-goal01-pg pg_isready -U goal01'
node test/run-all.mjs    # 串行全量回归；测试库自动建删
```

## 2｜结果总览

| 轮次 | 范围 | 数量 | 日志 |
|---|---|---|---|
| 基线（改动前，HEAD=1ec0ee4） | 全量（共享容器 jw-cc-kernel-pg，当时空闲） | **102/102 pass / 0 fail / 0 skip**（含容器重启用例真实通过） | `evidence/baseline-tests-20260917.log` |
| A1 后（G2 设备对象匹配） | 全量 | 107/107（102 + 5 新增 G2） | `evidence/a1-full-regression-20260917.log` |
| A2 后（G1 豁免登记制） | 全量 | 114/114（102 + 5 G2 + 7 X） | `evidence/a2-full-regression-20260917.log` |
| A3 后（性能优化） | 全量 | **114/114 pass / 0 fail / 0 skip** | `evidence/a3-full-regression-20260917.log` |
| 单套复核 | decision-loop 15/15；customer-credit 24/24；ledger-races-a3 7/7；evidence-object-match 5/5；domain-exemptions 7/7 | 全绿 | 同上日志 |

## 3｜新增测试（goal-01 本轮 12 项）

### 3.1 `test/evidence-object-match.test.mjs`（A1；不变量 4；验收清单"错设备材料"）
- **G2-1** 错设备材料作为答案引用 → 409 `EVIDENCE_OBJECT_MISMATCH`，核验项状态不变；
- **G2-2** 自动核验项：未锚定材料不满足对象锚定（保持 waiting_evidence）；对象匹配材料经晚到登记 → verified；
- **G2-3** 晚到错设备材料不重开锚定项；收口保持 pending_evidence 不当作通过（end 转待办 deferred 语义保持）；
- **G2-4** 未锚定项与人工核验路径行为不变（存量语义回归护栏）；
- **G2-5** 拒绝响应零写入（会话版本/核验项/问题全不变）。

### 3.2 `test/domain-exemptions.test.mjs`（A2；不变量 2；验收清单"假豁免"）
- **X1** 自报 approvedBy/domain 的 exemptions[] → 400，无登记即形成豁免的路径被封死；
- **X2** 矩阵无 `domain-exemption.grant` 条目 → POLICY_PENDING（拒绝零写入）；有档 approver 登记成功（批准人服务端解析）；
- **X3** 有效豁免 → 包引用后该域 required=false（无域结果也 ready）；冻结进包的批准人=服务端登记 principal、政策版本随包冻结；
- **X4** 撤销后新包引用被拒（POLICY_PENDING）；已冻结历史包不受影响（不改写历史）；
- **X5** 过期豁免登记即时拒绝；短时效豁免到期后引用被拒；跨客户引用统一 404 不泄露存在性；
- **X6** not_applicable 引用制：自报 waiverRef → 400；范围不覆盖 → POLICY_PENDING；scope=any 有效豁免关闭成功且 resolution 冻结服务端批准人（DB 校验）；
- **X7** 有目录角色但无矩阵条目的角色撤销 → POLICY_PENDING，豁免保持 valid。

## 4｜验收清单覆盖对照（目标 §六）

| 验收场景 | 覆盖 |
|---|---|
| 同申请不同 requestId 并发 | perf C2b（1×200+11×409、恰 1 账目）+ ledger-races-a3 K12 |
| 不同申请共同占额 | perf C1（桶守恒断言）+ K13/A07/A24 |
| 重复与异载荷重放 | K02/K02b/A08/A09/A11 + perf C2a |
| 撤权 | K01/K03（principal_customer_grants 撤销即刻生效；重放不借缓存） |
| 假豁免 | **本轮新增 X1–X7**（自报豁免全部拒绝；真实登记/撤销/过期/范围语义） |
| 旧 Gate | K06/K10（GATE_HOLD_FOR_REVIEW 缺口、GATE_STALE_RULES 换版失效） |
| 检查退回复核 | inspection-contract/orchestration/closure 18 项（A01–A12）+ K05（假收口引用 404） |
| 晚到分析 | K08/K09（晚到结果保留并标失效不重新盖章；非完成运行不满足必需域） |
| 错设备材料 | **本轮新增 G2-1..G2-5** |
| 规则换版 | K10（旧意见/Gate 仅适用域失效；无关域不滥重算） |
| 提额绕行 | K17/K18（客户级在途唯一/次数窗口/实质新证据/冷却不冻结既有用信；换业务员不可绕行） |
| 未知出账 | K14/A12（unknown 不动桶、禁直接释放、唯一对账出口 confirm-external + 矩阵权限） |
| 重启恢复 | integration-crash（SIGKILL 内核重启 + 容器重启，本轮 env 指向自有容器真实通过）+ A22 迁移中断/重复运行 |

## 5｜测试设施改动（Back/A 所有权内）

- `test/utils.mjs`：startKernel 端口碰撞自动重试（EADDRINUSE 换口重试，≤3 次；碰撞源=本机其他会话常驻服务，如 Edge 面板@48200）。
- `test/inspection-utils.mjs`：registerArtifact 助手支持可选 objectRef（G2 测试用）。
- `test/customer-credit.test.mjs`：A22 迁移清单断言更新为 001–008、schema_migrations 计数 7→8（迁移 008 为本轮新增对象）。

## 6｜环境性干扰记录（如实）

jw-cc-kernel-pg@15444 为多会话共享容器：本轮执行期间检测到其他会话的进程（goal03 perf、E1 套件、另一 run-all 实例）并行活动，期间该容器发生 2 次外部触发的 fast-shutdown 重启，造成一次 A22"连接被管理员终止"假失败与一次 B08 假失败（各自单跑复验即绿）。此后全量回归改在本任务自有容器 jw-goal01-pg@15446 上执行并稳定全绿。此为环境记录，非代码缺陷；不掩盖、不改预期。
