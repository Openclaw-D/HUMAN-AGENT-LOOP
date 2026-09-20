# V0.3 zcode-real-loop · RESULTS（真实模型业务闭环结果）

执行：ZCode（单writer）· 2026-09-20 晚 · 栈：隔离真实栈（jw-zloop-pg@15474，A 48304 / Connectors 48284 / Edge 48324），模型 glm-5.2 real（authority=none），预算钉回授权包络（196 元/200 次/账本累计）。

## 0. 结论一句话

**中等客户的"材料→五区分析→候选→人工点选纠偏→补证→定向重跑→持久记录"闭环已在页面驱动下用真实 GLM-5.2 跑通并逐条留证；好客户完成资产域分析（材料深度锚定）；差客户完成有据阻断（模型候选全部为核验/补证诉求+规则面"覆盖不可计算、不补造数值"）。全程 A 侧资金/额度/敞口/确认表零写入。**

## 1. 三客户逐项对照

| 客户 | 案例/材料 | 期望（北极星§3） | 实际结果 | 判定 |
|---|---|---|---|---|
| 中（主案例） | KS-LASER-500（金属加工·正常·申请500万），D01+D02→补证D09 | 正常分析、补证、点选纠偏、定向重跑 | ①页面建档→上传D01/D02→信审分析：5候选（90/90/85/80/75%，全部 model_estimate_uncalibrated+材料引用）；②点选候选2→反馈持久化（feedback事件）→带反馈重跑：点选项升为首选95%、原首选降候选3，面板明示"已参考此前本人反馈；不代表模型权重已更新"；③补证D09→第三轮：依据2份→3份原件，新增候选直接引用合同真实要素（KS-LASER-500-S-202608-1、回款123.47万）；④观察面板：模型逐条引用原文并给出可点开片段（第1页0–309） | **闭环完成** |
| 好 | KS-INJECTION-1000（注塑·较好·申请1000万），D01/D02/D14/D15/D16+设备清单.csv | 更快识别与响应，结论依据可追溯 | 信审助手首次调用遇连接中断→**unknown 如实留档**（见§3故障）；资产助手独立作用域继续：4候选（95/90/90/85%），深度引用材料事实（"30%预付、60%发货、10%验收"付款节奏、"13台/组设备"、中登网核验步骤），依据5份原件 | **完成**（资产域；信审域留unknown防重发锁） |
| 差 | KS-TEXTILE-200（棉纺·较差·申请200万），仅D01+D02（缺件） | 及时识别风险，有据阻断，不强行通过 | 模型5候选（90/90/85/80/70%），**全部为核验/补证诉求，零批准倾向**；点出SYNTHETIC代码前缀、虚构地址、卓郎/卓朗品牌核对；规则面：政策域"前提缺失6项"、信审域"关键现金流输入缺失…覆盖结论不可计算（不补造数值）"；正式预评估链无评估无确认（fail-closed 保持阻断） | **有据阻断完成** |

## 2. 真实调用台账（11 次终局，10 成功 + 1 未知）

| # | 时间(UTC) | 客户 | 助手 | 状态 | tokens(入/出) | 触发方式 |
|---|---|---|---|---|---|---|
| 1 | 15:20:30 | 中·冒烟 | credit | succeeded | 2241/711 | API 冒烟 |
| 2 | 15:27:37 | 中 | credit | succeeded | 2251/1623 | **页面·给我建议** |
| 3 | 15:31:44 | 中 | credit | succeeded | 2326/944 | **页面·更新建议（含点选反馈）** |
| 4 | 15:35:39 | 中 | credit | succeeded* | 3116/1773 | 页面·补证后更新（basis 中途变化→被当前性核验作废） |
| 5 | 15:38:19 | 中 | credit | succeeded | 3116/736 | 页面·补证后重试（3份原件候选） |
| 6 | 15:39:59 | 中 | credit | succeeded | 2952/1355 | **页面·模型观察（引用片段展示）** |
| 7 | 15:42:23 | 好 | credit | **unknown** | 未知 | 页面·给我建议（UND_ERR_CONNECT_TIMEOUT，零重发） |
| 8 | 15:46:13 | 好 | asset | succeeded | 4844/1296 | 页面·资产助手给我建议 |
| 9 | 15:51:30 | 差 | credit | succeeded | 2196/1418 | 页面·给我建议 |
| 10 | 15:52:51 | 中 | commerce | succeeded | 3119/585 | API·并发专项 |
| 11 | 15:52:58 | 中 | business | succeeded | 3119/1000 | API·并发专项 |

\* 第4轮为"补证与23秒分析窗口竞争→结果被诚实作废"的反例证据（页面显示"材料已变化或本次结果未通过核验，旧候选不可选择"）。

- 确定计费 tokens：入 29,280 / 出 11,441（按官方 8/28 元每百万估 **≈0.55 元**）；第7次 unknown 费用未知不计零。账本累计预占 10.85 元 / 上限 196 元（含共享栈既有 4.2 元——**未清零延续**）。
- 逐条 requestId/analysisRunId/回执文件：`evidence/call-ledger-raw.json`；账本 `Back/Edge/.run/zloop/model-cost-ledger.jsonl`。

## 3. 故障与反例实跑记录

| 反例 | 证据 | 结果 |
|---|---|---|
| 发送后结果未知（UND_ERR_CONNECT_TIMEOUT） | 好·credit 终局回执 status=unknown sent=null；页面锁定"暂不发起新分析或反馈"+保留运行身份 | 无自动重发；信审作用域按设计挂起，资产作用域继续办理 |
| 补证与在途分析竞争（陈旧结果） | 第4轮 valid=false cands=0（decision-feedback 事件账本） | 旧候选作废不可选，诚实披露 |
| 客户端注入事实不出站 | full-chain e2e 断言（brief 含注入字样=false） | 注入被拒 |
| 伪造引用降级 | full-chain e2e：forged-ref → 待核验问题（UNVERIFIED_REFERENCE） | 不进入有效观察 |
| 缺件 | textile 无工件时 observe=422 EVIDENCE_UNAVAILABLE（e2e） | 未发送 |

## 4. 边界分列（离线 / 真实API / 页面验收）

- **离线**（零出站）：Edge 138/138、B 110/110、full-chain e2e 24/24×3轮（本地替身）、bench-30 防重发 10并发→1调用。
- **真实 API**：11 次出站全部经产品链（Edge→assistant-model→LangGraph 六节点→B transport→智谱）；10 成功 1 未知；引用校验/回执/账本全程留痕。
- **页面验收**（本会话浏览器实操，截图为证）：建档、五区助手切换、分析触发、候选展示（置信度降序+未校准声明+依据）、点选反馈、反馈后重跑、补证后重跑、观察面板引用片段展开、unknown 锁定态——均为页面动作并与后端 runId 一一对应。
- **页面未覆盖（如实）**：文件上传经 Connectors API 完成（IAB 浏览器自动化不支持文件选择器；页面手工上传入口存在，复验步骤见 RUNBOOK）；二十格看板格子状态保持"未开始"锁（格子走 A 准入评估链，本切片未做需求登记/评估——非本切片范围）；"核心交互=点选纠偏"已页面验证，但知识沉淀/评测校准层未实现（按北极星为后续版本化评测范围）。

## 5. 错误与无依据结论记录

- 模型输出全部 authority=none、confidence 全部标注 model_estimate_uncalibrated；未见模型虚构金额/编造材料外事实（观察与候选均能对应证据片段）。
- 第2轮候选2 impact 提到"当前证据显示代码为SYNTHETIC-KS-LASER-500且未仿制执照"——与 D02 原文一致，非无依据。
- 未测人工基线 → **不报告任何提效百分比**；本切片 tokens/费用/耗时为实测，AI 质量准确率未测。

## 6. 持久记录与零写验证

- A 库：credit_facilities=0、financing_requests=0、exposure_entries=0、preassessment_confirmations=0、credit_assessments=0（模型闭环对正式业务面**零写入**）。
- 持久留痕：11 终局回执 + intent/claim 文件（Back/Edge/.run/zloop/model-receipts/receipts/）；决策事件账本 rev=7（begin/finish/feedback 全事件，decision-feedback/）；成本账本 56 条（预算未清零）。
- A2A/LangGraph：每次调用 graphTrace 六节点（prepare_evidence→validate_input→controlled_model_call→validate_citations→check_current→output_receipt）真实执行并计节点耗时；business+commerce 并发 overlap=true（evidence/parallel-dispatch.json）。

## 7. 源码漂移声明（并行 writer）

本路隔离栈 23:12 启动后，检测到并行切片（V0.3-Jev/taskkind 候选预测方向）于 23:30–23:32 修改 `assistant-model.mjs`、`assistant-decisions.mjs`、`decision-feedback-store.mjs`。**本轮全部真实调用与页面验证反映的是栈启动时（≤23:10）加载的代码**；其后的在制修改不在本轮证据覆盖内，由对应任务自行验收。本路未回退、未覆盖任何并行修改。
