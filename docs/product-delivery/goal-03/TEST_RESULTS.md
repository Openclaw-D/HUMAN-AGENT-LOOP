# goal-03 TEST RESULTS（2026-09-19，续轮·J1.1–J1.5 页面做实）

环境：本轮自有栈（BASELINE.md 端口表）——PG `jw-g03c-pg@15456`（A 库 `jw_g03c` 迁移 001–009 + 通道库 `jwg03c_conn`）、A `17933`（必需域政策 `pol-delivery-synthetic`：四域全部 required；规则包 `1.0.0` 已激活；11+1 个受控 principal 含 `svc1`(service)/`pol1`(policy)）、Connectors `17937`（处理驱动 2s、规则包 1.0.0、aBridge→A service 身份）、Edge `17935` `--live --serve-front Front/dist --connectors-url http://127.0.0.1:17937`。**未开 `--allow-legacy-basis`**。全部数据为合成演示。

## 1 自动化测试（全部实跑）

| 套件 | 结果 |
|---|---|
| Back/Edge 非 e1（`node test/run-all.mjs`） | **46/46 pass**（上轮 41 + 本轮新增 5：决策链读面透传 / DELETE grants 撤权+requestId+CSRF / 豁免登记写面 / Connectors 读面 X-Service-Token+未配置 404 / Connectors 写面 requestId+白名单） |
| Front（`npm test`，本轮修复漏挂：`wb-logic.test.mjs` 纳入默认入口） | **32/32 pass**（role-mock-adapter + edge-logic + wb-logic 13 项含通道投影 4 项新用例） |
| Front `npm run typecheck` | **0 error** |
| `npm run build`（dist 重建） | **成功**（Edge 同源托管） |
| 消费面契约 | revision `goal03d-1`（登记 A 决策链读/写面与 Connectors IR-02-C 面、上游鉴权、纪律） |

## 2 真实浏览器用户路径（主执行者亲自驱动；会话 A=内部多角色，会话 B=第二浏览器标签=客户实控人）

| # | 冻结旅程/判据 | 结果 | 证据要点 |
|---|---|---|---|
| 1 | J1.1 客户目录+新建（零内部 ID） | PASS | biz1 受控登录 → G1 权威目录（按授权过滤）→ 页面建档「汉江重工装备（合成·二）cust-mu77youg」即入工作本（实时 SSE 连接） |
| 2 | J1.1 受限邀请创建/撤销/兑换 | PASS | 受限邀请页创建 customer-owner 邀请（invoice+purchase_contract/168h）→ code 明文仅一次弹窗；**app1 会话点创建 → PERMISSION_DENIED 业务语言拒绝（权限由服务端目录裁决）** |
| 3 | J1.2 邀请兑换=cit_* 凭据绑定会话 | PASS | 会话 B（独立标签）粘贴邀请码 → 兑换即以受限客户身份自动进入「客户材料门户」（徽标：仅获准披露内容）；无角色下拉/无提权 |
| 4 | N-04/N-05 无效码诚实拒绝 | PASS | 会话 B 首次兑换用了失效文本 → `INVITATION_NOT_FOUND` 统一 404 业务文案（无存在性泄漏） |
| 5 | J1.2 门户上传+my/materials 白名单 | PASS | 门户上传 invoice（真实字节）→「我的材料」白名单投影逐件可见（kind/登记时间/stage），无内部等级/事实值；结构隔离提示常驻 |
| 6 | J1.2/J1.3 处理通道（页面发起） | PASS | 材料页通道卡：发起通道邀请（code 仅一次）→ 接受绑定 → 上传 2 份真实原件进通道 → 分段进度表（排队/处理中/已完成/对账中/重复跳过）→ 任务回执=阶段留痕（register_material/unzip/parse/facts/analyze/questions/register_results）+ A 侧留痕 aOps（材料 art-mu7a5k4a、派生 art-mu7a5k65、4 域运行 run-mu7a5k78/8k/9q/b4、Gate 回执 gr-mu7a5kc4） |
| 7 | N-12 去重（真实链） | PASS | 同字节+同元数据再传 → 任务 `skipped_duplicate`（页面可见）；跨客户同字节亦判重（02 路租户级判重语义，如实呈现） |
| 8 | J1.4 人工录入（转录） | PASS | 核验页通道人工路线：对扫描补充件录入 6 项事实（多行 factKey,value）+原件定位+理由 → 落库转录语义（source_supported 语义留痕、≠核验） |
| 9 | J1.4 获准复核（verified 唯一来源） | PASS | QA 页通道补证问题 5 项 → 行内填写复核意见 → 逐项「人工复核（获准）」→ 全部转 verified（复核人与意见入通道留痕） |
| 10 | J1.4 检查会话问答+收口 | PASS | 开始会话（缺购销合同时被 NOT_READY 诚实拒绝→A 档案补传后成功）→ 提问（对客户/customer_owner/requiresHuman）→ 收口 `ended`+`pending_evidence`（开放问题 1 如实留在收口状态——**客户在检查会话线程内回答待上游**，见 IR-03-6 扩展） |
| 11 | J1.5 冻结依据包（页面全链） | PASS | 方案页「从处理通道回执读取」自动带出 Gate 回执/4 域运行引用/规则版本 → 四域依赖声明（工件 id 来自真实材料清单）→ 二次确认冻结：r1 pkg-mu7ajojm（draft）→ 收口后 r2 pkg-mu7aynfh（含收口引用）→ 晚到材料触发 STALE 后 r3 pkg-mu7b592z（修订链 prev 关联） |
| 12 | J1.5 四域意见→包（域目录角色） | PASS | cred1/comm1/asset1/pol1 分别登录 → 域意见表单（引用真实 runId+与冻结声明一致的 deps+authority=none）→ 包内 domainResults 四域齐备（页面「查看依据包」可见意见/版本/运行引用） |
| 13 | J1.5 候选→送审→包绑定提案 | PASS | cred1 创建评估 → 登记候选意见（do_with_adjusted_terms/支撑 5000 万分/authority=none）→ 提交复核（awaiting_human_review）→ 提案绑定 r3（二次确认含对象/评估/包/幂等编号）成功建档 |
| 14 | J1.5/N-07 approver 正式批准=提交点阻断 | PASS | app1「正式批准」→ **STALE_BASIS**（晚到材料→域水位变化）业务语言拒绝；发布 r3 再提案后批准 → **REQUIRED_DOMAIN_MISSING/GATE_NEEDS_EVIDENCE** 缺口如实阻断（「查看依据包」直接列出全部缺口）；页面零绕过 |
| 15 | 撤权级联（IR-03-7 页面化） | PASS（接口面） | DELETE grants 代理+requestId+CSRF 自动化 5 项测试全绿；页面按钮（admin 对已兑换邀请「撤权客户身份」）就绪 |

## 3 NOT_RUN / BLOCKED / 部分项（如实）

| 项 | 状态 | 原因与去向 |
|---|---|---|
| approver 正式批准成功（Gate=CLEAR 全链） | PARTIAL | 真实 Gate 回执=`NEEDS_EVIDENCE`：合成薄材料不满足规则前置（requiredFacts minLevel=source_supported）。keyvalue 解析产出恒为 declared 级；人工录入事实未进入 B 分析快照（快照取自 parse_results.declaredFacts）——**跨路径接缝**，登记 IR-03-8② 待 02 路裁决。正向批准链已由 04 路 e1 全链（22 判据）以真实 API 面证明；页面侧证明到"提交点阻断+缺口明细" |
| 检查会话内客户直接回答 | 待上游 | 会话名册为 v1 项目角色键，G2 cit_* 客户身份不在名册——客户回答经门户消息+补材料承接；检查线程客户侧只读/回答面待 01 路接口（IR-03-6 扩展登记） |
| G3 处理状态推进（my/materials stage 演进） | 待 02 | 02 路 a_bridge 未调 G3 写口（ROUND-LOG 已派单）——通道分段进度页面已接（IR-02-C），my/materials stage 恒 registered |
| A 工件预览（信封件） | 待上游 | IR-03-3 正式单件读端点未落地；通道件预览经签名 URL 已接（页面按钮） |
| 浏览器原生文件选择器 | NOT_RUN | 同上轮：以页面上下文真实字节注入 `<input type=file>` 等效验证；真人手点待用户视觉验收 |

## 4 遗留失败

无自动化失败遗留。上述 PARTIAL 均为真实业务门/跨路径接口状态，页面如实呈现、不冒充。

---

# goal-03e 三路补测（2026-09-19 下午·DEF-G04N-04 页面侧 / DEF-G04N-05 消息线程 / IR-03-3 预览消费）

环境：复用在跑栈 PG `15456` / A `17933` / Connectors `17937`（未重启、未抢占）；Edge 为本路独立验证段 `17947`（新代码 + 新 dist 同源托管；`17935` 原样保留未动）。凭据同 BASELINE 续轮表。

## 1 自动化（全部实跑）

| 套件 | 结果 |
|---|---|
| Back/Edge 非 e1 | **53/53 pass**（上轮 46+1(§11.2 content 透传) + 本轮新增 6：线程双向/受众边界403/增量游标幂等/失败关闭501·401·400·checkCustomer/存储有界/objects 原始字节透传） |
| Front | **37/37 pass**（32 + 新增 5：mergeThread×2、previewKind/dataURL、sniffImageMime、facility.propose 确认计划含包绑定行+BASIS_PACKAGE_REQUIRED 文案） |
| typecheck | **0 error** |
| dist 重建 | **3 轮均成功**（最终 `index-Q0Q2O9st.js`；17947 同源自验加载新构建） |
| 消费面契约 | revision `goal03e-1`（登记 A §11.2 content 读面 + 通道 objects/:ref 签名 URL 归一代理 + Edge 消息线程本地面说明） |

## 2 真实浏览器三会话路径（tab1=biz1、tab2=cred1、tab3=cit_*（兑换））

| # | 判据 | 结果 | 证据要点 |
|---|---|---|---|
| 1 | DEF-G04N-05 双向可见（biz→客户） | PASS | biz1 沟通栏发对客户消息（服务端回执）→ cit 门户「与办理方沟通」轮询渲染 `biz1 · 在线`（此前对端永不渲染） |
| 2 | DEF-G04N-05 双向可见（客户→biz） | PASS | 门户回复 → biz 工作本对客户列 ≤1 个轮询周期内渲染 `ci-mu7qxurx-… · 在线`（sender 归属如实） |
| 3 | 受众边界（负例） | PASS | biz 发内部协作消息 → 内部列可见；cit 门户线程始终仅 customer 受众两条（服务端强制过滤）；cit 显式请求 internal=403 由 Edge 非 e1 用例覆盖 |
| 4 | DEF-G04N-04 包绑定提案（正向） | PASS | biz1 页面冻结 `pkg-mu7qq4ra`（Gate 回执从通道回执带出）→ cred1 页面创建评估→登记候选（authority=none）→提交复核→**带 `packageId` 提案 200**（右栏 facility_blocker fac-mu7qvfhq 可见，截图留证） |
| 5 | DEF-G04N-04 无包提案（负例） | PASS | API 级：同评估不带 packageId → **409 BASIS_PACKAGE_REQUIRED**（A 权威门，错误码如实映射「正式动作必须绑定依据包」）；页面 basis 兜底语义（输入清空仍回落 basis.packageId）如实呈现 |
| 6 | IR-03-3 通道件预览（修复后） | PASS | 通道任务回执「原件预览（签名 URL）」→ 面内取回真实字节（226B CSV / 70B PNG，octet-stream 魔数嗅探）→ **PNG 以 data:URL 内联渲染**（截图留证）；修复点=相对签名 URL 归一 `/api/jw/v2/connectors/objects/:ref`（此前被同源 SPA 兜底吞成 index.html） |
| 7 | IR-03-3 A 档案件读回（如实待上游） | PASS | 材料行「预览」→ Edge §11.2 代理路由工作（会话映射/404 原样透传，非 e1 用例覆盖）；A@17933 进程尚无该路由 → 页面诚实显示 NOT_FOUND 业务文案（**待路B部署后即亮，无需再改页面**）；注入 PNG 上传登记成功（original_upload 行） |
| 8 | 邀请码一次性（负例，顺带） | PASS | 码截取错误时兑换被如实拒绝 `INVITATION_NOT_FOUND`；新码兑换成功进门户 |

## 3 遗留

- A@17933 运行实例未含 §11.1/§11.2 新路由（路B已冻结契约并开工实现）：A 档案件预览在运行栈暂为诚实 404，svc 身份签发面同样待部署。**页面/Edge 侧零改动待命。**
- 通道 PNG 进解析链被 02 路适配器判 FORMAT_UNSUPPORTED→needs_followup（"图片不做自动识别，原件已安全接收可预览"）——设计内诚实语义，预览不受影响。
