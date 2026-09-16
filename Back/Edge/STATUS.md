# Edge · STATUS

更新：2026-09-17（任务04 S1 全量 + S2 传输语义 E0 + S3 骨架 + S5 演练/S4 D25 轮）

## 契约核查（2026-09-17 多次复核；最近一轮要点）

任务 01/02/03 均未冻结，但进展显著：
- **01**：`Back/A/src/http/server.ts` 已出现约 30 处 `/api/v2/customers|facilities` 路由（在制品、仍在修改）；但 `Back/CONTRACT.md` 仍 v1.3、API v2 提案仍自标待冻结 → 契约未发布、实现未固定，E1 集成继续 BLOCKED（不抢先集成在制品）。
- **02 Connectors**：实现成形 + 自建 E0/E1 测试计划（自有 PG@15443）；其 E0 实测 5/5 PASS（显式文件清单；其 npm 脚本撞本机 `node --test <目录>` 已知怪癖）；跨 lane 契约未发布（docs/ 空）。
- **03 C**：四域 E0 面成形（four-domain.test.mjs 单独 27/27 PASS）；统一 runner 同跑时两个 four-domain 文件失败（套件干扰，C lane 事项）；无已发布接口变更。
- 以上为只读运行观察，非验收、不代修；触发条件不变：01 契约汇入 CONTRACT.md 且实现固定 → E1 集成。

## 已完成

- **S1 全量**：D01–D28 验收矩阵、版本封存协议与 CLI、liveness/readiness 拆分、端口/容器假设审计、安全启停、最小自检（Edge 27/27、D g0 8/8、D g1 4/4、A typecheck）。
- **S2 传输语义 E0**：SSE 至少一次 / Last-Event-ID / 游标过期 resync / 无权限零回放 / 404 不泄漏存在性（fixture store seam）。
- **S3 骨架与判据**：
  - 动作代理：固定上游 + 显式路由白名单（无任意 URL 代理）、会话→上游凭据服务端映射（浏览器伪造凭据头不透传、无会话 401 先于路由表披露）、requestId 必带不代生成、上游未知 502 回显原 ID 不自动重试（D13/D17 种子）。
  - 消息受众路由：customer/internal 分离，内部外发默认 403 AUDIENCE_MISMATCH 留审计，显式 confirmExternalSend 放行且审计记 confirmed，送达未知不标已读（D09 种子，守护进程实测）。
  - 审计 sink（只追加）与 `/api/jw/v2/audit` 只读面。
  - CSRF 守卫（本轮新增）：全部 POST 写路由先过 Origin/Sec-Fetch-Site 校验——同源放行、跨站/null origin/信号不一致一律 403 CSRF_ORIGIN_REJECTED、非浏览器客户端放行、staging 允许列表可配（D17 种子 E0 PASS，6 用例 + 守护进程实测）。
  - browser-harness 最小操作页（`Back/D/browser-harness/`，经 `/harness/` 同源提供，CSP+穿越防护）：客户切换防错绑、面板开合不重建媒体占位/订阅、requestId 重试演示、受众守卫演示、审计查看。
- **S4 D25（本轮新增）**：提交前公开提交扫描器（`scripts/public-submission-scan.mjs`，git 文件集 8153、文本扫描 6466）：HARD=0；REVIEW 40 项已人工分类全部良性（占位符/Achieve 历史大文件）；证据 `evidence/d25-scan-*/report.json`。
- **S5 备份恢复演练（本轮新增）**：`scripts/backup-restore-drill.mjs` 真实执行 PASS（12/12 步）：v7d- 隔离容器 → 001 迁移 → 12 表合成数据 → pg_dump → DROP 模拟损毁 → pg_restore → 逐表指纹 ALL_MATCH → 容器销毁；runbook 与回滚边界（代码回滚≠数据库回滚、不可逆迁移向前修复）见 `docs/customer-next/acceptance/BACKUP_RESTORE_DRILL.md`。
- 证据：`docs/customer-next/acceptance/evidence/`（version-seal / d25-scan / s5-drill）、`Back/D/evidence/s1-g1-jw/`。

- **E1 集成测试骨架（本轮新增）**：`test/e1/` 冻结门（CONTRACT≥v2 + 提案状态 + Back/A 实现固定 + docker 可达，四判据实时探测）+ E1-D02 真实变体（自有隔离 PG + 全部迁移 + JW 内核 17919 段 + Edge 真实探针；停库→live 保持/ready 翻转→恢复）。门未过时用例如实 SKIP 并打印原因（当前实测：skipped，原因=契约未发布+实现 11 文件在制品）；门过即一条命令可跑。D03–D05 真实变体待 v2 事件 API 冻结后补写（见 test/e1/README.md）。

- **性能基线（本轮新增，Edge 层）**：`scripts/perf-baseline.mjs`——M1 快照 p95=0.53ms / M2 会话 p95=0.41ms·消息 p95=0.41ms / M3 事件→5路SSE p95=0.66ms，全部满足提案 SLO 且余量巨大（fixture+loopback 属预期）；60s 浸泡 heap 无增长趋势；2h 浸泡与全链路（含内核 DB 段）NOT_RUN。证据 `evidence/perf-baseline-*/perf.json`。

## 遗留门（不冒充完成）

| 门 | 阻塞原因 |
|---|---|
| S2 内核集成（E1：D02–D05 真实变体） | 任务01 v2 路由已在制品但契约未发布、实现未固定；`src/store.mjs` 为 fixture seam；E1-D02 骨架已就绪（冻结门后一条命令可跑） |
| S3 剩余 | 真实客户绑定 scope（auth seam 按 principal×customer×action）、Cookie 会话/HTTPS/staging 部署形态、真实浏览器层端到端 CSRF 验证（守卫 E0 已覆盖） |
| D06–D12/D14/D23/D28 场景执行 | BLOCKED(01/02/03) |
| D19/D21/D22 稳定性 30 轮 | BLOCKED(B 修复固定 hash) |
| D26 完整回滚演练 / staging 备份策略 | BLOCKED(部署形态/获准环境) |
| D27 真实设备/官方视频/获准模型 | BLOCKED(用户授权/账号/费用) — E2 门 |
| 性能基线测量 | 未执行；任务书 p95 目标为待确认提案 |

## 环境注意

- 48080/15432 为旧 Anthropic 工作区遗留实例占用，未触碰；JW 自有形态 A@48180/PG@15442（见 `Back/START.md`）。
- Docker Desktop 引擎在本会话内出现两次不可达/半启动（ServerVersion 为空但 info 可答）；演练前用 `docker ps` 作为就绪判据而非 `docker info`。
- 检测到并行 writer（Back/Connectors、Back/A 002 迁移、Back/C 四域、docs/customer-next 提案）；Edge 未读写这些路径。
- `--fixture-auth` 的 `harness-demo-cred` 是公开合成演示凭据（仿 A tok-* 模式），禁止用于真实身份；不启用时登录/写面一律失败关闭。
