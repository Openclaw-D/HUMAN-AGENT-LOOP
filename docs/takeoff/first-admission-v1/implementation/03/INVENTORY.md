# 03路盘点 · 2026-09-20（writer：ZCode 03路）

任务：TAKEOFF-FA-1.0.0 统一证据处理与受控分析链（ownership：Back/B/**、Back/C/**、Back/Connectors/**）。
本文件是本路开工盘点底账，只记录实测；后续变更在此增量登记。

## 0. 契约与依赖状态

- `Back/CONTRACT.md` 最新登记仍为 **§12 / v2.5（2026-09-19）**；01路的 `confirm-preassessment` 与候选同版协议增量**尚未冻结**（implementation/01/ 也不存在）。
- 结论：本轮先做①五域适配（确定性、不依赖01新字段）②调用协议冻结（02/04消费）③候选内部产出扩展（期限/价格口径/引用/修订语义，落点为 Connectors 收口 `amount_candidate` + A 登记 runs/gate/findings 既有面）；**A 候选新字段映射等01冻结后接线**，不猜A侧字段造第二套schema。
- 04路验收夹具已生成（`Back/Edge/test/fixtures/takeoff/`），其 kind 词表标注"拟，待03冻结词表核对"——本路协议冻结后04按词表核对。

## 1. 三模块现状（实测）

### Connectors（处理链主驱动）
- 链路：intake 邀请/上传 → evidence 登记（对象存储）→ processing coordinator 驱动
  `register_material → unzip → parse → facts → analyze → questions → register_results → done`；
  状态机含 `blocked_link/blocked_a_unavailable/blocked_unknown/needs_followup/failed/skipped_duplicate`，
  常驻 sweep 按游标恢复，绝不换 ID 重发（T07/T11 的机械基础已存在）。
- 判重：同客户同字节同声明元数据 → `duplicate_of`，A 侧不重复登记、parse/analyze 跳过（T05基础）；
  同字节不同元数据 → 新锚点语义照常处理、差异显式并存。
- analyze：感知一次（C pipeline）→ recalc-planner 选择性重算 → 域结果按
  (租户,客户,域,消费面签名,规则版本) 缓存于 `domain_analyses`；收口（Gate/提问/金额/下一步）
  按 (inputHash,规则版本) 幂等于 `analysis_finalizations`；旧水位回写被 CACHE_STALE_WRITE/收口键天然隔离（T08基础）。
- register_results：派生解析工件→逐域 run start/finish→Gate 回执→findings→包域结果，全部经 aOp 幂等
  （确定性 requestId；unknown 先对账）登记 A（T02"从发现回到原件"的引用面）。
- **当前域表：`DOMAINS = ['policy','credit','commerce','asset']`（四域）——TAKEOFF 需要五列，缺 business（商机）。**
- 解析白名单：CSV/TSV/XLSX/TXT/可提取文本 PDF/ZIP 安全解包/JPG+PNG+扫描PDF 安全接收；
  扫描/图片一律 FORMAT_UNSUPPORTED 转人工（人工录入入口已接：manual_entry 事实+获准复核升 verified）。
- kind 词表（evidenceKindOf 已知集）：statement/tax_filing/sales_purchase/accounting_ledger/
  equipment_contract/site_evidence/document/transcript/message/device_observation/image/video/audio；
  **未知 kind 一律降级 document（只影响重算面，不影响登记）**。

### C（确定性域管线）
- `domains/`：perception（感知快照/冲突保留/域投影）、assessors（四域评估器）、pipeline
  （感知→域评估→派生事实→规则→Gate→提问→金额→下一步）、schema（AnalysisRun/DomainAssessment 结构校验，
  authority 恒=none、发现必须可定位、无 confidence 字段）。
- `rules/`：rule-schema/engine/gate + `four-domain-rule-pack-v1.json`（全部 simulation_rule 合成规则，
  approvalStatus/生效窗口/不可豁免硬门/例外拒绝结构齐全）。
- `amount/candidate.mjs`：确定性金额候选（产品上限/可支持区间/缺口/HOLD；版本锚 currency/caliber/
  termMonths/inputWatermark/rulesetVersion/formulaVersion）。**缺：期限与价格口径作为一等输出、变更理由、
  修订引用（前版候选/输入/规则/运行引用）的显式结构。**
- `src/candidate-schema.mjs`：模型候选五字段白名单（observations/evidenceRefs/assumptions/uncertainty/
  recommendedHumanAction）+执行性措辞扫描——这是"模型候选"，与金额候选是两物。
- `src/parse/adapters.mjs`：真实字节解析（v2），产出 declaredFacts（declared 级）+source_supported
  数值（绑原件哈希+行引用）。
- 基线测试：`node test/run-all.mjs` = **101/101 绿**（2026-09-20 实测）。

### B（持久执行与路由）
- LangGraph 编排+文件 checkpoint、A 契约 client、三分发送语义、worker（租约/软超时/恢复）、
  预算门（全局/customer/session/调用数，失败关闭）、`fd:*` 四域工具接线、
  `routes-four-domain.json`（全量评估/单域重算×4/Gate-only；NO_ROUTE 升级人工）。
- transport glm.mjs：**无流式消费**（HTTP 完整读取；AbortController 超时→unknown 三分语义）；
  取消在步边界（标志文件）。—— 流式=未接，据实标注，不承诺首字时间。
- 基线测试：`npm test` = **105/105 绿**（2026-09-20 实测，79s）。

## 2. TAKEOFF 适配缺口（本路范围）

| # | 缺口 | 落点 | 验收 |
|---|---|---|---|
| G1 | 五域：缺 business（商机） | C schema/assessors/perception 投影/规则包；B fd 工具+路由；Connectors DOMAINS/依赖映射 | T03/T04 |
| G2 | 资产不被商务整列锁定 | 依赖映射核查（equipment_list 只影响 asset/commerce 而非全列）+定向测试 | T03 |
| G3 | 候选缺期限/价格口径/修订引用/变更理由 | C amount candidate 扩展 + Connectors 收口落库 + A 登记面 | T04/T08 |
| G4 | 金额可增可减+冻结解除（合成配置+确定性替身） | 合成规则包（标明非机构政策）+确定性管线端到端 | T04/T06 |
| G5 | 材料 kind 词表未覆盖 04 夹具（legal_document 等） | 协议冻结：扩词表+依赖映射，未知 kind 保守处理 | T02 |
| G6 | 五助手=职责非常驻：business 角色路由/去重/见微汇总 | B 路由 roles+recalc 去重面核查 | T14 |
| G7 | 恶意材料指令不获权限（T12/T14 侧） | 解析层指令文本处置核查+authority=none 结构（已存在）补测试 | T12/T14 |
| G8 | 预算不足不假完成（T14 侧） | B 预算门已存在，补定向测试 | T14 |
| G9 | 清理：孤立/全生命周期样例 | B/C/Connectors 逐项依赖检查+备份校验 | 交付记录 |

## 3. 边界与不动项

- 不写 A/CONTRACT、Edge、D、Front、共享根文档；A 候选新字段消费等01冻结。
- 真实模型 API：未获授权，0 调用；transport 保持预留，预算门照常生效。
- 不 commit/push/切分支/worktree；不停未知进程；数据库/对象存储不按目录名盲清。
- 三模块基线（C 101、B 105）为回归底线；Connectors 测试依赖隔离 PG（15443），本轮联调
  使用独立登记资源，不占用 15443/15444 既有实例的归属判断。
