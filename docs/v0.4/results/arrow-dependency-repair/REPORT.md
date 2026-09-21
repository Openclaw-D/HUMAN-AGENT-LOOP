# 专业依赖与拒绝投影修复

2026-09-21。本轮 Back 局部修复完成，已更新自有隔离入口 **http://127.0.0.1:62032**。没有操作共享48214或用户页面。新演练组 `dependency-v1-20260921` 的三客户均为 not_started，旧三例及原事件/选择仍保留。新旧ID关联与旧终态读回见 EXERCISES.json；不代表新的浏览器验收已经通过。

## 实际改动

- 新增 Back/B/src/worker/column-dependencies.mjs，契约版本 column-deps-v1。只核对并复用 C 的 assessors/pipeline/perception/rules，没有修改 C。五专业各自保存事实键声明（包括目前缺失的键）、源工件、来源/核验等级、规则版本与加载内容摘要、交易范围及相关全局质量信息。A 同时绑定已有 computeDomainDigest，原分析登记、采用与人类权限不变。
- advance-round 按各域 hash 判当前性、排受影响任务。未受影响轮次、结果、selection/eventId 和原 basisVersion 不改写；新结果没有继承旧选择。不同域可以在同一流程版本下保有不同、各自有效的依据版本。
- 非政策域不再携带未被该专业意见消费的整份 ruleEvaluation；政策返回真实规则结果，去掉未被规则读取的全量 facts 调试转储。完整运行输入仍冻结在任务中，原意见不假冒来自新材料。材料视图只列该域已声明的源工件。
- 拒绝投影先保留真实 rejected 信审点，再把其余未办结列标 stopped；已办结列保留历史状态。旧差例读回已核实为 business/policy completed、credit rejected、commerce/asset stopped，caseOutcome 与 archiveRef 不变。

## 影响矩阵

| 输入/变化 | 业务 | 政策 | 信审 | 商务 | 资产 |
| --- | --- | --- | --- | --- | --- |
| 年收入、订单、诉讼声明、资产负债声明 | 是 | 仅被规则读取的键 | 按实际信用键 | 否 | 否 |
| 经营现金流、偿债、新债务（含缺失键以后补入） | 否 | 是，覆盖率与压力派生规则 | 是 | 否 | 否 |
| 第一大客户收入占比 | 否 | 是 | 是 | 否 | 否 |
| 租期、拟月租、资金成本、费用已知项 | 否 | 当前规则未消费 | 否 | 是 | 否 |
| 权属、设备存在、对价、铭牌、型号冲突 | 否 | 权属等实际规则键 | 否 | 否 | 是 |
| 无关新鲜材料内容，且未带来不可读/质量异常 | 否 | 否 | 否 | 否 | 否 |
| 无关材料过期，改变全局新鲜度派生结果 | 否 | 是 | 否 | 否 | 否 |
| 全局不可读/非法输入，影响当前输出质量状态 | 是 | 是 | 是 | 是 | 是 |
| 激活规则版本/本地规则包内容改变 | 是 | 是 | 是 | 是 | 是 |
| 交易适用范围改变 | 是（共同交易依据） | 是 | 是 | 是（共同交易依据） | 是（共同交易依据） |

业务精确事实集合为 revenue_annual_declared/new_order_amount_declared/litigation_pending_declared/total_assets_declared/total_liabilities_declared；信审另含 video_liveliness/material_page_count 的“不能用于收入推断”提示依赖；资产包含 equipment_model 冲突检测键，即使它本次不在 evidenceRefs 中。政策键从规则 requiredFacts 与 condition 递归读取，派生覆盖率扩展到原始现金流/偿债/新增债务，材料新鲜度保留全局陈旧来源集合与实际评估日期。相关事实的所有来源/等级/矛盾值均保留，不只取当前最高等级值；未被当前分析器消费的无关矛盾不人为新增业务影响。

实际分析器的同阈值区间数值改变可能维持同一政策结论，但仍需重评其依据；单测另使用跨覆盖率阈值的变化确认政策真实结果会改变。没有删规则、换地区或根据好中差标签写死影响范围。

## HTTP 与结果一致性证据

- A typecheck 通过。
- HTTP_TEST.txt：**14/14 通过、0跳过**（13个子测试+父测试）。补证前完成业务/政策/商务/资产，信审等补证；加入无关材料后无新增 analysis_run、无新增 selection，原选择完全一致。现金流更正只追加政策/信审两个 run；业务/商务/资产的 roundId、selection、basisVersion 保持有效，原政策选择未复制到新结果。再次显式采用政策和信审后终态完成。
- 同一 HTTP 套件验证规则换版失效、未加载新规则版本不能假装执行、三例终态、信审 rejected 投影、拒绝后的迟到结果、未知确认不重发、真实进程重启/中断恢复、身份隔离。
- DEPENDENCY_TEST.txt：**6/6 通过**。现金流只改变政策/信审依赖，业务/商务/资产的实际 C 输出逐项相等；无关新鲜材料五域输出一致；缺失事实以后出现、型号/铭牌冲突、来源等级、交易范围、全局不可读、过期与规则版本均被覆盖。
- 运行实查 EXERCISES.json：旧三个客户ID仍可读取原持久终态，新三个不同客户ID未执行；旧差例信用拒绝不再投成 stopped。

## Front 消费契约（加法）

现有 plan、receipt、views 和 decision 路径不变。

- plan.affectedDomains：本次执行需要更新的专业列表。
- GET/receipt/views.platform.affectedDomains：当前依据失效或新轮尚待处理的专业；现金流补证为 policy/credit。
- needsReselection：最新有效但尚待选择的 `{domain,roundId,resultId,reason}` 列表；首轮候选也在该列表中，是否重评可看 roundNo。新结果必须用自身 resultId 和当前流程 expectedVersion 显式选择。
- dependencyChange：最近一次持久 COLUMN_DEPENDENCIES_CHANGED 事件，含真实 eventId、version、at、affectedDomains、reason、previousResults（原 roundId/resultId/basisVersion）。该变更记录在处理后仍保留，不能靠前端计数生成。
- receipt.dependencyVersion 与 changeReason：依据契约版本及可读变化原因；views 仍共享同一 process version，但各列 basisVersion 允许不同。不要把旧选择重绘成对新材料的选择。
- manifest 新增 exerciseId=dependency-v1-20260921、dependencyVersion=column-deps-v1；稳定 caseId 仍指向本演练组实际 customerId，不改名冒充旧件，不改变场景标签的非结论属性。

## 运行交回与必要动作

```powershell
# C:\Users\22673\Desktop\JW
./Back/A/scripts/stop-parallel-arrows.ps1
./Back/A/scripts/start-parallel-arrows.ps1 -Port 62032 -SeedSuffix dependency-v1-20260921
```

已执行上述受归属保护的更新，PID/端口仍读 parallel-arrows-back/RUNTIME.json、OWNERSHIP.json。以后不传 SeedSuffix 会复用 OWNERSHIP 记录的演练组，不意外退回旧组。测试专用 jw-arrow-back-test-20260921 已停止；验收专用 jw-parallel-arrows-back 与62032保持运行。服务更新后需重新选择隔离测试身份，业务历史不丢失。

现金流补证必然同时改变政策规则结果与信审依据。若原政策意见已采用，补证后需要政策新结果、信审新结果各一次明确选择；不能压成“只多信审一轮”或自动沿用旧政策选择。好例仍为启动+五列采用；中例操作数取决于补证前已采用哪些列、浏览位置与补证动作，不能承诺固定5–6次。Front需串行复验新组的实际箭头/四页交互；本轮没有修改 Front、控制其他任务、Git提交或发布。
