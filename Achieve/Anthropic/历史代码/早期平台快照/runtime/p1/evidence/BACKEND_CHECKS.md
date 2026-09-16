# P1 后端检查证据（停止终态）

日期：2026-08-27（Asia/Shanghai）

当前结论：**检查点 A 已按“首次 GLM 大块实现 + controller 独立微修/复核”的已披露口径接受；A repair GLM 调用仍拒绝。检查点 B 已通过 controller 独立 Gate；检查点 C 因无业务缺口未调用。后端现可进入前后端连调，但本任务未自行启动连调。**

## 1. Runner 窄修复

仅修改项目副本：

- `C:\Users\22673\Desktop\GLM\codex\skills\glm53-coding-agent\scripts\invoke-glm53.ps1`

未修改全局副本：

- `C:\Users\22673\.codex\skills\glm53-coding-agent\scripts\invoke-glm53.ps1`

项目 runner 新增 `-AllowNonGitWorkspaceWrite` 与 `-AuthorizedNonGitRoot`。只有显式 `-SkipGitRepoCheck`、`workspace-write`、显式授权开关、非空可解析授权根目录，且 `WorkingDirectory` 与授权根目录按 Windows 大小写不敏感规则解析后精确相等时放行。`danger-full-access` 永远拒绝。

PowerShell 解析检查：`PARSE_OK`。

不会触发 provider 的负向预检均通过：

- 旧的非 Git `workspace-write`、无新开关：拒绝，129 ms。
- 授权 root 不同：拒绝，12 ms。
- `danger-full-access`：拒绝，7 ms。
- 缺少 `AuthorizedNonGitRoot`：拒绝，35 ms。

项目 runner SHA-256：`3E47550B5208DFBF92D4E365B7FF8E4837A22CB7C8EE3BEF3E6938554AA555B5`。

## 2. 检查点 A 首次调用

JSONL：`C:\Users\22673\Desktop\Anthropic\runtime\p1\evidence\glm53-checkpoint-a.jsonl`

SHA-256：`B625EEADB096B9CEA60229D69E90F9C03DB04497F0B2BBB2211F2A4ED98B706B`

- thread：`01a03f65-5a86-7de0-87eb-75bb2e826940`
- terminal：`turn.completed`
- exit：0
- wall：545715 ms
- usage：input 388447，cached input 339904，output 36672，reasoning output 17148
- 写入：`src/core.mjs`、`src/schema.mjs`、`test/core.test.mjs`
- GLM 沙箱内验收：`node --test test/core.test.mjs`
- 结果：exit 1，测试隔离子进程 `spawn EPERM`，测试主体未运行，0 pass / 1 fail。

runner 汇总的 `rateLimitDetected` 为 `true`，但 JSONL 中没有找到 provider 返回的 429、quota 或 rate-limit 终态；本次不是明确的 provider 限额失败。

controller 在正常本地环境独立执行相同命令时，当时结果为 1 pass / 0 fail，确认首次失败来自 GLM 沙箱子进程限制，而不是当时的测试主体失败。

## 3. 检查点 A 唯一修复调用

JSONL：`C:\Users\22673\Desktop\Anthropic\runtime\p1\evidence\glm53-checkpoint-a-repair.jsonl`

SHA-256：`49C7D73A51F3C5371DED9F7B689964CC05A64F47F319955C9947DD71871D328F`

- thread：`01a03f6f-b18d-7343-979f-73bab5ff5896`
- terminal：`turn.completed`
- exit：0
- wall：189586 ms
- usage：input 265182，cached input 241664，output 8666，reasoning output 4196
- 修改：`src/core.mjs`、`test/core.test.mjs`
- GLM 最终测试：`node test/core.test.mjs`
- 结果：exit 1，`test/core.test.mjs:259`，实际 409、期望 200。
- 无 sandbox/file denial；但 JSONL 显示最终测试前执行了 9 条只读 shell，违反任务包“只允许一条 shell 命令”的执行约束。

controller 再执行冻结正式命令：

```powershell
node --test test/core.test.mjs
```

真实结果：exit 1，1 test，0 pass，1 fail；同样失败于 `test/core.test.mjs:259`，`409 !== 200`。

精确根因：第二个显式 Agent Run 成功后 Projection 版本为 4；Handoff proposed=5、accepted=6、Goal updated=7、Challenge raised=8。因此 Challenge resolution 的 `expectedProjectionVersion` 应为 8；当前测试写成 9，触发正确的 `PROJECTION_VERSION_CONFLICT`。

一次修复额度已经用完。controller 未修改业务代码或测试来掩盖失败，未启动第三次 GLM 调用。

## 4. A 停止时的文件与边界

当时 `runtime\p1` 只有：

- `evidence\BACKEND_CHECKS.md`
- `evidence\glm53-checkpoint-a.jsonl`
- `evidence\glm53-checkpoint-a-repair.jsonl`
- `src\core.mjs`
- `src\schema.mjs`
- `test\core.test.mjs`

没有 `.test-data`、SQLite 数据库、HTTP server、ScenarioPack、README 或 verify script。检查点 B/C 未启动；4179 未启动；4177 未触碰。没有 Worktree、branch、commit、push、依赖安装、前端修改或越界业务写入。

## 5. A 停止时的未验证项与残留进程

当时以下必交付项尚未实现或验证：HTTP API、十场景目录、三个 active sample Work、成功/负向 HTTP Command、重启 HTTP 恢复、`scripts/verify.mjs`、README 和完整后端 Gate。

检查时未发现命令行指向 `Anthropic\runtime\p1` 或 `glm-5.3` 的残留 `node.exe` / `codex.exe` 进程。

当时停止原因：检查点 A 的功能 Gate 与执行 Gate 均未通过，且已经使用唯一修复调用。功能局部通过不能覆盖上述失败。

## 6. Controller 授权窄收尾与 A 最终接受

总控随后明确授权 controller 处理已确认的微型测试版本偏移，不再调用第三次 A GLM。

controller 独立审查 `src/core.mjs` 后确认：

- `AgentRunRequested` 的 reducer 与 policy 已没有“整个 Work 永远只能一次”的历史阻断；不同的新显式 Command 各产生一个 Event，相同 idempotency request 由持久化 hash/result 原样重放且不增 Event。
- 对外代码仅使用冻结错误表中的 `VALIDATION_ERROR`、`ACTOR_REQUIRED`、`AUTHORITY_DENIED`、`WORK_NOT_FOUND`、`PROJECTION_VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`INVALID_TRANSITION`、`PROJECTION_UNAVAILABLE`。
- `WORK_ALREADY_EXISTS` 已不存在，重复 Work 使用 `409 / INVALID_TRANSITION`。

controller 未修改 `src/core.mjs`，仅修复 `test/core.test.mjs` 中同一版本顺延链：

- Challenge resolution 的 expectedProjectionVersion：9 → 8。
- Gate decision 的 expectedProjectionVersion：repair 错改的 8 → 9。

首次并发运行两种测试时，两个进程竞争同一固定 `.test-data\core.test.sqlite`，导致其中一个 `EBUSY`；这是 controller 测试编排错误，不作为功能结论。随后严格串行执行：

```powershell
node --test test/core.test.mjs
```

结果：exit 0，1 test，1 pass，0 fail，duration 193.7855 ms。

```powershell
node test/core.test.mjs
```

结果：exit 0，1 test，1 pass，0 fail，duration 124.6901 ms。

A 的最终接受口径为：**首次 GLM 大块实现 + controller 独立微修/复核**。第二次 GLM repair 仍因额外 shell 与失败测试被拒绝，未被包装为通过。

## 7. 检查点 B GLM 执行

JSONL：`C:\Users\22673\Desktop\Anthropic\runtime\p1\evidence\glm53-checkpoint-b.jsonl`

SHA-256：`4C0BEBC88BA59B46FE62F6D9458C435DA55735C9AF212B59BE03151F61CE87AA`

- thread：`01a03f76-d44f-7b40-ba8e-f45a2ff7ee9b`
- terminal：`turn.completed`
- exit：0
- wall：637457 ms
- usage：input 1966579，cached input 1886912，output 39310，reasoning output 14263
- 修改范围仅为：`src/core.mjs`、`src/scenarios.mjs`、`src/server.mjs`、`test/http.test.mjs`
- 无 Sandbox denial，无并发第二个 GLM 调用。

GLM 在允许的三次聚焦测试内运行 `node test/http.test.mjs`：

1. exit 1：测试误用 `interaction.findIndex`。
2. exit 1：测试请求覆盖 Content-Type，先得到 400 而非预期身份错误。
3. exit 0：1 pass / 0 fail，作为 B 正式验收。

runner 汇总 `rateLimitDetected=true`，但 JSONL 中没有 429、`rate_limit`、quota 或 too-many-requests 证据；不是 provider 明确限额终态。

B 产生三个完整 sample Event 链：

- risk：7 Events，最终 Receipt `unknown`，Work 未 completed。
- dev：10 Events，最终 Receipt `failed`，Work 未 completed。
- interaction：5 Events，普通 Message 后只有一个显式 Agent Run，Gate `needs_evidence`。

## 8. Controller B 独立审查与微修

controller 审查确认：十场景顺序、名称、defaultView、availability 与冻结控制板一致；sample-only Artifact/Proposal 只可通过未暴露为 HTTP 的 `appendSampleEvents` 写入；该方法只接受 sample Work、两个白名单 Event、已知 actor，并在单个 `BEGIN IMMEDIATE` 中逐 Event reducer + Schema 校验，失败回滚。

首次根目录 `node --test` 并行运行两个测试文件时，`core.test.mjs` 删除整个共享 `.test-data`，与 HTTP 测试数据库发生 `EBUSY`。controller 只把 core 测试临时目录从共享根改为 `.test-data\core-${process.pid}`，未修改业务实现。严格串行复测后：

```powershell
node --test
```

结果：exit 0，2 tests，2 pass，0 fail，duration 573.001 ms。

```powershell
node test/http.test.mjs
```

结果：exit 0，1 test，1 pass，0 fail，duration 386.1513 ms。

检查点 B 以“GLM 实现 + controller 独立测试隔离微修/复核”接受。没有必要启动检查点 C 的 GLM 调用。

## 9. Verify 与真实 HTTP Gate

controller 新增：

- `README.md`
- `scripts\verify.mjs`

执行：

```powershell
node scripts/verify.mjs
```

结果：exit 0；三个 sample 均 Schema-valid，risk 7/7、dev 10/10、interaction 5/5；`restartReplayEqual=true`，`selectorsShareProjection=true`。

4179 端口启动前确认无 listener。真实 CLI：

```powershell
node src/server.mjs --port 4179 --db C:\Users\22673\Desktop\Anthropic\runtime\p1\.test-data\manual-gate-20260826191904563\p1.sqlite
```

HTTP 结果：

- `/health`：200，`status=ok`，`storage=readable`。
- `/api/v1/scenarios`：200，10 项，冻结中文名称和顺序正确。
- 三个 sample Projection：200，全部 `fixture=false`、`dataOrigin=sample`、version=cursor。
- risk：7/7、status active、Receipt unknown。
- dev：10/10、status active、Receipt failed。
- interaction：5/5、status awaiting_gate、无 Receipt。
- 成功 `append_message`：200，`accepted=true`，risk 版本 7 → 8。
- stale `append_message`：409，`PROJECTION_VERSION_CONFLICT`；随后 risk 仍为 8，证明负向零写入。

PTY Ctrl+C 后会话返回 exit 1；未把该退出码隐瞒为 0。随后确认 4179 无 listener、相关 `node/codex` 进程数为 0。用 `P1Core` 再打开同一数据库成功重放 risk 8/8，最后 Activity 为 Message appended，Receipt 仍 unknown；目录没有 WAL/SHM，仅有主数据库，证明存储可关闭和恢复。

## 10. 最终边界、残留与限制

最终业务/证据文件：

- `README.md`
- `scripts\verify.mjs`
- `src\core.mjs`
- `src\schema.mjs`
- `src\scenarios.mjs`
- `src\server.mjs`
- `test\core.test.mjs`
- `test\http.test.mjs`
- `evidence\BACKEND_CHECKS.md`
- 三份 GLM JSONL。

额外保留一份 192512-byte 的 sample HTTP Gate SQLite：

- `.test-data\manual-gate-20260826191904563\p1.sqlite`

controller 两次尝试用精确 PowerShell 路径删除该一次性数据库，命令都在创建进程前被本地策略拒绝。未换 shell、未绕过权限。该数据库只含本地 sample/手工 Gate Event，不含凭据、客户或生产数据；最终报告必须继续披露此副作用。

项目 runner 的窄 Gate 修复仅位于 `C:\Users\22673\Desktop\GLM\codex\skills\glm53-coding-agent\scripts\invoke-glm53.ps1`。全局 runner 未修改。未使用 danger-full-access、Worktree、branch、commit、push、依赖安装、浏览器、前端、4177、provider/catalog/auth 配置。

最终检查：4179 无 listener；相关 `node/codex` 残留进程为 0。未做前后端连调、浏览器视觉检查、部署或生产声明。

## 11. 检查点 D：interaction 合法多 Run 历史重启恢复

日期：2026-08-27（Asia/Shanghai）。本节是 T3 发现回归后的新检查点，覆盖并更新上节关于当时端口状态的时间快照；不重开 A/B，也不宣布 P1 完成。

### 11.1 旧逻辑复现与原库保护

T3 证据：`C:\Users\22673\Desktop\Anthropic\integration\p1\INTEGRATION_CHECKS.md`。

原复现数据库 `integration\p1\runtime\p1.sqlite` 通过 `node:sqlite.backup` 从 read-only source 在线备份到：

- `.test-data\checkpoint-d-integration-copy\p1.sqlite`

没有直接复制活跃 SQLite 单文件，也没有用 `P1Core` 可写打开原库。原库检查点 D 前后 SHA-256 均为：

- `F1C1D714B195AA1795C50ED2DB1795613D868A07340CBF0B1A563384FDFEBDCF`

修复前在备份副本上复现：interaction Projection 为 version 7、cursor 7、7 Activities/Events、2 个标题为 `Agent run requested` 的显式 Run；`ensureSampleData` 返回 `409 / INVALID_TRANSITION`，message 为 `Interaction must contain exactly one explicit run`；失败前后完整 Projection 不变。

### 11.2 GLM-5.3 检查点 D 执行证据

JSONL：`C:\Users\22673\Desktop\Anthropic\runtime\p1\evidence\glm53-checkpoint-d.jsonl`

SHA-256：`2BFED1FF973A4E1A851D5950CD723FA20DBB0BEF5E41A3ECC212240705AD0A08`

- thread：`01a03f94-20cc-7163-8893-42e95d37586e`
- terminal：`turn.completed`
- exit：0
- queue wait：3 ms
- wall：196021 ms
- usage：input 420178，cached input 378880，output 9244，reasoning output 4135
- rateLimitDetected：false
- repair calls：0
- 唯一写入：`src\scenarios.mjs`、`test\http.test.mjs`
- 聚焦测试：`node test/http.test.mjs`，实际 1 次，exit 0，1 pass / 0 fail
- 无 Sandbox denial、timeout、transport failure、第三个业务文件或 4178/4179 访问。

GLM 只删除 `verifyInteraction` 中“Run 总数必须等于 1”的终身限制；仍保留 seed 活动前缀、至少一个 Message、至少一个显式 Run、首个 Message 位于首 Run 之前、Gate `needs_evidence`、Receipt null，以及 `verifySample` 的 Schema/sample/identity fail-closed 检查。risk/dev verifier 未修改。

### 11.3 Controller 独立验收

```powershell
node test/http.test.mjs
```

结果：exit 0，1 pass / 0 fail，duration 524.1468 ms。

```powershell
node --test
```

结果：exit 0，2 pass / 0 fail，duration 610.6707 ms。

```powershell
node scripts/verify.mjs
```

结果：exit 0，`ok:true`、`restartReplayEqual:true`、`selectorsShareProjection:true`；risk 仍为 7/7 + unknown，dev 仍为 10/10 + failed，interaction seed 仍为 5/5 + null Receipt。

controller 的独立新临时库因果链：

- seed：version 5、cursor 5、5 Events、1 Run。
- 普通 Message：6/6、6 Events、仍 1 Run。
- 第二个新显式 Run：7/7、7 Events、2 Runs。
- 同一 idempotency request 重放：仍 7/7、7 Events、2 Runs。
- close/reopen + `ensureSampleData`：仍 7/7、7 Events、2 Runs，完整 Projection 深度一致。

修复后再次只读验证 integration 备份副本：`ensureSampleData` 成功返回 risk/dev/interaction；interaction 保持 version 7、cursor 7、7 Events、2 Runs，完整 Projection 不变。副本验证前后 SHA-256 均为：

- `C409B1E6E71A03827C865C37EA7374C2B9721F12DD53281AE497E3F40152E9B0`

### 11.4 当前终态与边界

检查点 D 通过，可供 T3 重新验证“第二次显式 Run 后稳定重启”。本任务未修改前端、integration 证据或原复现库，未自行执行 T3 复验，也未宣布 P1 完成。

当前既有服务保持不变：4178 仍为 PID 16572，4179 仍为 PID 27464；没有停止或重启。检查时额外 GLM/codex runner 相关进程为 0。

受控复现副本保留在 `.test-data\checkpoint-d-integration-copy\p1.sqlite`，大小 200704 bytes，仅用于本地回归证据；原 integration 数据库未修改。未使用 Worktree、branch、commit、push、依赖安装、danger-full-access，未修改 runner/global skill/provider/catalog/auth、4177 或其它路径。

## 12. 检查点 E：currentActor 操作上下文与多 Run 文案

日期：2026-08-27（Asia/Shanghai）。本节记录最终视觉 Gate 发现的后端 Projection 回归；不修改或重启 4178/4179，不改前端，也不宣布 P1 完成。

### 12.1 修复前复现

controller 在全新临时 sample 上复现：

- risk 7/7：owner=`risk-owner`，但 currentActor=`risk-connector`，`availableCommands=[]`。
- dev 10/10：owner=`dev-recipient`，但 currentActor=`dev-connector`，`availableCommands=[]`。
- interaction 5/5：owner=`interaction-owner`，但 currentActor=`interaction-approver`。
- interaction stage detail=`One explicit Agent run produced a proposal`，matrix label=`One explicit run`。

根因是 `reduceEvent` 对每个非 `WorkCreated` Event 都执行 `currentActorId = event.actorId`；样例文案同时写死了单次 Run。

### 12.2 GLM-5.3 唯一调用

JSONL：`C:\Users\22673\Desktop\Anthropic\runtime\p1\evidence\glm53-checkpoint-e.jsonl`

SHA-256：`99807334615DF05CD4622C4C75A006BAD1E9F956DBA87703C32EBF4D516B5E62`

- thread：`01a03fa2-066d-7a12-9d37-ad8afc51517c`
- terminal：`turn.completed`
- exit：0；timeout=false；queue wait=3 ms；wall=549635 ms
- usage：input 2036015，cached input 1957376，output 20174，reasoning output 10307
- rateLimitDetected=false；repair calls=0
- Event 107 条；真实写入仅 `src\core.mjs`、`src\scenarios.mjs`、`test\core.test.mjs`、`test\http.test.mjs`
- 自测：四文件 `node --check` 通过；`node test/core.test.mjs` 1/1；`node test/http.test.mjs` 1/1

JSONL 出现一次 `Reconnecting... 1/5`，原因是 response body decode transport error；同一 thread 随后恢复并 `turn.completed`，没有第二次 provider 调用。该调用输入量明显偏高，主要为 cached input；功能结果不能掩盖此效率问题，后续同类局部检查点不应据此扩大 GLM 使用范围。

GLM 修正了正常 Event 不再覆盖 currentActor、`HandoffAccepted` 同步 owner/currentActor、新 sample 文案与相关 HTTP/core 回归。controller 独立文件哈希审计确认 GLM 未修改 Schema、server、README、verify、D 主库或其它业务文件。

### 12.3 Controller 独立补缺与最终功能 Gate

controller 审查发现 GLM 只修正新种子文案：历史 D 数据库的不可变 `WorkCreated` Event 仍携带旧 `One` 文案，重放后会继续误导。为覆盖真实历史数据，controller 在 `src\core.mjs` 增加确定性 replay 兼容：仅当 `dataOrigin=sample`、`scenario.id=interaction` 且字段精确等于两个已知旧字符串时，归一化为不依赖次数的文案；其他数据不被放宽或静默改写。`test\core.test.mjs` 增加旧 Event replay 回归。

该新测试首轮因测试夹具把 `assistant-agent` 改名后漏同步 relation endpoint 而 1/2 失败；controller 确认原因后只修夹具引用，复测 2/2 通过。最终重新执行：

```powershell
node --test
```

结果：exit 0，3 pass / 0 fail，duration 723.4481 ms。

```powershell
node scripts/verify.mjs
```

结果：exit 0，`ok:true`、`restartReplayEqual:true`、`selectorsShareProjection:true`；risk 仍为 unknown，dev 仍为 failed，interaction 无 Receipt。

controller fresh 内存 sample 因果链：初始 22 Events；普通 Message 不增加 Run；第二、第三次显式 Run 各增加一个 Event/Run；同一第三次 Run idempotency 重放不增加 Event；最终共 25 Events，interaction 8/8、3 Runs、owner/currentActor 均为 `interaction-owner`；risk owner/currentActor 均为 `risk-owner` 且 commands 包含 `append_message`；dev owner/currentActor 均为 `dev-recipient`；再次 `ensureSampleData` 完整 Projection 不变。

controller 把历史 D 主库以 SQLite read-only source 逐行镜像到内存库后验证：source 24 Events、18 idempotency rows；interaction 7/7、2 Runs、owner/currentActor 均为 `interaction-owner`；`ensureSampleData` 完整 Projection 不变；旧 stage/matrix 文案被 replay 兼容层归一化，固定次数正则为 false。历史 D 主库验证前后 SHA-256 均为：

- `C409B1E6E71A03827C865C37EA7374C2B9721F12DD53281AE497E3F40152E9B0`

### 12.4 文件、进程与终态

E 的业务/测试改动：

- `src\core.mjs`
- `src\scenarios.mjs`
- `test\core.test.mjs`
- `test\http.test.mjs`
- `evidence\glm53-checkpoint-e.jsonl`
- 本节 `evidence\BACKEND_CHECKS.md`

4178 在 E 前后均为 PID 16572；4179 在 E 前后均为 PID 22864。D 节记录的 4179/PID 27464 是更早时间快照，不作为 E 基线。没有停止、重启或请求这两个服务。终审没有 GLM/codex runner 残留进程；进程检索只匹配到正在执行检索本身的 pwsh。

活跃 integration 主库因 4179 占用而拒绝 `Get-FileHash`；该失败是只读哈希尝试，未打开、复制或修改活跃库。

历史 D read-only SQLite 打开仍在副本目录产生两个 sidecar：

- `.test-data\checkpoint-d-integration-copy\p1.sqlite-shm`：32768 bytes
- `.test-data\checkpoint-d-integration-copy\p1.sqlite-wal`：0 bytes

controller 先对精确解析后的两个路径调用 `Remove-Item`，在创建进程前被本地策略拒绝；随后按项目文件规则尝试标准补丁删除，因 `.shm` 非 UTF-8 二进制而在修改前失败。未换 shell、未通过 Node/Python 绕过、未触碰 200704-byte 主库；主库 SHA 仍为上述值。两个 sidecar 是本轮唯一未清理副作用。

因此终态分层结论为：E 的业务、权限、Schema、D 回归、历史 replay 与进程 Gate 通过；文件范围 Gate 因两个 SQLite sidecar 残留未完全通过。检查点 E 不能标记为“完整接受/已可供 T3 复验”，需由上级总控决定是否接受该无业务数据的残留，或在获得允许的清理机制后删除并复核。未使用 Worktree、branch、commit、push、依赖安装、danger-full-access，未修改前端、integration 证据、契约、runner/global skill/provider/catalog/auth 或 4177。
