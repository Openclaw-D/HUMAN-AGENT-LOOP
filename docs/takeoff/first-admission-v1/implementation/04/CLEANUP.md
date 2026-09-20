# 路04 清理记录 · 2026-09-20（第一轮）

边界：仅本路所有权（Back/Edge/**、Back/D/**）内**未跟踪且被 .gitignore 排除**的冷运行态。未删任何 Git 跟踪文件、未动凭据/安全设置、未动在途进程（`.run/delivery/` 由 48210 旧 Edge 实例在用，完整保留）。

## 删除清单

删除前逐一固化清单 hash（相对路径+字节数排序后 SHA-256，全文见 `Back/Edge/.run/takeoff/cleanup-manifest.txt`）。共性理由：均为旧轮测试/性能运行的临时 PostgreSQL 数据目录（`initdb` 本地 pgdata），已被各自套件登记为一次性运行态（.gitignore `**/pgdata/`），删除时经核对（无本地 postgres 进程、无容器挂载、无在途 PID 引用）。恢复方式：重跑对应套件即可再生（见各行）。

| 原路径 | 规模 | manifest-sha256（前8位） | 恢复方式 |
|---|---|---|---|
| Back/D/evidence/adhoc/pg-selftest/（整目录，仅含pgdata） | 69MB/1570文件 | e945c0da | 重跑 Back/D/suites/g0_runner_selftest.test.mjs |
| Back/Edge/.run/perf-d1-r{1,2,3}/pgdata | 各73MB | aa66a004/5a9ed2f2/062368f8 | 重跑 goal-01 perf 套件（perf-g04.mjs/d3臂） |
| Back/Edge/.run/perf-d2-r{1,2,3}/pgdata | 各74MB | e4116346/39aca520/df9e4e67 | 同上 |
| Back/Edge/.run/perf-d3-r{1,2,3}/pgdata | 各74MB | ac5388e1/2367af59/806b9b3a | 同上 |
| Back/Edge/.run/g04-fullchain/pgdata | 73MB | 4ab95ffe | 重跑 test/e1/e1-g04-fullchain.test.mjs |
| Back/Edge/.run/drill-pg/pgdata | 72MB | 86aba3b0 | 重跑备份恢复演练（backup-restore-drill.mjs） |
| Back/Edge/.run/drill-v2-pg/pgdata | 73MB | 56a3047b | 重跑 backup-restore-drill-v2.mjs |
| Back/Edge/.run/e1-d02-pg/pgdata | 71MB | 372440af | 重跑 test/e1/e1-d02-real.test.mjs |
| Back/Edge/.run/e1-d03d05/pgdata | 72MB | e3e0bbed | 重跑 test/e1/e1-d03-d05-real.test.mjs |
| Back/Edge/.run/task3-e2e/pgdata | 72MB | 8e14e03c | 重跑 test/e1/e1-task3-scenario.test.mjs |
| Back/Edge/.run/task3-inspect/pgdata | 72MB | df30d63d | 重跑 test/e1/e1-task3-inspection.test.mjs |
| Back/Edge/.run/task3-m4probe/pgdata | 72MB | 436b598e | 重跑 perf-m4-probe.mjs |
| Back/Edge/.run/task3-perf/pgdata | 72MB | 8e793c1c | 重跑 perf-baseline.mjs |
| Back/Edge/.run/task3-probe/pgdata | 55MB | a172c1cd | 重跑对应 probe 套件 |
| Back/Edge/.run/task3fix-selfcheck/pgdata | 19MB | c71cd22d | 重跑对应自检套件 |

合计释放 ≈1.44GB。各运行目录内的 kernel.log、edge.log、result.json 等**全部保留**（旧轮结论性痕迹，KB级）。

## 保留（含理由）

- `Back/Edge/.run/delivery/`：旧任务04轮 delivery-up 登记 + 48210 在跑实例的 messages 持久库——在途资源，不动。
- `Back/Edge/.run-g03c/ .run-g03e/`、`.run` 根部散日志：KB级旧轮痕迹，保留。
- `Back/Edge/config/{g03c-auth,g03c-runtime,g03d-conn-token*}.json/txt`：旧轮合成测试凭据，纪律禁止为清理动凭据。
- `Back/Edge/test/**` 全部既有套件（s1/s3/t4/g03*/e1）：Edge 传输/安全语义与业务回归仍在用；TAKEOFF 快照期按 05 §4 做定向回归，不做预先删减。
- `Back/D/{README,STATUS,RESULT,DEFECTS,ACCEPTANCE_MATRIX}.md`、`evidence/g04-*`、`suites/harness` 等 Git 跟踪文件：历史验收证据与可复用测试，属业务历史，不删。
- `JW_product_delivery_four_tasks/` 的删除与 `TAKEOFF_First_Admission_v1.0.0/`、`docs/takeoff/` 的未跟踪状态：文档对齐轮产物，非本路所有权，不还原不扩大。

## 前三路清理证据归集

待收口阶段归集（implementation/01、02、03 尚未建目录）。02路 INVENTORY 已列出 Front 待退休清单（home-overview 训练分支等）， retire 动作未执行；01/03 无记录。收口时以各路 implementation 目录内清理记录为准归集进本包 CLEANUP_LOG.md。
