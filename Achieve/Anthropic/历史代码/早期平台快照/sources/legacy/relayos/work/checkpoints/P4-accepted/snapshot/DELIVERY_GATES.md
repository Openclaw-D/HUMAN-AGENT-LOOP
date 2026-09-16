# RelayOS P2–P7 交付 Gate

状态：P1 冻结契约  
日期：2026-08-26  
执行根：`C:\Users\22673\Desktop\Anthropic\RelayOS`  
依赖：`PRODUCT_CONSTITUTION.md`、`SCENARIO_MATRIX.md`、`ARCHITECTURE_CONTRACT.md`

## 1. 总规则

### 1.1 串行依赖

`P1 产品内核契约 -> P2 确定性后端 -> P3 Advisory Provider/GLM runtime -> P4 中文前端 -> P5 十场景联调 -> P6 部署运维 -> P7 最终审计`

上一 Gate 未通过，不开始下一 Gate。唯一允许并行的是同一 Gate 内文件边界不重叠、接口已冻结且父任务能独立验收的模块；任何跨对象/状态机/API/视觉决定仍由主 Codex 收敛。

### 1.2 完成定义

每个 Gate 只有同时满足以下条件才算通过：

- 指定文件真实存在且与三份 P1 契约一致；
- 指定命令真实运行，exit code 为 0，并保留摘要证据；
- 失败/越权/冲突/重启路径与 happy path 同时验证；
- 没有把 mock、计划或未验证外部能力写成已完成；
- 变更文件、验证结果、未验证内容、风险和回滚点已记录；
- 用户保留最终验收权。

### 1.3 后续 package script 契约

P2 必须建立并在后续保持这些可复制命令；脚本名是交付接口，不得任意改名：

| script | 首次要求 | 责任 |
| --- | --- | --- |
| `npm.cmd test` | P2 | 全部离线自动化测试 |
| `npm.cmd run test:contract` | P2 | domain/API/error/schema 契约 |
| `npm.cmd run test:replay` | P2 | 删除投影后 event rebuild/hash 对比 |
| `npm.cmd run test:provider` | P3 | Mock/Z.AI adapter contract 与失败零权威写入 |
| `npm.cmd run test:frontend` | P4 | display mapping、状态、a11y/静态检查 |
| `npm.cmd run test:scenarios` | P5 | 十场景同内核压力测试 |
| `npm.cmd run test:ops` | P6 | health、CORS、shutdown、restart、backup/restore |
| `npm.cmd run build` | P2 | 语法、配置、静态资源与 schema 校验；不得伪装成打包成功 |
| `npm.cmd run smoke` | P2 | local server + SQLite 最小端到端闭环 |
| `npm.cmd run smoke:provider` | P3 | Mock provider 离线 smoke；授权时另跑 live Z.AI |
| `npm.cmd run smoke:integration` | P5 | API + UI + mock provider/connector 十场景联调 |
| `npm.cmd run smoke:restart` | P6 | 进程级重启恢复与 in-flight 证据 |
| `npm.cmd run smoke:backup-restore` | P6 | SQLite 备份/恢复/replay hash |

所有默认脚本必须在无网络、无 API key 条件下通过。真实 Z.AI smoke 是单独、显式授权、可跳过但会阻止“live provider 已验证”的结论。

### 1.4 建议目录与单文件 owner

```text
RelayOS/
  package.json
  src/
    domain/
    application/
    infra/persistence/
    http/
    providers/
    connectors/
    config/
  scenarios/
  public/
  test/
  scripts/
  ops/
  work/checkpoints/
```

- 主 Codex：domain contract、API composition、架构收敛、视觉实现/验收、全 Gate 最终验收。
- 可委派执行者：仅冻结后的 persistence/provider 等中等模块，且每个文件只能有一个写入者。
- 用户：产品方向、依赖新增、真实 API 授权、部署暴露范围和最终验收。
- 不使用 Git worktree；本项目直接 local。非 Git 环境的 Gate rollback 使用不含 secret/运行 DB 的代码清单与压缩快照，放在 `work/checkpoints/Px-accepted/`，并保存 SHA-256 manifest。

## 2. P2 Gate：确定性后端与 event-sourced 内核

### 2.1 目标与范围

实现不依赖模型的最小可运行闭环：十场景可共用的对象/状态机、per-stream optimistic concurrency、BusinessEvent append、projection rebuild、command idempotency、HTTP API、MockExternalSystemAdapter、错误和健康检查。

不包含：真实 provider、真实 connector、正式 UI、认证、多租户、高可用。

### 2.2 文件所有权建议

| owner | 允许文件 |
| --- | --- |
| 主 Codex | `src/domain/**`、`src/application/**`、`src/http/**`、`src/connectors/contract.js`、`src/connectors/mock-adapter.js`、`package.json`、P2 相关测试与 README |
| 可选冻结模块执行者 | `src/infra/persistence/schema.js`、`src/infra/persistence/event-store.js`、`test/event-store.test.js`；不得改 domain/API/package |

### 2.3 必须证明的契约

1. WorkCase、GoalVersion、Evidence/ContextVersion、四类主体/控制对象、AuthorityGrant、Handoff、HumanGate、ActionIntent/Receipt、Exception/Escalation、MetricObservation 与 BusinessEvent 的最小 schema 可运行。
2. HandoffOffer 前 owner 不变；recipient 接受且版本匹配后同事务转移。
3. Gate 只能由指定 HumanPrincipal 解决；`demo_unverified` 只模拟 principal selection。
4. human/Agent 的 authority、capability、context 三者独立；无 system write 默认权。
5. action 未授权/无 succeeded receipt 时不能标外部执行成功。
6. event append、projection、command receipt 同事务；成功 retry 早于 stale version check。
7. 删除投影后从 event 重建，所有 WorkCase canonical hash 相同；event/hash/schema 损坏 fail closed。
8. Origin/CORS 在 body read 前拒绝；body limit、error code、live/ready、SIGINT/SIGTERM 基线存在。

### 2.4 明确命令与证据

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd run test:contract
npm.cmd run test:replay
npm.cmd test -- test/domain.test.js test/event-store.test.js test/http-contract.test.js test/connector-contract.test.js
npm.cmd run build
npm.cmd run smoke
```

证据必须包含：测试数量/通过失败、三类事务故障注入、foreign Origin 零写入、projection rebuild 前后 hash、重启后 owner/goal/handoff/Gate/receipt、SQLite journal mode、一次 failed/unknown connector receipt。

### 2.5 停止条件

- 需要十场景专用 domain branch 才能跑通最小闭环；
- replay 依赖 projection snapshot 或与在线 state hash 不同；
- 任一 domain failure 留下 event/projection/receipt 部分写入；
- human/Agent/system/control object 类型可混淆；
- 新增依赖但未获得用户批准；
- P0 数据库被直接升级且无法证明 typed event migration。

### 2.6 回滚点

P2 开始前只保留四份 P1 文档。P2 通过后生成 `work/checkpoints/P2-accepted/manifest.sha256` 和排除 `data/`、`.env`、secret、日志后的代码快照。P3 若失败，回滚到 P2 accepted，`ADVISORY_PROVIDER=mock`。

## 3. P3 Gate：Advisory Provider 与 GLM 运行时边界

### 3.1 依赖、目标与范围

依赖 P2 全绿。实现 `AdvisoryProvider`、`MockProvider`、`ZaiGeneralProvider`、结构化输出、prompt/eval/schema version、timeout/retry/circuit breaker、sanitized trace 和失败零权威写入。

不包含：让模型自动 apply、目标/权限/owner/Gate 决策、开发期 Coding Plan endpoint 复用、视觉设计。

### 3.2 文件所有权建议

| owner | 允许文件 |
| --- | --- |
| 主 Codex | `src/application/advisory-service.js`、provider 与 domain command 的组合边界、HTTP advisory route、配置/日志集成、P3 最终测试 |
| 可选冻结模块执行者 | `src/providers/contract.js`、`src/providers/mock-provider.js`、`test/provider-contract.test.js`；不得改 domain/event store/http composition |
| 主 Codex 或单一后端 writer | `src/providers/zai-general-provider.js`、`test/provider-failure.test.js`、provider 配置文档 |

### 3.3 必须证明的契约

- 五种 operation 只返回 `authority=none` 的 `AdvisoryResult`；证据 ID、goal/context version 和 output schema 全部验证。
- timeout、429、5xx、network、invalid JSON、schema mismatch、ambiguity、unsafe/over-authority suggestion 都可确定重现。
- transient 只重试一次；连续五次 transient failure 熔断 30 秒；half-open 单探测。
- provider failure 前后 WorkCase streamVersion、event count、projection hash、command receipt count完全相同。
- telemetry 不含 API key、Authorization、完整敏感 prompt/response；domain replay 不依赖 provider telemetry。
- runtime env/adapter 不出现 Coding Plan 专用 endpoint 或开发凭据。

### 3.4 明确命令与证据

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
$env:ADVISORY_PROVIDER = 'mock'
npm.cmd run test:provider
npm.cmd test -- test/provider-contract.test.js test/provider-failure.test.js test/advisory-zero-write.test.js
npm.cmd run smoke:provider
npm.cmd run test:replay
```

若用户明确授权并在进程环境提供 secret，才允许单独运行：

```powershell
$env:ADVISORY_PROVIDER = 'zai-general'
$env:RUN_LIVE_ZAI = '1'
npm.cmd run smoke:provider
```

live 证据只保存 redacted provider/model、status、latency、schema version、traceId 与 hash。未获得授权或 secret 时，不运行真实 API，并把 P3 结论写为“adapter/Mock contract 已验证，live Z.AI 未验证”；不得声称 live provider 已跑通。

### 3.5 停止条件

- provider 获得 DB/domain mutation handle 或返回即触发 apply；
- 失败/歧义/越权导致任何权威写入；
- 依赖开发期 Coding Plan endpoint/key；
- 结构化输出需靠宽松猜测或自由文本 fallback 才能通过；
- secret 出现在日志、event、fixture、截图或错误；
- provider 不可替换或 Mock 无法完整模拟失败。

### 3.6 回滚点

保持 P2 accepted snapshot 与 `MockProvider`。Z.AI adapter/配置出错时关闭 `zai-general`，回滚 P3 provider files，不回滚或迁移任何 WorkCase event。

## 4. P4 Gate：全中文黑白灰前端

### 4.1 依赖、目标与范围

依赖 P2、P3 离线 Gate 全绿。实现 1920×1080 为基线的中文关系图：默认主图 76%，可 zoom/drag/Fit，清晰图例、owner、pending handoff、Human Gate、Action receipt 与 Replay；演示角色常驻“未认证”语义。

不包含：账号/登录、认证声明、十场景专用页面、由 GLM 决定视觉、真实 connector。

### 4.2 文件所有权建议

主 Codex 独占 `public/**`、display mapper、frontend tests 与视觉验收。GLM 不承担布局、视觉层级、文案、交互或最终 browser acceptance。若新增图形依赖，先由用户批准，再由主 Codex 更新 package 和验收。

### 4.3 必须证明的契约

- 第一次打开能在 5 分钟内回答：当前目标、owner、待接受交接、开放 Gate、下一步。
- WorkCase/Human/Agent/System 类型视觉不混淆；department/control item 不画成 Agent。
- offered handoff 用虚线/文字显示 owner 未变；accept 后 owner 边改变并进入 timeline。
- 黑白灰外不靠颜色表达状态；keyboard focus、reduced-motion、loading/empty/error/degraded/stale/success 状态齐全。
- 关系图默认占主内容 70%–80%；timeline/inspector 为辅助 drawer/rail。
- 角色选择固定显示“演示角色（未认证）”，Replay 标记 `demo_unverified`。

### 4.4 明确命令与视觉证据

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd run test:frontend
npm.cmd run build
npm.cmd run smoke
```

必须用真实浏览器验证并保留：

1. 1920×1080 首次打开/图例/onboarding；
2. offered handoff（owner 未变）；
3. accepted handoff（owner 改变）；
4. open Human Gate 与受保护动作禁用；
5. Replay 展开及 Action receipt；
6. provider degraded、version conflict、empty/loading/error；
7. 1440×900 和 390×844 可读/可操作检查；
8. console 无 error，Fit/zoom/drag/keyboard/reduced-motion 正常。

### 4.5 停止条件

- 需要每场景复制页面/组件或写行业状态机；
- 图退化为装饰，不能回答五问；
- 前端自行判 authority 或乐观改变 owner/receipt success；
- 角色选择像登录，缺少未认证警示；
- 首次使用 80% 通过阈值未达到；
- 为视觉引入未经批准依赖。

### 4.6 回滚点

保留 P3 accepted API；前端失败只回滚 `public/**` 与 display mapper，不改变 domain/event schema。通过后生成 P4 accepted 视觉截图索引与 code manifest。

## 5. P5 Gate：十场景模拟数据压力测试与全栈联调

### 5.1 依赖、目标与范围

依赖 P4。把 `SCENARIO_MATRIX.md` 十场景全部转为 versioned config 和去标识化 fixtures，通过同一 API/domain/provider/connector/UI 完成闭环。金融、供应链、企业自动化可作展示重点，但不得有专用内核。

### 5.2 文件所有权建议

| owner | 允许文件 |
| --- | --- |
| 主 Codex | `src/config/**`、scenario schema、十场景 shared runner、UI 场景切换、P5 最终 tests |
| 单一 fixture writer，可选委派 | `scenarios/*.json`、`test/fixtures/scenarios/**`；只能按冻结 schema 填数据，不得改 loader/domain/UI |
| 只读 reviewer，可选委派 | 审查十场景字段/证据 ID/事实-推断-假设标签和专用分支；不得写文件 |

### 5.3 每场景共同测试序列

`Trigger -> WorkCase -> GoalVersion -> Evidence/ContextVersion -> provider advisory -> HandoffOffer -> clarify/re-offer or accept -> HumanGate -> ActionIntent -> Mock ExecutionReceipt -> MetricObservation(business/risk/efficiency) -> complete/close -> delete projection -> replay rebuild`

每场景至少另有：provider invalid/timeout、stale goal/context handoff、越权 Gate、connector failed/unknown、idempotent retry、version conflict、Exception/Escalation 路径。

### 5.4 明确命令与证据

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd run test:scenarios
npm.cmd run smoke:integration
npm.cmd run test:provider
npm.cmd run test:replay
npm.cmd test
npm.cmd run build
```

Gate evidence：

- 输出必须明确列出十个 scenarioKey、每个通过/失败和同一 kernel version；目标是 10/10，不接受只报总测试数。
- 静态扫描不存在 `if/switch` 按 scenarioKey 改 domain transition、专用 API route 或复制 UI。
- 每场景 source evidence IDs 与 P0 报告可追溯；strategy/C 级事实边界不被夸大。
- 每场景至少一个 business/risk/efficiency MetricObservation，包含数据源、Owner、阈值和失败处理。
- 三个展示场景的浏览器录屏/截图；其余七个至少有 API/replay/fixture 证据。
- 记录 extension 字段占比与 scenario-specific domain branch 比例；两者分别不得超过 20%，domain state branch 目标为 0。

### 5.5 停止条件

- 任一场景需专用状态、command、event、route 或 UI 才能通过；
- 只有三个展示场景通过；
- 某场景没有三类指标、异常路径或 replay hash；
- extension 字段/场景 branch 超过 `PRODUCT_CONSTITUTION.md` 反证阈值；
- 公开招聘线索被写成真实企业内部流程、预算或已达成结果；
- mock 数据包含真实个人、客户、账号、secret 或受保护材料。

### 5.6 回滚点

按场景 config/fixture 独立回滚到 P4 accepted；某场景失败不得修改共同 kernel 来“迁就”而不重新过 P2/P3/P4。任何必要 core change 都退回 P2，之后重新串行通过所有 Gate。

## 6. P6 Gate：部署与运维接近就绪

### 6.1 依赖、目标与范围

依赖十场景 10/10。交付单节点 Node + SQLite volume 的可重复启动、配置、健康/就绪、日志、错误、重启恢复、CORS/Origin、优雅关闭、备份/恢复、schema migration/rollback 和部署说明。

明确不做：SSO/OAuth、生产身份安全、多租户隔离、高可用、合规认证。因此结论只能是“接近部署且演示/受控试点可运行”，不能是“生产安全认证完成”。

### 6.2 文件所有权建议

主 Codex 或单一 ops writer 负责 `ops/**`、`scripts/smoke-*.js`、README deployment section、ops tests；domain/provider/frontend owner 不在 P6 随意重构。部署暴露范围、真实 host/origin 和 secret 注入方式由用户决定。

### 6.3 明确命令与运行证据

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd run test:ops
npm.cmd run smoke:restart
npm.cmd run smoke:backup-restore
npm.cmd run test:replay
npm.cmd test
npm.cmd run build
```

手工/脚本证据还必须包括：

- 无 DB 时首次启动、已有 DB 重启、WAL 模式、readiness；
- malformed/foreign Origin 在 body read 前拒绝且零写入；allowlist 精确到 scheme+host+port；
- SIGTERM 在 in-flight transaction/provider/connector 条件下的 10 秒 shutdown 边界；
- provider 熔断时核心 read/确定性 command 可用、advisory 显示 degraded；
- connector unknown receipt 重启后可查、不会重复副作用；
- 在线备份或受控停机备份、恢复到新路径、event/hash/projection 一致；
- migration 成功、失败回滚、旧版本 binary/schema 不兼容时 fail closed；
- JSON logs 可按 traceId 串起 API/provider/adapter/event，且 secret scan 为 0；
- `HOST=127.0.0.1` 默认与无认证警告；共享网络部署文档醒目标注风险。

### 6.4 停止条件

- 重启后 state/receipt/idempotency 丢失或 replay hash 不同；
- shutdown 中断事务却返回成功，或 connector 处于 unknown 被标 succeeded；
- CORS 使用 `*`、Origin 后置校验、服务默认绑定所有网卡；
- backup/restore、migration/rollback 未真实运行；
- secret 出现在日志/备份/快照；
- 文档宣称认证、HA、生产安全或真实连接器已完成。

### 6.5 回滚点

部署或 migration 前生成只含代码/config schema 的 P5 accepted snapshot，以及 SQLite consistent backup + schema/version/hash manifest。migration 失败恢复旧 binary + 旧 DB backup；禁止在损坏事件链上继续写。

## 7. P7 Gate：最终审计与交付接受

### 7.1 依赖与目标

依赖 P2–P6 全部通过。P7 不新增功能，只做代码、契约、测试、浏览器、运行、风险、文档和事实边界的独立审计。

### 7.2 必跑命令

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd test
npm.cmd run test:contract
npm.cmd run test:replay
npm.cmd run test:provider
npm.cmd run test:frontend
npm.cmd run test:scenarios
npm.cmd run test:ops
npm.cmd run build
npm.cmd run smoke:integration
npm.cmd run smoke:restart
npm.cmd run smoke:backup-restore
```

### 7.3 最终审计清单

- 四份 P1 文档、README、运行/部署文档与真实行为术语一致；
- 十场景为 10/10，共用同一 kernel/API/UI；展示重点无专用内核；
- 所有关键不变量均有正向和反向测试；provider/connector failure 均有零权威写入或明确 receipt；
- event-only rebuild 通过，投影可丢弃；hash/schema corruption fail closed；
- 1920×1080、1440×900、390×844 视觉证据和五问首次使用证据齐全；
- health/readiness、日志、CORS、shutdown、restart、backup/restore、migration/rollback 真实验证；
- secret scan、fixture privacy、日志 redaction、错误响应检查通过；
- 页面和文档明确无认证，demo role 不是身份，未声称生产安全；
- P0 市场事实、推断、假设与证据 ID 可追溯；不把招聘数量/薪资当预算；
- 未验证项、限制、失败测试和剩余风险全部显式，没有占位符或“计划即完成”。

### 7.4 停止条件与最终结论

任一必跑命令失败、任一场景失败、event rebuild 不一致、模型失败产生权威写入、角色语义冒充认证、部署证据缺失或文档夸大，P7 必须判定不通过并退回最早受影响 Gate。

只有全绿时可以写：**“RelayOS 在单节点、无认证、Mock connector 默认、Z.AI live 验证状态按证据明确标注的边界内，已完成十场景共享内核的端到端与部署运维验收。”**

不得写：生产认证完成、真实企业内部流程已验证、真实 connector 全部可用、预算/ROI 已证明或模型可以自主决定权威状态。

## 8. 可委派的 GLM-5.3 冻结检查点

以下只是后续可选路由，不在 P1 调用。每次调用前必须读取 `glm53-coding-agent` skill、检查配额、冻结接口、限定一个 writer，并由主 Codex独立验收。

### 8.1 P2 Persistence 检查点

- 目标：实现 SQLite schema、append-only event store、idempotent command receipt 与 fault-injection test。
- 允许文件：`src/infra/persistence/schema.js`、`src/infra/persistence/event-store.js`、`test/event-store.test.js`。
- 冻结契约：`ARCHITECTURE_CONTRACT.md` 第 3、5、11 节；不得改对象、event payload、事务顺序或引入依赖。
- 客观验收：`npm.cmd test -- test/event-store.test.js`、`npm.cmd run test:replay`；主 Codex检查 diff、越界文件、transaction ordering、hash/rebuild、故障注入和残留进程。
- 停止：接口有歧义、需改 domain/API、event 不能独立重建或 GLM 越界时立即拒收。

### 8.2 P3 Mock Provider 检查点

- 目标：实现 provider contract、deterministic MockProvider、timeout/invalid/ambiguity/unsafe fixtures。
- 允许文件：`src/providers/contract.js`、`src/providers/mock-provider.js`、`test/provider-contract.test.js`。
- 冻结契约：`ARCHITECTURE_CONTRACT.md` 第 5、8 节；所有返回 `authority=none`，无 DB/domain handle。
- 客观验收：`npm.cmd test -- test/provider-contract.test.js`、`npm.cmd run test:provider`；主 Codex独立验证失败前后权威 fingerprint 相同。
- 停止：需要 model-specific domain branch、自由文本 fallback、写权或 secret 时拒收。

### 8.3 P5 场景 fixture 只读审查

- 目标：只读核对十场景证据 ID、F/I/H 边界、extension namespace、三类指标与异常路径。
- 允许范围：读取 `scenarios/*.json`、`test/fixtures/scenarios/**`、`SCENARIO_MATRIX.md`；不写文件。
- 验收：主 Codex逐项复核审查发现，运行 `npm.cmd run test:scenarios`；GLM意见不自动改变产品或 schema。

### 8.4 永不委派给 GLM 的决定

产品宪章、对象/状态机/API/authority 设计、provider 权力边界、场景取舍、视觉与交互、依赖批准、真实 API/secret 操作、部署暴露范围、最终 P7 结论。

## 9. 变更升级规则

- 只改 fixture/文案且不动 contract：留在当前 Gate。
- 改 scenario schema 或 adapter contract：退回 P3/P5 并重新跑后续 Gate。
- 改 domain object/state/invariant/event/API：退回 P2，更新 P1 四文档并重新串行验收。
- 改六条产品哲学、统一内核、模型权力、身份边界或反证阈值：停止编码，由用户明确决定后重开 P1。
