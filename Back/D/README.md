# D路：V7后端独立黑盒验收与故障恢复（2026-09-16 夜间批次）

只写 `V7/backend-next/D/**`；A/B/C/CONTRACT.md 只读。被测对象（SUT）由 A 发布固定版本，D 用独立客户端 + 预先判据验收，不解析 A/B/C 自报 PASS 文本。

## 快速开始

```bash
cd V7/backend-next/D

# 1) 框架自检（不依赖A/B/C；应全过 exit 0）
node suites/g0_runner_selftest.test.mjs

# 2) A发布CONTRACT+固定版本后：填 D/config/sut.json（模板见 config/sut.example.json）

# 3) 全矩阵（起 D自有PG容器+D自有子进程SUT → 跑全部套件）
node harness/run-all.mjs <runName>

# 单套件 / 单测（定向复测，不整轮空转）
D_SUITES=g4 node harness/run-all.mjs <runName>
D_ONLY=D-08 D_SUITES=g2 node harness/run-all.mjs <runName>
```

退出码：0=全过且断言≥1；1=有FAIL；2=套件/runner崩溃；3=零断言不得PASS。

## 判定语义（对全部套件生效）

- 每测有超时（默认120s）、断言计数；异常=FAIL；suite异常非零退出。
- BLOCKED 留门（前置缺失，如A未发布/transport不可用），不计FAIL但必须写入 RESULT 剩余门。
- 故障注入只作用于 D 自己创建的子进程/容器/目录（`v7d-` 前缀容器、15432段端口、`D/.run/` 数据目录、`D/evidence/<run>/` 日志）。

## 目录

- `ACCEPTANCE_MATRIX.md` — 29项外部可判定判据（含严重度/owner/依赖）。
- `harness/` — runner、独立HTTP客户端、自有子进程管理、自有PG容器管理、凭据泄漏扫描、SUT生命周期（sutctl）、版本冻结（freeze）、套件编排（run-all）。
- `suites/` — g0框架自检 + g1..g9 按矩阵分组。
- `evidence/<run>/` — result.json、日志、SUT_VERSION.json（固定hash）、泄漏扫描报告。
- `STATUS.md` / `RESULT.md` — 当前状态与最终汇总。

## 恢复

- 杀残留SUT：仅 `D/harness/proc.mjs` 跟踪的进程；若异常中断，按 `evidence/<run>/sut-*.log` 中的命令行人工确认后处理。
- 遗留自有PG容器：`docker rm -f v7d-pg-<runid>`（绝不动无 v7d- 前缀容器）。

## 结论分级（写进 RESULT.md）

模拟工程链路（本机合成凭据+mock transport）/ 真实provider未测（本轮0真实调用）/ 生产权限未测 / 第二机器未测。
