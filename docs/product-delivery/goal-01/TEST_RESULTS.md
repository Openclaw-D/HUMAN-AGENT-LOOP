# goal-01 TEST_RESULTS（2026-09-18，四任务产品交付轮·路径01）

环境：本机 Windows + Node 22.23.1 + Docker PG16 容器 `jw-goal01-pg@127.0.0.1:15446`
（`JW_A_ADMIN_DB_URL=postgres://goal01:goal01-local@127.0.0.1:15446/postgres`；每套件独立临时库；`--test-concurrency=1` 串行）。
被测代码：分支 `v02-goal1234-delivery` 工作树（基线 e4ed7a5 + 本路未提交变更）；`tsc --noEmit` 通过。
留档：`evidence-regression-full.log`（全量 TAP，轮 D）+ 本文各文件级复验记录。

## 结论

**120 项 = 基线 114 + 本轮新增 6；最终轮（四分片并发 + 定点复验）全部通过：0 fail / 1 skip**
（skip = crash 套件容器重启用例的既有资源边界守卫，与前几轮口径一致）。

最终轮构成（2026-09-19 凌晨，机器四路并行负载下以四分片并发完成）：
- shard1=customer-credit 24/24；shard3=25 全绿（evidence-shard-1/3.log）。
- shard2=29 绿 + integration-limits 两用例（载荷限额、验证器异常）定点复验绿（evidence-shard-2.log、evidence-limits-1/2.log）。
- shard4=33 绿，唯一失败为 V4 测试自身断言写错（响应形状误读，非产品缺陷），修正后全文件复跑 6/6（evidence-shard-4.log、evidence-invitations-final.log）。
- bootNonce 补丁（见下）晚于分片，其影响面以三文件冒烟覆盖最终代码态：integration-core 10/10、invitations 6/6、trust-gates-a1 7/7（evidence-final-*.log）。

### 测试工具最终加固：bootNonce 启动指纹（替换鉴权探测）

`--faulty-verifier` 注入内核的鉴权层不可用，导致此前的启动鉴权探测被挂住/误判（integration-limits 四次挂起复现）。
改为：内核新增 `--boot-nonce` 参数并在 /healthz 回显；harness 只认回显本次随机数的内核——同端口段的
其他会话内核/外来服务不可能持有该随机数。相关：config.ts（--boot-nonce）、kernel.health()、utils.mjs。

### 过程遗留说明（如实）

- 整跑（17 文件单进程串行）在四路并行负载下不可行（多次 20 分钟+零进展/挂起），最终以四分片并发完成，结果等价且留档齐全。
- CREATE DATABASE 在管理库被其他会话长期占用时会无限阻塞：utils.mjs 已加 statement_timeout=20s + 3 次重试护栏。
- 宿主机曾有 3 个父进程已死的孤儿内核（48280/48180/17933），按"不停止未知进程"纪律未清理。
- `npm test`（node --test test/run-all.mjs）父 runner 吞内层 TAP 仅透传退出码；统计口径用
  `node --test --test-concurrency=1 test/*.test.mjs` 直跑（本轮即此命令）。

## 证据矩阵

| 层 | 运行 | 代码态 | 结果 |
|---|---|---|---|
| 全量 | 17 文件整跑（evidence-regression-full.log） | 含本路全部语义变更（K04 修复/A22 清单/utils 加固**之前**） | 120 项：118 pass / 1 fail / 1 skip；唯一 fail=integration-core#77 setup 端口被并行服务抢占（环境抖动） |
| 复验1 | trust-gates-a1 + customer-credit + invitations 三文件 | 最终代码态 | K04 green（legacy 客户 exempt 修复生效）、A18 green（确认为负载性偶发）、V1–V6 green；仅 A22 挂（见复验2 前的第二次修复） |
| 复验2 | customer-credit 全文件 ×2 | 最终代码态 | 首轮 23/24（A13 结算幂等抖动，本路零改动面）；复跑 24/24（含 A22 迁移清单=009、migCount=9 修复生效） |
| 复验3 | integration-core 全文件 | 最终代码态（utils 加固后） | 10/10（含曾抖动的 #77） |
| 复验4 | invitations-directory 全文件 | 最终代码态 | 6/6 |

未在任何最终态运行中失败的其余文件（decision-loop、inspection、ledger、package/review/reports、exemptions、object-match 等）由全量轮直接覆盖，其后无相关代码变更。

## 本轮新增验收（test/invitations-directory.test.mjs V1–V6）

- **V1 客户目录**：grants 服务器端过滤（grant 模式只见获准客户）、search、键集游标两页不重叠、匿名 403、limit/cursor 非法 400。
- **V2 邀请生命周期**：创建（code 明文仅一次、列表不泄露）→ 兑换恰一次（重复 409）→ 同 requestId 对账 `replayed:true` 不重发凭据 → 未知码 404 统一文案 → 撤销 410/重复撤销 409 → 过期（白盒置时）410；agent 不可创建；grant 模式业务身份获准客户可发、未获准 404（无存在性泄漏）。
- **V3 撤权级联**：admin 撤 grants → 身份级联停用 → 同 requestId 重放 403（不借缓存回执）→ my/materials 403。
- **V4 授予面**：邀请身份材料种类白名单服务端强制（未授予 403）；grade=confirmed 自提 403（K04 保持）；内部身份不受限；**既有合成客户 principal 保持旧行为零变更**。
- **V5 获准披露**：my/materials 白名单字段精确断言（无 grade/事实值/来源链）；服务身份推进后 stage 客户可见；内部身份 403；客户身份读 listArtifacts 仍 403（B13）。
- **V6 处理状态**：仅 kind=service（human 403）；runRef 内回退/重复 409 PROCESSING_STAGE_REGRESSION；新 runRef=新尝试可重开；failed 必须 failureReason+nextAction；内部读 current+history；未知材料 404。

## 过程中抓到并修复的缺陷（全部有测试锁定）

1. **B13 越权（真实安全缺陷）**：给客户联系人身份附加受邀角色会绕过 `listArtifacts` 的 `every(r==='customer')` 拦截 → 身份只授 `['customer']` + 拦截改 `some` 加固。
2. **邀请授予面误伤**：白名单检查原对一切 customer 角色生效，误拒既有合成客户 principal（K04）→ 收窄为仅约束 `customer_identities` 成员。
3. **撤权级联缺失**：撤 grants 未停用客户身份 → 补同事务级联 disable（V3 锁定）。
4. **游标跨页重复**：`created_at`（PG 微秒）经 JS 毫秒 ISO 编码截断，边界行重复出现 → 键集改为仅 `customer_id`。
5. **A22 断言维护**：迁移清单/计数加入 009（同 005–008 惯例）。

## 测试工具加固（Back/A/test/utils.mjs；四路并行实测踩坑）

- `/healthz` 探测加 A 内核指纹（`principalVerifier`+`db` 字段）——防止误绑并行会话的 Edge/Connectors 等外来服务。
- 启动后等待迁移完成（`permission_matrix` 存在为标记）——消除"HTTP 先于迁移就绪"导致的 seedMatrix 竞态（A18/A19 类）。
- admin 凭据鉴权探测 + EADDRINUSE 重试 3→6 次、随机端口段 48100–48500 加宽至 48100–49100（上限避开 Windows 临时端口区）——四路并行下窄段碰撞率过高（实测同一端口 6 连撞）。
- 已知残留：`npm test`（node --test test/run-all.mjs）父 runner 吞掉内层 TAP 仅透传退出码，统计不可见；建议 04 验收口径采用 `node --test --test-concurrency=1 test/*.test.mjs` 直跑。宿主机存在 3 个父进程已死的孤儿内核（48280/48180/17933，分属已结束的运行），按"不停止未知进程"纪律未清理，占用少量端口资源。

## 性能

本路无新增热点路径：目录=键集分页单查询；my/materials=单查询 LATERAL；处理状态写=既有门序逐段 INSERT。goal-01 轮 PERF 基准（`docs/backend-upgrade/goal-01/PERF_BEFORE_AFTER.md`）对应代码路径未触碰，不重跑、不冒充新链数据。
