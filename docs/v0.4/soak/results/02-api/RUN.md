# V0.4 长程测试 02_API 包 · 运行入口（RUN.md）

契约：`docs/v0.4/soak/02_API.md`（API稳定性、吞吐与延迟：只读 API 长时分页/增量刷新/重连性能与权限一致性）。

## 唯一运行入口

```bash
# 全序列（P1→P7，约 4 小时 10 分钟有效长测）
node Back/Edge/test/soak-v04-api/driver.mjs --plan full --run-dir .local/soak-v04-api/run

# 单相位（调试/复验；P1..P7，--minutes 可覆盖时长，--fresh-copy 修复后重拷源码快照）
node Back/Edge/test/soak-v04-api/driver.mjs --phase P1 --run-dir .local/soak-v04-api/run
```

前置：功能矩阵回归（相位前深断言，约 15s）

```bash
cd Back/Edge && node --test --test-concurrency=1 test/soak-v04-api/matrix.test.mjs
```

## 相位计划（默认时长，有效长测合计 250 分钟 ≥ 4 小时）

| 相位 | 时长 | 并发 | 内容 |
|---|---|---|---|
| P1 | 25min | 1 | 低载基线：全端点采样、p50/p95/p99、资源趋势 |
| P2 | 30min | 2 | 混合负载：晚到/重复事件、同ID回执终态、复合游标走读 |
| P3 | 30min | 4 | 规模分页（10/1000/10000 首末续页）、撤权窗口（翻页403/复权恢复） |
| P4 | 30min | 8 | 高并发：SSE 重连/长连接、慢客户端背压（resync）、主动断开 |
| P5 | 30min | 2 | 故障恢复：A 宕机/延迟超时/5xx 注入、Edge 优雅重启+硬杀（持久化+resync） |
| P6 | 40min | 4 | 持续混合轮换：场景矩阵补全（含客户受众、内部受众、GET零副作用连续抽查） |
| P7 | 65min | 2 | 收尾稳定窗：≥60min 无新非预期错误 + 关键数据不变量复验 |

## 配额执行（契约 §隔离与资源）

- 总速率 ≤5 req/s：驱动全局令牌桶 4.5/s（burst 5）；并发 ≤8；单请求 30s 超时。
- 长历史 ≤10000 事件（cust-a10000）、1000 材料元数据（cust-m1000）；单件 <1KB；日志轮转上限 20MB/文件。
- 端口系统分配、绑定 127.0.0.1；SQLite/回执/预算账本全部在 `.local/soak-v04-api/run/`（Git 排除区）。
- 外部模型出站 = 0；无真实模型/上传/审批/资金调用；恢复故障只施加于本包 fork 的 Edge 子进程与 driver 内 stand-in A。
- 宿主保护：可用内存 <2GB 或 <10% 自动降载（令牌桶 50%）；每 60s 采样宿主内存/CPU/磁盘。

## 替身边界（如实声明）

- **替身**：`Back/A 持久数据库 + PG` —— `test/soak-v04-api/standin-a.mjs`（driver 进程内内存 HTTP 上游），实现 A 只读端点形状（customer/events/exposure/decision-status/findings/object-inventory/artifacts/assessments/financing-requests、receipts 探针、inspections）与凭据 ACL、撤权、延迟/错误/停机注入。会话核实经真实 `createLiveCredentialVerifier`（对替身 A 探针）。
- **真实**：Edge 全链真实代码在隔离副本上运行（kernel-store、customer-activity、server 只读路由/鉴权/CSRF、session、message-store sqlite WAL、回执文件扫描、audit、proxy/readProxy），真实本地 HTTP。
- 真实 A + 隔离 PG 整链：本包未跑（真实 A 需容器化 PG 与业务命令造数，10k 事件历史无法经业务链快速构造；替身边界如实按契约声明，不宣称真实 A 整链长测通过）。
- 回执文件由 driver 按 assistant-receipts 落盘形状直写（真实模型调用不属本包授权，出站上限 0）。

## 结果物

- 状态/原始数据：`.local/soak-v04-api/run/state/`（results.json、windows-*.jsonl、host-metrics.jsonl、edge-metrics.jsonl、driver-*.log）
- 交付：`docs/v0.4/soak/results/02-api/`（RESULTS.json、REPORT.md、DEFECTS.md、hashes）
