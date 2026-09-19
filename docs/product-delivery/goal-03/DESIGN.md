# goal-03 设计（小范围）

目标：非开发人员从页面完成 新客户→邀请→上传→处理→补证问答→四域→方案→人工决定→结果留存。不重做视觉、不建三维、不造第二套审批状态机。

## 1. 架构与形态

- **双形态一入口**：`Front/dist` 单页应用由 Edge 同源托管（`--serve-front`）。顶部显式模式选择：
  - **训练演示**（保留既有 v5-preview 六角色模拟，标"训练"徽标，纯本地、不连后台）；
  - **真实办理**（受控登录 → 客户目录 → 客户工作本；全部数据经 Edge BFF，凭据不落浏览器）。
- 职责边界（任务书§2）：页面不实现审批状态机；Edge 只做身份/资源范围/BFF 投影/受控命令代理；权威全部以 A/执行回执为准。通用组件（site-mirror/lib）不 import 业务库。

## 2. 受控登录（路径一）

- Edge 新增 `GET /api/jw/v2/auth/identities`：仅当部署提供受控身份目录（`--auth-file`）时列出 `{principalId, roles, label, demo:true}` **不含凭据**；选择后 `POST /api/jw/v2/session {principalId}` 由 Edge 服务端查表换会话。手输凭据登录 `{credential}` 并存（真实身份）。
- 无角色下拉、无提权输入；会话响应的 roles 只读展示。fixture 形态仅 `harness-demo-cred`（明确标"合成演示"）。
- CSRF 守卫沿用既有 POST 四态；会话 TTL 30 分钟，撤权/过期 → 401/`auth` 帧终态要求重认证（既有语义）。

## 3. 客户目录与创建（路径一）

- 目录页三通道：搜索（按客户标识直查 A 单客户读，404=无权或不存在，不区分泄露）、新建（既有 `POST /api/v2/customers` 经代理白名单）、最近访问（本会话本地记录，明确标注非服务端清单）。
- 授权目录全量清单 = IR-03-1，落地前页面显式"目录清单待上游（IR-03-1）"。
- 新建成功 → 直接进入该客户工作本（不要求手填任何 ID）。

## 4. 客户工作本（路径二~六，任务书§4 布局）

客户为唯一工作上下文；切客户取消在途请求（沿用 use-edge-live 代际守卫）。骨架：

```
┌ EdgeStatusBar（模式/连接/版本/能力）──────────────┐
│ 主体区（当前工作面板，页签切换） │ 右栏（详情/待办/四域格） │
│  材料·原件 │ 核验 │ 问题·补证 │ 方案·决定 │ 结果     │ 待办(next-actions)  │
│                                                │ 四域矩阵(复用)       │
├ 底部沟通常驻（复用 HomeChat：受众 customer/internal 显式分）──┤
```

- **材料·原件**：文件选择上传（Edge `POST /api/jw/v2/customers/:id/originals`，≤512KB，临时信封 v0 见 IR-03-3）、材料清单（A listArtifacts：版本/取代链/口径 materialMeta/objectRef/核验等级/独立证明数/派生缺口/事实冲突）、原件预览（IR-03-3a 落地前显式"预览待上游"，不伪造）。
- **核验**：材料等级展示（客户申报恒 unverified）、校正=登记取代件（supersedes，内容相同被 A 拒绝）、复核=findings 登记与 resolve（引用现行证据）、版本与矛盾（factConflicts 逐条显示）；核验操作与正式决定分属不同角色权限（A 结构保证）。
- **问题·补证**：检查会话 next-actions 驱动；提问（audience/targetRole 必选，Edge 只读透传 + 既有代理写）、回答按 target_role 授权、暂停自动提问（outbound pause 既有动作）、人工接管（takeover）；内部沟通与对客户消息分列（Edge messages audience 既有）。
- **方案·决定**：decision-status 权威投影（候选/已批/可用/阻断/依据包当前性/报告引用）+ 评估候选（candidate，authority=none 明示）+ 正式动作（facility approve/activate 等，二次确认对话框显示动作/对象/requestId，幂等键稳定、冲突 409 显文案；候选≠批准≠可用文案直出 A 字段）；资金申请 reserve/commit/disburse 对有权角色开放（use-readiness 阻断先行展示）。
- **结果**：decision_records/正式回执（requestId 可对账，Edge receipts 既有）、报告三视图导出（Edge 新增只读透传 json/markdown 下载，文件名带客户与版本）、刷新/重登恢复（服务端状态 + workspace 快照，本地不存业务事实）。

## 5. 异常与权限语义（任务书§4）

- 失联/撤权：保留真实模式错误态（401/403/auth 帧 → 要求重认证；404 断流）；不转模拟成功。
- 提交未知结果：保留 requestId 对账入口（复用 edge-client.receipt）；重复点击由幂等键吸收（同载荷 replayed）。
- 颜色语义沿用既有：绿=指定事项完成≠授信通过；蓝=进行中；红=禁止/失败；灰=未知/未开始；均带文字。
- 未接入能力显式标"未接入"：原件预览（IR-03-3）、视频/三维（D27-S/BLOCKED）、真实外发渠道（企微等，页面内消息办理）。

## 6. 实时与性能（任务书§5）

- 沿用 kernel-store 分桶缓存/在途合并/事件缓冲 + use-edge-live 代际/退避/去重/502 对账；新增读透传端点不引入新缓存层（直接按会话凭据转发，A 是唯一裁决方）。
- customer-only 会话：A 既有策略禁其事件流/证据清单（403）——Edge 对该类会话降级为"快照+手动刷新"模式，如实展示，不伪装实时。
- 性能重点实测四项：首屏（同源静态）、workspace 快照、关键提交（决定动作经代理 RTT）、事件更新延迟（SSE 帧到达）；不虚构百分点，结果记 TEST_RESULTS.md。

## 7. 测试策略

- Edge 非 e1（本路）：新增端点逐个测试（受控身份目录无凭据泄漏、originals 信封与上限、报告/检查读透传错误透传、目录搜索降级语义）；helpers 自足栈扩桩上游。
- Front 纯逻辑测试（node --test strip-types）：workbench-logic（上传信封编码与上限、决定确认流状态机、409/401 文案映射、受众分列规则）。
- 真实浏览器（主执行者亲自驱动，非静态检查）：两个隔离会话（办理人 business vs 复核/approver；另以启动期 customer 角色静态 principal+grant 验证客户侧权限隔离）走 C1/C2 真实操作路径；invitation 运行时创建在 IR-03-2 落地前如实 BLOCKED。
- 全量回归：Edge run-all + Front test + typecheck + build（dist 重建交付）。
