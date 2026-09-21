# 补证联动的准确依赖与可重复验收

## 目标
局部修正已确认缺陷：当前 `Back/A/src/domain/advance-round.ts` 的 input() 将全部 artifactIds/factKeys 共用一个 hash，现金流一项更正使五专业全部失效。用户目标是补证仅增加必要办理、其他专业同时真实联动，不能把全量重跑当最终实现。继续遵循 PARALLEL_ARROWS_COMPLETION.md，不以本包部分进展宣称整个goal完成。

## 输入与ownership
根目录 C:/Users/22673/Desktop/JW。读取 parallel-arrows-back 的 REPORT/API/RUN，以及 parallel-arrows-front 最新报告后执行。Back原有owner负责 A advance-round、B column-runner、自有隔离seed/start脚本、对应tests及报告；允许新增本adapter专用依赖描述模块。C现有assessors/pipeline/perception/rules只读核对实际读取范围，不更改规则、业务制度或其他writer文件。Front只读，不控制其他任务。仅在Front停止写入和页面测试后串行启动；不操作共享48214、真实数据、Git或付费模型。

## 必须做到
1. 为五专业建立与实际分析器、规则计算相符的版本化依赖。覆盖必读事实、缺失事实键、规则版本、交易适用范围、来源/核验等级、派生事实依赖和会影响输出的全局矛盾/不可读材料。不能仅用本次已返回的 evidenceRefs 漏掉不存在但未来会新增的输入。
2. 每专业单独计算当前性；判定未受影响的完成结果、原选择及event保持有效，受影响专业追加新轮并真实重算。四页可在同一流程版本展示不同专业各自有效依据版本，历史不得覆盖或假冒为基于新材料作出的旧选择。
3. 明确现金流更正真实影响政策和信审（政策分析包含现金流规则结果），不得为了“只多信审一轮”隐藏政策变化。业务/商务/资产只有分析范围确实不受影响时才保留；用影响矩阵与结果一致性测试证明，不凭场景标签写死。
4. 复用现有权限、采用命令、幂等、版本和终态规则。受影响的既有人类采用不能静默复制为对新结果的采用。给Front稳定 affectedDomains、待重新选择结果列表及可读原因，以便展示一次补证的联动；不要自创自动批准或给服务身份采用权。
5. 完成/拒绝终态、迟到结果、读取恢复和未决围栏继续通过。增加修改无关材料不重跑、不增选择记录；修改现金流只更新准确依赖域；规则版本变化触发应有失效的实际HTTP测试。
   同时修复已核实的拒绝状态投影：parallel-arrows-front/final-three-cases.json 的 bad caseOutcome=rejected，但 domains.credit.state=stopped。read status() 不应将真实 rejected 的信审job覆盖成stopped；拒绝点保留 rejected，其他未完成列才 stopped，已办结列保留历史。前端矩阵必须能区分拒绝红叉与后续停办。
6. 为最终独立点击验收提供新的隔离合成演练组，保留之前三例历史。使用新的seed-suffix和稳定case manifest，记录新旧关联，不能清空已完成客户或靠改名冒充新版本。隔离服务可按本包归属脚本更新，启动后交还 URL和资源；不动用户原页面。

## 交付
写 docs/v0.4/results/arrow-dependency-repair/REPORT.md，含准确影响矩阵、HTTP证据、前端消费契约和仍然无法压缩的必要动作。若分析器的真实全量依赖不能在上述ownership内准确局部化，报告具体代码位置及最小补充范围，不删规则凑点击数。只在本任务交付，不向主协调发消息或启动其他任务。
