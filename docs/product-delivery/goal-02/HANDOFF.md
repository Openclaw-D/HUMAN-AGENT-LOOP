# goal-02（产品交付·任务二）· HANDOFF（2026-09-18；2026-09-19 增量见 §6）

交付：客户上传的原始材料经"受控落地→A 权威材料登记→解析→事实→四域预审→A 正式运行/Gate 回执→
冲突进复核队列→问题/补证→人工录入/更正/复核"同一条链真实可复现；重复不重算、变化只算必要、
中断从正确状态恢复、A 结果未知先对账。范围：`Back/B/**`、`Back/C/**`、`Back/Connectors/**` + 默认测试入口；
A/契约/Edge/Front/D 零改动；无 Git 提交；零真实模型/渠道调用。基线 `v02-goal1234-delivery` @ e4ed7a5（PR#4 待验收，
按任务书"不盲目切 main"延续该基线）。

## 1｜运行与验证入口

```bash
# 三路回归（默认测试入口，均已修复/补齐）
cd Back/C          && npm test          # 100/100（含 parse-adapters v2 4 项）
cd Back/B          && npm test          # 105/105（补齐 3 个漏挂文件）
cd Back/Connectors && npm test          # 71/71（修复前该命令实际跑 0 个用例）

# A 桥真内核集成（需 jw-cc-kernel-pg@15444；自动建删测试库并起停 A 内核）
cd Back/Connectors && node --test --test-force-exit test/goal02-a-bridge.test.mjs   # 2/2

# 性能双臂对照（证据落 docs/product-delivery/goal-02/evidence/）
cd Back/Connectors && node scripts/perf-goal02.mjs
```

服务主入口不变：`node scripts/start-connectors.mjs`（`.run/config.json`）。**A 桥新配置**：`a.tenantId`、
`a.credentials.{service,registrar,reviewer,upload.*,uploadFallback}`（service=kind:service principal，Gate 回执/运行专用；
upload.*=邀请角色→A 客户 principal 映射）、`a.customerLinks`（客户映射种子）、`processing.aPackageDomainResults`（默认 false）。
样例见 `Back/Connectors/config/connectors.config.example.json`。

## 2｜处理链（游标顺序）与关键不变量

`register_material → unzip → parse → facts → analyze → questions → register_results → done`

- **A 材料登记在前**（任务书数据顺序）：邀请角色映射 A 客户 principal（人类凭据），grade 恒 unverified；
  等级提升=获准人工复核行为（A 侧结构强制），机器产物不冒充核验。派生件（ZIP entry）provenance 指向容器 A 工件。
- **register_results（A 正式收口）**：派生解析工件 → 逐域 analysis-runs start/finish（service 身份；deps=全部参与材料
  A 引用+该域消费键+激活规则版本；A 盖章 input_digest）→ Gate 回执（C gate.result 1:1）→ 事实冲突 → A findings
  （service 可建、人类处理）→（可选，配置开启）包域结果。
- **unknown ≠ failed**：A 超时/断网 → a_links 'unknown' + 任务 blocked_unknown → 回执对账（确定性 requestId+原 principal，
  v2 回执按主体归属过滤）→ 从断点续跑；**绝不换 ID 重发**。确定性拒绝（4xx）→ failed 如实留痕。
- **三层语义**：机器确定性提取=source_supported（绑定行引用+parserVersion+口径注记）；人工录入=转录（source_supported+
  entryMode，原件可见+定位+录入人）；verified 只能由获准复核端点产生。回答≠材料≠核验三段分离保留。
- **去重**：解析缓存键含声明元数据（期间/币种/单位/口径）；同字节同元数据才判重；同字节不同元数据照常处理、
  事实并存。事实内容键确定性（含人工 mode）。A 操作幂等=a_links 状态机。

## 3｜给 03（Edge/Front）的最小联调路径

1. 读 `GET /processing/status` 渲染分段进度（下载 100%≠解析完成；blocked_unknown 显示"对账中"）。
2. 原件预览：`GET /evidence/preview` → downloadUrl（短时签名）。
3. 扫描件：任务 needs_followup + `manual_entry_required` 问题 → 页面表单调 `POST /evidence/manual-entry`（附 location）
   → 展示"待人工复核" → `POST /questions/verify`（复核人+理由）。
4. 更正：`POST /evidence/correct-fact`（必填 reason/correctedBy）——响应 `aSync` 字段如实反映 A 侧状态。
完整清单见 INTERFACE_REQUESTS.md IR-02-C。

## 4｜遗留与边界（如实）

- **包域结果登记**代码就绪但默认关闭、无真内核全链用例（需与业务侧依据包冻结声明协同；不冒充闭环）。
- PDF 表格不重构；XLSX 只取首个工作表；OCR/ASR/真实渠道保持 BLOCKED（无获准提供方）。
- B 全量并发下 crash-recovery 偶发 1 次时序失败（单独/复跑均绿）——未改断言掩盖，复现时按文件单跑定位。
- A 正式决定（批准/激活）不在本路：本链终点=可复核的运行/Gate 回执/冲突复核项/依据引用，决定由有权人类在页面作出。
- 检查会话问题通道合并待 01 裁决（IR-02-A ③）；本轮不双写。
- 测试资源登记：Connectors 测试库逐文件建删于 15443；A 内核测试库逐用例建删于 15444 管理连接；
  e2e 端口 48281/48285/48286/48288/48289、A 内核 48310-48349（用后即闭）；对象存储目录随测试清理。

## 5｜交付物清单（本目录）

`DESIGN.md`（现状缺口 G1-G7+链路+A 消费契约）、`SUPPORTED_FORMATS.md`（格式白名单与拒绝边界）、
`TEST_RESULTS.md`（回归矩阵+必测映射+性能+遗留）、`INTERFACE_REQUESTS.md`（IR-02-A/C）、`CHANGELOG.md`（逐文件）、
`evidence/`（四套件输出+perf JSON）。根 DECISIONS/CHANGELOG 未由本轮写入（单 writer 纪律）；如需登记请集成方摘录本 CHANGELOG。

## 6｜2026-09-19 增量（缺陷判据与 PDF 抽取修复验证轮）

- **复证**：04 路 R4 已将 DEF-G04N-01/02/03 复测关闭；本轮在制工作树独立复证（C 101/101、B 105/105、
  Connectors 73/73 含 a-bridge 真 A 内核 2/2）——requestId 确定性纪律、XLSX 整体解析、kind 命名空间
  `material.<kind>`（A 侧剥前缀比对，CONTRACT §11）全部真实有效，缺陷无回弹。
- **新增常绿判据 3 项**：Connectors `test/defects-g04n.test.mjs`（N1 严格 A 契约 requestId 纪律+解析产物到达 A+
  幂等零新写；N2 XLSX 不当容器+真 ZIP 命运分离）、C `test/parse-adapters-v2.test.mjs` P3 谓词空白回归。
  均已挂入 `npm test`/`test:processing` 默认入口。
- **新修缺陷**：`C/src/parse/adapters.mjs` extractPdfText 流切片把 `stream` 关键字混入 FlateDecode 数据
  （能否解出全凭字节运气；长流全空误判扫描件）——数据起点改为关键字之后。复证无回归。
- 缺陷台账（DEFECTS.md）归 04 路单 writer；本路状态与证据见本目录 CHANGELOG/TEST_RESULTS 增量节。

## 7｜2026-09-19 续轮（IR-03-8 ①②③⑤ 关闭；03 路缺陷候选落地）

03 路（Edge/Front 页面侧）在真实链复现四项缺陷候选（`docs/product-delivery/goal-03/INTERFACE_REQUESTS.md`
IR-03-8），本轮由 02 路 owner 全部关闭，零 revert 增量交付：

1. **① G3 处理状态写口调通**：a_bridge 新增 `reportProcessingStages`（service 身份，A §11 G3）；
   协调器在游标推进点逐段上报 register_material→received / parse→parsed / analyze→analyzed /
   人工环节→needs_review / 失败→failed。`runRef=<taskId>:a<attempt>`（重试/恢复=新尝试，按尝试序如实留痕）；
   requestId=`ptx-<taskId>-a<attempt>-prc-<stage>` 确定性幂等。**my/materials 的 stage 自此有权威数据源**
   （03 路页面无需改动，读 A 获准披露面即可）；上报失败不阻断主链（a_links 留痕）。
2. **② 人工事实并入四域分析输入（Gate 可被人工路线满足）**：裁决=录入/更正事实以 source_supported 进入
   快照；manual_entry_required 问题获准复核 verified 后该件转录事实升 verified（verified 只由复核端点产生）；
   被人工取代的 parse 值不进快照；人工事实变更自动重入分析（新输入=新收口）。**收口 requestId 追加 `-<finId>`
   作用域后缀**：同输入重放幂等不变，新收口=新 A 写（历史回执保留）。效果：扫描件人工路线可达
   NEEDS_EVIDENCE→复核→**CLEAR**（M3 本地 / G-A3 真内核双证）——J1.5 正向 CLEAR 批准的前置已成立。
3. **③ intake 判重客户级 + 绑定幂等回执**：duplicate 判重（service.registerArtifact 与 stageParse 两处）从
   租户级收敛到客户级，跨客户同字节各自处理；既有绑定后新邀请接受显式推进 accepted 并挂接既有绑定
   （响应带 `invitationAccepted:true` 幂等回执），不再卡"pending 不允许上传"。
4. **⑤ 种子透传**：start-connectors 原本丢弃 `fileCfg.processing` 整节——现已透传；种子优先级
   `processing.aCustomerLinks` > `a.customerLinks`（03 路部署形态）> 空，落 a_customer_links 表后以表为权威。
   已直插 `linked_by=goal-03-deploy-seed` 的存量部署不受影响（种子不覆写表）。

**给 03/04 路**：页面 my/materials 阶段推进可直接复验（扫描件→录入→复核→analyzed→CLEAR 全链真内核已证）；
本轮 Connectors 全量 77/77、B 105/105、C 101/101（证据 evidence/*-ir038.txt）；测试 PG 已容器参数化
（`CONNECTORS_TEST_PG_PORT`），并行轮请各用自属容器。金丝雀 journey-first-file.mjs（17933/17935）留给路 D 合流回归统一跑。
