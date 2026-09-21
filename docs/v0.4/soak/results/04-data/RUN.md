# V0.4 长程测试 04-DATA · 运行入口（RUN.md）

包任务书：`docs/v0.4/soak/04_DATA.md`（材料处理、PostgreSQL 与存储稳定性）。
本文件是本包唯一运行入口；结果目录 `docs/v0.4/soak/results/04-data/`；运行产物 `.local/soak-v04-data/`。

## 前置条件

- Docker（本包专用容器 `jw-v04soak-data-pg`，127.0.0.1:25511，postgres:16-alpine，POSTGRES_USER=soak04/POSTGRES_DB=cnext，max_connections=200）。启动：
  `docker run -d --name jw-v04soak-data-pg -p 127.0.0.1:25511:5432 -e POSTGRES_USER=soak04 -e POSTGRES_PASSWORD=soak04 -e POSTGRES_DB=cnext postgres:16-alpine postgres -N 200`
- Node ≥22。不读取/不依赖共享容器、.env、真实凭据或客户数据；零真实外部出站（A=本地可计数替身；企微=FakeWecomTransport）。

## 一条运行入口

```bash
cd Back/Connectors
SOAK04_SCALE=1 SOAK04_RUN_DIR=C:/Users/22673/Desktop/JW/.local/soak-v04-data \
  node test/soak-v04-data/driver.mjs
```

- 驱动自包含：等待 PG 就绪 → 重置本包 schema/对象目录（仅本包专用容器）→ 装配真实 compose+HTTP 服务（端口系统分配，绑定 127.0.0.1）→ 本地 A 替身 → 邀请/金丝雀准备 → 现有 PG 回归（goal02-parsing、goal02-blocked-recovery、upload-context.pg、v03-evidence-pg；指向本包容器）→ 基线 26min → 爬坡 4 档（1→2→4→8 worker，各 36min，内嵌 4×PG 短暂断连 + 4×worker SIGKILL + A 替身 slow/down 窗口）→ 收尾 70min 稳定窗 → 写 `results-summary.json`。
- 仅跑现有回归（不跑长测）：`node test/soak-v04-data/run-regressions.mjs`
- 烟雾自检（~12min，验证 harness 本身）：`SOAK04_SMOKE=1 SOAK04_SCALE=0.002 SOAK04_SKIP_REGRESSION=1 SOAK04_RUN_DIR=.../.local/soak-v04-data-smoke node test/soak-v04-data/driver.mjs`
- 优雅停止：写 `.local/soak-v04-data/control.json` 内容 `{"stop":true}`（当前相位结束即收口，报告如实标注未完成部分）。

## 可调环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| SOAK04_RUN_DIR | `<repo>/.local/soak-v04-data` | 运行产物目录（对象/事件/指标/心跳） |
| SOAK04_PG_PORT | 25511 | 本包 PG 端口 |
| SOAK04_SCALE | 1 | 全部相位时长缩放（<0.05 自动启用 smoke 速率补偿） |
| SOAK04_DOCKER_CONTAINER | jw-v04soak-data-pg | 故障注入目标容器（仅限本包资源） |

## 文件清单

- `test/soak-v04-data/harness.mjs` — 配置/可复现随机/fixtures（正常、空、同 hash 重复、损坏/截断、扩展名不符、受限大小 ~0.9MB、敌意 ZIP 静态安全夹具）/本地 A 替身（requestId 幂等+回执+故障模式 normal|slow|down|err500）/不变量检查。
- `test/soak-v04-data/worker.mjs` — tick worker：真实 compose+coordinator；心跳（RSS/heap/事件循环滞后/tick 错误/崩溃信号计数）；uncaught 捕获保活并记栈（产品行为信号，不静默）。
- `test/soak-v04-data/driver.mjs` — 编排：相位引擎、上传/读混合、终态监视与错误分类、故障注入、60s 采样+5min 聚合、宿主资源守护（低内存/磁盘/CPU 自动降载）、不变量核查（每次故障恢复后+档界+收尾）。
- `test/soak-v04-data/run-regressions.mjs` — 现有关键 PG 回归 runner。

## 产物映射

- `.local/soak-v04-data/results-summary.json` — 汇总（本包 RESULTS.json 的数据源）
- `events/events.jsonl`（轮转）— 全部结构化事件：上传分类/终态/故障起止/恢复/不变量判定/worker 生命周期/崩溃栈
- `metrics/metrics-1min.jsonl`、`metrics-5min.jsonl` — 资源与吞吐采样
- `regression-results.json`、`status/worker-*.json`、`objects/`、`driver-console.log`

## 边界与纪律

- 白名单修复仅限 `Back/Connectors/src/store/pg.mjs`、`src/objectstore/fs.mjs`、`src/processing/coordinator.mjs`；测试/脚本独占 `Back/Connectors/test/soak-v04-data/`。
- 不改 schema/HTTP 入口/授权模块/Edge/A/真实材料；不做 Git worktree/commit/push/切分支；不重启共享服务；故障只施加于本包容器与本包 worker。
- 上限：单请求 30s、并发 8、平均请求速率 ≤5req/s、内存 1GB、数据+日志 1GB、材料元数据 ≤1000、事件 ≤10000。
