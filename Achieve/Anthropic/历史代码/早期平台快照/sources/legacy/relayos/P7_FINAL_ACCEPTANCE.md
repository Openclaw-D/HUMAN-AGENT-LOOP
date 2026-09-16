# RelayOS P7 最终审计与交付接受

> **状态：不通过（P7 NOT ACCEPTED）**  
> 审计日期：2026-08-26  
> 最早退回 Gate：**P1（WorkCase 状态机与共同 command/API 契约需要重新冻结）**；其余已证实的不变量缺陷最早属于 **P2**。  
> 本文不是 accepted release 声明，不授权切换 `127.0.0.1:4177`。

## 1. 审计范围与停止决定

本轮按 `DELIVERY_GATES.md` 第 7 节独立复核 P2–P6 的代码、冻结契约、自动化测试、十场景、浏览器、运维、checkpoint、市场证据和事实边界。P7 没有新增产品功能，没有修改 domain/API/provider/connector/source/test/package，也没有创建 Git worktree、分支、commit 或 push。

虽然 11 条必跑命令均为 exit code 0，额外负向探针仍证实：当前实现允许冻结契约禁止的 WorkCase 状态迁移，而且冻结状态机声明了 `blocked → active` 与 `completed → active`，共同 command/API 却没有对应 resume/reopen command 或 event。修复该矛盾必须新增 command/event/API 语义，或修改冻结状态机；两者都超出 P7 权限。因此按委派停止条件立即判定不通过，不在 P7 静默修约。

本轮只保留失败审计文档和已取得的两张去敏浏览器证据。**没有生成 P7 accepted snapshot 或 manifest**；`work/checkpoints/P7-final/` 不得被视为回滚点。

## 2. 运行隔离与 4177 保护

- 审计开始和收口时，`127.0.0.1:4177` 均只由 PID `22464`（`node.exe src/index.js`）监听；P7 未停止、替换、写入或复用该进程及其 runtime DB。
- 最新源码浏览器验收使用 `127.0.0.1:54557`、独立临时 SQLite DB 和独立临时目录；端口由临时运行选择，不是 4177。
- 临时服务通过同一 production shutdown entry 接收 `SIGINT` 并完成 WAL/SQLite 关闭；54557 已无 listener。
- 临时目录 `C:\Users\22673\AppData\Local\Temp\relayos-p7-browser-b4a9c6a08f374667820badd2730d4c51` 已验证位于系统 temp root 后删除，删除后不存在。
- 收口复核：4177 listener 仍为 PID `22464`，无 54557 listener。

## 3. P7 必跑命令真实结果

运行环境：Node.js `v22.23.1`，npm `10.9.8`，Windows PowerShell，项目根 `C:\Users\22673\Desktop\Anthropic\RelayOS`。

| 命令 | 真实结果 |
| --- | --- |
| `npm.cmd test` | exit 0；109 total / 108 pass / 1 skip / 0 fail |
| `npm.cmd run test:contract` | exit 0；17/17 pass |
| `npm.cmd run test:replay` | exit 0；25/25 pass |
| `npm.cmd run test:provider` | exit 0；19 total / 18 pass / 1 skip / 0 fail |
| `npm.cmd run test:frontend` | exit 0；13/13 pass |
| `npm.cmd run test:scenarios` | exit 0；2/2 Node tests；10/10 场景；同一 `kernelVersion=1`；480 BusinessEvents；20/20 event-only replay；scenario-specific domain/API/UI branches=0；最大 extension 2.65% |
| `npm.cmd run test:ops` | exit 0；31/31 pass |
| `npm.cmd run build` | exit 0；57 JS/ESM、10 configs、10 fixtures、5 assets；第三方 import=0 |
| `npm.cmd run smoke:integration` | exit 0；10/10 场景；480 events；20/20 replay |
| `npm.cmd run smoke:restart` | exit 0；PASS；全程 port 0/临时 DB；强制终止原子恢复、真实 child IPC 进入 production SIGTERM shutdown entry、unknown receipt restart/query/retry 均通过 |
| `npm.cmd run smoke:backup-restore` | exit 0；PASS；20 streams / 480 events / 20 projections / 440 receipts；20 canonical hashes；20/20 rebuild；secret scan=0；临时 artifacts 已清理 |

不得隐藏的运行事实：

- 使用 `node:sqlite` 的相关命令真实输出了 Node 22 `ExperimentalWarning`。
- `RELAYOS_ZAI_GENERAL_API_KEY` 不存在，live Z.AI 测试保持 1 项 skip；没有读取、复制、回退或 alias 开发期 `ZAI_API_KEY`，live General API **未验证**。
- Windows 本机没有 literal POSIX `SIGTERM` 证明。`smoke:restart` 的准确结论仍是 `literalPosixSigtermVerified=false`：真实强制终止验证 SQLite 原子恢复，真实 child IPC 进入同一 production `SIGTERM` shutdown entry；不得升级描述为 literal SIGTERM 已验证。

这些绿色命令只证明既有 suite 的覆盖范围；不能推翻下一节新增负向探针的反例。

## 4. 阻断性反例与最早受影响 Gate

负向探针使用临时数据库和测试 harness，未写入源码、checkpoint 或 4177。下列行为均被当前实现实际接受，而不是推测：

| 阻断项 | 反例结果 | 契约/代码证据 | 最早 Gate |
| --- | --- | --- | --- |
| WorkCase 状态机与 command/API 不可同时满足 | 实际接受 `active → blocked → completed → cancelled`；冻结契约禁止 `blocked → completed` 和 `completed → cancelled` | `ARCHITECTURE_CONTRACT.md:84-90`；`src/domain/kernel.js:285-298` 没有 block/complete/cancel 的来源状态 guard | **P1/P2；先退 P1** |
| 冻结状态机存在不可达迁移 | 契约要求 `blocked → active`、`completed → active`，但共同 commandTypes 没有 resume/reopen/activate command | `ARCHITECTURE_CONTRACT.md:87-88,183` | **P1** |
| `workCase.create` 绕过 temporal AuthorityGrant | 无 `workCase.create` grant 的 `agent-assistant` 成功创建 version 1 WorkCase，并成为 owner | `src/domain/kernel.js:140-143` 在 `authorizedActor` 之前直接 return；契约 `ARCHITECTURE_CONTRACT.md:68,183` 无 bootstrap 例外 | P2 |
| Trigger 跨 stream 幂等缺失 | 同一 `organizationId + trigger.type + dedupeKey` 创建两个不同 WorkCase，两个 stream 都成功 | 契约 `ARCHITECTURE_CONTRACT.md:61`；现有 suite 只覆盖 command/idempotency retry，没有该跨 stream 反例 | P2 |
| Stable ID 同类型唯一性缺失 | 同一 WorkCase 两次打开相同 `HumanGate.id`、不同 payload，均成功；投影中 gate count=2 | `src/domain/kernel.js:220,342`；reducer 直接 push；其他 typed IDs 也需逐一补反向验证 | P2 |
| `ExecutionReceipt` 成功态校验不足 | fake adapter 返回缺少 `completedAt`、`resultHash`、`externalRecordRefs`、`errorClass` 的 `succeeded` receipt，service 仍持久化为 succeeded | `ARCHITECTURE_CONTRACT.md:73`；`src/connectors/contract.js:4-14` 只校验少量字段，且仅限制非 succeeded 的 completedAt | P2 |

因此 `DELIVERY_GATES.md:370` 的“所有关键不变量均有正向和反向测试”不成立。expectedVersion、command idempotency、Accepted Handoff、具名 Human Gate、provider failure 零权威写、event/hash/schema corruption fail closed 等既有测试仍通过，但不能抵消上述未被 suite 捕获的反例。

### 4.1 P7 不实施修复的原因

如果只给现有 block/complete/cancel 加来源状态 guard，冻结表中的两条回到 `active` 的迁移仍永久不可达。完整修复需要在 P1 重新决定以下二选一并冻结：

1. 新增 resume/reopen command、event、API validation、replay、UI 和正反向测试；或
2. 从冻结状态机删除不可达迁移，并同步十场景与验收语义。

两种方案都会改变 frozen state machine 或共同 API，P7 无权选择。P1 重新冻结后，P2 还需修复上述 authority、dedupe、stable ID、receipt 和状态 guard，再按依赖顺序重跑 P2–P7。

## 5. 文档一致性审计

除阻断性的状态机/API 矛盾外，发现两项窄范围文档漂移；因 P7 已触发停止条件，本轮未静默修改：

- `ARCHITECTURE_CONTRACT.md:406` 仍写 `ZAI_BASE_URL`、`ZAI_MODEL`、`ZAI_API_KEY`，真实 runtime 与 `OPS.md` 使用且只允许 `RELAYOS_ZAI_GENERAL_BASE_URL`、`RELAYOS_ZAI_GENERAL_MODEL`、`RELAYOS_ZAI_GENERAL_API_KEY`。
- `ARCHITECTURE_CONTRACT.md:29` 写 Node.js `>=22.5.0`；`package.json`、README/OPS 与实际运行边界为 `>=22.16.0 <23`。

README、OPS、P5/P6 acceptance 对单节点、无认证、demo role、Mock connector、Z.AI live 未验证和 4177 保护的表述保持诚实。

## 6. 十场景、共享内核与市场证据

### 6.1 十场景

- `test:scenarios` 与 `smoke:integration` 均实际得到 10/10。
- 10 个 config、10 个 fixture 使用同一 `kernelVersion=1`、同一 domain/API/UI renderer；静态行业专用 branch=0。
- 480 BusinessEvents、20/20 event-only rebuild，projection 可删除重建；最大 `scenarioExtensions` 占比 2.65%。
- 上述通过不等于 P7 接受，因为共用内核本身存在第 4 节反例。

### 6.2 P0 市场证据追溯

对 `P0-market/outputs/中国AI招聘市场证据库-2026-08-26.csv` 与同名 `.md` 独立统计：

- 91 条有效记录 = 84 条 job + 7 条 strategy_topic；
- layer = 39 business_application + 30 platform_runtime_governance + 22 base_model_compute；
- evidence grade = A 45 + B 7 + C 39；
- 十场景线索卡与 Scenario Matrix 为 10/10；44 个唯一 evidence ID 的 type/grade 可追溯；
- config/fixture 的 F/I/H 分层与来源一致，fixture 为 synthetic/de-identified。

没有把岗位数、薪资或公开招聘文本写成预算、ROI、采购意向或企业内部真实流程。当前只有市场线索与演示假设，不是企业内部流程证明。

## 7. Event、provider、connector 与运维审计

- event-only replay、canonical hash、stream version、未知 event schema、event/hash/schema corruption fail closed 的既有自动化均通过。
- provider 五 operation、Mock 与 ZaiGeneralProvider adapter 仍为 `authority='none'`；provider failure 测试保持零权威写。
- Mock connector 默认路径、unknown receipt 的查询优先与不重复副作用、错误响应、CORS Origin-before-body、health/readiness、shutdown、restart、backup/restore、migration/rollback、observability/trace/redaction、secret scanner 和 fixture privacy 的 P6 suite 均通过。
- 但 malformed succeeded receipt 反例说明 connector contract 仍可伪造不完整成功；因此不能把 connector Gate 判为全绿。
- 无第三方运行依赖；`npm ls --all --depth=0` 为空，build 扫描第三方 import=0。

## 8. 浏览器与视觉证据（未完成 Gate）

本轮只在契约级停止条件出现前完成 1920×1080 部分证据；未继续消耗资源制造“看起来完整”的视觉包。

| 文件 | SHA-256 | 已证明内容 |
| --- | --- | --- |
| `work/checkpoints/P7-final/visual/01-1920x1080-first-open.png` | `C8446B7A7A58124E08714C941B98338D5DECA7377F3B054D49424C9E04F166D1` | 1920×1080 首开；图谱宽约 75.96%；中文五问、Mock/未连接真实 GLM、演示角色未认证、边界提示 |
| `work/checkpoints/P7-final/visual/02-offered-handoff-open-gate.png` | `C820CB50B5F1BDDA97C5EAD2C57720CD2BD3A87490CDD6C8ED95AED20F4D49F1` | offered handoff 虚线；owner 仍为 `human-owner`；具名 open Gate；未把 offered 冒充 owner 变化 |

已实际交互：Zoom 上限 200%、下限 25%、Fit 105%；pan/drag 改变 transform；键盘 `ArrowRight` 移动真实节点选择并更新详情。关系图宽度约 76%，仍是页面绝对主体。

未完成并明确保留为失败项：

- 1440×900 与 390×844 独立视觉证据；
- drawer/selector/role/demo 的全矩阵复核；
- unknown receipt 不画成成功的本轮独立浏览器证明；
- 完整 console error=0 证明（运行日志出现 `/favicon.ico` 404，本轮没有把它包装成 console=0）；
- 真实外部受试者 5 分钟 UAT。

“当前目标是什么、当前 owner 是谁、哪里待接受交接、哪里有开放 Gate、下一步是什么”只完成界面/内部 walkthrough 证据。**真实 5 分钟用户 UAT 未完成。**

## 9. 历史 checkpoint 与 artifact 边界

每个历史 checkpoint 只与其自身 manifest 比对，不要求当前 P6 source 与旧 P2–P5 snapshot 相同。

| Checkpoint | snapshot 自校验 | missing / extra / mismatch / forbidden | manifest SHA-256 | 全目录不可变 digest（前后相同） |
| --- | --- | --- | --- | --- |
| P2 | 34/34 | 0 / 0 / 0 / 0 | `084A5FCE552DFAFA0E44273B6D064D0B60D3071F8145DD953A5B2E00A816FDAF` | `89A500A850ECDCD2E211A40E76C2808AAF5EF3077E550A7F89FC091AA2ED9A83` |
| P3 | 49/49 | 0 / 0 / 0 / 0 | `F14DB5DE559482858EA958F305831F07850F97EAF32F05E337580A31E69034C0` | `DCCA81F30F76C5BDDA486C84F9C5AC950F5434FC15AA1EC72D0A517E3D58779D` |
| P4 | 62/62 | 0 / 0 / 0 / 0 | `EF652AADAB68BF23262C8EF4806265D5CC276F79ED9973776678ADADDA85EA0D` | `6C6221C51C841AE410416DD60F6B6C938B5D78591625B9085718C7658EE1432C` |
| P5 | 89/89 | 0 / 0 / 0 / 0 | `5D1A99CB23085D3CD3B0689812CEA3B3D4595C0B5375F4CEA31AC285631A21A3` | `96C3EBA8230415DA9F01C45C260F24BC2B32D55FFCB004299F33A34A6233B083` |
| P6 | 112/112 | 0 / 0 / 0 / 0 | `1C21CDA06607F9F592713C828CA564621695F04D66CC74BD155888FA74311461` | `4E1CD2DC73DDE29D088C7B453856B55552D7981F71A18D928C4B3155C0D50317` |

说明：P2 另有带 snapshot path prefix 的次级 manifest，34/34 自校验 hash 为 `564BE1DF2A7DCA17F49D152BBB3D902C5C05B6A34E4E32694959C1D1459A08C9`；内容差异仅来自路径前缀表示。

P6 retained backup evidence SHA-256：`ABD98DA87834E73205FB1DE44724F8E922D1D30254A080A83E697F9960AE6A6E`。P5 视觉证据 6/6 hash 匹配。P2–P6 历史 checkpoint 全目录 digest 在独立审计前后相同，未被 P7 修改。

收口后再次运行 `npm.cmd run verify:checkpoint:p6`：112/112，missing=0、extra=0、mismatch=0、forbidden=0，证明本轮没有改动当前 P6 accepted source/config/docs/tests/scripts。

历史 checkpoint 内未发现第三方依赖、secret、`.env`、runtime DB/WAL/SHM、log、live response 或 symlink。项目中的既有 runtime artifacts 只位于受保护的 `work/runtime/**`，没有读取、复制或清理。由于 P7 不通过，本轮没有生成可被误认作 accepted 的 P7 snapshot/manifest。

## 10. 当前事实边界与未验证项

- 已验证边界：单节点、本机 loopback、无认证、`demo_unverified`、Mock connector、Mock advisory provider 默认、十场景 synthetic/de-identified demo、模型 `authority=none`。
- 未交付/未验证：SSO/OAuth、身份认证、多租户、HA、公网生产安全、真实 connector、真实企业内部流程、采购意向、预算、ROI、真实 5 分钟外部用户 UAT、live Z.AI General API。
- demo role 只改变演示视角，不是身份、登录或授权证明。
- 模型输出永远是 advisory，不能自主改变 owner、Gate、ActionIntent 或其他权威状态。
- 开发期 glm53-coding-agent/Coding Plan 不属于 runtime；P7 没有把开发期 key 用于 Z.AI runtime。

## 11. 最终切换方案（当前禁止执行，仅在重新 P7 全绿后使用）

### 11.1 切换前提

当前前提不满足。必须先完成 P1 状态机/API 决策与重新冻结，修复 P2 反例，串行重跑 P2–P7，并取得新的全绿 P7 acceptance。此前：

1. PID `22464` 必须继续独占 `127.0.0.1:4177`；不得停止或向其 DB 写入。
2. originating task 必须在切换前记录 PID 22464 的**原 source、工作目录、完整非 secret 环境变量名/配置路径、旧 DB 绝对路径、旧 log 路径和可验证 backup**。任一项无法确定即停止切换。
3. 新 runtime 必须使用全新路径，不得复用旧 P4 DB：
   - DB：`C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\final-4177\data\relayos.db`
   - log：`C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\final-4177\logs\relayos.jsonl`
   - provider telemetry：`C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\final-4177\telemetry\provider.jsonl`
   - backup：`C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\final-4177\backups\`

### 11.2 预置十场景（只在新 DB 不存在时）

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
$finalRoot = 'C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\final-4177'
New-Item -ItemType Directory -Force -Path "$finalRoot\data", "$finalRoot\logs", "$finalRoot\telemetry", "$finalRoot\backups"
if (Test-Path -LiteralPath "$finalRoot\data\relayos.db") { throw 'Final DB already exists; do not overwrite.' }
npm.cmd run seed:p5 -- --db "$finalRoot\data\relayos.db"
```

`seed:p5` 必须真实输出 10/10，且不得覆盖已有 DB。随后先用 `PORT=0` 对该新 DB 做只读 staging health/十场景检查并正常 shutdown；不要接触 4177。

### 11.3 最终环境变量与启动

只有 staging 与重新 P7 全绿后，originating task 才可在记录好旧 P4 rollback tuple 后，正常停止 PID 22464，并设置：

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
$env:HOST = '127.0.0.1'
$env:PORT = '4177'
$env:CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:4177'
$env:RELAYOS_DB_PATH = 'C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\final-4177\data\relayos.db'
$env:RELAYOS_SCENARIO_DIR = 'C:\Users\22673\Desktop\Anthropic\RelayOS\scenarios'
$env:RELAYOS_PUBLIC_DIR = 'C:\Users\22673\Desktop\Anthropic\RelayOS\public'
$env:RELAYOS_DEMO_MODE = 'true'
$env:RELAYOS_CONNECTOR = 'mock'
$env:ADVISORY_PROVIDER = 'mock'
$env:RELAYOS_SCHEMA_MIGRATION = 'auto'
$env:RELAYOS_LOG_LEVEL = 'info'
$env:RELAYOS_LOG_PATH = 'C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\final-4177\logs\relayos.jsonl'
$env:RELAYOS_PROVIDER_TELEMETRY_PATH = 'C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\final-4177\telemetry\provider.jsonl'
npm.cmd start
```

Mock 模式不得设置或读取 `RELAYOS_ZAI_GENERAL_API_KEY`，也不得 alias `ZAI_API_KEY`。启动必须保持前台可观察，不能在不明窗口静默后台化。

### 11.4 切换后只读验收

```powershell
$base = 'http://127.0.0.1:4177'
$live = Invoke-RestMethod "$base/health/live"
$ready = Invoke-RestMethod "$base/health/ready"
$scenarioKeys = @((Invoke-RestMethod "$base/api/scenarios").scenarios | ForEach-Object { $_.scenarioKey } | Sort-Object -Unique)
$cases = @((Invoke-RestMethod "$base/api/work-cases").workCases)
if ($live.status -ne 'live' -or $ready.status -ne 'ready') { throw 'RelayOS health/readiness failed.' }
if ($scenarioKeys.Count -ne 10) { throw "Expected 10 scenarios, got $($scenarioKeys.Count)." }
foreach ($key in $scenarioKeys) {
  if (-not ($cases | Where-Object { $_.scenarioKey -eq $key })) { throw "Scenario has no seeded WorkCase: $key" }
}
```

再人工检查十个 scenario selector、五问、offered handoff、open Gate、unknown receipt、drawer 与 console；任一失败不得继续声称切换成功。

### 11.5 失败回滚

1. 立即停止新 4177 进程，等待同一 shutdown path 完成；不要把 failed/new DB 数据复制回旧 DB。
2. 保留新 DB/log/telemetry 供审计，不删除、不原地降级 schema。
3. 用切换前记录的 P4 rollback tuple 和**未改动的旧 P4 DB**重新启动 P4；不得让 P4 binary 打开 P6/P7 DB。
4. 如果选择 P6 accepted 回滚，先运行 `npm.cmd run verify:checkpoint:p6`，从 `work/checkpoints/P6-accepted/snapshot/` 与兼容 backup 恢复到另一个全新 DB 路径，再按 OPS 启动；不得原地降级或猜测合并升级后写入。
5. 只有旧服务 `/health/ready` 与只读业务检查通过、4177 只有一个 listener 后，才结束回滚。

## 12. 最终判定

P7 **不通过**。当前源码仍等于 P6 accepted checkpoint，但存在自动化 suite 未捕获的权威、状态机、幂等、Stable ID 与 receipt 反例；冻结状态机/API 矛盾要求先退回 P1 决策。本轮不切换 4177，不生成 accepted P7 checkpoint，不进入 P8。
