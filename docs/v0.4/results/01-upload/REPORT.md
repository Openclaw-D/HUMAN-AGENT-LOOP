# V0.4 01 路 · 上传授权只读投影与写门一致性 · REPORT

2026-09-21。执行 `docs/v0.4/ZCODE_PARALLEL_04.md` 01 项。契约：同目录 [CONTRACT.md](CONTRACT.md)（V0.4-UPLOAD-AUTHZ-PROJ-1.0，契约先行于实现）。本轮写入仅限 ownership 清单（§6）；Front/、Edge/、Connectors/、共享 CONTRACT、迁移文件零修改；未 commit/push、未重启共享服务、未用付费模型、未外网调用（HTTP 仅 127.0.0.1 回环）。

## 结论

**14/14 通过，runner 退出码 0，可重复运行（连跑两轮均 14/14）；既有回归 40/40 全绿。**历史 BQA-R2 包01 登记的阻点"A 上传权限投影缺失"已按其建议的投影契约（principalId/customerId/tenantId/canRead/canUpload/种类限制）补齐：投影从 `registerArtifact` 既有写门同源派生，零写只读，同一组正反例上读写判定逐例一致，读矩阵前后全库逐表快照逐字节一致。**上传恢复整链仍未装配**（Edge 适配器接线留待串行集成，见 §5），不宣称上传恢复完成。

## 独立运行命令

```
node docs/v0.4/results/01-upload/run.mjs
```

- 退出码：`0`=全部通过；`1`=有断言失败；`2`=阻点（隔离 PG 不可达，跳过不计通过）。
- 等价直跑：`JW_A_ADMIN_DB_URL=postgres://jwv04:jwv04@127.0.0.1:25451/postgres node --test --test-concurrency=1 test/v04-upload-authz.test.mjs test/v04-upload-failclosed.test.mjs`（cwd=Back/A）。

## 交付物（精确清单）

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `Back/A/src/domain/upload-authorization.ts` | 新建 | 只读投影模块：`buildUploadAuthorization(kernel).authorizeUpload()`；只 SELECT，零写 |
| `Back/A/src/http/server.ts` | 修改（+16 行） | 挂 `GET /api/v2/customers/:customerId/upload-authorization[?kind=][&principalId=]`；kernel.ts 未动（不在 ownership，投影在 server 层构造） |
| `Back/A/test/v04-upload-authz.test.mjs` | 新建 | 主套件：正反例矩阵+写门对照+撤权/过期/伪造/零副作用+秘密不泄露（9 例） |
| `Back/A/test/v04-upload-failclosed.test.mjs` | 新建 | 故障注入：`--faulty-verifier` 真实内核 + DB 故障替身池 + verifier=null（5 例） |
| `docs/v0.4/results/01-upload/CONTRACT.md` | 新建 | 本路契约（先行冻结） |
| `docs/v0.4/results/01-upload/run.mjs` | 新建 | 独立运行器（PG 可达门+退出码） |
| `docs/v0.4/results/01-upload/sha256-before.txt / sha256-after.txt` | 新建 | 输入源码前后 SHA256 |

`credit.ts` 在 ownership 内但**零修改**（投影不改写门；hash 前后一致，见 §7）。

## 测试结果（14 条 = 9 主套件 + 5 故障注入；通过 14 / 失败 0 / 跳过 0）

### 主套件 v04-upload-authz（真实隔离 PG + 真实 HTTP 内核进程）

| # | 用例 | 断言要点 |
| --- | --- | --- |
| 1 | 正反例矩阵 ×10 | 受限联系人在白名单内/`material.`前缀别名/第二种类/种类不在清单（投影 KIND_NOT_ALLOWED↔写门 403 PERMISSION_DENIED）/内部角色不受种类限制/agent 与 service 非人类（NOT_HUMAN↔403）/grant 模式内部 human/跨客户 grant 缺失（↔写门 404）/跨租户（↔写门 404）；**每例断言 `投影canUpload ⟺ 写门放行`**；拒绝路径 tenantId=null |
| 2 | 无 kind 投影 | 回答"能否上传某类材料"；与随后真实写门放行一致；非人类无 kind 同拒 |
| 3 | 写门租户声明越界 | 投影无租户声明按客户行租户判定（契约 §1.3 口径差）：错误声明写门 403、声明与客户行错位 404、正确声明放行且投影一致；拒绝零写入（计数 +1 仅正确声明那笔） |
| 4 | 无会话/伪造凭据 | 双侧 403 PRINCIPAL_UNTRUSTED；错误体不含凭据；拒绝后 `evidence_artifacts` 计数零变化 |
| 5 | 伪造 principalId 声明 | 投影 200 ok:false PRINCIPAL_MISMATCH（返回凭据派生主体）；写门 body 同名字段被忽略照常放行（契约 §3.2 双侧实证） |
| 6 | 过期 | 过期邀请兑换 410 INVITATION_EXPIRED；已兑换身份在邀请行置过期后投影仍可上传且写门真实放行（读写一致，投影未自造"邀请过期"新政策；活控制=撤权） |
| 7 | 撤权 | 内部 grant 行删除 → 投影 CUSTOMER_SCOPE_VIOLATION + 写门 404（撤权即刻生效）；联系人级联停用 → 双侧 403；撤权后重复上传零写入 |
| 8 | 零副作用 | 12 请求 GET 矩阵（200/403/400 混合）前后**全库逐表行集规范化哈希逐字节一致**；显式覆盖 audit_events/outbox_events/v2_idempotency/idempotency/customer_invitations/customer_identities/evidence_artifacts；状态码序列逐一断言 |
| 9 | 秘密不泄露 | 响应无 credential/sha256/code/token/secret/provider 等字段名及凭据值 |

### 故障注入套件 v04-upload-failclosed

| # | 用例 | 环境 | 断言要点 |
| --- | --- | --- | --- |
| 10 | 验证器异常真实注入 | 真实内核 `--faulty-verifier` | 投影 GET 与 registerArtifact 同闭 403；异常文本与凭据均不外泄；无会话同闭 |
| 11 | customerId 超长 | 同上 | 400 INVALID_INPUT（与写门 reqString 同口径） |
| 12 | DB 查询异常 | **替身池**（唯一替身） | `authorizeUpload` 拒绝上抛（非 ok:false）——上游故障不伪装为"无权限" |
| 13 | 验证器异常（进程内镜像） | 替身验证器 | PRINCIPAL_UNTRUSTED 且不回显凭据（与 #10 同语义） |
| 14 | verifier=null | 替身验证器 | 有凭据/无凭据都失败关闭 |

### 既有回归（只读证据，不抵扣必测项）

`JW_A_ADMIN_DB_URL=…@25451 node --test --test-concurrency=1 test/invitations-directory.test.mjs test/integration-core.test.mjs test/customer-credit.test.mjs` → **40/40 通过，exit 0**（invitations/identity 面 + v2 HTTP 全链 + 客户授信域，确认 server.ts 挂新路由零破坏）。run-all.mjs 未整跑：其 crash 套件会重启共享 PG 容器，违反并行纪律。

## 真实 PG 与替身边界

- **真实隔离 PG**：本路专有容器 `jw-v0401-upload-pg`（postgres:16-alpine，127.0.0.1:25451 仅 loopback；每轮测试自建 `v7next_a_test_*` 独立库并自删）。主套件全部断言跑在真实 SQL/事务/真实 HTTP 内核进程上；无 checkCustomer/自建角色表替身。
- **替身（2 处，均单列标注）**：① #12 的 DB 故障注入池（共享基础设施上不能真停库注入故障）；② #13/#14 的进程内 stub 验证器（与 #10 真实内核注入互为镜像）。其余零替身。
- 测试内白盒操作（时间类）：`UPDATE customer_invitations SET expires_at` 过去时刻，用 utils 既有"直连 DB 白盒操纵"惯例，仅作用于本路自建库合成数据。

## 源码 hash

见 `sha256-before.txt`（输入源码 = git HEAD `e298a78` 版本）与 `sha256-after.txt`（测试执行后）。`credit.ts / v2kit.ts / principal.ts / identity.ts / upload-context.mjs` 前后逐字节一致（本路未改动）；`server.ts` 由 `79efd9b1…` 变为 `c65bd514…`（+16 行，本路唯一修改的既有文件）。

## 资源登记（本路创建）

| 项 | 值 |
| --- | --- |
| 容器 | `jw-v0401-upload-pg`（镜像 postgres:16-alpine 本机已有，未下载） |
| 端口 | `127.0.0.1:25451 -> 5432`（仅 loopback） |
| 凭据 | `jwv04`/`jwv04`（合成测试凭据，仅本路容器，非共享凭据；与 run.mjs 默认值一致） |
| 创建 | 2026-09-21，容器 ID `f7c73400c0b9` |
| 运行目录 | `.local/v04-01/`（4 轮测试日志 + 回归日志 + 冒烟日志） |
| 处置 | 容器保持运行供 `run.mjs` 重复执行；移除：`docker rm -f jw-v0401-upload-pg`（确认登记后执行）；测试库 `v7next_a_test_%` 每轮自删 |
| 停止的后台进程 | 仅本路自建的冒烟内核（48471，已停）；未触碰任何共享/他路进程 |

## 遗留与移交（串行集成建议）

1. **Edge 接线未装配（按任务排除项，非缺陷）**：Edge `createUploadContextReader({ authorizeUpload })` 的授权源仍是注入点。接线建议已写契约 §4：包装本 GET，200+`ok:false` 必须映射为 403 UPLOAD_FORBIDDEN（不可落入其 catch-all 变 503，否则拒绝被伪装成上游故障）；403/500 原样上抛。此为一句包装代码的集成，留给 Codex 串行装配。
2. **投影不改写门既有语义**：邀请过期仅挡兑换（已兑换身份不受影响）是现有写门口径，投影如实镜像未加严；若产品要求"邀请过期即停传"，属政策变更，须 CTRL 另行决定并同步改写门（避免读写分叉）。
3. **拒绝码粒度差异**：投影 reason（如 CUSTOMER_SCOPE_VIOLATION）比写门 404 双关更明确，属于授权探针口的既定设计（契约 §3.1 有映射表）；浏览器面继续走既有 404 包装读口，不改。
4. **kernel.ts 未动**：ownership 不含 kernel.ts，投影在 server.ts 层构造（同 kernel 实例、同 verifier 链）。若后续想在 Edge 进程内直用模块，`buildUploadAuthorization(kernel)` 可直接复用，无需新装配点。
5. **并行 writer 漂移**：工作区存在他路改动（02/04 路 Edge、Front），本路未触碰、未回退；本路输入 hash 以 git HEAD 为基准记录。

## 明确不宣称

- 不宣称上传恢复整链完成/可用（对象存储链、Edge 适配器、Connectors service 均未接线）。
- 不宣称跨对象存储原子性已证明。
- 不宣称页面/前端已消费本投影（前端由 Codex 保留）。
- 本轮验收口径 = **权限读写一致 + 读零副作用**，均已实证；其余移交串行集成与独立验收。
