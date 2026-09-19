# goal-03 HANDOFF（2026-09-19 续轮·冻结旅程 J1.1–J1.5 页面做实）

## 本轮交付了什么（任务书三 C2 收口轮）

在 goal-03c 工作本（受控登录/目录/六页签/门户/邀请）之上，把冻结旅程 J1.1–J1.5 对 A CONTRACT §11 v2.4 与 02 路处理链做实：

- **Edge（本路 src）**：
  - 只读代理新增 A `decision-status`/`domain-exemptions`；新增 **Connectors IR-02-C 消费面**（`/api/jw/v2/connectors/**`：processing/status、tasks/:id?tid、evidence/preview 签名 URL）——`--connectors-url` + `--connectors-token-file`/`JW_CONNECTORS_TOKEN`（服务令牌仅存服务端内存，浏览器不持有）。
  - 动作代理新增 **DELETE 方法**（CSRF 同 POST 管辖）+ `DELETE customers/:id/grants/:principalId`（IR-03-7 页面化撤权）+ `POST customers/:id/domain-exemptions`；新增 CONNECTORS 写面白名单（intake 邀请/接受、evidence/upload、manual-entry、correct-fact、questions/answer|verify、processing/pause），requestId 纪律与 A 面一致。
- **Front（workbench）**：通道卡（邀请-绑定-上传-分段进度-任务回执-A 留痕-预览-暂停）；G3 逐件处理状态；通道人工路线（批量转录/更正）；通道补证问题（回答+获准复核 verified）；检查会话收口按钮；依据包冻结表单（Gate 引用自动同步通道回执+四域依赖+豁免+收口引用）、包详情（四域意见/缺口）、域意见登记（域角色限定+真实 runId）、信审候选表单+提交复核、包绑定提案；邀请页 admin 撤权。
- **契约**：`consumed-surface-v1.json` → `goal03d-1`（上游 Channel 面与鉴权纪律登记）。
- **测试**：Edge 非 e1 **46/46**（新增 g03d 5 项）；Front **32/32**（修复 npm test 漏挂 wb-logic；通道投影 4 项新用例）；typecheck 0 error；dist 重建。
- **文档**：BASELINE（续轮资源表）/TEST_RESULTS（重写：15 项浏览器路径+4 项 PARTIAL）/INTERFACE_REQUESTS（IR-03-2 撤销原提案、IR-03-7 关闭、IR-03-8①–⑤ 新登记）/PAGE_INVENTORY/本文件。

## 给 04 路（验收装配）

1. 栈命令与端口见 BASELINE 续轮表；`jw-g03c-pg/A17933/Connectors17937/Edge17935` 本轮结束后保持运行，可直接复用（或按命令重建）。
2. 部署初始化清单（非用户路径，均已记审计/`linked_by`）：主客户建档、规则包 1.0.0 激活、必需域政策种子、`a_customer_links` 表直插、客户检查会话种子（`tools/seed-g03c.mjs`）。
3. 正向批准（Gate=CLEAR）需材料满足规则前置（source_supported 事实）——当前合成薄材料的 NEEDS_EVIDENCE 是**设计内诚实阻断**；04 可用其生成器一致组按 02 路接缝裁决后补测（IR-03-8①②）。
4. 浏览器自动化注意：IAB 不支持原生 file chooser（用页面上下文注入真实字节）与 window.prompt（面板已改为行内输入）。

## 已知边界与遗留（如实）

1. my/materials stage 恒 registered（G3 写口待 02，IR-03-8①）；通道分段进度页面已接 IR-02-C。
2. 人工录入事实不进 B 分析快照（IR-03-8②）；intake 判重租户级+绑定幂等空转（IR-03-8③）；会话材料前置裸 kind（IR-03-8④）；a_customer_links 种子不透传（IR-03-8⑤）。
3. 客户在检查会话线程内直接回答待 01 路接口（IR-03-6 扩展）；A 档案信封件预览待 A 单件读端点。
4. Edge 会话内存态（30min TTL、重启重登）与客户兑换登记内存态维持 S3 边界未扩大。

## Git 状态

未 commit/push（任务书纪律）。本续轮变更集：`Back/Edge/src/{proxy,readproxy,server}.mjs`、`Back/Edge/test/g03d-decision-channel-surface.test.mjs`（新）、`Back/Edge/contract/consumed-surface-v1.json`、`Front/site-mirror/app/workbench/{channel-card.tsx(新),originals-panel,verify-panel,qa-panel,proposal-panel,invitations-panel}.tsx`、`Front/site-mirror/lib/workbench/{wb-client,wb-logic}.ts`、`Front/preview/test/wb-logic.test.mjs`、`Front/package.json`（测试入口补挂）、`Front/dist/**`（重建）、`docs/product-delivery/goal-03/**`。

---

# goal-03e 补充交付（2026-09-19 下午·三路目标 ⑨⑩⑪）

## 交付内容

- **⑩ DEF-G04N-05（消息线程双向）**：Edge 新增 `src/message-store.mjs`（按客户有界线程存储）+ `GET /api/jw/v2/customers/:id/messages`（会话必需 + messages:read + 目标客户可读校验同发送面；customer-only 会话强制 audience=customer，显式 internal → 403；`?after=<cursor>` 增量、`?limit`≤500）；消息路由投递成功后入栈（requestId 幂等重放不二次入栈）。前端：`wb-client.listMessages/fetchChannelObject`、wb-logic 纯函数 `mergeThread/remoteThreadRows`（远端权威+pending 按 requestId 退出不双显）、BottomChat 与客户门户 4s 轮询双向渲染（sender 归属、送达态）。
- **⑨ DEF-G04N-04（页面侧包绑定提案）**：路B已冻结 CONTRACT §11.1（平铺 `packageId`——与页面既有实现一致）。本轮补强：facility.propose 确认计划含「绑定依据包」行（配套用例）、409 BASIS_PACKAGE_REQUIRED 业务语言映射用例；浏览器全链实证=页面冻结→评估→候选→送审→带包提案 200（见 TEST_RESULTS goal-03e §2.4/2.5）。
- **⑪ IR-03-3 / CONTRACT §11.2（预览消费）**：Edge 读面新增 A `artifacts/:artifactId/content` 只读代理（404 语义原样透传）+ 通道签名 URL 归一代理 `/api/jw/v2/connectors/objects/:ref`（**raw 字节透传、content-type 保留；修复相对 URL 被同源 SPA 兜底吞掉的预览断链**）；前端 originals-panel 材料行「预览」（信封件 image=text 内联/其余下载；非信封件如实显示无字节）与 channel-card 面内预览（魔数嗅探 PNG/JPEG/GIF 内联、CSV 文本内联、其余下载）。
- 消费面契约 revision → `goal03e-1`。

## 给 04 路 / 01 路

1. A@17933 运行实例未部署 §11.1/§11.2（svc 身份、content 读回）——页面/Edge 已零改动待命，A 重启后 A 档案件预览即亮。
2. 页内消息线程为 **Edge 本地面**（内存、30min 会话解绑后线程仍在、Edge 重启即清空），不入 A 契约；对外投递（企微等）仍属任务02 边界。
3. 独立验证段 Edge `17947`（git-ignored 日志 `.run-g03e/`）本轮结束后保持运行；`17935` 未动。

## 已知边界（如实）

1. A 档案件预览在运行栈暂为诚实 404（上游未部署），页面不伪造。
2. 通道 PNG 判 FORMAT_UNSUPPORTED→needs_followup（02 路设计内），预览不受影响。
3. 消息线程仅在 Edge 进程内存（有界 500/客户）；不落库、不进 Git。
