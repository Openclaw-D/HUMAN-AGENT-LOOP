# assembly MANIFEST｜第四版组合（A × B × C × 双候选恢复链，2026-09-15 07:5x）

**v0.2/D-9 更新**：B 可信恢复接口（D-9）已消费——`recovery-round.mjs` 覆盖 thin 与 LangGraph 双候选的**真实暂停→A 升级投影→匿名/错凭据双门拒绝（无副作用）→可信 retry_step（新 attempt 非盲发）→B 内部 completed 不冒充 A 正式审批→A 正式动作收口**，23/23 PASS（`../evidence/assembly-recovery-round-final.txt`，含 LangGraph 凭据零落盘扫描）。来源清单 23 文件；B 侧 D-9 变更文件：thin/langgraph 编排器、resume-core、codes（hash 已刷新）。

**v0.2 更新**：resolved 意见码位对齐（RUN_RESOLVED，C v3 #4）；校验顺序入合同；新增 LangGraph 实际 assembly 对比（`lg-round.mjs` → PASS，`../evidence/assembly-lg-round-1.txt`）；来源清单扩至 22 文件（+ B langgraph/orchestrator、file-checkpointer、resume-core、codes；hash 全量刷新见 `manifest-hashes.sha256`）。

**本轮组合 = A×B×C 全链**：B thin 编排器（含 checkpoint/sinks）经 a-sync 对账层驱动 A 事实源；C 规则包/计算工具/候选校验同线接入。验证：`node assembly/b-round.mjs` → **PASS**（`../evidence/assembly-b-round-final.txt`，含 D-6 正反例/确定性回执/幂等去重）；`node assembly/integrated-round.mjs` → PASS（A×C，`../evidence/assembly-round-final.txt`）。

## 组合来源（路径引用，未复制未修改原件；hash 为组合时实测）

| 来源文件 | hash (sha256) | 角色 |
| --- | --- | --- |
| `CONTRACT.md` | `3f7571a5…33a50e` | 合同 v0.1（本轮发布：D-3~D-6 裁决 + ICR-1~4 + C 观察澄清） |
| `A/src/service.mjs` | `403195923…c9c5f` | 命令/投影 + v0.1 门（意见状态门/引用失败关闭/principal 边界/resolved 终态） |
| `A/src/store.mjs` | `a7a399b3…d51aa` | JSON 原子存储/幂等/失败关闭 |
| `A/src/server.mjs` | `3e36a518…22075` | HTTP wire + token principal 验证器构造 |
| `A/assembly/b-round.mjs` | `785c3258…6bf1f08` | A×B×C 组合编排（D-8 已修：回执验证 + finally 清理） |
| `A/assembly/integrated-round.mjs` | `bb5cc99d…7d692` | A×C 组合 |
| `A/assembly/sim-round.mjs` | `a4e57734…9daf9c35` | 纯 A 占位回路（保留） |
| `B/src/thin/orchestrator.mjs` | `e0ad1251…847e0d3` | thin 编排（journal checkpoint + 依赖门 + sinks） |
| `B/src/a-sync.mjs` | `c8d701d9…3783b1fa` | A 合同 HTTP 客户端 + run sink（toACandidate 归一） |
| `B/src/ports.mjs` | `f1c92664…6144138` | 端口封装（D-7 修复后：fs.writeFile/rename） |
| `B/src/c-tools.mjs` | `7c40e200…f9886dce` | C 计算工具端口适配 |
| `B/src/adapter-bridge.mjs` | `56399882…f4eae4ab` | 模型七状态桥/白名单候选 |
| `B/src/graph-def.mjs` | `1badd640…98e4d480` | 事件→步骤表（ratio_query 等） |
| `C/src/rule-pack.mjs` + `rules/rule-pack-v1.json` | `86c7ae7c…51717` / `ec9b021c…cabdcc` | 规则包（发布为 A RuleVersion） |
| `C/src/calculation-tool.mjs` | `d9e9fdb1…054f25` | 现金流覆盖计算（`calc:cash-flow-coverage@1`） |
| `C/src/candidate-schema.mjs` | `49a37869…c9ac52` | 候选结构校验 + 权威措辞扫描（预校验层） |

完整 hash 见同目录 `manifest-hashes.sha256`。

## b-round 全链覆盖（PASS 明细见 evidence）

模型步 simulated（sent=false）→ a-sync 确定性 requestId 意见落库（runVersion 2）→ C 计算 succeeded → calculation 落库（v3）→ completed 终态不自动升正式状态（candidate_ready）→ B 重入 dedup + A 幂等不重复 → **无凭据自声明 human → 403 PRINCIPAL_UNTRUSTED**（D-6 负例）→ 合成 token 正例 → resolved + formalOutcome（principalId 留痕）。

## 接口分歧/澄清状态（v0.1 后）

| 项 | 状态 |
| --- | --- |
| 分歧 1 candidate.evidenceRefs 形状 | **已消**：C v1.1.0 与 B toACandidate 均按 A 字符串约定投影；合同 v0.1 ICR-1/ICR-2 文本明示 |
| 分歧 2 recommendedHumanAction 枚举 | **已消**：C v1.1.0 对齐 A 四值枚举；B 'none' 哨兵在 B 边界省略键；合同 v0.1 明示"省略=无建议" |
| 分歧 3 validateRulePack 成功形态 | 缝上适配维持（C 返回 []；A 侧无合同约束） |
| ICR-3 runId 双标识 | 合同 v0.1 已明示"runId 服务端生成；经 requestReceipt 关联"；b-round 回执断言验证 |
| ICR-4 escalate 重放语义 | **裁决：维持严格幂等**（同 requestId 同载荷才重放；B 重启丢缓存后换新 requestId，升级留痕允许重复、状态幂等） |
| C 观察 #4/#5 | 合同 v0.1 已澄清（supersede=新实体；state 命令 body 形状更正） |
| K-1 投影位置 | 合同 v0.1 已明示"stale/formalOutcome/currentProjectFactVersion 位于响应顶层" |

## 待办

1. **交 D 最终验收**：被测版本 = `manifest-hashes.sha256`（23 文件）；扩展面 = 恢复链（recovery-round）+ 编排级 unknown/崩溃恢复/重复副作用/可信 resume + 双候选投影一致性。
2. B/C 文件再更新 → 重跑四组组合（b-round/integrated-round/lg-round/recovery-round）→ 刷新本清单。
3. 启动/恢复说明：`../RUNBOOK.md`；site 接线提案：`../site-diff-proposal.md`（只提案，未接线）。
