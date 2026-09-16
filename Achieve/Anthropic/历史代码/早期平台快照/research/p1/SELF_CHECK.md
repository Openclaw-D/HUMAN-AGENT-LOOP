# P1-01 自检记录

日期：2026-08-27

## 1. 交付范围

实际写入仅位于 `C:\Users\22673\Desktop\Anthropic\research\p1\`：

- `EVIDENCE_REGISTER.csv`
- `EVIDENCE_REGISTER.md`
- `TEN_SCENARIO_DOSSIERS.md`
- `SCENARIO_COMPARISON_MATRIX.md`
- `SEVEN_NAMES_PROPOSAL.md`
- `SHARED_KERNEL_CANDIDATES.md`
- `RESEARCH_GAPS.md`
- `GLM53_LOGIC_AUDIT.md`
- `GLM53_LOGIC_AUDIT_20260827_FIXED.jsonl`（runner 原始事件）
- `SELF_CHECK.md`

本任务未修改产品代码、`sources`、根目录交接材料、旧 TAG/RelayOS；未启动前后端/浏览器/服务，未安装依赖，未创建 Worktree/分支，未 commit/push/deploy。

## 2. 结构与引用检查

2026-08-27 使用 PowerShell 只读检查：

| 检查 | 结果 |
| --- | --- |
| CSV 总记录 / 唯一 ID | 53 / 53 |
| 等级分布 | A=22，B=31，C=0 |
| 发布主体 / 登记类型 | 40 / 35 |
| 场景总登记引用 | S01=6，S02=6，S03=6，S04=7，S05=8，S06=7，S07=7，S08=7，S09=7，S10=7 |
| Markdown 中稳定 ID 引用 | 53 个唯一 ID，全部可在 CSV 解析；未使用登记=0 |
| ID 格式 / locator 格式 | 异常=0 / 异常=0 |
| publisher、supported_claims、limitations 空值 | 0 |
| 十场景标题 | 10 |
| 统一字段 | 触发、角色、责任、事实系统、上下文/证据、断点、Artifact、Challenge、HumanGate、动作/Receipt、路径、指标均逐场出现 |

复核命令：

```powershell
$csv = Import-Csv -LiteralPath 'C:\Users\22673\Desktop\Anthropic\research\p1\EVIDENCE_REGISTER.csv'
$csv.Count
($csv.evidence_id | Sort-Object -Unique).Count
$csv | Group-Object evidence_grade
foreach ($s in 1..10) {
  $id = 'S' + $s.ToString('00')
  [pscustomobject]@{ scene=$id; count=($csv | Where-Object { ($_.scenes -split ';') -contains $id }).Count }
}
```

```powershell
$ids = @{}
Import-Csv -LiteralPath 'C:\Users\22673\Desktop\Anthropic\research\p1\EVIDENCE_REGISTER.csv' |
  ForEach-Object { $ids[$_.evidence_id] = $true }
$refs = Get-ChildItem -LiteralPath 'C:\Users\22673\Desktop\Anthropic\research\p1' -Filter '*.md' |
  ForEach-Object {
    [regex]::Matches((Get-Content -LiteralPath $_.FullName -Raw),
      '\b(?:MKT|RC|RD|HA|CP|GG|PI|KO|CS|SL|MS)-\d{3}\b') |
      ForEach-Object { $_.Value }
  } | Sort-Object -Unique
$refs | Where-Object { -not $ids.ContainsKey($_) }
```

第二段应无输出；本轮实际无缺失引用。

## 3. 验收判断

- 十场景统一字段：**通过**。
- 每场景至少 3 个独立来源、2 类证据、1 条流程/责任高等级材料：**通过**；S06 非汽车与 S10 市场规模仍列为显式缺口。
- 前三锚点足以支持 ScenarioPack 字段和 success/failure/unknown：**通过研究 Gate**，但字段/阈值仍需客户数据复核。
- 七个名称可追溯且语义边界清楚：**通过，有条件项为 S06、S10**。
- 共享内核候选逐项有至少 3 个不同场景、反例、成本、安全、可解释性：**通过**。
- 所有事实性主张回指登记：**通过结构检查**；来源真伪/页面未来可达性不能由格式检查保证。
- GLM 辅助复核：**CONDITIONAL PASS**。正式只读审计为 thread `01a03f27-467a-7600-9065-97dfc99f898b`、`turn.completed`、wall 646909 ms；七名称 5 PASS、S06/S10 两项 CONDITIONAL，十场景字段 10/10，共享内核失败清单为空。父级已接受其有效修正，但未将 conditional 升级为无条件通过。

## 4. 主任务人工抽检建议

1. 从 CSV 每场景随机抽 2 条，打开 URL 对照 `supported_claims` 与 `limitations`。
2. 重点抽检 RC-001、RD-002、HA-004、PI-003、MS-001 的角色/责任/负向路径。
3. 用 S04/S05 与 S03/S07 两组边界测试任意新用例，确认不会双重归类而无主对象。
4. 对 `SEVEN_NAMES_PROPOSAL.md` 的商业优先权重做一次独立复算；若权重改变，只调整优先顺序，不自动删除场景。
5. 任取一个高风险动作，验证 UI/数据契约能回答：谁、依据什么、批准哪个版本、外部是否真实生效、unknown 如何恢复。

## 5. R1 产品契约交付与边界

R1 新增：

- `WHY_THESE_TEN_SCENARIOS.md`：十场景入选、商业/责任依据、相邻边界、共享与不可抽象差异。
- `TEN_SCENARIO_VIEW_REQUIREMENTS_V2.md`：十场景逐项关系/进度/矩阵、右侧接续、模型作用/禁权、成功/失败/未知、指标和默认视图。
- `THREE_VIEW_CONTRACT_V2.md`：同一权威投影、统一选择上下文、三视图交互和右侧信息层级。
- `MODEL_RUNTIME_REQUIREMENTS.md`：显式触发、无权/仅建议、运行事件、成本/时延、幂等、重试/取消、断连/重启和 unknown。
- `RESEARCH_TO_UI_TRACEABILITY.md`：53 个稳定 ID 到产品判断、界面、后端事实/事件和测试的映射。

R1 窄范围更新：`RESEARCH_GAPS.md`、`SELF_CHECK.md`。

本检查点未修改根目录控制文档、`prototype/**`、`runtime/**`、`integration/**`、`sources/**` 或产品代码；未启动浏览器、4177/4178/4179 或任何前后端服务；未安装依赖、创建 worktree、提交、推送或部署。因任务属于市场证据综合和产品判断，按委派边界**未调用 GLM**；本节不把旧研究阶段的 GLM `CONDITIONAL PASS` 写成 R1 产品契约验收。

## 6. R1 结构自检结果

2026-08-27 使用 PowerShell 只读检查：

| 检查 | 实际结果 |
| --- | --- |
| V2 十场景标题 / 推荐默认视图 | 10 / 10 |
| 每场景“入选、成功/失败/未知、关系、进度、矩阵、右侧、模型、禁权、质量/成本/时延/业务” | 10/10 均存在 |
| 追踪矩阵中的唯一稳定 ID | 53 |
| CSV ID 未进入追踪矩阵 / 追踪矩阵多余 ID | 0 / 0 |
| 三视图同一权威投影、统一选择上下文、删除旧左下栏 | 均明确 |
| 普通消息不触发模型、模型不改关口/动作、unknown 失败关闭 | 均明确 |
| S06 / S10 证据范围 | 智能网联汽车主证据 / 诊疗辅助、质控、随访 |
| 仓库检查 | 当前目录不是 Git 仓库，因此未使用 Git 状态作为范围证据；写入动作均为上述 7 个 `research\p1` 文件 |

核心复核命令：

```powershell
$base = 'C:\Users\22673\Desktop\Anthropic\research\p1'
$csv = Import-Csv -LiteralPath (Join-Path $base 'EVIDENCE_REGISTER.csv')
$trace = Get-Content -LiteralPath (Join-Path $base 'RESEARCH_TO_UI_TRACEABILITY.md') -Raw
$traceIds = [regex]::Matches($trace,
  '\b(?:MKT|RC|RD|HA|CP|GG|PI|KO|CS|SL|MS)-\d{3}\b') |
  ForEach-Object { $_.Value } | Sort-Object -Unique
$csv.evidence_id | Where-Object { $_ -notin $traceIds }
$traceIds | Where-Object { $_ -notin $csv.evidence_id }
```

两条差集应均无输出；本轮实际均无输出。

```powershell
$view = Get-Content -LiteralPath (Join-Path $base 'TEN_SCENARIO_VIEW_REQUIREMENTS_V2.md') -Raw
[regex]::Matches($view, '(?m)^## S\d{2} ').Count
[regex]::Matches($view, '\*\*推荐默认：').Count
```

两项均应输出 `10`；本轮实际均为 `10`。

## 7. R1 Gate 判断

- 十场景均形成具体“痛点—对象—判断—责任—关系—进度/循环—矩阵—接续—模型—指标—失败”链：**通过文档结构与人工复核**。
- 三视图同一状态、同一选择、同一版本/责任/事件，布局仅为本地显示状态：**通过产品契约**。
- 关系图拖动/平移/缩放/Ctrl+滚轮、聚焦/适配与右侧联动：**已写入契约，未实现验证**。
- 进度分支/返工/补证/重试/暂停恢复/回退/版本漂移/unknown：**已写入契约，未实现验证**。
- 矩阵责任/权限/状态/交互/最后交互/异常及下钻：**已写入契约，口径仍需用户任务测试**。
- 右侧“聊天+接续”和模型显式运行/禁权/恢复：**已写入契约，未接真实运行时**。
- 53 个证据 ID 到界面/后端/测试：**结构追踪通过**；真实客户字段、回执和指标阈值缺口仍保留。

因此 R1 建议状态为：**产品契约候选通过，等待主任务/用户 Gate；不得直接宣称前后端已满足或启动实现。**

## 8. 主任务 R1 抽检方法

1. 选 S01、S02、S03 各一条 success/failure/unknown 路径，逐项核对三个视图和右侧是否引用同一责任、版本和事件。
2. 选 S05 与 S09，对比矩阵的列、权限和下钻是否真实不同；选 S06 与 S10，检查现场最小风险与专业签名是否没有被通用“批准/成功”抹平。
3. 从 `RESEARCH_TO_UI_TRACEABILITY.md` 随机抽 10 个 ID，回到 CSV 的 `supported_claims/limitations`，再顺向检查界面元素、后端事实和测试，不允许越过证据限制。
4. 在原型/实现 Gate 注入目标版本错配、证据过期、资格失效、动作回执 unknown、模型断连和重复点击，确认全部失败关闭且能接续恢复。
