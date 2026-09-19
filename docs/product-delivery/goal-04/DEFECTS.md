# 任务四｜缺陷台账（DEFECTS.md）

登记规则：本轮发现的每个缺陷一行，复现命令/步骤必备；缺陷退回对应 writer（01/02/03），本路不改他路源码掩盖失败。修复后由本路定向复测并在本文件标注"已复测关闭"；未修复一直保留，不得从台账删除。

| ID | 日期 | 严重度 | Owner | 摘要 | 复现 | 状态 |
|---|---|---|---|---|---|---|
| DEF-G04N-01 | 2026-09-18 | P1 | 02 | 处理链 `register_results` 阶段把解析产物（parse_extraction 派生件）登记到 A 时全部 400 INVALID_INPUT「requestId 必须是 1..128 长度的 string」；解析事实/预审结果只存 Connectors 本侧，**永不到达 A**（13/13 任务失败）。上游材料登记（register_material）正常。 | `node Back/D/product-journey/journey-first-file.mjs` → 金丝雀 `kd:register-results-reaches-a`；证据 `docs/product-delivery/goal-04/evidence/d2/first-file-*.json` | **已复测关闭（2026-09-19，R4）**：02 路修复 a_bridge/coordinator 后金丝雀转绿——register_results 全部 `done`，0 任务失败于 A 结果登记；解析事实/Gate 回执/分析运行真实到达 A（证据 `evidence/d2/first-file-1789748291415.json` defectProbes `ok:true`）。注：journey A 实例须先经 admin 激活规则包版本（驱动器已补该前置步骤），否则 A fail-closed 报 STALE_BASIS——那是正确行为不是缺陷。 |
| DEF-G04N-02 | 2026-09-18 | P2 | 01+02 | **kind 命名空间错位（结构性，本轮未爆发）**：02 coordinator 送 A 的材料 kind 为 `material.<kind>`，而 01 新增的 customer_identities.allowed_kinds 校验（迁移 009）按原始 kind 白名单比对。目录种子 customer 身份不触发该校验（本轮实测通过），但**真实邀请兑换流程（cit_* 凭据）接通时客户上传将被全部拒绝**。两路须对齐：A 侧剥前缀比对或 coordinator 送原始 kind。 | 代码审读：`Back/Connectors/src/processing/coordinator.mjs` stageRegisterMaterial（kind 前缀）× `Back/A/src/domain/credit.ts` registerArtifact allowed_kinds 校验 | **已复测关闭（2026-09-19，R4）**：A 侧已按剥前缀比对收敛（`credit.ts` registerArtifact，comment 显式标注本缺陷），01 路终验日志可证（`docs/product-delivery/goal-01/evidence-invitations-final.log` 6/6 含 V4 材料种类服务端强制）。本路黑盒定向复测走完整真实链：业务建邀请（allowedKinds=[bank_statement]）→ 匿名兑换得 cit_* 凭据 → 按 02 路命名空间送 `material.bank_statement` → **200 登记**；送未获准 `material.ledger_book` → **403 PERMISSION_DENIED**（前缀不构成越权通道）。金丝雀 [4.5] 段 4 项全过（证据 `evidence/d2/first-file-1789748291415.json`）。 |
| DEF-G04N-03 | 2026-09-18 | P2 | 02 | **XLSX 被魔数识别当 ZIP 容器**：账表 XLSX 进入 unzip 阶段，解出 5 个 OOXML 部件为派生件并产生谓词为 `<?xml version` 的垃圾声明事实；语义错误（XLSX 是单一文档不是材料容器）。需 XLSX 专用适配器（任务书要求 XLSX 在支持范围内）或显式 FORMAT_UNSUPPORTED→人工路线。 | 同上金丝雀 `xlsx:no-zip-container-mishandling`（本轮派生子件 5 个实测） | **已复测关闭（2026-09-19，R4）**：02 路交付 XLSX 专用适配器（C parse-adapters：`isXlsxBuffer` 识别→就地结构化解析，不再进 ZIP 容器路径）。金丝雀实测：任务止于 `register_material:done→unzip:skipped→parse:done→facts:done→analyze:done→questions:done→register_results:done`，派生子件 0 个，零垃圾声明事实（证据同上）。 |
| DEF-G04N-04 | 2026-09-19 | P1 | 03+01 | **页面正式提案链无法绑定依据包：J1.5 正式决定在页面层无法完成**。工作本提案面板 facility.propose 只传 `assessmentId` 不传 `packageId`（`Front/site-mirror/app/workbench/proposal-panel.tsx`），而 A 新权威门强制 `BASIS_PACKAGE_REQUIRED`（409：正式提案必须绑定依据包——该服务端行为本身正确、fail-closed）。且交付运行时 principalTokens **无 service 主体**，Gate 回执/分析运行/依据包登记（kind=service 专用）在交付形态不可达 → 依据包恒不存在 → 页面提案恒 409 → approve/activate 按钮永不出现。 | 交付栈（jw-g04b-pg@15452/A@48282/Edge@17931）页面动作链实测：提案 409 `BASIS_PACKAGE_REQUIRED`；证据 `docs/product-delivery/goal-04/evidence/d3/perf/round-*.json`（keySubmit.blocked）、`evidence/d3/page-journey-J1.json` J1.5 | OPEN（owner 03：页面补包绑定/展示；owner 01：交付运行时补 service 主体或等价登记面；服务端门语义无需改动） |
| DEF-G04N-05 | 2026-09-19 | P2 | 03 | **页内消息通道对端不渲染**：biz「对客户」消息与客户回复均获服务端回执（页面显示「已送达（服务端回执）」），但接收端页面均不显示：客户门户未显示对客户消息（在线观察 ≥18s 与刷新后）；biz 工作本在「实时连接」徽标在线状态下 ≥8s 不显示客户回复。J1.4「页面内受控渠道」双向问答不可用。 | 双会话实测（tab1 biz1 / tab2 客户门户）：互发消息各留服务端回执、两端口均不可见；证据 `evidence/d3/page-journey-J1.json` J1.4 | OPEN（owner 03：消息线程跨端渲染；回执制本身工作正常） |

严重度：P0=硬门路径不可用/正确性破坏；P1=必测反例未被拒绝或页面误导；P2=体验/性能可感知缺陷；P3=记录性。

补充观察（P3 级，暂不立条）：PDF 文本抽取的谓词名带尾随空格（如 "TOTAL PRICE "）——下游按谓词精确匹配时会失配，建议抽取时 normalize；见 evidence/d2 PDF facts。

## 前轮遗留对照（不自动继承为本轮缺陷）

前一轮（docs/backend-upgrade/goal-04，PR#4 分支）遗留 DEF-G04-01/02/09/10 与 D27-R BLOCKED——本轮对可迁移者按新判据重新验证后决定是否重开条目，不在未验证时写成"已解决"或"仍存在"。
