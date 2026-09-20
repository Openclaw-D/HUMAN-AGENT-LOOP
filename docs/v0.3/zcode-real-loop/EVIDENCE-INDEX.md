# V0.3 zcode-real-loop · 调用清单与证据索引

## 1. 真实调用清单（全部经产品链：Edge 会话/授权 → assistant-model → LangGraph 六节点 → B transport → 智谱 glm-5.2）

逐条 requestId / analysisRunId / 回执文件 / 用量 / 引用校验数：**evidence/call-ledger-raw.json**（机器可读）。

| # | UTC 时间 | 客户×助手 | 状态 | tokens(入/出) | 触发 | runId（requestId 前 60 字符见 raw.json） |
|---|---|---|---|---|---|---|
| 1 | 15:20:30 | 中·冒烟×credit | succeeded | 2241/711 | API 冒烟 | amq:cust-mu9yqi5s…:v2-f14356eb…::obs:credit:4a4ac25460c2::a1 |
| 2 | 15:27:37 | 中(LASER)×credit | succeeded | 2251/1623 | 页面·给我建议 | amq:cust-mu9yu9db…:v2-74cf3a09…::obs:credit:3ef3f6c8feda::a1 |
| 3 | 15:31:44 | 中×credit | succeeded | 2326/944 | 页面·更新建议（反馈入上下文） | amq:cust-mu9yu9db…:v2-d9fc6a94… |
| 4 | 15:35:39 | 中×credit | succeeded→**作废** | 3116/1773 | 页面·补证后更新（basis 竞争） | amq:cust-mu9yu9db…（valid=false 反例） |
| 5 | 15:38:19 | 中×credit | succeeded | 3116/736 | 页面·补证后重试 | amq:cust-mu9yu9db…（3 份原件候选） |
| 6 | 15:39:59 | 中×credit | succeeded | 2952/1355 | 页面·模型观察（引用片段） | amq:cust-mu9yu9db… |
| 7 | 15:42:23 | 好(INJECTION)×credit | **unknown** | 未知 | 页面·给我建议 | amq:cust-mu9zheml…:v2-13647111…（RESULT_UNKNOWN_INTERRUPTED，零重发） |
| 8 | 15:46:13 | 好×asset | succeeded | 4844/1296 | 页面·资产助手 | amq:cust-mu9zheml… |
| 9 | 15:51:30 | 差(TEXTILE)×credit | succeeded | 2196/1418 | 页面·给我建议 | amq:cust-mu9zp319… |
| 10 | 15:52:51 | 中×commerce | succeeded | 3119/585 | API·并发专项 | amq:cust-mu9yu9db…:v2-d93b7f2e… |
| 11 | 15:52:58 | 中×business | succeeded | 3119/1000 | API·并发专项 | amq:cust-mu9yu9db…:v2-be5bde28… |

- 每次调用 request 身份绑定：tenant+customer+assistant+question+完整上下文（含证据包）hash+configHash+promptVersion；同载荷重放零出站（e2e 与 bench-30 断言）。
- 六节点 graphTrace（节点+耗时）逐回执内嵌；引用校验 citationChecks 逐条留档。
- 费用口径：确定部分按官方 8/28 元每百万估 ≈0.55 元；#7 unknown 费用未知不计零；账本累计预占 10.85/196 元（含共享栈既有 4.2 元延续）。

## 2. 页面动作 ↔ 后端 runId 对应（中等客户主链）

| 页面动作 | 页面时间 | 后端证据 | 对应 |
|---|---|---|---|
| 新建客户"喀什示例金属加工有限公司（激光场景·合成）" | 23:23 | A customers cust-mu9yu9db-948bbe5d2f28（页面表单→A 建档） | ✓ |
| 上传 D01/D02（Connectors API，见 RESULTS§4 边界） | 23:24 | evidence_artifacts + a_links registered + A artifacts 4 条 | ✓ |
| 信审·给我建议 | 23:27:18 | intent 23:27:18.539 → terminal 23:27:37.927；账本 reserve+actual 同 requestId | ✓ 调用#2 |
| 点选候选2"核验设备所有权与可回租范围" | 23:30:50 | decision-feedback 事件 feedback:de4c51c1… action=select option_2 | ✓ |
| 更新建议（含反馈） | 23:31:22 | begin 23:31:22 → finish 23:31:44（新 runId v2-d9fc6a94…）；点选项升首选 95% | ✓ 调用#3 |
| 补证上传 D09（API） | 23:34 | evidence ev_2907472c… → A artifacts 6 条 | ✓ |
| 更新建议（补证轮·首次） | 23:35:16 | finish 23:35:39 valid=false cands=0（basis 竞争→诚实作废，页面提示旧候选不可选） | ✓ 调用#4 |
| 更新建议（补证轮·重试） | 23:37:5x | 生成时间 23:38:19，"查看依据·3 份原件"，新增合同要素候选 | ✓ 调用#5 |
| 观察面板提问+获取模型观察 | 23:39:3x | 调用#6；页面展示可点开引用片段（第1页 0–309 / 0–298） | ✓ |
| 好·信审给我建议 | 23:42:1x | 调用#7 unknown；页面锁定"暂不发起新分析或反馈" | ✓ |
| 好·资产给我建议 | 23:45:5x | 调用#8；4 候选引用 5 份原件 | ✓ |
| 差·信审给我建议 | 23:51:30 | 调用#9；4 候选全部核验/补证诉求 | ✓ |

## 3. 证据文件索引

| 文件 | 内容 |
|---|---|
| `evidence/call-ledger-raw.json` | 11 次终局回执机器可读全量（requestId/analysisRunId/usage/error/回执文件名） |
| `evidence/smoke-result.json` | 后端链冒烟分步结果（A 登记→上传→decisions→真实候选） |
| `evidence/parallel-dispatch.json` | business+commerce 并发专项（overlap=true，双真实调用） |
| `evidence/medium-1-first-analysis.png` | 中客户首次 5 候选页面（整页） |
| `evidence/medium-3-after-supplement.png` | 补证轮候选面板（3 份原件+合同要素候选） |
| `evidence/medium-4-observe-citations.png` | 观察面板区域截图（引用片段文本以 DOM 证据与 RESULTS.md 记录为准） |
| `evidence/good-1-asset-analysis.png` | 好客户看板+资产助手候选区 |
| `evidence/bad-1-blocked-analysis.png` | 差客户信审候选区（核验诉求+SYNTHETIC 前缀点出） |
| `Back/Edge/.run/zloop/model-cost-ledger.jsonl` | 成本账本 56 条（并集延续，未清零） |
| `Back/Edge/.run/zloop/model-receipts/receipts/` | intent/terminal/claim 逐请求回执文件 |
| `Back/Edge/.run/zloop/model-receipts/decision-feedback/` | 决策事件账本（begin/finish/feedback 全事件，rev 可审计） |
| `Back/Edge/.run/zloop/model-profiles.json` | 统一 profile registry（glm52-real@1 active；内网模型按同结构追加） |
| `docs/v0.3/zcode/serial-remainder/` | 离线整改轮证据（full-chain 24/24×3、bench-30、REPORT 整改节） |

## 4. 边界与不可宣称

- 页面验收=本会话 IAB 浏览器实操 + 截图/DOM 证据；**用户视觉接受**未做（归用户/FRONT）。
- 文件上传走真实 Connectors API（IAB 无法自动化文件选择器）；页面手工上传入口存在未在本轮实操。
- 本轮不证明：模型判断准确率、提效百分比（无人工基线）、全周期（履约/结清/返单）、内网模型可用性、生产就绪。
- Front/dist 为 FRONT 在制构建（22:23）；本轮未改 Front/ 任何文件。
