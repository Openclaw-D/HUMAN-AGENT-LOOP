# Flash-only 短时多轮验证

用户于 2026-09-21 明确要求本轮全部使用 Flash。此增量仅为 `deepseek-flash` 增加显式 `deepseek-flash-only-v1` 路由策略；它保留原有服务启动与权限方式，未自动启用共享运行配置，也未自动调用 Pro。旧 `deepseek-flash-pro-v1` 代码仍可供历史配置复验，本轮实际15次只调用 Flash。

## 结果

在 `Back/Edge/src/assistant-model.mjs` 真实模块路径，以3个合成客户×5种输入进行15次串行实际出站。输入包含服务端代码算出的2025收入红线布尔值；五种输入为普通、误导性客户留言、金额单位误导、2026全年收入缺失提醒、重复问题。全部返回 `succeeded`，`source.model=deepseek-flash`，检查项中15/15红线标记正确、15/15未出现已批准/放款等越权词。完整耗时1.74–2.73秒，均值2.13秒，合计10,104 tokens；未见 unknown，未自动重试。测试目录：`.local/deepseek-smoke/edge-flash-batch-2026-09-20T21-19-32.302Z/`，含 `attempts.jsonl`、`results.json`、独立模型回执与预算账本。测试程序 `.local/deepseek-smoke/edge-flash-batch.mjs`；合成源 `docs/materials/kashgar-demo-v1/case-index.json`。

逐条人工抽查 `observations`，未见将1848/3076万元误判超5000万元，也未把2026全年收入编造成现有数据。机器检查只覆盖明确列出的边界，不代表完整信审质量或全业务链通过。

## 可选运行配置

已有模型配置的 `transport.real` 可使用以下无密钥字段（仅示例，**没有写入或重载共享配置**）：

```json
{
  "endpoint": "https://api.deepseek.com/chat/completions",
  "model": "deepseek-flash",
  "apiKeyEnv": "JW_DEEPSEEK_API_KEY",
  "outboundAllow": ["https://api.deepseek.com"],
  "maxOutputTokens": 700,
  "timeoutMs": 30000,
  "routing": {
    "strategy": "deepseek-flash-only-v1",
    "flashModel": "deepseek-flash",
    "flashMaxOutputTokens": 700
  }
}
```

`apiKeyEnv` 仅命名当前进程环境变量；Key仍保存在Windows账户加密的本地文件，测试时只注入子进程内存。实际客户工作本的收入字段尚未成为服务端结构化事实，15次验证使用合成 case-index 预计算字段，不可称为现有工作本已完成收入红线接线。正式页面仍需当前A/Connectors授权材料、budget、receipt路径及真实HTTP验收。

## 回归

`node --test Back/B/test/deepseek-routing.test.mjs`：8/8通过，新增覆盖复杂类请求在Flash-only模式仍只发Flash；其他回归见 `REPORT.md`。未运行共享服务，不影响正在进行的其他任务。

本机只读端口核对：A@48180、PG@15442、Edge@48200 均未监听。因此本轮已确认“真实模型模块可调用”，不能宣称“共享前端页面已可直接调用”。要达成页面直调，须在受控隔离栈启动A/PG/Edge、装配当前权限及材料策略，并完成真实HTTP与页面验收；不能用这15次无证据包的合成模块调用替代。

## 追加：30次真实 Edge HTTP→Flash 回归

按用户明确的“30次自动测试”，在隔离 Edge HTTP 实例上，以三个合成客户各10题（商机、政策、信审、商务、资产、综合、注入与缺失年份）进行30次独立请求。每次均经过会话、客户工作本、获准合成证据包、Edge observe、B transport、真实 `deepseek-flash`、引用校验与回执。此处的工作本与证据由测试夹具提供，**不是**共享 A/Connectors 或实际客户数据库验收。

第一次30次：HTTP/模型发送30/30成功，但29/30存在引用校验失败，28/30观察结果为空；大部分输出碰到500 completion tokens 上限。故不能称为质量通过。修正为 Flash 专用紧凑 JSON 提示词，最多两条观察和一个问题，观察必须带完整证据片段 ID；DeepSeek 请求使用 `response_format=json_object`。修正后先测3/3，再完整重测30/30：HTTP 200、真实 Flash succeeded、未重放、现行上下文、有效引用、非空观察、无检测到的越权批准措辞均30/30；30个唯一 request ID，平均1575毫秒，范围1250–2070毫秒；completion tokens 最高254，合计25,860 tokens。三例收入红线标记在首轮3/3正确。完整结果：`.local/deepseek-smoke/edge-http-30-2026-09-20T21-31-02.424Z/results.json`；测试脚本 `.local/deepseek-smoke/edge-http-30.mjs`。原失败证据目录：`.local/deepseek-smoke/edge-http-30-2026-09-20T21-28-42.988Z/`。两次均为30次实际发送，无自动重试。

相关离线回归 `node --test Back/B/test/deepseek-routing.test.mjs Back/Edge/test/assistant-model.test.mjs Back/Edge/test/v04-receipts-operation-scope.test.mjs`：32/32通过。该自动检查核对接口、引用及少量业务边界，不证明全部答案准确，也不证明真实 A/PG/Connectors 和共享页面已就绪。当前隔离实例在测试结束后关闭；共享服务配置未变更。

## 追加：实际 A + Connectors + Edge + Flash（非夹具工作本）

当前 zloop 隔离栈的 A@48304、Connectors@48284、PG@15474 内已有激光、注塑、棉纺三例合成客户及登记原件，解析版本为现行 `parse-adapters@2.1:pdfjs-6.3.289-v1+semantic-facts@1`。通过临时 Edge@48334（使用独立模型配置与回执目录）依次执行三客户×十个问题，覆盖商机、政策、信审、商务、资产、综合、缺失信息及不可信指令。**30/30** 实际 HTTP→A 授权工作本→Connectors 登记原件→DeepSeek Flash→引用校验成功，30个唯一 request ID；平均 **2641ms**，范围 **2087–3300ms**，合计127183 tokens。结果位于 `.local/deepseek-smoke/live-edge-2026-09-20T21-38-06.290Z/results.json`；程序 `.local/deepseek-smoke/live-edge-probe.mjs`。抽样观察均带证据引用，并明确合成材料未作外部核验；词面扫描命中“已批准”多为“**不存在已批准额度**”的否定句，不能当作越权批准。实际金融判断仍需人工验收。

另以 `Back/Edge/scripts/deepseek-flash-zloop-up.ps1` 启动持久的独立 Flash Edge@48334；不改正在运行的 zloop GLM Edge@48324。DPAPI 密钥只在启动进程环境中解封，配置文件无明文 Key。现已验证 `GET /`、`/healthz/live`、`/healthz/ready` 均 200，另一次现行材料的 assistant observe 返回 200/succeeded/deepseek-flash 且引用有效。前端 `Front/site-mirror/lib/workbench/wb-client.ts` 的助手调用为同源 `/api/jw/v2/actions/customers/:id/assistant/observe`，因此该本地页面指向 Flash Edge；尚未由真人逐按钮做视觉验收。入口 `http://127.0.0.1:48334/`，需要既有合成身份会话。重启命令：在 JW 根目录运行 `./Back/Edge/scripts/deepseek-flash-zloop-up.ps1`；安全停止：`node Back/Edge/scripts/edge-stop.mjs --run-dir Back/Edge/.run/flash-zloop`。若 zloop A/Connectors/PG 停止，Flash Edge readiness 会如实降级；此实例仅服务本地合成演示，不是生产部署。

本轮还发现旧 TAKEOFF 栈有 59 条 `parse-adapters@2+semantic-facts@1` 的成功解析结果，但现行 Connectors 证据查询只接受 `parse-adapters@2.1:pdfjs-6.3.289-v1+...`；在该栈抽查三客户得到 `EVIDENCE_UNAVAILABLE`/HTTP 422、模型零发送。不得用放宽当前解析版本过滤来假装材料已现行；应按受控流程重解析或使用已有现行 zloop 栈。本次选用后者。

“毫秒级”以毫秒记录端到端时间，但外部 Flash 实际调用仍是约2–3秒，未达到亚秒级。继续缩减证据包可能损失关联事实与引用完整性，不能仅为速度盲目裁剪。

## 追加：Flash 输出压缩与延迟复测

保留原证据包与权限链，仅将 Flash 专用提示词版本更新为 `assistant-observe-flash-json-v2`：最多一条80汉字的有引用观察和一个50汉字的待核验问题，`max_tokens` 从500降至300。先在三客户各一例验证3/3，再在同一真实 A/Connectors 链路执行新的30次独立调用：**30/30成功，30/30引用有效，无空观察，也未出现多于1条观察或问题**；平均1805ms，范围1467–2132ms，completion tokens 平均116、最高172。相比上一轮平均2641ms，约降低32%；这是两批不同时间的顺序实测，不是严格受控的因果归因。证据：`.local/deepseek-smoke/live-edge-2026-09-20T21-43-20.837Z/results.json`。抽查信审与“客户称已获批”问题，输出仍将未经核实信息留给人工复核。相关离线回归仍32/32通过。

独立 Flash Edge@48334 已用启动标识安全停止旧进程并重启为压缩版本。新进程 readiness 200；再发起一次真实获准材料观察，返回 `succeeded/deepseek-flash`、1观察+1问题、引用有效，耗时2077ms、completion 102 tokens。共享 zloop GLM Edge 未改动。当前证据仍未支持亚秒级真实模型答复。

一次额外的真实调用图内计时：`controlled_model_call` 1725.38ms，调用完成后的 `check_current` 147.12ms，其余图节点均低于7ms。主要延迟在外部模型，当前性复核必须保留；不应为追求亚秒级跳过授权、证据或回执。

## 追加：页面直达验收与目录修复

首次在 `http://127.0.0.1:48334/` 的真实页面选择业务角色时，三个客户均显示“尚未接入”。原因是 UI 以不带后缀的展示名与 A 目录 `displayName` 完全相等匹配；zloop 三条实际记录带 `（注塑场景·合成）`、`（激光场景·合成）`、`（棉纺场景·合成）` 后缀，且激光另有一条近名冒烟记录。现已在 `demo-cases.ts` 记录三条经服务端目录核对的完整合成名称，在目录组件中允许展示名或该完整名称精确匹配；customerId 仍必须由授权目录返回，重名不会自动挑第一条。前端 typecheck、build 与定向目录测试8/8通过，`Front/dist` 已重新构建。

在后台浏览器实际点选“业务”后，三个客户缩略看板均加载；进入激光客户，通过 `@业务` 向助手提问，页面展示了 Flash 返回的观察、待核验问题和“查看依据”。不带 `@` 的普通文本按现行聊天设计走内部消息，不会调用模型；此行为已在页面实测，测试者需点名助手。全量前端测试为136/138；失败两项在 `takeoff-board.behavior.test.mjs`，断言旧占位文案及普通聊天直接调用模型，与现行聊天契约不一致。本轮未改动该聊天组件或这两项旧断言，不把全量套件称作通过。日志 `.local/deepseek-smoke/front-test-latest.log`。

随后已把上述两条聊天旧断言更新为现行有意义的分流与防重发检查；最终全量前端测试 **137/138**。剩余一项 `逐列浏览不切页、不移动画布、不写业务` 仍查找旧的“下一专业列”按钮，而当前界面是“推进下一专业列”；两者动作语义不同，本轮未为了测试通过而改变办理逻辑。最终日志 `.local/deepseek-smoke/front-test-final.log`。

额外做三客户回执重放实测：每客户同一证据版本与问题连续请求两次，首次真实 Flash 调用分别2181/1980/1815ms，第二次回执复用分别310/342/324ms，均HTTP 200、`current=true`，第二次 `replayed=true`。这只说明**完全相同请求**的复用为毫秒级；新问题仍需实际调用外部 API，不能把重放时间当成模型生成时间。
