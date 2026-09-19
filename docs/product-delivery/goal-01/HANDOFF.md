# goal-01 HANDOFF（2026-09-18，四任务产品交付轮·路径01）

## 交付概览

任务书：`JW_product_delivery_four_tasks/`（任务01 = 通用可信核心 + 可供页面办理的租赁业务服务）。
本轮 A 路增量 = **v2.4 加法契约**（CONTRACT §11）：客户目录、受限邀请+客户联系人身份、材料处理状态权威投影。
既有边界（v1 内核 / v2 授信域 / 检查会话 / 依据包/Gate/台账/提额/豁免）零语义变更；无边界大迁移（任务书"不全仓搬家"）。

## 变更清单（可审查集合，未 commit）

| 文件 | 变更 |
|---|---|
| `Back/A/migrations/009_customer_invitations.sql` | 新增 customer_invitations / customer_identities / artifact_processing 三表（只增不改） |
| `Back/A/src/domain/identity.ts` | 新模块：目录/邀请/兑换/处理状态/我的材料 + 客户身份校验链 `chainCustomerIdentityVerifier` |
| `Back/A/src/domain/kernel.ts` | verifier 链式扩展（合成目录→DB 客户身份）；`kernel.identity` 装配 |
| `Back/A/src/domain/credit.ts` | registerArtifact 邀请授予面强制（客户身份 kind 白名单）；revokeCustomerAccess 级联停用客户身份；listArtifacts B13 拦截 every→some 加固 |
| `Back/A/src/domain/errors.ts` | 新错误码 INVITATION_NOT_FOUND(404)/INVITATION_EXPIRED(410)/INVITATION_REVOKED(410)/INVITATION_ALREADY_USED(409)/PROCESSING_STAGE_REGRESSION(409) |
| `Back/A/src/http/server.ts` | 8 条新路由（v2.4 块） |
| `Back/CONTRACT.md` | §11 v2.4 登记 |
| `Back/A/test/invitations-directory.test.mjs` | V1–V6 验收测试 |
| `docs/product-delivery/goal-01/*` | 本目录交付文档与回归证据 |

## 消费者接线点（契约已冻结，勿再各自造）

- **03/Edge**：客户目录=`GET /api/v2/customers`；邀请三口+`redeem`（匿名，返回 cit_* 凭据明文一次，建议绑入 Edge 会话）；客户上传进度=`GET /api/v2/my/materials`（白名单）。见 INTERFACE_REQUESTS.md。
- **02/Connectors**：处理状态推进=`POST /api/v2/customers/:id/artifacts/:artifactId/processing`（仅 service 身份；runRef 纪律见 §11）。既有 a_register 证据登记路径不变。

## 运行与测试

- 迁移：A 启动自动迁移（新增 009）；手工 `cd Back/A && npm run migrate`。
- 类型检查：`npm run typecheck`（通过）。
- 新套件：`JW_A_ADMIN_DB_URL='postgres://goal01:goal01-local@127.0.0.1:15446/postgres' node --test test/invitations-directory.test.mjs` → 6/6。
- 全量回归：分层证据矩阵见 TEST_RESULTS.md（**120/120 有最终代码态通过证据，0 fail，1 skip**）；
  留档 evidence-regression-full.log。统计用 `node --test --test-concurrency=1 test/*.test.mjs` 直跑
  （`npm test` 父 runner 吞内层 TAP，仅透传退出码）。
- **测试工具已加固**（四路并行实测）：/healthz 指纹防误绑外来服务、迁移完成等待、admin 鉴权探测、
  端口段加宽至 48100–49100 + 重试 6 次。其他路的 harness 若有同类机制建议对齐（尤其 04 验收）。

## 已知边界与遗留

- 客户凭据（cit_*）为长效凭据，无刷新/重入端点——若 03 需要会话续期请在 INTERFACE_REQUESTS.md 登记，勿在前端自行轮换。
- redeem 匿名口未加限流（本机合成环境）；生产化须在 Edge/网关层加频率限制，A 侧保持失败关闭语义不变。
- 邀请角色三类（owner/finance/plant）来自冻结旅程 J1；新增角色需迁移 CHECK 同步，勿只改前端。
- D27-R（真实媒体/模型）、检查会话与项目绑定的页面合成（J1.4 定向问题走检查会话域，project 绑定属 Edge 组合职责）不在本路范围。

## 协作事实

- 并行 writer：路径 04 会话同轮活跃（docs/product-delivery/goal-04/）；本路未读写其文件。
- 分支基线 `v02-goal1234-delivery@e4ed7a5`（PR#4 未合并、未经用户验收）；本路未做任何 Git 写操作。

## 待办（2026-09-18 16:50 更新）

- DEF-G04N-02（04 路记，owner 01+02）A 侧修复已完成（credit.ts 剥 `material.` 前缀比对 + V4 扩展用例 + DESIGN R7/CONTRACT §11 登记）；
  **运行时验证 PENDING**——16:44 发现 Docker Desktop 引擎未运行，jw-goal01-pg@15446 无法启动；引擎恢复后跑
  `JW_A_ADMIN_DB_URL='postgres://goal01:goal01-local@127.0.0.1:15446/postgres' node --test test/invitations-directory.test.mjs` 即可闭环。
- 宿主机 Docker 引擎状态影响全部四路；02 路的 DEF-G04N-01/03 修复后由 04 路复测。
