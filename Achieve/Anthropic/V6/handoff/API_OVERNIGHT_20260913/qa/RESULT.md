# D路（V6-API-QA）独立验收 RESULT · 终态

- 接手：2026-09-13 23:05；**终态确认：2026-09-14 08:30（北京时间，截止 09:00）**。夜间轮询（01:15–08:20）除 A 的 STATUS 文档更新外无状态变化：3467 全程同一实例（PID 25748）、真实模式始终未配置、真实调用 0 次、qa/ 无新增缺陷。清晨演示页的两次证据追加与一次模拟追问为合法人工/演示操作（A 已核清，非 D 写入；D 全部写入仅限 [D-QA 合成] 会话）。
- 写面：仅 `V6/handoff/API_OVERNIGHT_20260913/qa/**`。产品源码只读；未启动任何实例；3311/3321/3399 未触碰；付费模型调用 0 次。

## 总判定（与 A 终态 RESULT 08:17 一致）

| 项 | 判定 |
| --- | --- |
| 模拟链路（既有路径 + 未配置真实入口） | **通过**（D 独立回归 26/26 + UI 验证，针对 B 集成后当前二进制） |
| F-001（D 发现的并发覆盖缺陷） | **A 已修复，D 三层复测通过并闭环**（代码结构 + A 单测 RA11b 判别 + D HTTP 集成；A 的 01:05 分析与 D 诊断一致） |
| 真实模型 API 接通 | **未验证**——接线完成、配置缺失（端点/模型/密钥/MODE=real 全缺，08:20 复核仍缺）、真实调用 0 次（预算 0/20）。**模拟与 mock 测试不能证明真实 API 已接通** |
| 遗留缺陷 | D 侧无未关闭缺陷 |

## D 验证了什么（证据）

1. **独立源码/接口审查**（`REVIEW_NOTES.md`，基线 hash `source-baseline-sha256.txt`）：幂等/版本门/暂停门/取代链/存储校验结构核清；发现 F-001；核实 B 集成 diff 仅 import 一行、`model_real` 的 types/store/UI 三处一致性、bridge usage 透出、enrich 正文装配只含本合成项目内容且模型历史不回灌。
2. **API 回归 26/26**（`regress_api.py`，日志 `regress-api-final2.log`）：
   - 既有路径：会话/证据/标注/人工纠正/模拟分析/原样重放幂等/换载荷409/刷新读回/暂停409 SESSION_PAUSED/恢复/证据取代链/过期标识 —— 全通过；
   - F-001 复测：并发双 simulate 三态验证（写入者回复按 replyId 全部存在于最终 store；迟到者 409 VERSION_CONFLICT；顺序重试如实 no-op 不虚构写入）；
   - 未配置链路：`model-status` 无秘密布尔如实；`analyze` → 503 MODEL_NOT_CONFIGURED 含缺项清单；失败不落库、不占幂等缓存；暂停中 analyze 409（暂停门先于配置检查）。
3. **UI 验证**（只读；截图 `shots-ui-real-disabled.png`）：真实按钮禁用+诚实 title 缺项清单；model_simulation 回复「模型（模拟）」标签+SIMULATED 声明；配置状态行如实。`model_real` 深色标签经 A 的 mock 验证截图 `../evidence-ui-model-real.png` 目验区分清晰（3468 隔离实例+本地 mock 端点，非付费）。
4. **A 测试套件抽查**（源码级，非复跑）：RA3/RA4/RA13 真实覆盖 R2（标注问题+证据引用+人工纠正原文进入发往模型的请求体，模型历史输出不回灌）；RA11b 对旧实现判别性成立；RA12 预算先到即停。

## 未测清单（真实 provider 配置前无法测试）

- R1 尾项：真实 provider 在线时 `source=real` 回复的端到端目验（当前真实调用 0 次）；
- R2 尾项：真实请求体的线上实证（当前仅单测级 + mock 级证据）；
- analyze 同 requestId 重放/换载荷 409、新 requestId 再分析、**MODEL_RESULT_STALE 在途改判**（真实延迟下才有意义窗口）、MODEL_BUDGET_EXHAUSTED 实测——均需 MODE=real 且消耗预算，仅可由 A 在 20 次预算内统一执行；
- 真实 provider 对 `response_format:{type:'json_object'}` 与 `metadata` 字段的兼容性（B 的 INTERFACE.md 已提示，首探针须核对）。

## 记录在案（非本轮缺陷）

1. simulate 幂等 payload 含 expectedVersion 的既有语义（A 已在 STATUS 记录）：UI 原样重试不受影响；attemptCalculation 口径不同（不含），长期宜统一。
2. enrich 的证据"正文"= 标注问题转述 + fixture 标题文字（C 案例设定：载明内容由标注问题转述给模型）——与 CONTRACT §2 的 `text` 字段名不同但语义覆盖，A/C 已对齐记录。
3. ~~socket 验证时间标注疑为笔误~~（**A 已在 01:13 STATUS 更正为 00:23–00:26 run2，关闭**）。另记录：A 于 01:13 修复其自有演示数据 M1 标注乱码（bash argv 双重编码所致；python utf-8 原子写修复，与 C 源逐字符一致，A 写面内操作，D 无动作）。

## 交接物（本目录）

- `QA_PLAN.md`（约定与清单）/ `REVIEW_NOTES.md`（源码审查+F-001 全记录）/ `RESULTS_LOG.md`（逐轮执行记录）
- `regress_api.py`（可复用回归，URL 可配置）/ `regress-api.sh`（bash 初版，仅存档）
- 各轮日志 `regress-api-*.log`；截图 `shots-ui-real-disabled.png`；基线 `source-baseline-sha256.txt`
