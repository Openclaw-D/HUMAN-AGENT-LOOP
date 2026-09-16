# S0 · 本地基线只读核验（客户授信内核任务 01）

核验时间：2026-09-16 深夜（本机实跑）。执行者：ZCode（按 `JW_customer_credit_backend_tasks/01_CUSTOMER_CREDIT_KERNEL.md` §3 授权，只读，不改产品代码、不重启/停止任何进程、不运行可能触碰旧数据库的测试）。

输入完整性：任务包 5 个文件 sha256 与 `MANIFEST.json` 逐项一致（实算核对）。

## 1. 已核验（本机实跑取证）

### 1.1 Git 根与远端

| 项 | 结果 | 证据 |
|---|---|---|
| Git 根 | `C:/Users/22673/Desktop/JW` | `git rev-parse --show-toplevel` |
| origin | `https://github.com/Openclaw-D/HUMAN-AGENT-LOOP.git`，与任务书要求一致 | `git remote -v` |
| 本地工作区分支 | `main`，HEAD = `9c724c0`（Merge PR #1 test/pr-workflow） | `git rev-parse HEAD` |
| 远端 main（实查） | `5497576`（= 任务包 R0 引用 SHA），内容为 PR #2（2172a0c 基线文档）合并进 main | `git ls-remote origin` + 只读 `git fetch` 后 `git log origin/main` |
| 本地 main 与远端关系 | **本地落后 2 个提交**（`2172a0c` 基线文档、`5497576` PR#2 合并），未分叉 | `git branch -vv`（fetch 后） |
| 工作区改动 | 干净；仅未跟踪目录 `JW_customer_credit_backend_tasks/` | `git status --porcelain` |

注意：fetch 前本地 `origin/main` 跟踪引用停留在 `9c724c0`（陈旧），曾造成"已分叉"假象；只读 fetch 后澄清为纯落后。S0 期间**未执行** fast-forward（更新本地 main 属于分支变更，需授权）。

远端 main 目录树（`git ls-tree origin/main`）含 `V02_BASELINE.md`、`V02_FRONT_BACK_MAPPING.md`、`PR-TEST.md`；**不含** `JW_customer_credit_backend_tasks/`（本任务包仅在本地未跟踪）。

### 1.2 Front 源码与 dist 指纹

- `git status --porcelain -- Front/dist` 为空：**工作区 dist 与已提交 dist 一致**。
- dist 指纹（实算，2026-09-16）：
  - `Front/dist/index.html`（634 B）= `aca77b20f57d61236c51fd8d7e3a21cebe3f3fc4011cea058af88ada48f1129f`
  - `Front/dist/assets/index-w5N-BVp0.js`（240,006 B）= `9d6d55f0785f363edc6e74bf39666a01edc1424b320cf4ff4ba63b7481f4457c`
  - `Front/dist/assets/index-DEDsssDP.css`（19,208 B）= `d7ba2d00e4e342d4faa28b8e1b861d792846a95540e2a1a1b388cf4bada6b2fb`
  - 树聚合哈希（按路径排序后对清单再哈希）= `b26b649d830accf47c6e0591cb2297d47d2486deb625e378f3dd2446fd72d3a2`
- `git diff --stat 949525a HEAD -- Front` 为空：**Front 自 Stage 0 基线（949525a）以来零改动**，基线中的构建复现结论所依赖的源码前提未变。

### 1.3 进程与端口（只读识别）

| 端口 | 状态 | 归属 |
|---|---|---|
| 48080 | LISTENING，PID 21496（node.exe，uptime ≈ 70,144 s ≈ 19.5 h） | **旧树实例**：命令行 `node C:\Users\22673\Desktop\Anthropic\V7\backend-next\A\src\index.ts --port 48080 --dispatch --principal-tokens …`。运行的是**迁移前旧 Anthropic V7 路径**的 A 内核，不是当前 JW `Back/A`。命令行含 10 个合成 principal 令牌（tok-admin/tok-business/tok-agent/tok-agent2/tok-approver/tok-jianwei/tok-policy/tok-credit/tok-commerce/tok-asset，与 `Back/A/scripts/start-kernel.mjs` 目录同构，均为合成测试身份） |
| 48080 健康检查 | `GET /api/v1/health` → `{"ok":true,"db":"down","model":"not_configured","principalVerifier":"configured","leaseSeconds":90}`（实跑 curl） | 内核活但其 PG 不可达 |
| 48180 / 3617 / 3618 / 3730 / 15442 / 5432 | 均无监听（`netstat -ano` 实查） | **当前 JW 的 A/B/C/前端网关均未运行**；48180（V0.2 计划端口）空闲 |
| Docker | `docker ps` 连接失败：Docker Desktop 未运行 | `jw-v01-pg` 容器状态无法查询 |

结论印证任务书要求：**不能仅凭端口号判断服务新旧**——48080 是旧树遗留实例（db:down），不可用作任何集成对象；当前 JW 无任何后端在跑。

### 1.4 数据库与迁移配置（脱敏）

- 迁移文件：`Back/A/migrations/001_init.sql`（单一初始迁移）。
- 配置默认值（`Back/A/src/config.ts`）：port 48080、dbPort **15432**、leaseSeconds 90、outboxPollMs 500、outboxMaxAttempts 8；支持环境变量覆盖（START.md 路径用 `V7NEXT_A_DB_URL` 指向 `jw-v01-pg` @127.0.0.1:15442，库 jw）。
- 测试库假设（`Back/A/test/run-all.mjs:15-18`、`test/utils.mjs:11,43`）：硬编码 `127.0.0.1:15432`（容器 v7next-a-pg），测试凭据为代码内合成值（v7next:v7next）。**证实** HANDOFF 所记"A 全量测试硬编码旧端口与旧容器"。S0 未运行该套件。
- 敏感文件存在性（只查存在，未读取内容）：`Back/B/config/` 仅有 `b-config.example.json`、`b-config.http-sample.json`；浅层扫描未发现 `.env*` 或真实 `b-config.json`。

### 1.5 已知不稳定项的本地状态（只读定位，未复跑）

- `Back/B/test/contract-stub.test.mjs` ≈:123「持久化:restore 后回执仍在」用例存在；对应写入路径 `Back/B/src/ports.mjs:119` `atomicWriteJson`（EPERM 发生在其 tmp→rename 原子替换）。
- `Back/B/test/crash-recovery.test.mjs` ≈:31「跨进程崩溃恢复」用例存在（slow mock + 断言竞态）。
- `D-25e`：`HANDOFF.md:29` 记载"仍不稳定"。D 验收套件 S0 未复跑。
- 上述三项均**维持文档定性**（known instability，归 Stage 8 / D-25e 定向处理），S0 不复跑、不修、不改定性。

### 1.6 前后端接线状态

- `Front/integration/` 目录**不存在**（V02_FRONT_BACK_MAPPING §9 规划的 Stage 2 文件均未创建）。
- `Front/preview`、`Front/site-mirror` 源码中无对 `/api/v1/**` 或 `/api/jw/**` 的运行时请求（检索无命中；旧 `site-mirror/app/v5-preview/api-client.ts` 为映射文档已认定的死代码）。
- **证实：前后端未接线**，前端当前不请求任何后端。

## 2. 仅文档记载（本次未复跑，引用仓库/远端记录）

- Stage 0 实跑结果（V02_BASELINE.md，采集于 949525a）：Front typecheck/test/build PASS、dist 构建逐字节复现；B 测试 10 次 = 8 过 2 败；C 34/34 PASS；A 全量未跑；D 沿用 06:45 批次 37 PASS / 1 FAIL（D-25e）/ 2 BLOCKED。这些是仓库记录，非本次复跑。
- B EPERM 根因归因（杀软/索引/句柄竞争）是**假设**，非本次证实；可证实的事实仅是"复跑即过的不稳定 + rename EPERM 报错文本"。
- 构建可复现性：Front 源码自 949525a 零改动（已核验），故该结论的前提成立，但本次未重新构建验证（避免 S0 期间触碰已提交 dist）。

## 3. 未核验（本次无法或未覆盖）

- 浏览器实际加载的构建：3618 预览未运行，无法核对浏览器侧与 dist 的一致性。
- `jw-v01-pg` 容器内迁移版本与数据卷可恢复性（Docker Desktop 未运行）。
- 旧 48080 进程所连数据卷是否含需保留内容（其 db:down，且属旧树，本次不探查）。
- 远端 main 之外引用（R1–R4 URL 的网页可达性）未逐一抓取，仅核实 R0 SHA 与实查远端一致。

## 4. 受阻（需要用户环境操作/裁决）

| 门 | 阻塞点 |
|---|---|
| E1 级任何运行验证（PG + HTTP + 跨进程） | Docker Desktop 未启动；`jw-v01-pg` 需用户启动 |
| A 全量测试 | 硬编码 15432/旧容器，须先参数化（HANDOFF 既定），S0 不触碰 |
| 48080 遗留进程处置 | 属旧树、db:down；按规则不停止，留用户裁决 |
| 本地 main fast-forward 至 origin/main（+2 提交） | 分支变更动作，需用户/总控授权后执行 |
| `test/pr-workflow` 分支清理（本地+远端） | V02_BASELINE 已标注"待用户决定" |

## 5. 附录：S0/S1 执行期间观察到的并发写入（2026-09-16 深夜，S1 收尾时补记）

S0 核验时工作区仅有未跟踪目录 `JW_customer_credit_backend_tasks/`；S1 收尾复核 `git status` 时，工作区新出现**非本执行者创建**的未跟踪路径：`Back/Connectors/**`（任务 02，含 fixtures 与 node_modules）、`Back/C/{amount,coordination,domains,questions,rules}/**`（任务 03，含 rule-pack-v2）、`Back/Edge/**`、`Back/D/evidence/**`（任务 04）及 `docs/customer-next/acceptance/**`。判定：用户侧另有执行者在并行实施任务包 02/03/04。本执行者未读取其内容实质、未修改、未与其争用任何文件；本文档 §1 的工作区快照以 S0 核验时点为准。共享契约/验收归属按任务包与根部 AGENTS.md 由总控统筹。

## 6. 下一阶段（S1）writer 范围

- 本次仅新增：`docs/customer-next/LOCAL_BASELINE.md`、`docs/customer-next/LOCAL_REMOTE_DIFF.md`（S0 产物），以及 `docs/customer-next/S1_*.md`（S1 设计提案）。
- S1 为**提案**：领域 ADR、实体/事件/权限/错误码 Schema、迁移设计与兼容说明。共享契约权威文件（`Back/CONTRACT.md`、`DECISIONS.md`、`README.md`）不由本执行者改写，须经总控（Codex）统筹、单一 writer 冻结。
- 产品实现（S2+）尚未开始；`Back/A/**` 的实际代码改动待 S1 契约冻结后另行授权。
