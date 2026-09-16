# INTERFACE｜现有接口映射与本轮新增契约

## 现有接口（保留，不动）

| 端点 | 语义 | 关键机制 |
| --- | --- | --- |
| GET `/api/v5-preview/project` | 业务可见总览投影 | 每次读盘，损坏→STORE_CORRUPT |
| POST `/api/v5-preview/notes` | 补充说明（requestId 幂等 + expectedVersion OCC） | 幂等重放先于版本门；404 NOT_FOUND 不含内部 todoId |
| POST `/api/v5-preview/messages` | 项目沟通 | 同上（V6-CTRL A） |
| POST `/api/v5-preview/demo/seed` | 演示控制·非业务操作 | 版本全局单调递增，幂等表清空 |

持久化：`rows-store.json`（schema `v5-preview-rows-store@1`）= overview + idempotency；深递归失败关闭校验。**本轮零迁移**。

前端既有恢复机制：恢复记录 `jw:v5-preview:pending-note-request`/`-message-request`（完整原载荷 + 情景归属）；草稿-请求关联 `{requestId, revision}`；`shouldApplyOverview`（版本）+ `shouldApplyWriteResponse`（当前情景上下文）+ `isSameRequestOwner`（回执所有权）——全部保留且远程尽调写路径**复用同一套模式**。

## 本轮新增契约（remote-*，独立存储文件）

存储：`remote-store.json`（schema `v5-preview-remote-store@1`，与 rows-store 完全独立、零迁移）；全局 `version` 单调递增供 OCC；自带幂等表（requestId→hash→响应）。

| 端点 | 语义 | 核心规则 |
| --- | --- | --- |
| GET `/api/v5-preview/remote-session` | 会话列表+详情（参与者/出席/视频状态/证据/标注/复核/计算状态投影） | sessionId↔projectId 绑定；跨项目引用拒绝 |
| POST `/api/v5-preview/remote-session` | 创建会话（requestId+expectedVersion） | 重复 requestId 幂等重放；版本冲突 409+serverVersion |
| POST `.../remote-session/evidence` | 附着合成 fixture 证据（sourceType=simulation_fixture） | 仅明确标识的静态 fixture（fixtureId 白名单），不开放任意 URL/上传 |
| GET `.../remote-session/fixture/[fixtureId]` | 确定性合成测试图形（SVG，显著"合成测试证据"标记） | 白名单 id；不走外网 |
| POST `.../remote-session/annotations` | 圈选标疑+提问（归一化坐标 0..1，绑定 evidenceId+evidenceVersion） | 无证据/版本不符→404/409；悬空标疑不存在 |
| POST `.../remote-session/annotations/replies` | 追问回复（kind = model_simulation / business / domain） | model_simulation 显式标注，模型无正式权力 |
| POST `.../remote-session/reviews` | 人工复核（action=confirm/correct/request_resupply/request_retake/pause_round/escalate_human） | 绑定目标类型+目标版本；证据/问题更新后旧确认显示"已过期"（按版本比较计算，不自动继承） |
| GET `.../remote-session/rule-config` | 规则配置（技术质量/证据充分性/业务风险/经济性四层） | 当前全部 `unconfigured`；未知值不是 0，缺配置不是通过 |
| POST `.../remote-session/calculation` | 经济性核算尝试 | 未配置口径→`not_configured`+所需输入清单；负收益 fixture→`blocked`（响应与界面标注"测试输入，非实际核算"）；不产出可执行授信/期限/价格建议 |

### 视频 adapter 状态机（本轮 not_configured 为唯一真实态）

`not_configured → connecting → connected ⇄ reconnecting → failed / ended`。当前实现：页面可进入查看，加入/采集操作返回"视频服务未接入"；**不创建媒体流、不申请设备权限、无定时采集、无网络请求到任何 provider**。`simulation` adapter 为显式开关+显著"模拟会议"标签，fixture 不可晋升 live。真实 provider 未来经服务端授权取短期会话凭证，凭证不进源码/URL/日志。

### 出席与身份语义

`on_site_declared`（自报现场）≠ `on_site_confirmed`（本轮依据确认）≠ `live_only`（仅实时入会）；`attendanceVerified` 单列。客户陈述、模型提取（simulation）、人工核实三类来源在证据/复核中分开显示。服务端决定参与权限；浏览器提交更高 role 不可信。身份未配置→失败关闭，不开放跨项目/未知用户访问。

## 暂停/过期/未知精确语义

- **过期**：review.targetVersion < 目标当前 version → 界面显示"已过期（针对 vN）"，不自动继承。
- **未配置**：RuleConfig 各层 null → 相关状态显示"待配置"，不产生可执行建议。
- **未知（网络）**：写请求 NETWORK → 保留完整原请求（复用 pending-request 模式），可原样重试；确定性响应清记录。
- **暂停本轮判断**：pause_round 复核动作 = 会话级标记，不终止沟通。
