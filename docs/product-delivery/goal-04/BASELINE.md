# 任务四 D1 基线记录（2026-09-18）

任务书：`JW_product_delivery_four_tasks/04_INDEPENDENT_USER_JOURNEY_ACCEPTANCE.md`（本包 00/01/02/03/COMPLETE 与 MANIFEST.json 同盘）。本文固定本轮起点，D3 固定快照验收以这里记录的状态为参照。

## 0｜基线变更记录（共享工作区，多 writer 并行）

- **BC-1（2026-09-18，D1 当日发现）**：共享工作区已由并行 writer 从 `main@1ec0ee4` 切至 **`v02-goal1234-delivery@e4ed7a5`**（PR#4 分支头，含前一轮 goal-01~04 联合交付）。本路不回切、不合并 PR；以该分支 + 在制修改为实际集成基线，D3 冻结快照时以 version-seal 实测为准。
- 在制修改归属（git status 实测，后续每日复核）：`Back/A`（credit/errors/kernel/server M + `009_customer_invitations.sql`、`identity.ts` 新增）= 任务01；`Back/Connectors`（schema.sql M + `evidence/a_bridge.mjs` 新增）= 任务02；`Back/Edge/src/proxy.mjs` M = 任务03；`Back/Edge/scripts/*.mjs`、`Back/D/product-journey/`、`docs/product-delivery/` = 本路（04）。
- 分支上已有可复用素材：`Back/Edge/test/e1/e1-g04-fullchain.test.mjs` + `g04-chain.mjs`（前一轮全链验收骨架）；`docs/backend-upgrade/goal-04/` 仅 evidence 日志（.log 被 .gitignore 排除，正文文档在 PR#4 分支提交内）。


## 1｜Git 状态（记录时点 2026-09-18 晨）

- 分支 `main`，HEAD `1ec0ee4e79a793d1c95363022cb7d06ea04a6a5a`，与 `origin/main` 一致。
- 工作区唯一非跟踪项：`JW_product_delivery_four_tasks/`（本轮任务书包，尚未 commit）。
- 无其他脏文件；本轮执行期间每日复核一次并记入 TEST_RESULTS.md 的运行环境节。
- 本地分支 `v02-goal1234-delivery`（PR#4，前一轮 goal-01~04 交付）**未合并**；按任务纪律不切分支、不合并 PR，本轮基线就是 main@1ec0ee4。
- `Back/A/migrations/`：001–008 全部在 HEAD 跟踪（001 init、002 customer_credit、003 inspection_sessions、004 decision_loop、005 trust_gates_a1、006 a2_a3_authority、007 ledger_once、008 domain_exemptions）。
- `Back/CONTRACT.md`：v1.3（§9 为 v2.2 增量登记；头部版本号尚为 v1.3——e1 冻结门判据之一是 ≥v2，当前如实为 BLOCKED，待任务01 发布）。

## 2｜任务包核对

MANIFEST.json 六文件 sha256 与盘上实际文件一致（D1 当日核对通过，核对记录见 evidence/d1/manifest-check.json）。

## 3｜相关文件摘要（本轮消费面）

| 包 | 入口/测试 | D1 现状 |
|---|---|---|
| Back/A | `node src/index.ts --port N --dispatch`；合成身份 `scripts/start-kernel.mjs`；测试 `npm test`（102 项：101 pass/1 skip 自报，本轮不代验收） | 迁移 001–008；v2 客户授信面/检查会话/决策闭环/Gate 回执制均在 |
| Back/B | worker `node src/cli.mjs worker`（config/b-config.json，Git 排除）；测试 12 文件入口 | fs-lock 重写、调度规划层在；真实接线以 02 本轮交付为准 |
| Back/C | mock `node scripts/start-mock.mjs --port N`；测试 `node test/run-all.mjs`；四域评测 `npm run eval4d` | 42 场景冻结集在；零运行依赖 |
| Back/Connectors | `node scripts/start-connectors.mjs`；`npm test`（`node --test test/` 目录形式，本机有已知怪癖——属 02 修改范围，我只验证不代修） | 进件规范化/处理协调器在 |
| Back/Edge | `node scripts/edge-start.mjs [--live]`（默认 48200）；交付编排 `scripts/delivery-up.mjs/delivery-down.mjs`；e1 `node --test test/e1/<显式文件>` | live 投影/动作代理/SSE/CSRF/审计在；e1 现有 4 用例文件+冻结门 |
| Front | 源码 `Front/preview/`（vite）；构建 `npm run build`；预览 `node start-preview.mjs`（默认 3618）；`dist/` 已随仓库提供（index.html 构建于 2026-09-18 04:20） | main 上仍为六角色本地合成模拟（`/__jw_preview_health` 报 `backendConnected:false`）；本轮由 03 重做接线 |
| Back/D | 2026-09-16 夜间批次黑盒验收框架（历史原文，historical）；本轮新增产物放 `Back/D/product-journey/`（本路独占新目录） | g0–g9 旧矩阵不动；不回写历史结论 |

## 4｜运行资源清单（记录时点；只读盘点，全部不碰）

进程：
- 3618 LISTENING pid 20520：Front 预览（先前会话遗留，保留）。
- 48180 LISTENING pid 11388：A 内核形态端口（先前会话启动，非本轮跟踪，保留不动）。
- 48080 LISTENING pid 21496：旧 Anthropic 遗留实例（历史，禁触）。

Docker 容器（postgres:16 系）：
- `jw-v01-pg` @15442（START.md 登记，task3 交付编排使用）
- `jw-cc-kernel-pg` @15444（任务01 内核测试）
- `jw-goal01-pg` @15446（goal-01 轮）
- `jw-connectors-pg` @15443（Connectors）
- `v7d-pg-4a0850f79d` @15433（2026-09-16 D 路旧批次）

另有 Dify 系容器（docker-*）与本产品无关，不碰。

## 5｜本轮（任务四·新包）登记资源段——后续所有 D2/D3 运行只用这里

| 用途 | 登记 |
|---|---|
| 旅程主库 PG 容器 | `jw-g04b-pg` @127.0.0.1:**15452**（建容器动作执行前单独记录命令与时间） |
| 恢复/演练第二库 | `jw-g04c-pg` @127.0.0.1:**15453** |
| A 内核（旅程实例） | **48282** |
| Edge（--live） | **17931** |
| C mock | **3742** |
| Front 预览（交付形态） | **3628** |
| e1 用例自管段 | 沿用 e1-d02 既有 15434+17919（该文件本路所有，改动随用例走） |

D1 时点以上端口全部空闲（netstat 核对）。容器创建遵守 START.md：一次性人工/记录在案动作，脚本只 start 已登记容器。停止一律走三证复核脚本，不按 PID 盲杀；与本轮无关的进程/容器/端口一律不碰。

## 6｜环境

- Node v22.23.1（满足 22.x 要求）；Git Bash on Windows 10.0.26200 x64。
- Docker Desktop 在跑（`docker ps` 正常；历史教训：以 `docker ps` 为就绪判据，不用 `docker info`）。
- 凭据纪律：不读取/不落盘任何真实密钥；合成 tok-* 只进 Git 排除的运行时配置（`Back/Edge/config/delivery-runtime.json` 等）；证据脱敏后入库。

## 7｜对前三路的接口前提（本轮验收依赖，不代实现）

1. 任务01 发布 CONTRACT ≥v2 并固定 Back/A 实现（e1 冻结门判据）。
2. 任务02 交付浏览器上传→处理→A 登记的真实链路，且各默认测试入口可运行（我验证不漏挂，缺陷退回 02）。
3. 任务03 交付页面旅程（目录/邀请/上传/核验/问答/决定），dist 与源码同版重建。
4. 任一路就绪即通知我接通第一份原始文件（不等全绿）；我先以只读探针跟踪各路进展，缺陷写 DEFECTS.md 并退回对应 writer。
