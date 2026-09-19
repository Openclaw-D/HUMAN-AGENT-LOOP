# ROUND-LOG｜产品交付四任务轮·跨会话协调日志

用途：本轮唯一跨会话消息总线。只读监控会话在此发布巡检发现；各路 writer 在自己小节下回执。
规则：**追加不覆写**；每条带时间戳与会话标识；各路只写自己小节；分歧由用户裁决后标记 DECIDED。
Writer 划分：本文件由监控会话（协调）维护结构；各路只追加自己小节内容。

---

## 2026-09-18 04:5x｜监控会话巡检 #1

状态：四路均活跃。01 已建 identity.ts/迁移009/invitations-directory.test.mjs；02 已建 a_bridge.mjs、改 coordinator/schema；03 已建 readproxy.mjs、g03c-workbench-surface.test.mjs；04 合成原件包 run1 已生成（执照/流水XLSX/合同PDF/铭牌/现场照）。

### 动作项 → 01（goal-01 writer）

1. [契约分歧·待裁决] 目录形状：你冻结 G1 = cursor 分页 + `{customerId,name,status,createdAt,createdBy}` 无 total；03 已按 IR-03-1 实现消费侧 = offset 分页 + `legalEntityRef` + `total`。二选一：(a) G1 加法修订兼容 offset/total/字段名（按 customers 表真实字段）；(b) 维持冻结并书面回执 03 适配。
2. [契约分歧·待裁决] 邀请流程：你 = code+redeem 两步流 + POST revoke + 过期410；03 IR-03-2 = 创建即返凭据一步流 + DELETE + 403，另要求 409 INVITATION_ROLE_NOT_ALLOWED / INVITATION_LIMIT。两步流安全性更优，请正式回执 03 你的语义，并裁决两条错误码是否纳入 v2.4。
3. [接线] G3 写口（`POST .../artifacts/:artifactId/processing`）需主动推给 02：02 的 DESIGN 未引用该写口，其 7 段游标与你的受控序列（received→parsed→analyzed→needs_review|failed）无映射表。02 已开始写 a_bridge，请尽快把映射与端点契约落进 CONTRACT §11 或本目录文档。

### 动作项 → 02（goal-02 writer）

1. [接线] 在 a_bridge 实现 01 的 G3 处理状态写口（service 身份、阶段单调、runRef 幂等），游标推进同步上报。建议映射：register_material→received、parse→parsed、analyze→analyzed、人工环节→needs_review、失败→failed。否则 03 客户进度页（my/materials）无权威数据源。
2. [架构对齐] 与 03 对齐上传权威入口：03 现走 Edge 直登 A（materialFile base64 信封，过渡）；你 B1 = 字节进 Connectors→a_bridge 登记 A（符合任务书）。需明确：信封何时废弃、B2 支持格式后 Edge 是否改代理 Connectors intake、同一原件两链路 artifactId 如何经 a_customer_links 合一（避免 A 双工件）。

### 动作项 → 03（goal-03 writer）

1. [契约分歧·待裁决] IR-03-1/IR-03-2 与 01 冻结形状差距大（见 01 小节 1/2），请现在协商：把 IR 改为"以 01 v2.4 为准"的适配注记，或向 01 提具体反提案。不要等落地后返工。
2. [边界] IR-03-3-b（A 侧对象存储）与任务书"Connectors 负责字节"冲突，01 本轮不做存储；预览归宿 = 02 已有签名 URL（`/objects/:ref`）经 Edge 受控代理。IR-03-4 本轮 01 明确零改动，维持"事件窗口非权威"标注正确。

### 知会 → 04（goal-04 writer）

前三路上述分歧推迟 J1.1/J1.2 达成；相应项维持 BLOCKED 等收敛。合成原件包与 02 B2 格式范围对齐良好；最早联调点 = 02 B1；XLSX/text-PDF（B2）是 J1.2 六件套全通关键路径。

### 回执区（各路只写自己小节）

（暂无）

---

## 2026-09-19 03:0x｜03 路（goal-03 续）回执

J1.1–J1.5 页面做实完成（Edge 非 e1 46/46、Front 32/32、dist 重建、浏览器双会话自证 15 项）。关键事实与跨路事项：

1. [接线完成] 02 路 IR-02-C 消费面已全量页面化（Edge `/api/jw/v2/connectors/**` 服务令牌代理；页面：通道邀请/绑定/上传/分段进度/任务回执 A 留痕/预览/人工录入/更正/问答/复核）。→ 02 请确认。
2. [缺陷候选→02] IR-03-8①：a_bridge 未调 A G3 处理状态写口，my/materials stage 恒 registered（ROUND-LOG #1 派单项仍未落地）。②：B 分析快照只取 parse declaredFacts，manual-entry 事实不进四域输入→Gate 无法被人工路线满足。③：intake 判重租户级+绑定幂等空转（跨客户同字节判重、既有绑定后新邀请无法 accepted）。详见 goal-03/INTERFACE_REQUESTS.md。
3. [缺陷候选→01] IR-03-8④：检查会话 start 材料前置按裸 kind 匹配，通道登记件为 `material.<kind>`（DEF-G04N-02 页面侧体现，本轮以 A 档案直传绕开）。另 IR-03-6 扩展：cit_* 客户身份不在 v1 会话名册，无法在检查线程内回答。
4. [给 04] 本路栈保持运行（15456/17933/17937/17935；凭据见 git-ignored 配置），部署初始化清单见 goal-03/BASELINE.md 续轮表；J1.5 正向批准待 Gate=CLEAR 材料（设计内诚实阻断已页面证明，缺口明细页面可见）。

---

## 2026-09-19 04:3x｜01 路（goal-01 路B）开工回执：⑦⑧ 接口形状冻结（本轮时序硬要求项）

已受理四项：④ IR-03-8④、⑥ IR-03-6、⑦ DEF-G04N-04 A侧、⑧ IR-03-3。**⑦⑧ 形状已冻结进 `Back/CONTRACT.md` §11.1/§11.2（只增不改），终版如下；实现与新用例随后，完成后在本文件追加终验回执。如实现期须偏离，先在本小节声明再改契约。**

### ⑦ DEF-G04N-04 A 侧 = 交付运行时服务身份（§11.1）

- 迁移 `010_service_identities.sql`：`service_identities`（credential 仅存 sha256；status active/disabled）。
- 身份链加法：合成目录 → customer_identities 未命中 → **service_identities** → Principal `{kind:'service', roles:['service'], tenants:[绑定租户], customers:'all'}`。既有 service 三口与 createPackage 门语义**一字不动**。
- API（admin 人类专用）：
  - `POST /api/v2/service-identities` `{requestId, tenantId, displayName?}` → `{principalId(svc_*), credential(明文仅此一次), tenantId, status:'active'}`；403 非人类/非 admin；重放不重发明文。
  - `GET /api/v2/service-identities`（列表，无凭据字段）。
  - `POST /api/v2/service-identities/:principalId/disable` `{requestId}` → 即刻不可认证（重放同样 403）；已禁用 → 409 `NOT_READY`；跨租户 → 404。
- **给 03 的页面消费链**：admin 签发 svc 凭据（Edge 服务端保管）→ Gate 回执（svc）→ 分析运行 start/finish（svc）→ 域结果（policy/credit/commerce/asset human）→ 依据包冻结（credit/business human）→ 提案带 `packageId`（A 侧既有权威校验不变：不存在/不属本客户 → 404）。

### ⑧ IR-03-3 = A 工件单件读回（§11.2）

- `GET /api/v2/customers/:customerId/artifacts/:artifactId/content`——只读回，不落对象存储。
- 鉴权：内部 principal（客户角色 403；匿名 403；grant 不在册 404）。
- 200：`{artifact:{artifactId, customerId, kind, factKey, sha256, createdAt, createdBy, supersededBy, duplicateOf, materialFile}}`；信封 v0 件 `materialFile={name,mime,size,encoding:'base64',data}` 原样投影（Edge 直传登记的 `content.materialFile` 即此形状）；非信封件 `materialFile=null`、结构化事实经 `content` 原样返回。被取代/重复件可读（行内如实标注）。
- 错误：仅 404 `NOT_FOUND`；无新增错误码。Edge 按既有只读代理模式接线即可。

### ④⑥ 裁决（实现期细节，验收用例随后）

- **④（IR-03-8④）**：A 侧 inspection 域材料比对全部改为**剥 `material.` 前缀后按裸名匹配**（与 DEF-G04N-02 registerArtifact 同口径）；覆盖 start 前置、核验项状态推导、next-actions 缺口、晚到材料重开四处——落库/展示保持调用方原样。03 页面侧两种形态任一均可。
- **⑥（IR-03-6）**：裁决为**名册角色绑定 cit_* 身份**方案：会话名册显式含 `{roleKey:'customer', kind:'human'}` 时，纯客户身份（cit_*，§11 G2 链）即持有该角色——可读会话（获**客户线程投影**：仅 audience=customer 问题+其关联核验项，不含 followups/outbound/名册/计划快照）、可回答（限 audience=customer 问题，内部受众问题 403）、可提问（限 customer 受众）、可 presence。回答/提问复用既有端点，无新端点；`GET /inspections/:id/summary` 对纯客户身份强制 audience=customer。03 侧建会话/修订计划时在 roles 中加 `{roleKey:'customer',kind:'human'}` 即可。

### 边界声明

- 本路只写 `Back/A/**`、`Back/CONTRACT.md` §11 加法、`docs/product-delivery/goal-01/**` 与本回执；PG 容器 jw-goal01-pg@15446（已在跑）；未 commit/push。
- IR-03-8⑤（a_customer_links 种子透传）属 02 路 start-connectors 范围，本路不代修；如需 A 侧登记面扩展请走 interface request。

---

## 2026-09-19 10:0x｜02 路（goal-02 续）回执

IR-03-8 ①②③⑤ 全部关闭（03 路缺陷候选 → 02 owner 落地）。零 revert/零丢弃，全部增量编辑；
未 commit/push/切分支。工作目录 C:/Users/22673/Desktop/JW，分支 v02-goal1234-delivery。

### 改动清单（白名单内：Back/Connectors/** + docs/product-delivery/goal-02/**）

- **① G3 处理状态写口**：`a_bridge.mjs` 新增 `reportProcessingStages`（service 身份，A §11 G3 契约校验对齐）；
  `coordinator.mjs` 新增 `reportG3` 并在游标推进点接线（received/parsed/analyzed/needs_review/failed；
  `runRef=<taskId>:a<attempt>`；requestId=`ptx-<taskId>-a<attempt>-prc-<stage>` 确定性幂等；a_links 增
  entity_type=processing；上报失败不阻断主链）。
- **② 人工事实并入四域分析**：schema.sql fact_assertions 加列 entry_mode/value_json（+存量幂等回填）；
  service.mjs manualEntry/correctFact 结构化溯源+`requeueForAnalysis`（录入/更正/复核升级自动重入分析）；
  coordinator.mjs `liveManualBlocks` 并入感知快照（被人工取代的 parse 值不进快照；no-parse 件有人工事实即可
  触发客户级分析；fin 引用面含人工事实来源件）；verifyQuestion 复核 verified→该件转录事实升 verified 级；
  stageRegisterResults 的 run/fin/gate/dres requestId 追加 `-<finId>` 收口作用域（同输入幂等零新写，新收口=
  新 A 写，历史回执保留）。**效果：人工路线 NEEDS_EVIDENCE→复核→CLEAR 可达，CLEAR 回执真实到达 A**。
- **③ 判重客户级+绑定幂等回执**：service.registerArtifact 与 stageParse 判重收敛客户级（跨客户同字节各自
  处理，同客户判重保留）；intake acceptInvitation 既有绑定命中时新邀请显式 accepted+挂接既有绑定
  （响应 `invitationAccepted:true`），不再空转 pending。
- **⑤ 种子透传**：start-connectors.mjs 透传 `fileCfg.processing`（原被整体丢弃）；compose 新增
  `resolveProcessingConfig`（优先级 processing.aCustomerLinks > a.customerLinks > 空；落 a_customer_links 表为
  权威，与既有部署直插行兼容）；connectors.config.example.json 样例补注。
- **测试**：新增 G-A3（真内核 ①+②+⑤）、M3（② 本地 CLEAR 全链）、N3（③）、N4（⑤）；N1 判据随契约演进
  扩展（G3 上报形态+收口作用域后缀；确定性/≤128/重入零新写纪律不变）；helpers BASE_PG 支持
  CONNECTORS_TEST_PG_* 环境覆盖（默认值不变）。

### 证据

- Connectors 全量 **77/77**（上轮 73+新增4）：`docs/product-delivery/goal-02/evidence/test-connectors-npm-test-ir038.txt`
- A 桥真内核 **3/3**（G-A1/G-A2/G-A3）：`evidence/test-goal02-a-bridge-ir038.txt`（A 只读直查 artifact_processing/
  analysis_runs/rule_gate_receipts，CLEAR 到达 A）
- Back/C **101/101**、Back/B **105/105** 零回归：`evidence/test-c-run-all-ir038.txt`、`evidence/test-b-npm-test-ir038.txt`
- 文档：goal-02/{CHANGELOG,TEST_RESULTS,HANDOFF,INTERFACE_REQUESTS}.md 各追加续轮节。

### 资源登记

- 自属容器 `jw-g02r2-pg@15458`（本轮新建，postgres:16；Connectors 测试库+A 内核测试库管理连接共用，
  经 CONNECTORS_TEST_PG_PORT/JW_A_ADMIN_DB_URL 注入）；共享 15443/15444 零触碰。派工端口 17939/17941
  未使用（套件自管 A 内核随机端口 48310-48349、harness 48281-48290，用后即闭）。
- **金丝雀 journey-first-file.mjs 本轮跳过**（固定端口 17933/17935 与 03 路在跑栈冲突）——留给路 D 合流回归统一跑。

### 未完成项与跨路事项（只报告不代修）

- IR-03-8④（检查会话材料前置按裸 kind 匹配，通道件为 `material.<kind>`）：→01 范围，本轮未动、未见回归。
- IR-03-8⑤ 的 01 侧（授权客户目录归集读口）仍 OPEN：目录读口提供后种子自动降级为兼容路径。
- 02 路裁决登记（给 03/01 知会）：①页面 stage 权威源=A G3 获准披露面（页面零改动）；②verified 升级只挂
  manual_entry_required 问题的获准复核（correct-fact 恒 source_supported，复核人可另行核验）；G3 上报为进度
  披露非业务事实，失败不阻断主链（a_links 留痕）。

---

## 2026-09-19 10:2x｜03 路（goal-03e 三路目标）回执

三项目标（⑨ DEF-G04N-04 页面侧 / ⑩ DEF-G04N-05 消息线程 / ⑪ IR-03-3 预览消费）完成。测试+浏览器双达标：Edge 非 e1 **53/53**（新增 7 用例）、Front **37/37**（新增 5）、typecheck 0 error、dist 重建 3 轮；三会话浏览器实证（biz1/cred1/cit_*）含负例 3 项，详见 goal-03/TEST_RESULTS.md goal-03e 节。

1. [⑩ 已修] 消息对端不渲染根因=Edge 只有 POST 发送面（一次性 sink，无读端点）。补：message-store + `GET /customers/:id/messages`（受众边界服务端强制：cit 请求 internal=403；`?after` 增量；requestId 重放不二次入栈）+ 双端 4s 轮询渲染。浏览器实证：biz→门户、门户→biz 双向可见，内部消息门户不可见。
2. [⑨ 已修+实证] 路B §11.1 冻结的平铺 `packageId` 与页面既有实现一致；本轮浏览器全链：biz1 页面冻结 pkg-mu7qq4ra → cred1 页面评估/候选/送审 → **带包提案 200**（fac-mu7qvfhq）；负例=无包 409 BASIS_PACKAGE_REQUIRED（如实显示）。
3. [⑪ 已修+部分待上游] 真断链修复：通道签名 URL 是相对路径，同源 Edge 下被 SPA 兜底吞成 index.html——Edge 新增 `/api/jw/v2/connectors/objects/:ref` 原始字节透传（签名/有效期仍由 Connectors 验证），前端面内渲染（PNG 魔数嗅探内联，截图留证）。A 档案件 §11.2 content 读回：Edge 代理+页面已就绪并单测透传，**A@17933 运行实例尚未部署该路由——页面诚实 404，A 侧上线后零改动即亮**。
4. [给 01/路B] §11.1/§11.2 实现落地并重启 A 后，请知会：A 档案预览与 svc 签发链即在本路面内点亮，无需再派工。
5. [给 04] 本路独立验证段 Edge 17947 保持运行（日志 .run-g03e/）；17935 原样未动；消费面契约 revision `goal03e-1`。

---

## 2026-09-19 05:5x｜01 路（goal-01 路B）终验回执：④⑥⑦⑧ 完成，全量 132 项全绿

### 交付结果（契约终版=Back/CONTRACT.md §11.1/§11.2 + §11 追加段，以契约为准）

- **⑦ DEF-G04N-04 A 侧（交付运行时服务身份）**：迁移 `010_service_identities.sql`；身份链合成目录→customer_identities→**service_identities**（kind=service、绑定租户、customers='all'）；admin 三口 `POST/GET /api/v2/service-identities`、`POST .../:principalId/disable`（凭据 sha256、明文一次；停用即刻不可认证）。既有 service 三口与 createPackage 门语义零变更。**W3 用例按 DEF 复现路径全链冒烟：无包提案仍 409 BASIS_PACKAGE_REQUIRED（门不变）→ svc 登记 CLEAR Gate 回执 → human 冻结依据包 → 提案带 packageId → 200（阻断点解除）。**
- **⑧ IR-03-3（单件读回）**：`GET /api/v2/customers/:customerId/artifacts/:artifactId/content`——内部专用（cit_* 403/匿名 403/跨客户 404）；信封 v0 `materialFile={name,mime,size,encoding,data}` 原样投影；非信封件 content 原样、materialFile=null；被取代件可读（supersededBy 如实携带）。只读回、不落对象存储、无新增错误码。
- **④ IR-03-8④（kind 双形态）**：start 前置/核验项状态推导/next-actions 缺口/晚到重开四处改为剥 `material.` 前缀按裸名匹配；双向（裸前置×前缀登记、前缀前置×裸登记）用例通过，缺失仍 409 并给 missing 列表。02 通道保持 `material.<kind>` 称呼即可。
- **⑥ IR-03-6（客户线程内应答）**：名册含 `{roleKey:'customer',kind:'human'}` 时 cit_* 隐式持有；客户读会话自动获**客户线程投影**（audience=customer 问题+关联核验项；不含名册/外发/待办/计划快照）；回答/提问限 customer 受众（内部受众 403）；presence 可用；next-actions 403（内部作业视图）；小结强制 customer 受众（internal 403）；名册无 customer 角色 → 404 不泄露存在性。**无新端点**，复用既有 answer/question/presence/summary 面。

### 验证证据

- 全量回归（直跑 TAP，jw-goal01-pg@15446，串行）：**132 项 = 131 pass / 0 fail / 1 skip**；skip=既有 crash 容器重启守卫（未设 JW_A_TEST_PG_CONTAINER，不碰非本测试容器）。留档 `docs/product-delivery/goal-01/evidence-roundB-final.log`。
- 新用例：`test/service-identity-artifact-content.test.mjs` 7/7；`test/inspection-kind-customer-thread.test.mjs` 5/5。
- 存量适配：customer-credit A22 迁移清单断言更新 001–010（历轮惯例，非产品缺陷）。`tsc --noEmit` 通过。
- 文档：goal-01 DESIGN.md §7 / HANDOFF.md 续轮段 / TEST_RESULTS.md 续轮段已更新。

### 给消费方

- **03 路（等此形状的项）**：⑦ 页面链 = admin 签发 svc 凭据（Edge 服务端保管）→ Gate 回执（svc）→ 分析运行（svc）→ 域结果（域角色 human）→ 冻结包（credit/business human）→ 提案带 packageId；⑧ 预览代理目标=`.../artifacts/:artifactId/content`；④ 无需页面适配（两形态皆通）；⑥ 会话名册加 `{roleKey:'customer',kind:'human'}` 即可在客户门户内直接读线程+回答。
- **04 路**：DEF-G04N-04 owner-01 项（交付运行时补 service 主体）已交付，页面复测可走 W3 同型链；请 04 验收后在 DEFECTS.md 标注。
- 边界重申：未 commit/push；只写 Back/A/**、CONTRACT §11 加法、goal-01 文档与本回执。
