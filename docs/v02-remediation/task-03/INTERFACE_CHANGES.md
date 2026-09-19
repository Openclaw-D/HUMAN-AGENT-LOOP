# 任务03 · 接口变更登记（INTERFACE_CHANGES）

生效：CONTRACT §12（v2.5，2026-09-19）。共享契约文件 `Back/CONTRACT.md` 为唯一事实源，本文件是面向消费方的变更摘要。

## 新增（非破坏）

| 接口 | 语义 | 消费方 |
|---|---|---|
| `GET /api/v2/customers/:id/assessments?limit=&cursor=` | 按客户权威分页评估清单（内部专用；键集游标基于 id；排序 id 降序） | Edge 工作台快照（IR-03-A ②） |
| `GET /api/v2/customers/:id/financing-requests?limit=&cursor=` | 按客户权威分页融资申请清单（投影=单件 GET） | 同上 |
| `listArtifacts` 响应新增 `processing` 字段 | 每件材料最新处理状态 `{stage,runRef,failureReason,nextAction}|null` | Edge/页面（处理引用免 N+1） |

## 行为收紧（需消费方自查）

| 变更 | 旧行为 | 新行为 | 影响评估 |
|---|---|---|---|
| `GET /api/v2/assessments/:id`、`GET /api/v2/financing-requests/:frId` | 客户角色凭 grant 可读本客户单件 | 客户角色 403 `PERMISSION_DENIED`（内部专用，与清单/§11.2 口径一致） | Edge 服务端凭据（内部）不受影响；客户联系人身份本就无此 UI 入口 |
| 目录 `?search=` | 仅匹配 display_name | 匹配 display_name / customer_id / legal_entity_ref | 加法；授权过滤不变 |

## 明确不交付（本轮）

- IR-03-A ③（事件提交序/已提交水位/缺口检测根修）：分析结论与根修代价见 CONTRACT §12.5；A 侧零改动，Edge 现有窗口自愈缓解继续有效。

## 联调注意

- 清单游标 `nextCursor=null` 表示结束页；游标对重启/长历史稳定（仅基于业务 id）。
- `limit` 1..100（默认 20）；非法值 400。
- 授权语义：匿名 403；客户角色 403；越权/无 grant/跨租户统一 404（不泄露存在性）。
