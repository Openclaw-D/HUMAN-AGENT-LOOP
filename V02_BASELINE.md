# V0.2 Baseline · Stage 0 基线冻结

2026-09-16 晚采集。本文档只记录事实，不改任何产品代码；属于 Commit Boundary 0（仅本文档）。

## 1. 代码基线

- Git 根：`C:/Users/22673/Desktop/JW`，分支 `main`，HEAD = `949525a`，工作区干净（写本文档前）。
- 本地 main 与 `origin/main`（Openclaw-D/HUMAN-AGENT-LOOP）一致。
- 残留：本地与远端存在 `test/pr-workflow` 分支（`c7208bb`，仅含 PR-TEST.md 3 行），为 2026-09-16 晚 PR 工作流实测所建，**待用户决定后清理**，不属于 V0.2 范围。
- 来源：Front=旧3607六角色前端；Back=V7/backend-next（148 文件与来源逐文件一致，见 Achieve/Migration/latest-backend-check.json）。

## 2. 本机复测结果（Stage 0 实跑）

| 项 | 命令 | 结果 |
|---|---|---|
| Front typecheck | `npm run typecheck` | PASS（0 错误） |
| Front 测试 | `npm test` | 11/11 PASS |
| Front build | `npm run build` | PASS（29 模块，~292ms） |
| dist 一致性 | build 后 `git status -- Front/dist` | **干净：新构建 dist 与已提交 dist 逐字节一致**（发布件可由当前源码复现） |
| A typecheck | `npm run typecheck` | PASS（0 错误） |
| B 测试 | `npm test`（63 项） | **不稳定**：10 次运行 = 8 次全过、2 次失败（另有首次 62/63）。见 §3 |
| C 测试 | `npm test` | 34/34 PASS（~0.6s） |
| A 全量测试 | 未运行 | 按 HANDOFF：A 全套硬编码旧 15432 端口与旧容器，部分用例会重启旧资源，Stage 0 不触碰（须先参数化，属于后续工作） |
| D 验收 | 未运行 | 沿用夜间批次结论（2026-09-16 06:45）：40 唯一 id，37 PASS / 1 FAIL（D-25e 不稳定）/ 2 BLOCKED；DEF-03/04 已解决确认；DEF-01 业务语义待用户裁决 |

## 3. 新发现的 B 偶发失败（本阶段如实记录，Stage 0 不修）

复现特征：整套 63 项约 2–3/10 概率出现以下之一，复跑即过——与 D-25e/DEF-04 家族的"不稳定"定性一致：

1. `test/contract-stub.test.mjs:123`「持久化:restore 后回执仍在」
   `EPERM: operation not permitted, rename ...stub-state.json.*.tmp -> stub-state.json`（`B/src/ports.mjs` atomicWriteJson）——Windows 文件原子重命名被拒（杀软/索引/句柄竞争类环境因素）。
2. `test/crash-recovery.test.mjs:31`「跨进程崩溃恢复:intent 无回执 → unknown,零盲重发」
   断言竞态：`0 !== 1`（C mock 调用计数）与 `'running' !== 'unknown'`（恢复判定）——崩溃注入与检查之间的时序敏感。

定性：**known instability**，归入 Stage 8（Recovery & Failure Hardening / D-25e 定向复测）统一处理；不因复跑通过而宣称关闭。

## 4. 运行环境（Stage 0 时点）

- **Docker Desktop 未运行**：`docker ps` 连接失败；`jw-v01-pg` 容器状态无法查询（HANDOFF 记录其迁移后已停止、卷 `jw_v01_pgdata` 保留）。Stage 2 起需要用户启动 Docker Desktop。
- **端口 48080 被占**：node.exe PID 21496，uptime ≈ 17.5 小时（迁移夜间任务遗留实例）。`GET /api/v1/health` → `{"ok":true,"db":"down","model":"not_configured","principalVerifier":"configured","leaseSeconds":90}`——内核活但其 PG（旧容器）不可达。**按规则未停止**，留用户裁决；V0.2 计划用 48180，不冲突。
- 空闲端口：3617 / 3618 / 15442 / 3730 / 48180 均无监听。

## 5. 集成假设（待 Stage 2 验证）

- A 内核：`Back/START.md` 路径 = Docker `jw-v01-pg`（127.0.0.1:15442，库 jw）+ `V7NEXT_A_DB_URL` + migrate + `node src/index.ts --port 48180 --dispatch`；需要合成身份演示时用 `A/scripts/start-kernel.mjs`（tok-* 合成 principal）。
- C mock：`node scripts/start-mock.mjs --port 3730`（零依赖）。
- B worker：复制 `B/config/b-config.http-sample.json` → Git 排除的 `b-config.json`，contract.baseUrl=48180、mock.baseUrl=3730，`node src/cli.mjs worker`。
- 前端网关：任务书要求 same-origin——3618 启动服务（`Front/start-preview.mjs`，Node 内置 HTTP）扩展 `/api/jw/*` 反代到 A；dev 模式（3617 Vite）用 Vite proxy 对应配置。网关 thin、只绑 127.0.0.1、不记凭据、不改业务载荷。
- 旧 `Front/site-mirror/app/v5-preview/api-client.ts`（/api/v5-preview/**）仅为类型被引用，运行时死代码；按任务书 §8 不复活，只允许参考其 ApiFailure/幂等/冲突 UX 模式。

## 6. 当前已知 blocker 汇总

1. 前后端未接线（V0.2 主目标本身）。
2. B 偶发失败 2 处（§3）→ Stage 8 定向处理。
3. Docker Desktop 未启动 → Stage 2 前置条件（需用户环境操作）。
4. 48080 遗留进程 → 用户裁决是否停止。
5. v1.3 `staleReviewAck` 业务政策 PENDING-USER-RULING → Stage 7 前需裁决（任务书 §5.G/§7 要求不改语义，UI 文案按"技术支持、制度待裁"处理）。
6. 生产身份/项目隔离、真实模型调用 = 非目标（0 调用）。
