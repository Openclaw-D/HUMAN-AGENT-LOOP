# P1-01 工程设计提案（CANDIDATE —— 供用户/有权专家逐条确认）

状态：`ENGINEERING PROPOSAL / 2026-09-04 / ZCode 主 Agent 起草，不构成冻结`
上位契约：`versions/V4/P1_GOLDEN_CASE_CONTRACT.md`（§5 Evidence 语义 / §8 工作面 / §11 待确认 / §12 P1-01）

本文件把 P1 契约的工程含义翻译成可执行设计 + 待确认清单的推荐答案。确认后进入施工（engine 语义扩展，seed 内容仍等确认）。

## A｜引擎最小扩展（对应契约 §5，语义已冻结故可先行设计）

现有 Evidence：`{evidenceId, kind, title, submittedBy, payload{summary,tags,amountCny}}`。
P1 需要的增量（全部可选字段 + 向后兼容，老事件不受影响）：

| 新字段 | 类型 | 语义 |
| --- | --- | --- |
| `sourceType` | 枚举：business_statement / original_document / existing_system / authorized_external / human_review / model_derived | 来源类型（§5） |
| `subjectRefs` | string[]（主体/租赁物 id 引用） | 主体/关系/租赁物覆盖（§1.2 责任连续的前提） |
| `observedAt / effectiveAt / expiresAt` | ISO string，可空 | 观察31/适用/过期时间（§5 时间三元组） |
| `verificationStatus` | 枚举：claimed / unverified / verified / contradicted / stale | 核验状态——**只能由 Human Gate 或核验命令改变，模型/系统不得自行升级** |
| `evidenceRef` | string? | 回溯源引用 |
| `confidence?` | number? | 仅 model_derived 可带，不得替代 verificationStatus |

新事件类型：`EVIDENCE_VERIFICATION_CHANGED`（Human 核验命令，产 Receipt 语义）；
新投影字段：Evidence 按 verificationStatus 五分类计数（§8 五类 Evidence 视图）。

## B｜Risk Thread（对应契约 §1.2/§8）

Risk Thread = 一条贯穿投影，不是新存储：由既有事件按 `riskThreadKey` 折叠出
`发生什么 → Evidence → Owner → 等待 Gate → 影响条件 → 下次复核`。
最小实现：Evidence/WorkItem/Gate 增加 `riskThreadKey?` 关联键；投影新增 `riskThreads[]`，
每项含 timeline（事件 seq 引用）+ 当前 owner + awaiting gate + linked conditions。
Case Chat 与大屏 `/work/screen` 消费同一 Risk Thread 投影。

## C｜InputEvent 与两个新 Gate（对应契约 §4/§12）

- `InputEvent`：批复后外部变化事件（只追加、只产生 Candidate 与重开 Candidate，不改正式状态）；
- 两个新 Gate 类型进 seed schema：`PRE_VISIT_PREP`（访前准备）、`PRE_LEASE_CONTEXT_REVIEW`（起租前差异复核）——**Gate Owner 角色等待 §11.3 确认后填入**。

## D｜§11 待确认清单（附推荐答案，逐条同意或修改即可）

| # | 问题 | ZCode 推荐答案 |
| --- | --- | --- |
| 1 | 主演示矛盾选哪个（§7 四选一） | 推荐候选 1（主体/担保人/关联关系披露不完整）：贯穿四域最自然、Evidence 最易合成、三分钟可懂 |
| 2 | 合成十问/材料包最小字段 | 十问答案例外化 + 材料包 8 类：营业执照、征信授权、近 6 月流水、纳税申报、租赁物采购合同+发票+权属证、关联方清单、经营/能耗数据、reso司法自查；每类标 claimed |
| 3 | 两个新 Gate 的 Human Role | 访前准备 Gate=信审（发起）+业务（确认可访厂）；起租前差异复核=信审发起、商务确认条件落实——沿用现行角色名，需有权专家点头 |
| 4 | 首期确有权限的数据源 | 建议首期只用"业务陈述+材料上传"两类，外部数据一律以 authorized_external 占位不接真源 |
| 5 | stale 阈值 | 默认：征信/司法类 30 天、财务类 90 天、权属类不过期但变化即 stale；可配置 |
| 6 | 历史基线数据 | 不强求真实基线；用"合成基线对照"演示 ROI 方法论，标注非真实样本 |
| 7 | 成本转移边界确认人 | 由用户（风控总监视角）逐项确认多方影响账 |

## E｜施工顺序建议

1. 用户确认 D 表（或改）→ 2. 引擎语义扩展 checkpoint（等 L-J command journal 落地后串行，避免双写 engine.ts）→ 3. 合成案例 seed（新 caseId，不替换现 demo）→ 4. Risk Thread 投影 + /work/screen 消费 → 5. P1-01 演示串排。
