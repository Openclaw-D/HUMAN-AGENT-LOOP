# MORNING_REPORT｜R2_EVAL_20260913 晨报（截至 2026-09-13 收束）

状态：**READY_FOR_REVIEW（冻结）**。全部候选仍待 Codex 复验与用户视觉接受；本轮真实模型调用 0、产品 API 0、无部署、无 Git 写、未操作 Codex。**不以手写答案绿分冒称模型质量——真实模型质量 NOT TESTED。**

## accepted-candidate（本批自验通过、待独立复验的候选交付）

1. **eval-cli-r2.mjs v2.0.0**：全输出引用检查（findings/questions/conclusions，bySource）+ 五类引用违规分类（fabricated/stale/not-found/absent/缺kind）+ 畸形输入失败关闭（exit 2）+ 零分母守卫（no_citations critical）+ 顺序无关（metamorphic T4 抓到键序漂移已修）+ v1/v2 候选双接受。证据：selftest-r2 **109/109**（含 neg16 缺version负例：versionAbsent 计数+人工复核路由）、确定性双跑、Codex 探针对照（R1 exit0 → R2 exit4）。
2. **schema 冻结 v2**：jw-eval-candidate@2（conclusions 可带 evidenceRefs、kind 必填）/ scorecard@2；v1 全兼容，R1 批次零回写（64/64 哈希复核）。
3. **metamorphic 套件 10/10**：语义改写（EXACT 不变，PROXY 别名覆盖允许下降——实证别名依赖不是准确率）/无关文字/同源重复/顺序/版本替换五族变换。
4. **A 适配器离线映射**：map-adapter-to-candidate.mjs（失败关闭三态验证）+ docs/A_ADAPTER_MAPPING.md（字段映射表与语义损失如实声明）。
5. **场景库**：三基础案例 + 9 变体/场景（VAR-1..6、EVT-1）+ 新增 6 场景族包（EVT-2 转写否定词/单位、SCN-1 会话归属、SCN-2 去重挂断、SCN-3 生命周期前序、SCN-4 人机冲突/意见并存、SCN-5 权限规则）+ 7 个场景 golden + 16 个控制样例（9 R1正控复用、neg1–15）。
6. **MOBILE_DEMO_STORYBOARD.md v2**：402×874 主基准、手机五段式（五行总览→业务全屏访谈→文字Agent辅助→纠偏/确认→挂断回聊天）、三案例事件分镜表、解说页画面—事件映射纪律、八条诚实纪律；语音/文字Agent/视频均显著"合成/模拟/未接通"标识。
7. **文档与台账**：SCENARIO_COVERAGE.md（场景族/断言分层/人工未判/修复建议，无综合信用分）、METRIC_AUDIT.md、AGENT_LEDGER.md（9路subagent、限流3次如实记录、并发峰值3→2）、README-R2、STATUS、REPORT、MANIFEST.json。

## changes-required（验收发现的缺陷及其本轮状态）

| 缺陷（Codex R2 验收） | 状态 |
| --- | --- |
| collectRefs 漏 conclusions | 已修复并在原探针上对照实证（R1 exit0 → R2 exit4） |
| 畸形输入需失败关闭 | 已修复（neg7–9 exit2，无崩溃） |
| 零分母不得满分 | 已修复（no_citations critical；N/A 非 0） |
| SA-4 审计 2 处低危（缺kind放行、refs放松未文档化） | 已修复（kind 必填、refs 必填、neg13/14 控制、文档同步） |
| metamorphic T4 顺序漂移（本轮自查发现） | 已修复（键序规范化，10/10） |
| 待 Codex 独立复验 | 全部候选待复验；SA-9 独立坏例复验结论见下节 |

## deferred（明确推迟，不假装完成）

- 真实模型接入与质量评估（无凭证，模型调用 0）。
- 真机 Safari、真实 ASR/视频、触控真机验证（分镜已留验收位）。
- 文字Agent辅助段与五行总览的产品页面实现（分镜设计，归主任务）。
- PROXY 别名表的语义扩充（须走新 golden 批次）。
- 版本替换 metamorphic 的 golden 覆盖路径（当前走包内最大版本路径，golden 覆盖路径已由 neg12/单测覆盖）。

## 手机演示缺口（帮助主任务定位）

1. 五段式里"五行总览"与"文字Agent辅助"是分镜设计，产品页面尚无对应实现——主任务 CP1 若按此验收需先实现最小版本或降级演示口径。
2. 语音草稿的"关键字段未确认"标记与更正/失效链是 EVT-1/EVT-2 场景的产品化前提。
3. 挂断后待办不消失（第5段）需要产品侧会话结束语义配合（SCN-2）。
4. 解说页未实现——分镜 §4 已给最小字段清单（事件/证据变化/触发者/结果/待人判断）与两条禁则。

## SA-9 独立坏例复验结论（已完成）

SCORER_ADVERSARIAL_REVALIDATION.md：8 个自创坏例，**误报 0 / 漏报 3 / 不确定 1**；golden/inputs 前后 sha256 零污染；确定性双跑一致。

- **漏报1（已修复）**：未知顶层字段走私决定可绕过 decisions_emitted → 已实现字段允许名单失败关闭（顶层+嵌套），adv4 实测 exit 2；selftest 无回归。
- **漏报2（已修复）**：矛盾"假覆盖"（别名命中但证据挂错侧）不进人工复核 → 已加 sidesCited 交叉（golden sides vs 候选实引）并把 humanConfirmRequired 的 matched 项路由进人工复核清单；adv6 实测生效（"候选实引无"被点名）。
- **漏报3（接受为已知局限）**：Unicode 同形字符短句可同时躲过精确与近似去重——低危，已写入 knownLimitations；后续可在 METRIC_DEFINITIONS 扩充（新批次）。
- **不确定1**：合法 kind+越权措辞躲开 advisory 别名——属指标定义明示的 ADVISORY 层边界，按既有规则走新 golden 批次扩充别名，不改评分器。
- 扛住项如实记录：跨案例真实 sourceId、字符串 version、大小写错位 variantId 全部失败关闭；合法 historical 不误报；unresolved 越权话术被 advisory 扫描命中。

## 命令与证据索引

- `node tools/eval-cli-r2.mjs selftest` → 109/109（evidence-r2/selftest-r2-output.txt）
- `node tools/metamorphic-test.mjs` → 10/10（evidence-r2/metamorphic-output.txt）
- `node tools/eval-cli-r2.mjs score --candidate ../../CODEX_REVIEW_FOUR_TASKS_20260913/c-conclusion-probe.json --fail-on-critical` → exit 4（evidence-r2/codex-probe-verify.txt）
- 全量评分与退出码：evidence-r2/score-runs-r2.txt、evidence-r2/scorecards/、evidence-r2/adapter-mapping-evidence.txt
- 文件哈希与精确命令：MANIFEST.json
