# BQA-R2 包01 · 上传授权与撤权隔离 · REPORT

2026-09-21。执行 `docs/v0.3/backend-qa-r2/01_AUTH_UPLOAD.md`。本轮只做后端专项测试；Front/ 零接触，后端生产源码与既有测试只读，写入仅限本目录。未 commit/push、未改共享配置、未启停共享服务、未用付费模型、未外网调用（HTTP 仅为 127.0.0.1 回环）。

## 结论

**本包 15/15 通过，runner 退出码 0，可重复运行（连跑两轮均 15/15）。**既有 8 条单测原样复跑全绿；既有 PG 测试在专用容器上由"跳过"转为真实通过（1/1，exit 0）。**上传授权链仍未装配**：缺 A 上传权限投影为单列阻点（见"未测"），对象存储生产链未触碰，跨存储原子性未证明。

## 独立运行命令

```
node docs/v0.3/backend-qa-r2/results/auth-upload/run.mjs
```

- 退出码：`0`=全部通过；`1`=有断言失败；`2`=阻点（专用PG不可达，跳过不计通过）。
- 环境变量（均有默认值，默认指向本包容器）：`CONNECTORS_TEST_PG_PORT/USER/PASSWORD/DATABASE`（与既有测试同名兼容），或 `BQA_PG_*`。
- 专用PG：容器 `jw-bqa-r2-authup-pg`（本机已有镜像 postgres:16-alpine，未下载），`127.0.0.1:25443`，仅 loopback。每轮测试自建正则约束 `cnext_test_*` 独立库并自删；两轮运行后核实残留库数为 0。

## 通过（15条，真实PG=专用容器真实SQL/事务）

### 真实PG套件（tests/upload-context.pg-bqa.test.mjs，9条）

| # | 用例 | 断言要点 |
| --- | --- | --- |
| 1 | setup 探测 | 专用PG可达，否则 blocked_env 跳过（不计通过） |
| 2 | 本人唯一有效绑定可读 | 真实SQL联查（accepted_binding_id 精确join）恢复 bindingRef/invitationId/allowedKinds/allowedObjects/expiresAt；响应不含 provider/providerUserId/token/tokenHash/principal |
| 3 | 跨租户/客户/身份拒绝 | 六种错位输入（含 null/空串/undefined）全部 available=false；外部 provider（wecom）active 绑定单独存在也不得恢复（JW_UPLOAD_PROVIDER 限定） |
| 4 | 过期/撤销不猜不恢复 | 邀请过期、绑定撤销、邀请撤销三种均 NO_ACTIVE_UPLOAD_BINDING；撤销后重复读取仍失败，无自动续期/新建 |
| 5 | 多邀请歧义 | 同一绑定幂等挂接第二邀请后 read 返回 AMBIGUOUS_UPLOAD_BINDING 且 invitationId=null——不挑最新 |
| 6 | GET零写 | 全读取矩阵（有效/跨域/过期/未知邀请 assertUpload）前后 `participant_bindings`+`intake_invitations`+`audit_log` 全表快照逐字节一致 |
| 7 | 事务回调与回滚 | 正例：回调经传入 tx 写探针行提交后可见、返回上下文与邀请绑定；反例：回调写后抛错→事务回滚、探针行零残留、已提交探针行不受影响 |
| 8 | 撤销锁竞争与线性化 | 见下方"锁顺序与线性化"；并发撤销 55P03、提交先于撤销不被追溯、撤销后读取/上传全闭、反向次序 fail-closed 回调不运行 |
| 9 | assertUpload 范围强制 | 真实SQL上 kind 不在清单、对象越锚定、空对象表、伪造 invitationId、错 principal 全部 CUSTOMER_SCOPE_MISMATCH；合法输入通过 |

### 独立HTTP适配器套件（tests/upload-context.http-bqa.test.mjs，6条，真实回环HTTP端口由系统分配）

| # | 用例 | 断言要点 |
| --- | --- | --- |
| 10 | 显式代理门 | 普通服务token/无代理配置/mayDelegateActor=false → ACTOR_NOT_DELEGABLE；缺租户白名单/跨租户 → TENANT_SCOPE_MISMATCH；伪造空actor → CALLER_NOT_TRUSTED |
| 11 | 适配器正常路径 | 服务端会话身份派生归属；`x-jw-actor-principal: forged-actor` 请求头被忽略；token/providerUserId 等秘密字段不出现在响应 |
| 12 | 无会话/无授权闭门 | 401/403 且上游 fetchContext 零调用；authorizeUpload 缺装配 → 503 UPLOAD_AUTHZ_UNAVAILABLE |
| 13 | 上游契约违反 | 上下文 customerId 不符或 available 非布尔 → 502 UPLOAD_CONTEXT_INVALID（不伪装）；两次授权租户漂移 → 403；授权 principalId 与会话不符 → 403 |
| 14 | 读取中撤权/掉会话 | 上游读取后二次授权被撤 → 403；读取中会话失效 → 401（读前后重验，不给跨读窗口） |
| 15 | 上游故障降级 | 上游异常 → 503 UPLOAD_CONTEXT_UNAVAILABLE（服务不可用，不伪装为"无绑定"） |

### 既有测试复跑（只读证据，不抵扣必测项）

- `node --test Back/Connectors/test/upload-context.test.mjs Back/Edge/test/upload-context.test.mjs` → **8通过/0失败，exit 0**（logs/existing-unit-tests.log）。
- `CONNECTORS_TEST_PG_PORT=25443 node --test Back/Connectors/test/upload-context.pg.test.mjs` → **1通过/0跳过，exit 0**（logs/existing-pg-test.log）：BACK_HANDOFF 记录的"专用测试PostgreSQL不可达"跳过点已在本包容器上补验（精确join、上传持锁期间撤销 55P03、撤销后拒绝）。

## 锁顺序与线性化（必测项明示）

- **锁顺序**：`withAuthorizedUpload` 在单条 SQL 内以 `FOR SHARE OF b, i` 同时取绑定行与邀请行共享锁（单语句，无两条锁获取之间的倒手窗口）；撤销走 `UPDATE participant_bindings SET status='revoked'`（行级 ROW EXCLUSIVE），与 FOR SHARE 冲突，必须等待上传事务终结。反向（撤销先持锁）则上传读取等待撤销事务终结后读到 revoked。
- **实测线性化次序**：上传事务持锁 → 并发撤销（独立连接池、`SET LOCAL lock_timeout='100ms'`）被阻塞报 55P03 → 上传提交（探针写入持久）→ 撤销此时才成功 → 其后读取 NO_ACTIVE_UPLOAD_BINDING、上传回调不运行。**先于撤销合法提交的写入不被追溯撤销**（任务明确不要求追溯；已实证保留）。
- **反向次序**：先撤销后上传 → fail-closed，回调零执行。

## 失败

无。

## 未测（含阻点，不因跳过计通过）

1. **阻点·A上传权限投影缺失**：`Back/A/src/domain/credit.ts:397` registerArtifact 写门与 `v2kit.ts:211` requireHuman 是唯一正式上传授权源，但无零写上传授权读投影可供 Edge 消费（`kernel-store.mjs:521` checkCustomer 不能证明 kind=human/上传种类/撤销状态）。按任务"不自创角色表或装配新路由"，本包未测也未伪造该投影；建议 CTRL 冻结投影契约（principalId/customerId/tenantId/canRead/canUpload/种类限制）后另包验收。
2. **端到端整链**：候选 Connectors service 与 Edge 适配器均未装配进共享 Edge 实例或公开 GET 路由（BACK_HANDOFF 明示"未装配"）；本包只测独立单元，**不能称上传恢复完成**。HTTP 授权面为合成替身，实际后端进程+本地替身的 HTTP 验收待装配后进行。
3. **跨对象存储原子性**：`withAuthorizedUpload` 未接原件对象存储与登记链；DB 事务原子性已验，**对象存储+DB 跨存储原子性未证明**。本包未触碰对象存储生产链。
4. **既有代理默认面**：既有默认 serviceToken 无租户白名单限制属产品行为，改契约归 CTRL，本包只验证新模块显式白名单语义。

## 不适用

- 前端页面/浏览器验收（任务禁止，Front/ 零接触）。
- 真实客户数据、付费模型、外网调用（任务禁止；全部输入为合成）。
- 已合法提交写入的追溯撤销（任务明确不要求；已实证行为为"保留"）。

## 输入与漂移

13 个输入文件（BACK_HANDOFF.md、Connectors upload-context 源+测试+helpers+store/intake/binding、Edge upload-context 源+测试、A credit.ts/v2kit.ts）执行前后 SHA256 逐字节一致（logs/sha256-before.txt / sha256-after.txt，diff 为空），无"待复验"项。测试执行期间未发生输入版本变化。

## 遗留

- 容器 `jw-bqa-r2-authup-pg` 保持运行供重复执行（登记于 RESOURCES.md；移除命令见该文件）。
- 既有测试文件与本包测试均未改动产品实现、未弱化断言；产品缺陷（授权投影缺失、checkCustomer 不可作上传授权源）以上述最小事实呈报，未代修。
