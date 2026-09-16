# RelayOS P4

RelayOS P4 是一个全中文、黑白灰的 **WorkCase 连续性关系图**。它回答同一件事如何在人员、Agent 与外部系统之间连续推进，并坚持一个硬边界：**责任只有被明确接受后才转移**。

前端不维护第二份权威状态。owner、authority、handoff、Human Gate、Action receipt 和业务回放都来自 HTTP API 的 WorkCase projection 与 BusinessEvent replay；缩放、拖动、演示状态和 AI 建议不会改变它们。

## P4 界面

- 1920×1080 基线中，主图约占内容区 76%，右侧 inspector 约占 24%。
- inspector 顶部固定回答五问：当前目标、当前 owner、待接受交接、开放 Gate、下一步。
- WorkCase、具名人员、可路由 Agent、外部系统使用不同形状；owner、待接受交接、回执非成功同时使用文字、粗细和实虚线编码。
- Replay、待接受交接、Human Gate 与 AI 建议使用 drawer，不永久压缩主图。
- 支持 25%–200% zoom、滚轮、pan、节点拖动、Fit、reset、方向键浏览和 Enter 打开节点详情。
- 演示角色始终标记为 `演示角色（未认证）` / `demo_unverified`，不是登录或安全边界。
- AI 建议只调用 `/api/advisories`，结果固定为 `authority=none`，需人工确认且不会自动 apply。
- finance、supplyChain、enterpriseAutomation 三个 config 共用同一个 renderer，没有行业 UI 分支。

## 运行

要求 Node.js `>=22.5.0`。项目只有 Node 内置依赖，无需 `npm install`。

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd run seed:p4
npm.cmd start
```

默认监听 `127.0.0.1:4178`，默认 domain 数据库为 `./data/relayos.db`。P4 seed 默认写入 `work/runtime/p4-demo.db`；需要让服务读取该数据时：

```powershell
$env:RELAYOS_DB_PATH = 'C:\Users\22673\Desktop\Anthropic\RelayOS\work\runtime\p4-demo.db'
$env:ADVISORY_PROVIDER = 'mock'
npm.cmd start
```

`seed:p4` 只通过确定性 command service 生成三个代表性 WorkCase，不直接写 projection 或 SQLite：待接受交接/开放 Gate、已接受交接/receipt unknown、Agent owner/receipt succeeded。

主要运行变量：`HOST`、`PORT`、`RELAYOS_DB_PATH`、`RELAYOS_SCENARIO_DIR`、`CORS_ALLOWED_ORIGINS`、`ADVISORY_PROVIDER`、`RELAYOS_PROVIDER_TELEMETRY_PATH`。`RELAYOS_PUBLIC_DIR` 仅用于静态目录组合，默认 `./public`。

## Advisory provider

默认 `ADVISORY_PROVIDER=mock`，界面会诚实显示“Mock / 未连接真实 GLM”。`ZaiGeneralProvider` 已实现，但只在显式配置下启用：

- `ADVISORY_PROVIDER=zai-general`
- `RELAYOS_ZAI_GENERAL_API_KEY`：产品运行时专用 secret，必填；不会复用开发期 `ZAI_API_KEY`
- `RELAYOS_ZAI_GENERAL_BASE_URL`：只接受 `https://api.z.ai/api/paas/v4/`
- `RELAYOS_ZAI_GENERAL_MODEL`：P3/P4 只接受 `glm-5.3`
- `RUN_LIVE_ZAI=1`：只用于显式 live test/smoke Gate

缺少专用 secret 时 fail closed，不会把 Mock 结果冒充 live。advisory 仅允许 `material.extract`、`context.summarize`、`conflict.identify`、`configuration.suggest`、`action.suggest`；成功结果仍是 `authority=none`，不是 command、ActionIntent、Gate 决定或 owner 变化。

## 验证

```powershell
npm.cmd test
npm.cmd run test:frontend
npm.cmd run test:provider
npm.cmd run test:replay
npm.cmd run test:contract
npm.cmd run build
npm.cmd run smoke
npm.cmd run smoke:provider
npm.cmd run smoke:frontend
```

`smoke:frontend` 使用临时 SQLite 与 port 0，真实检查静态资源、offered→accepted owner 转换、advisory 零写入和 receipt unknown。`build` 同时语法检查 `src/**`、`scripts/**`、`public/**`，并拒绝第三方/远程 UI 依赖。

P4 浏览器验收证据位于 `work/checkpoints/P4-accepted/visual/`，索引位于 `work/checkpoints/P4-accepted/VISUAL_ACCEPTANCE.md`。验收通过后运行：

```powershell
npm.cmd run checkpoint:p4
```

该命令复制实际 accepted code 到 `work/checkpoints/P4-accepted/snapshot/`，并生成逐文件 `manifest.sha256`。运行时 DB、日志、secret 与视觉截图不进入代码快照。

## 明确边界

P4 没有实现登录、SSO/OAuth、生产身份、多租户、真实企业 connector、HA、公网部署、模型自动 apply 或十行业富 fixture。真实 GLM live Gate 仍取决于独立 `RELAYOS_ZAI_GENERAL_API_KEY`；首次使用者 80%/5 分钟目标仍需真实受试者 UAT，当前浏览器 Gate 只做首屏五问的信息检索启发式验收。P0 市场、旧 P0、P1 合同、P2/P3 accepted snapshot 和 domain/event schema 均保持不变。
