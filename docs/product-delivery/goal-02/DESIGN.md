# goal-02（产品交付四任务 · 任务二）· 原件到决定链 DESIGN

Writer：ZCode（任务二路）。修改范围：`Back/B/**`、`Back/C/**`、`Back/Connectors/**`、各自依赖与默认测试入口 + 本目录文档。不动 A/契约/Edge/Front/D。
基线：分支 `v02-goal1234-delivery` @ `e4ed7a5`（PR#4 待验收；任务书总纲"不盲目切到 main"，故延续该基线，不合并 PR、不 commit/push）。零真实模型/渠道调用、无真实密钥、无付费外发。

## 0｜现状测量（改码前，2026-09-18 实测）

上一轮 goal-02（docs/backend-upgrade/goal-02）已交付：Connectors 处理协调器（五段游标：解压→解析→事实→分析→提问→register_a；租约认领 FOR UPDATE SKIP LOCKED；unknown 对账不换 ID）、C 解析适配器 v1（csv/tsv/txt/zip）、局部重算与域缓存、问题仲裁（suggest_only 默认）、perf 双臂对照。本轮实测确认的缺口（全部有代码位置）：

| # | 缺口 | 位置 |
|---|---|---|
| G1 | A 正式收口未接线：`register_a` 只走 A v1 项目 evidence；四域结果/Gate 留守 Connectors（上一轮 IR-1） | `Connectors/src/processing/coordinator.mjs` stageRegisterA |
| G2 | 材料未登记进 A 权威客户工件（A v2 evidence_artifacts）；无跨服务 ID 持久映射 | 同上 + `evidence/a_register.mjs` |
| G3 | 解析白名单缺 XLSX、可提取文本 PDF；扫描件无"原件可见→人工录入→获准复核"产品后端 | `C/src/parse/adapters.mjs`（pdf/图片一律 FORMAT_UNSUPPORTED，仅抛转人工问题） |
| G4 | **解析缓存键只看文件哈希**：缺 主体/期间/单位/口径 元数据（任务书 §5 明确禁止） | `parseCacheKey`；同字节不同元数据被 skip |
| G5 | CSV 引号内分隔符/换行/引号转义不处理（`splitLine` 无状态机）；`normDate` 接受 2026-13-45 非法日期；合计行会当数据行 | `adapters.mjs` |
| G6 | **默认测试入口漏挂/损坏**：B `npm test` 缺 fs-lock-recovery/inspection-dispatcher/question-arbiter 3 个文件；Connectors `node --test test/` 在 Node 22 测试发现规则下匹配不到任何文件（无 `*.test.mjs` 命名） | `Back/B/package.json`、`Back/Connectors/package.json` |
| G7 | 事实冲突（fact_conflicts）不进 A 复核队列（decision_findings） | coordinator |

## 1｜本轮链路（在上一轮基础上接通 A，不推翻）

```
浏览器上传 → 受控字节落地+元数据校验 → 【A 登记权威材料及版本（新，v2 artifacts，邀请映射人类凭据，grade=unverified）】
  → 持久处理任务 → 解析（含 XLSX/text-PDF；缓存键含元数据） → 观测/事实候选
  → 【A 登记派生解析工件（新，provenance.derivedFrom=原件，等级≤上游）】
  → 四域预审（局部重算+缓存，不变） → 【A analysis-runs start/finish（新，service 身份，A 盖章 input_digest）】
  → 【A Gate 回执（新，service 身份，rulesetVersion=激活版本）】 → 【A findings（新，事实冲突→复核队列）】
  → 问题准备/建议（不变，suggest_only） → 页面问答/人工录入/校正/复核（新增后端）
  → （存在依据包时）A 包域结果登记（新，引用已完成运行）
```

分段与失败语义：每段独立 stage 留痕；确定性失败=failed（如实原因，不编数）；超时/断网=unknown + blocked_unknown + requestId 对账（绝不换 ID）；重放经确定性 requestId + a_links 状态幂等续跑。

## 2｜A 消费契约（读自 Back/A 源码，本轮不改 A）

| A 端点 | 身份 | 用途 |
|---|---|---|
| `POST /api/v2/customers/:id/artifacts` | 人类+客户范围 | 材料登记（原件：邀请映射客户 principal，grade=unverified；派生：业务合成 principal，provenance.derivedFrom 约束等级≤上游；更正：supersedes 版本链） |
| `POST /api/v2/rule-pack-versions/activate` | 人类 policy/admin | C 规则包版本正式激活（A 侧一次一个 active） |
| `POST /api/v2/customers/:id/analysis-runs/start` / `:runId/finish` | **service** | 四域运行登记；start 时 A 对声明依赖盖章 input_digest；只有 completed 运行有资格满足必需域 |
| `POST /api/v2/customers/:id/rule-gate-receipts` | **service** | Gate 回执（result∈CLEAR/NEEDS_EVIDENCE/HOLD_FOR_REVIEW/HARD_BLOCK；rulesetVersion 必须=当前激活版本） |
| `POST /api/v2/customers/:id/findings` | agent/service 可建 | 事实冲突→复核队列（人工处理仅人类） |
| `POST /api/v2/decision-packages/:id/domain-results` | 域目录角色 | 包域结果（deps 与冻结声明一致；只接受已完成运行）——存在依据包时登记 |
| `GET /api/v2/receipts/:requestId` | 原主体 | 幂等对账（v2 回执按 (tenant, principal) 归属过滤：对账必须用原调用凭据） |
| `GET /api/v2/customers/:id/decision-status` | 业务角色 | 发现现行依据包（basisVersion=packageId:revision） |

关键语义（A 源码钉死，本路遵守）：材料等级提升=获准人工复核行为（客户上传恒 unverified；派生件等级≤上游）——**机器提取不冒充核验**；人工录入（原件可见+来源定位）记 source_supported（转录），verified 仅复核端点；Gate 不能自带 JSON，只收回执引用；运行规则版本 ≠ 激活版本 → STALE_BASIS 如实失败。

## 3｜分阶段实施

### B1 上传→A 材料/解析结果主入口 + 测试入口修复
- 新表：`a_customer_links`（tenant+customer → aCustomerId/projectId，持久映射；配置可种子）、`a_links`（逐操作登记：local_id ↔ a 工件/运行/回执；request_id、principal、status∈registered/unknown/failed）。
- 新模块 `Connectors/src/evidence/a_bridge.mjs`：A v2 客户端（材料/派生件/取代/运行/Gate/findings/回执/decision-status；确定性 requestId；超时→TIMEOUT_UNKNOWN；注入 fetch 供故障注入）。
- 协调器游标改为：`register_material → unzip → parse → facts → analyze → questions → register_results`；容器本体先登记再解包；解包派生件在解压时同步登记（provenance 指向容器 A 工件）。
- `register_material`：邀请角色→A principal 映射（配置 `a.credentials.upload.*`，缺省 fallback）；payload 只含受控元数据（无字节、无授信字段）。
- unknown 对账泛化：按 a_links 中 status=unknown 的操作逐一经回执查询确认，幂等续跑。
- 修 G6：B `npm test` 补齐 3 文件；Connectors 改显式枚举清单（Windows cmd 无 glob）。

### B2 格式范围 + 人工录入/校正/复核 + 四域→A
- C 适配器 v2（`parse-adapters@2`）：引号感知 CSV 状态机（引号内分隔符/换行/双写转义）；非法日期（含 2026-13-45、2 月 30 日）→ badRow 不再静默规范化；合计/总计行识别剔除（flag）；XLSX 最小 OOXML 读取（zipguard 族解包 + sharedStrings + sheet1 + 公式缺缓存值→该行拒绝 + Excel 序列日期转换并注记）；可提取文本 PDF（FlateDecode 流 + 文本算子提取；提取失败/加密/无文本=扫描件→人工路线，如实标注）；JPG/PNG 安全接收+预览（魔数嗅探、不解码、签名 URL 取字节）。
- 解析缓存键：`(tenant, customer, sha256, parserVersion, metaHash)`——metaHash=主体/期间/单位/口径/币种（任务书 §5）。同字节不同元数据 → **不 skip**：仍处理并在新锚点下断言事实（冲突显式并存），标注 `duplicate_bytes_new_metadata`。
- 人工路线后端（Connectors HTTP）：`POST /evidence/manual-entry`（原件可见+来源定位+录入人，事实=source_supported+entryMode=human_transcription，≠核验）；`POST /evidence/correct-fact`（修订链+理由，更正事实≠核验完成）；`GET /evidence/preview`（格式嗅探+签名 URL，不公开媒体目录）；现有 `evidence/verify`（获准复核）与 `questions/verify` 不变。更正回写 A：被链接材料经 supersedes 形成新版本（业务 principal）。
- 四域→A（`register_results` 段）：逐域 start/finish（deps.artifactIds=该域参与材料的 A 工件、factKeys=域消费键、rulePackVersion=配置激活版本）；Gate 回执（C gate 状态 1:1 映射 + inputDigest=感知快照哈希 + evidenceRefs）；fact_conflicts 新增行→A findings（findingType=数据不一致类、sideA/sideB、requiredAction、responsibleRole）；存在依据包（decision-status 发现）→ 域结果登记。任何一步 unknown → blocked_unknown 对账，不换 ID。

### B3 问题/补证/去重/恢复/有限负载（复验+补口）
- 本地问答三段（回答≠材料≠核验）已有；补 manual-entry/preview 消费面供 03 页面；页面复验路径写入 HANDOFF（Edge/Front 属 03 路，本路交付消费面+联调说明，不代改）。
- 去重/恢复/预算/暂停机制保留上一轮实现；本轮新增 A 侧幂等（a_links）与之叠加，SIGKILL 恢复与断网对账进测试矩阵。

## 4｜测试数据与矩阵（任务书 §6 必测逐项）

原始字节生成（测试内，不经预填事实）：引号 CSV（引号内逗号/双写引号/换行）、非法日期行、合计行、XLSX（真实 ZIP 字节+sharedStrings+公式无缓存行）、text-PDF（最小 PDF 生成器，FlateDecode 文本流）、扫描 PDF（无文本）、JPG/PNG 魔数、ZIP（含 csv+txt+pdf entry）、错期间/错主体声明、同字节不同元数据、修正原件。

| 必测项 | 落点 |
|---|---|
| 引号金额反例/非法日期/坏行合计 | C `parse-adapters.test.mjs` 扩展 + Connectors e2e |
| XLSX/text-PDF 原件 | 同上（真实字节过 HTTP 入口） |
| 扫描人工路线 | e2e：上传→FORMAT_UNSUPPORTED→manual-entry→复核→verified+A 回写 |
| 同字节不同元数据 | e2e：不 skip、双锚点并存、metadata flag |
| 压缩异常 | zipguard 既有回归 + e2e 派生命运分离 |
| 错主体/设备/期间 | 期间旗标既有 + 对象锚定并存 |
| 重复上传 | 既有 + 缓存键含元数据新断言 |
| A 提交后断网 | e2e：注入 fetch 发出后断连→blocked_unknown→回执对账→done（调用数断言，未换 ID） |
| 进程被终止后恢复 | 既有 SIGKILL 子进程 + A 链续跑断言 |
| 旧结果晚到 | 域缓存/水位既有 + selective 只算受影响域断言 |
| 补证选择性重算和暂停 | 既有回归复跑 |
| 四域→A 贯通 | 真 A 内核 e2e：激活规则包→上传→tick→断言 A artifacts/4 runs completed/Gate 回执/findings |

## 5｜性能口径

复用 `perf-goal02.mjs` 双臂（selective vs naive_full）同机同数据复测，新增指标：每任务 A 调用次数（有 A 配置臂）；复用/重算原因计数一致性断言保留。数字随机器变，倍率关系为结论；不为毫秒指标加架构。

## 6｜接口需求（详见 INTERFACE_REQUESTS.md）

- IR-A（→01）：customerId↔aCustomerId 权威映射/客户目录消费口（本轮：配置种子+a_customer_links 持久表，未配置=诚实 skip 并留痕）。
- IR-B（→01）：v2 回执对账按 (tenant, principal) 过滤——确认 service 凭据可读自身回执（已按此实现，待联验）。
- IR-C（→03）：页面消费面清单（processing/status、questions、manual-entry、preview），供 C2/C3 阶段接线。
- 检查会话问题通道合并裁决维持上一轮登记（目标一裁决单一事实源；本轮问题通道=Connectors 本地面，冲突走 A findings）。

## 7｜验收自断言

不靠"接口存在"宣称闭环：每条 A 链路断言读到 A 侧持久回执（artifacts 列表/analysis-runs 行/Gate 回执行/findings 行/回执查询）；A 未配置或映射缺失=显式 skipped+回执注明，不冒充完成。模型/渠道真实能力仍未授权，保持 BLOCKED 如实标注。
