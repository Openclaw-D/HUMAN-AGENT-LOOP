# 01-front 交付：十案例前端与业务操作闭环（V0.5 候选）

2026-09-30 收尾轮冻结。ZCode 第一路（与 09-29 轮同 writer，已交回后继续）。范围遵守 `../00_SCOPE.md`；
仅写 `Front/**`（源码+dist）与本目录。未动 Back/Edge/Connectors/根文档；未 commit/push/tag；未重启 48430（全程只读使用）。

## 1. 本轮改动摘要（对应任务 1–6）

**任务1 · 十案例横向展列**
- `lib/workbench/arrow-cases.ts` 重写：容错消费 02 manifest（caseId/customerId/displayName/scenarioLabel/displayOrder/
  summary/checkpoint/nextAction 多候选字段名兼容——02 CONTRACT_DELTA 定稿前不阻塞）；`sortCasesForDisplay` 差→中→好；
  十例开发夹具（`?demoFixture=1`，按 00_SCOPE 十案例清单造名，页面红字标注不作验收）。
- `workbench/customer-directory.tsx`：默认视图改横向滚动案例条（`CaseStrip`：固定卡宽+scroll-snap+左右步进按钮，
  约一屏 5 卡，不挤十卡）；卡片=分类/业务名/要点/当前阶段（服务端 checkpoint 优先，缺省由五区进度推导）/下一动作/
  五区真实进度。**业务入口已无验收视图/测试开关**：完整客户目录仅在 `?acceptance=1` 工程参数或演示清单未接通
  （诚实回退+重试）时出现。内部编号（customerId/caseId）不外显。
- `app/takeoff/glass.css`/`compact-workspace.css`：案例条/卡片/阶段块/徽标样式。

**任务2 · 案例内已走路线与下一动作**
- 四页（平台/材料/决策/流程）沿用同源读面：已走路径=看板状态+流程页服务端事件时间线；材料页原件/解析事实、
  决策页候选/意见卡、待办回原格子均已在位。本轮新增目录卡检查点与下一动作直接可读；缺件/待核验/待人工
  均显示服务端原因（receipts 状态词表中文映射）。

**任务3 · DEF-03-05 修复 + 收口/履约页面动作**
- **新增 `app/takeoff/human-verification.tsx`**：收入（业务·revenue_annual_declared，万元数值）/主体（政策·
  entity_identity_verified）/权属（资产·equipment_ownership_verified，通过/不通过）三类人工核验登记的正式页面入口。
  挂载于核验行格子抽屉（原"暂无可办理动作"处）。流程：结论+依据（必填留痕）+confirmed 勾选 → 二次确认对话框 →
  既有授权接口 `registerArtifact`（kind=document, grade=confirmed, sourceMode=human_verified_document）→
  advance-plan→advance 触发受影响区重评（RoundSupplement 同型 pending 幂等；复用 jw:round-supplement 事件联动）。
  不绕权限（403 原样提示切角色）、不把采用候选当核验（与 decision 是两类事件，界面文案区分）。**行为测试锁定
  请求体形状与通过/不通过两路径（差例权属=false 如实登记不刷绿）**。
- **新增 `app/takeoff/cycles-panel.tsx`**：履约·结清·返单面板（办理菜单入口）。状态驱动动作：open→履约完成；
  awaiting_external_receipt→显示"待外部回执（外部收付款未连接）"+登记模拟回执（编号+来源必填，来源预填
  "模拟演练回执"）；回执已登记→结清；settled→关闭/返单（reorderOf 独立新周期）。全部二次确认+requestId 幂等；
  未确认回执结清页面禁用（服务端 409 双保险）。`wb-client.ts` 新增 listCycles/createCycle/fulfill/
  recordExternalReceipt/settle/close 六方法（TASK3_INTERFACES §6 原样）。
- 预评估收口沿用既有 EndDialog（三类结论+撤回，绑定版本/硬门）——本轮未改语义。

**任务4 · 角色入口**
- `role-entry.tsx`：某角色下有且仅有一个"只含本角色"的身份时**自动进入**（biz1/pol1 等单角色身份直进；
  adv1 等跨专业协调身份不再挡在业务入口）；多个单角色身份才出选择器（中文职责名直显，内部代号→"角色身份 N"）。
- 跨角色提示：403 → "当前身份无本列办理权限：请在右上角切换到对应专业角色后重试（不借用其他身份）"；
  意见卡 reject 需信审角色时预先提示"「拒绝本案」需信审角色：请切换角色后办理"。不后台借管理员凭据。

**任务5 · 连接提示与 override 收敛**
- `describeLoginFailure`（新增，含测试）：CREDENTIAL_VERIFICATION_UNAVAILABLE/503+核验类 → "后台身份核验服务暂不可用
  （通常是数据库或上游服务未启动）：请启动服务后重试…"；502/504 → "请确认数据库与办理服务已启动"；401/403 → 权限/凭据；
  无 status → 网络不可达；PRINCIPAL_UNTRUSTED → 角色配置未就绪。列推进 404/503 → "本列服务暂未接通：请确认办理服务已启动"。
  业务阻断（waiting_evidence/HARD_BLOCK/红线）仍是业务语义提示，不混称"连接不上"。
- `root-app.tsx`：`?edge=` 仅在 dev 端口（3617/3618）**且**目标主机为 127.0.0.1/localhost/::1 时生效；生产与其他端口
  一律忽略（同源托管），凭据不会发往任意地址。

**任务6 · 助手与降噪**
- `takeoff-assistant-brief.ts` 新增 `composeCaseExplanation`：无模型自由问答时（MODEL_NOT_CONFIGURED）聊天内返回
  【案例说明 · 服务端读面组答（非真实模型）】——当前客户/评估状态/现行材料数/需求登记/规则门/暂缓动作/待满足条件/
  可继续的事，全部来自当前真实投影；结尾明确"自由模型问答未配置：可查看材料原件、按页面按钮办理，或请负责人接入模型"。
  点击建议提问=填输入框（用户发送）；纯文本走内部消息既有链路。**已实测**：48430 无模型栈提问得到完整案例说明。
- 语音/电话/扫码三个 disabled 假按钮移出主流程（上传/引用/@保留）；表情面板移除。

## 2. 冻结指纹（交 03 集成）

- 冻结时间：2026-09-30（本轮收尾构建）
- `Front/dist/index.html` sha256 = `30d30cac98bee093c89bcb66f481e8d0844f1490421a7361f1bc6d27ecdf90e1`
- `Front/dist/assets/index-Bs_MNrNz.js` sha256 = `ebfa9c281374db8d882e123a77add8fee47433d722b89241dbd787921345a914`
- `Front/dist/assets/index-M8Eyq3S5.css` sha256 = `1e5c1f46151d454dbb8d36fe3217fb8751c28492d8fb1efd21d4a361fb513e8e`
- pdf 分包：`pdf-BHYTCBMm.js`、`pdf.worker.min-CK_pjWcW.js`
- 03 同源托管 Front/dist 即生效（Edge static 实时读盘；无需 CORS）。

## 3. 测试与检查

- `npm test`：**164/164 通过，exit 0**（node v24.15.0，kimi-desktop runtime）。
- 本轮重写/新增：demo-directory.behavior.test.mjs 8 条（十例排序与卡片内容、横向滚动结构、无验收视图/调试开关、
  夹具十例标注、进度真实投影、角色自动进入、登录失败分类、DEF-03-05 请求体+通过/不通过双路径、cycles 状态驱动
  动作+回执纪律、助手案例说明+降噪）。
- 既有更新：directory.behavior.test.mjs（回退路径下完整目录语义）、visual-workspace（角色失败新文案）、
  column-advance（403 切角色文案，其余语义不变）、takeoff-board（沿用）。
- `npm run typecheck`：零错误。`npm run build`：成功（见 §2 指纹）。

## 4. 视觉证据（1920×1080/100%，screenshots/）

| 文件 | 内容 | 栈 |
|---|---|---|
| 01-role-entry.png | 角色入口（中文职责五卡，无工程身份/编号） | 48430 真实 |
| 02-demo-directory-real3.png | 演示目录·真实 3 案例（差→中→好，阶段/下一动作块，五区进度） | 48430（03 arrow-cases 回退） |
| 03-ten-case-fixture-strip.png | 十案例夹具横向展列（滚动步进、逐例检查点、夹具红字标注） | 48430+夹具 |
| 04-workspace-board-good.png | 好例工作台：事件按钮"提交材料并分析"、助手上下文/建议、降噪后工具条 | 48430 |
| 05-verification-register-drawer.png | DEF-03-05：商机·核验抽屉内"年收入核验·登记核验结论"表单 | 48430 |
| 06-cycles-panel.png | 履约·结清·返单面板（无周期空态+纪律说明） | 48430 |
| 07-assistant-case-explanation.png | 无模型提问→【案例说明】确定性投影（来源标注） | 48430 |

全部为只读会话（登录+GET/页面导航），未触发任何业务事件/付费模型。

## 5. 用户操作步骤（演示者视角）

1. 打开 `http://127.0.0.1:<Edge端口>/` → 角色页点职责卡进入（同角色多身份时才出现中文选择）。
2. 演示目录：差→中→好横向滚动（左右箭头/滚轮），卡片读要点/当前阶段/下一动作；点卡进入。
3. 工作台：顶栏显式事件按钮按服务端状态变化（提交材料并分析→等待人工确认→…）；左右列箭头仅浏览。
4. 核验：点开 业务/政策/资产 列"核验"行格子 → 填结论+依据 → 勾选 confirmed → 提交（二次确认）→ 自动重评受影响区。
5. 信审待补件：事件按钮变"补充现金流材料并重评"打开材料面板（补件→仅相关区重评）。
6. 采用意见：事件按钮变"确认本次选择"；拒绝需信审角色（界面提示切角色）。
7. 收口：办理→结束（三类预评估结论+撤回，服务端版本/硬门）。履约/结清/返单：办理→履约·结清·返单。
8. 助手：右侧绑定当前客户/专业；建议提问点击填入；@提问在无模型时返回案例说明（来源标注）。

## 6. 逐案例 UI 能力表（进入后可用动作×当前实现）

| # | 案例（00_SCOPE 主旨） | 目录卡显示 | 进入后已走路线可看 | 关键页面动作（01 已具备） | 依赖 |
|---|---|---|---|---|---|
| 01 差 | 年收入超5000万红线 | 要点/阶段/下一动作 | 材料/分析记录/规则门 | 看收入原件（材料页）；红线阻断原因（格子详情/助手案例说明）；不可强制通过（adopt 无入口） | 02 十例清单+材料 |
| 02 差 | 资产权属冲突 | 同上 | 申报 vs 核验冲突记录 | 资产·核验格→权属核验"不通过"登记（留痕）；硬阻断 409 提示；拒绝入口（信审角色） | 02/03 |
| 03 差 | 偿债能力不足 | 同上 | 现金流/偿债原件、风险意见 | 查看候选与依据；信审角色拒绝或补证重评 | 02/03 |
| 04 中 | 现金流缺件 | 同上 | 信审 waiting_evidence 原因 | 事件按钮→补材料面板；补件后仅相关区重算（服务端 affectedDomains） | 02/03 |
| 05 中 | 金额/期间口径冲突 | 同上 | 两份矛盾材料、冲突计数 | 材料页并读+factConflicts 提示；核实后版本重算 | 02/03 |
| 06 中 | 核验未完成 | 同上 | 材料/分析已有、核验待办 | **收入/主体/权属核验登记表单（本轮 DEF-03-05）** | 02/03 |
| 07 中 | 新证据致旧结论陈旧 | 同上 | 历史判断+stale 标记 | stale 格冻结提示；按新证据重评入口 | 02/03 |
| 08 好 | 首次预评估收口 | 同上 | 五区结果与依据 | 核验→采用→结束对话框三类结论确认（不批正式额度） | 02/03 |
| 09 好 | 履约待外部回执 | 同上 | 前序完成、周期待回执 | 履约·结清·返单面板：履约完成→登记模拟回执（来源明确）→结清解锁 | 02 cycles 样例 |
| 10 好 | 已结清可返单 | 同上 | 结清/关闭演练记录 | 面板：返单开独立新周期（历史不覆盖） | 02/03 |

## 7. 未完成 / 边界（如实）

- 十案例端到端联调**未做**（02 尚未交 CONTRACT_DELTA/十例清单样例，03 v05 栈 48431 arrow-cases 未通）：
  本轮以 48430 三真实案例+十例夹具验证布局与全部页面动作；最终十例浏览器验收由 03 在 01/02 冻结后执行。
- 02 manifest 的 summary/checkpoint/nextAction 字段名未定稿：前端按多候选名容错，02 定稿后如不同名，仅需在
  `arrow-cases.ts pickText` 候选列表加名（见 01-front/NEEDS.md）。
- cycles 状态词表按 TASK3_INTERFACES §6 常见态映射；02 若实际状态名不同，需同步 STATE_LABEL/canXxx（NEEDS §3）。
- `?demo=virtual` 旧虚拟演示保持隔离不动（非默认/回退路径）。
- 本轮零付费模型调用、零 commit/push/tag；48430/48423 全程只读；48321 在本轮中途被外部停止（非本会话操作），
  未重启；3617 preview 为既有进程，未动。
