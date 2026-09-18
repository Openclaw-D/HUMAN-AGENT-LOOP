# goal-01 跨路接口需求与提供面（2026-09-18）

本路（01）为下述接口的**生产者**；均已实现并冻结（CONTRACT §11），非 OPEN 项。
消费方（02/03/04）联调时如需变更，按任务书在本文件登记，由 01 版本化迁移。

## 提供 → 03（Edge/Front）

| 接口 | 用途（用户路径） | 备注 |
|---|---|---|
| `GET /api/v2/customers?search&limit&cursor` | J1.1 客户目录/搜索/分页（业务侧） | 内部身份专用；grant 模式只见获准客户 |
| `POST /api/v2/customers` | J1.1 新建客户（既有） | 只填业务字段，零内部 ID |
| `POST /api/v2/customers/:id/invitations` + `GET .../invitations` + `POST /api/v2/invitations/:id/revoke` | J1.1 受限邀请创建/查看/撤销 | code 明文仅创建响应一次，页面复制给客户 |
| `POST /api/v2/invitations/redeem` | J1.2 客户凭邀请码进入（匿名口） | 返回 `credential`（cit_*）明文一次；Edge 侧建议将其绑入会话（session 交换），过期/撤销/已用有专用错误码 410/410/409 |
| `GET /api/v2/my/materials` | J1.2 客户看逐件上传/解析/预审分段状态 | 白名单投影（stage/失败原因/下一动作）；不含内部证据元数据 |
| `POST /api/v2/invitations/redeem` 同 requestId 重放 | 旅程反例 9（响应丢失对账） | replayed:true，不重发凭据明文 |

需要 03 反馈的点：Edge session 交换是否直接持有 cit_* 凭据或代持刷新——本接口凭据长效（无刷新端点），若 03 需要"客户会话过期重登"请登记需求（可加邀请码重入或 Edge 侧会话续期，凭据本体不轮换）。

## 提供 → 02（B/C/Connectors）

| 接口 | 用途 | 备注 |
|---|---|---|
| `POST /api/v2/customers/:id/artifacts/:artifactId/processing` | 处理协调器把 received/parsed/analyzed/needs_review/failed 权威推进到 A | 仅 kind=service 身份；runRef 内阶段严格递增、新 runRef=新尝试；failed 必须带 failureReason+nextAction；确定性 requestId 纪律同 a_register |
| `GET /api/v1/receipts/:requestId`（既有） | 断网/超时后对账 | TIMEOUT_UNKNOWN 先对账不换 ID |

02 无需改动其证据登记路径（a_register 经 v1 project evidence 口不变）；G3 是**增量**推进状态的通道。

## 需要 → 04（验收方）

- 冻结旅程 J1.1/J1.2 的失败判据已可对本契约逐条对测（目录可见性、邀请拒绝码、my/materials 白名单、反例 9 对账）。
- 解耦反证：`test/invitations-directory.test.mjs` 的身份校验链与 grants 过滤可在隔离副本变异验证。
