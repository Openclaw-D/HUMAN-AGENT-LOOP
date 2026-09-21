# V0.4 R2-02 路 · 上传恢复适配装配 · REPORT

2026-09-21。执行 `docs/v0.4/tasks/ZCODE_R2_02.md`。契约：同目录 [CONTRACT.md](CONTRACT.md)（V0.4-UPLOAD-ASSEMBLY-R2-1.0）；串行挂载示例：[MOUNTING.md](MOUNTING.md)。本轮写入仅限 ownership 清单（§4）；A、Connectors 源码、`server.mjs`、compose 及共享配置零修改；未 commit/push、未重启共享服务、未动真实模型（HTTP 仅 127.0.0.1 回环）、未操作其他会话/任务。

## 结论

**20/20 通过，runner 退出码 0，可重复运行（连跑两轮均 20/20）；相邻既有回归 6/6 全绿。**A 授权投影（真实 HTTP 进程）、Edge 恢复 reader（零改动复用）、Connectors 恢复模块（真实隔离 PG）已合成一个可注入装配模块 `Back/Edge/src/upload-context-assembly.mjs`，并在隔离 HTTP/PG 链上实证：正例恢复上下文、双重授权与读中撤权/会话变化、跨租户跨客户拒绝、歧义/撤销/过期失败关闭、上游不可用 503 诚实故障、响应 allowlist 与双库 GET 零写。**共享运行实例的恢复仍未启用**（server.mjs 未挂载，示例与决策点在 MOUNTING.md），不宣称上传恢复完成。

## 独立运行命令

```
node docs/v0.4/results/r2-02-upload/run.mjs
```

- 退出码：`0`=全部通过；`1`=有断言失败；`2`=阻点（隔离 PG 不可达，跳过不计通过）。
- 等价直跑：`JW_A_ADMIN_DB_URL=postgres://jwv04r2:jwv04r2@127.0.0.1:25461/cnext node --test --test-concurrency=1 test/v04-upload-assembly.test.mjs test/v04-upload-assembly-boundaries.test.mjs`（cwd=Back/Edge）。

## 交付物（精确清单）

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `Back/Edge/src/upload-context-assembly.mjs` | 新建 | 注入式装配工厂：`createUploadContextAssembly` + A HTTP 适配 `createAuthorizeUploadViaA` + Connectors 适配 `createFetchContextFromConnectors` |
| `Back/Edge/test/v04-upload-assembly.test.mjs` | 新建 | 真实链主套件（11 例）：真实 A 内核 + 真实 Connectors PG + 真实 reader，隔离 HTTP 实例 |
| `Back/Edge/test/v04-upload-assembly-boundaries.test.mjs` | 新建 | 边界套件（9 例）：A 适配状态映射/工厂校验/歧义替身 |
| `docs/v0.4/results/r2-02-upload/CONTRACT.md` | 新建 | 本路契约 |
| `docs/v0.4/results/r2-02-upload/MOUNTING.md` | 新建 | 串行挂载最小清单（2 处改动点 + 4 个 CTRL 决策点，未应用） |
| `docs/v0.4/results/r2-02-upload/run.mjs` | 新建 | 独立运行器（PG 可达门 + 退出码） |
| `docs/v0.4/results/r2-02-upload/sha256-inputs-after.txt / sha256-deliverables.txt` | 新建 | 输入源码与交付物 SHA256 |

ownership 内的 `Back/Edge/src/upload-context.mjs` **零修改**（reader 按原样复用，hash 见 §6）；A/Connectors 源码、server、compose 零修改。

## 测试结果（20 条 = 11 真实链 + 9 边界；通过 20 / 失败 0 / 跳过 0，两轮一致）

### 真实链 v04-upload-assembly（真实 A 内核进程 + 真实隔离 PG + 隔离 HTTP 实例）

| # | 用例 | 断言要点 |
| --- | --- | --- |
| 10 | 授权正例 | 200 可用上下文；响应键集恰为 9 字段 allowlist；`allowedKinds=['invoice']` 来自 Connectors 邀请；`fetchContext` 收到 `{tenantId:t1(A权威), customerId, principalId(A联系人主体)}`，客户端伪造租户参数无通道；工厂 `connectorsStore` 直连注入形态同样可达 |
| 11 | 无恢复绑定 | A 授权通过但 Connectors 无绑定 → 200 `available:false NO_ACTIVE_UPLOAD_BINDING`，`bindingRef/invitationId=null`，不伪造上下文 |
| 12 | 跨租户与跨客户 | dave(t2) 读 t1 客户、ct1 读非授权客户 → 均 403 UPLOAD_FORBIDDEN，Connectors 零查询；dave 自己租户无绑定 → 200 不可用 |
| 13 | 会话凭据未被 A 信任 | 凭据原样转交真实 A → 403 PRINCIPAL_UNTRUSTED 映射为 403 拒绝（非 503），上游零触达 |
| 14 | Connectors 侧过期与撤销 | 白盒置过期 → `available:false`；恢复后重新可用；binding 撤销 → `available:false` 且不泄露绑定引用（真实 binding 服务） |
| 15 | 读中会话变化 | 上游读期间撤销 Edge 会话 → 读后会话复查 401 SESSION_REQUIRED |
| 16 | 读中 A 侧撤权 | 上游读期间 DELETE A grant → 最终授权复查 403 UPLOAD_FORBIDDEN（**非 503**）；工件计数零变化；撤权即刻生效（下一请求首门即拒） |
| 17 | 上游不可用 | A 不可达（无监听端口）→ 503；Connectors store 关闭 → 503（诚实故障，非伪装拒绝） |
| 18 | GET 零写 | 混合矩阵（403/200/200/403/401/503）前后 **A 库与 Connectors 库全表行集规范化哈希逐字节一致** |
| 19 | 不泄露秘密 | 响应无 token/credential/sha256/secret/provider 字段名及凭据值 |
| 20 | 工厂配置校验 | 缺 sessionOf/授权源/恢复源即 TypeError（配置期失败关闭） |

### 边界 v04-upload-assembly-boundaries（无 PG/内核；替身单列）

| # | 用例 | 断言要点 |
| --- | --- | --- |
| 1 | A 200+ok:false | → 403 UPLOAD_FORBIDDEN（拒绝不落 503），上游恢复读零触达 |
| 2 | A 403 PRINCIPAL_UNTRUSTED | → 403（不落入 503） |
| 3 | A 500 | → 503 UPLOAD_CONTEXT_UNAVAILABLE（故障如实上抛） |
| 4 | A 网络不可达 | → 503 |
| 5 | A 200 畸形 JSON | → 503（不伪装成授权判断） |
| 6 | 适配层直测 | credential 原样入头、principalId 进查询串、200 投影逐字段透传不改写；空 customerId 拒绝 |
| 7 | 歧义绑定（行形状内存 store 替身） | 真实 `makeUploadContextService` 过滤逻辑执行 → 200 `available:false AMBIGUOUS_UPLOAD_BINDING`，不泄露绑定引用 |
| 8 | 畸形恢复上下文 | → 502 UPLOAD_CONTEXT_INVALID（reader 既有分支经装配保持） |
| 9 | 工厂/store 配置校验 | 8 组缺依赖/坏依赖输入全部拒绝装配 |

### 既有回归（只读证据，不抵扣必测项）

`node --test --test-concurrency=1 test/upload-context.test.mjs test/s3-harness.test.mjs`（cwd=Back/Edge）→ **6/6 通过，exit 0**（reader 既有行为 + 会话/harness 面，确认装配层零破坏既有模块）。未整跑 Edge run-all（会拉起共享面，违反并行纪律）。

## 真实 PG 与替身边界

- **真实隔离 PG**：本路专有容器 `jw-v04r2-upload-pg`（postgres:16-alpine，127.0.0.1:25461 仅 loopback）。A 内核跑 `startKernel` 自建 `v7next_a_test_*` 库（每轮自删）；Connectors 跑 `createTestDatabase` 自建 `cnext_test_*` 库（每轮自删，两轮后已核实零残留）。真实链全部断言跑在真实 SQL/事务/真实 HTTP 进程上。
- **替身（3 处，均单列标注）**：① Edge 会话 exchange 的 `verifyCredential`（会话建立层；真实授权不依赖它——伪造凭据会话被真实 A 拒绝有专例 #13）；② 歧义用例行形状内存 store（真实 schema 唯一索引使双 active 绑定不可构造；该分支为 Connectors 防御代码，只验证装配链行为不验证 SQL）；③ 边界套件 `fetchImpl` 状态替身（模拟 A HTTP 码）。其余零替身。
- 测试内白盒操作（时间/撤权类）仅作用于本路自建库合成数据。

## 源码 hash

见 `sha256-inputs-after.txt`（输入源码执行后状态）与 `sha256-deliverables.txt`。本路未修改任何既有文件；输入模块 `upload-authorization.ts / upload-context.mjs(Edge) / intake/upload-context.mjs(Connectors) / session.mjs` 前后一致。工作区中 `Back/Edge/src/server.mjs` 等文件存在**他路在途改动**（并行 writer），本路未触碰、未回退。

## 资源登记（本路创建）

| 项 | 值 |
| --- | --- |
| 容器 | `jw-v04r2-upload-pg`（镜像 postgres:16-alpine 本机已有，未下载；容器 ID e9a9f4f8b732） |
| 端口 | `127.0.0.1:25461 -> 5432`（仅 loopback；与 01 路 25451 分段） |
| 凭据 | `jwv04r2`/`jwv04r2`（合成测试凭据，仅本路容器；管理库 cnext） |
| 创建 | 2026-09-21 |
| 运行目录 | `.local/v04-r2-02/`（round1.log、round2.log、regression-edge.log） |
| 处置 | 容器保持运行供 `run.mjs` 重复执行；移除：`docker rm -f jw-v04r2-upload-pg`（确认登记后执行）；测试库 `v7next_a_test_%`/`cnext_test_%` 每轮自删（已核实零残留） |
| 后台进程 | 测试内核（随机端口）由 `startKernel.stop()` 在套件 after 钩子内自停；本路无残留进程 |

## 遗留与移交（串行集成）

1. **共享 server 挂载未做（按任务排除项，非缺陷）**：最小改动 = 2 处（构造装配 + 一条 GET 路由），示例与验收要点在 MOUNTING.md；四个决策点（部署形态/路由路径/环境变量/探针）留 CTRL。
2. **分进程部署缺口**：Connectors 无 upload-context 只读 HTTP 口（现仅进程内模块）；若选分进程形态需先在 Connectors 增只读口（Connectors 源码本路只读未动）。
3. **装配层跨服务 import 边界**：`connectorsStore` 直连形态经动态 import 加载 Connectors 源（仅该分支加载）；纯 HTTP 形态注入 `fetchContext` 即无此依赖——形态裁决后如需解耦，改动收敛在装配文件单文件内。
4. **邀请过期口径如实继承**：01 路已登记"邀请过期仅挡兑换、已兑换身份以撤权为活控制"，本装配未加严未放宽；若产品要求"过期即停传"须 CTRL 同步改写门（避免读写分叉）。
5. **前端消费未接**：响应 allowlist 字段集已冻结（契约 §2.4），前端由 Codex 保留。

## 明确不宣称

- 不宣称共享 Edge 运行实例的上传恢复已启用/可用（未挂载）。
- 不宣称上传写路径（`withAuthorizedUpload`）或对象存储原子性已验证（本轮未触碰）。
- 不宣称分进程部署形态已定或 Connectors HTTP 读面已存在。
- 本轮验收口径 = **装配链在隔离 HTTP/PG 的行为正确 + 拒绝/故障语义不伪装 + 读零副作用**，均已实证；其余移交串行集成与独立验收。
