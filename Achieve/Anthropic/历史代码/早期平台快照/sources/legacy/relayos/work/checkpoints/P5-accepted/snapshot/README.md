# RelayOS P5

RelayOS P5 是基于同一套 deterministic event-sourced kernel、HTTP API、AdvisoryProvider、connector、graph renderer 与 UI 的十场景全栈模拟。十个场景只通过 versioned config、角色与词汇标签、adapter 声明和去标识化 fixture 参数化；没有行业专用 domain state、transition、command、event、route、renderer 或 UI branch。

系统仍坚持同一个权威边界：BusinessEvent 是唯一权威来源；WorkCase projection 可删除并重建；责任仅在 Accepted Handoff 后转移；受保护动作必须经过具名 Human Gate；模型建议永远 `authority=none`，不会自动产生权威写入。

## 十场景

- `customerService`：客服：会话分流与升级
- `aiCoding`：AI 编码：变更审查与发布
- `supplyChain`：供应链：采购、履约与异常协调
- `videoGeneration`：视频生成：素材、品牌与版权审查
- `enterpriseAutomation`：企业自动化：请求、审批与系统写回
- `edgeIot`：端侧 IoT：设备任务与安全控制
- `finance`：金融：支付、风控与智能投研
- `localServices`：本地生活：订单、履约与补偿
- `contentGovernance`：内容治理：审核、执行与申诉
- `ecommerce`：电商：商家、商品与流量治理

每个 config 都有对应的去标识化 fixture，并显式区分 `F`（事实）、`I`（有证据推断）和 `H`（待验证假设）。公开招聘记录和 `strategy_topic` 只作为方向线索；不代表实时在招、预算、真实企业内部流程或已达成效果。每个场景固定包含 business、risk、efficiency 三类 MetricObservation 定义，以及 data source、owner、合成阈值和失败处理。

## 共同闭环

十场景使用同一序列：

`Trigger → WorkCase → GoalVersion → Evidence/ContextVersion → Mock advisory → HandoffOffer → clarify/re-offer 或 accept → HumanGate → ActionIntent → Mock ExecutionReceipt → business/risk/efficiency MetricObservation → complete/close → 删除 projection → BusinessEvent-only replay rebuild`

场景压力测试同时覆盖 provider invalid/timeout、stale goal/context handoff、越权 Gate、connector failed/unknown、idempotent retry、version conflict、Exception/Escalation、未知 extension、专用 command 与专用 route 的 fail-closed 行为。

## 运行

要求 Node.js `>=22.5.0`。项目只有 Node 内置依赖，无需 `npm install`。

默认服务监听 `127.0.0.1:4178`，默认数据库为 `./data/relayos.db`。生成新的十场景演示数据库时必须显式给出尚不存在的路径，seed 不会覆盖已有文件：

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd run seed:p5 -- --db C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\p5-demo.db
$env:RELAYOS_DB_PATH = 'C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\p5-demo.db'
$env:ADVISORY_PROVIDER = 'mock'
npm.cmd start
```

P5 seed 只调用共同 application service 与 Mock connector，不直接写 projection 或 SQLite。若目标数据库已存在，请选择新路径或由用户明确处理旧的临时文件。

主要运行变量：`HOST`、`PORT`、`RELAYOS_DB_PATH`、`RELAYOS_SCENARIO_DIR`、`CORS_ALLOWED_ORIGINS`、`ADVISORY_PROVIDER`、`RELAYOS_PROVIDER_TELEMETRY_PATH`。`RELAYOS_PUBLIC_DIR` 只用于静态资源目录组合，默认 `./public`。

## Advisory provider

P5 Gate 只验证 `ADVISORY_PROVIDER=mock`。前端实际调用 `/api/advisories`，并在调用前后重新读取 projection，确认权威 `projectionVersion` 与 `projectionHash` 不变。invalid、timeout、歧义或越权都不会产生权威写。

`ZaiGeneralProvider` 仍保留 P3 contract，但本 Gate 没有独立 `RELAYOS_ZAI_GENERAL_API_KEY`，因此没有执行或声称 live GLM 验证。运行时 General API 与开发期 Coding Plan 完全隔离，禁止复用 `ZAI_API_KEY`。

## 验证

P5 必选 Gate：

```powershell
npm.cmd run test:scenarios
npm.cmd run smoke:integration
npm.cmd run test:provider
npm.cmd run test:replay
npm.cmd run test:frontend
npm.cmd test
npm.cmd run build
```

`test:scenarios` 与 `smoke:integration` 会逐一输出十个 `scenarioKey`、共同 `kernelVersion`、replay hash、extension 数量/占比和 pass/fail；还会静态扫描 `src/**`、`public/**`，拒绝 `scenarioKey` 驱动的 domain/API/UI 分支。所有 HTTP 测试使用 port `0` 与临时 SQLite，不占用用户可见端口。

浏览器证据索引见 `P5_VISUAL_ACCEPTANCE.md`，完整 Gate 证据见 `P5_ACCEPTANCE.md`。通过后生成 accepted 快照：

```powershell
npm.cmd run checkpoint:p5
```

该命令实际复制 accepted source/config/test/doc 到 `work/checkpoints/P5-accepted/snapshot/`，生成逐文件 `manifest.sha256` 并验证 0 missing/extra/mismatch，以及 0 runtime DB/WAL/SHM/log/secret。视觉截图保存在 checkpoint 的 `visual/`，但不进入代码快照。

## 明确边界

P5 尚未完成 live Z.AI、真实 connector、登录、SSO/OAuth、多租户、生产身份与权限、HA、公网部署、生产安全加固或真实企业 UAT。十场景数据都是公开线索驱动的合成模拟，不能解释为任何企业的真实流程、预算、当前招聘状态或实际效果。P5 完成后停止，不包含 P6 工作，也不切换用户可见的 `127.0.0.1:4177` P4 回滚服务。
