# D路测试执行记录（滚动更新）

## 执行环境
- 3467（A的 next dev 实例 PID 25748→见A STATUS），数据目录 `SE_REBUILD_20260913/runtime/data/`（未重置）。
- D的测试会话（[D-QA 合成] 前缀，D所有）：`dqa-0914-*` 系列共4个会话（run1弃用因脚本编码问题、run2/run3部分执行、最终run4全绿）。未触碰A演示会话 rs-mtzpo3q1-j33xtuqj 的任何写按钮。
- 付费真实调用：0（未配置；D未触发）。

## 运行1（23:59 regress-api.sh bash版）：工具失效，非产品缺陷
- Windows git-bash 内联中文 POST 编码损坏（GBK/UTF-8）→ 服务端正确拒绝 INVALID_INPUT（这本身验证了输入校验）。改用 Python urllib 重写（regress_api.py），bash 版脚本保留仅作记录。

## 运行4（00:12 regress_api.py 最终版）：**26/26 通过**
| 组 | 结果 | 说明 |
| --- | --- | --- |
| T0-T3 | ✅ | 服务可达；[D-QA]会话创建；合成证据附着；标注创建 |
| T4 | ✅ | 人工纠正（business回复）追加，kind=business |
| T5/T5b | ✅ | 模拟分析成功，回复全部 model_simulation 且带模拟/SIMULATED声明 |
| T6 | ✅ | 同requestId【原样】重放（UI registry语义）→ 幂等返回缓存，不重复追加 |
| T6b | ✅ | 同requestId换载荷 → 409 REQUEST_MISMATCH |
| T7 | ✅ | 刷新读回（GET detail）：纠正+模拟回复均在、数量一致 |
| T8/T8b | ✅ | 暂停成功；暂停中 simulate → 409 SESSION_PAUSED（服务端门） |
| T9/T9b/T9c | ✅ | 恢复；证据取代链建立；旧证据/旧标注过期标识可见 |
| T10（F-001-RETEST） | ✅ | 并发双simulate：迟到者被入口版本门409、写入者回复完整保留、无覆盖丢写（详见 REVIEW_NOTES F-001 状态） |
| T11 | ✅ | model-status：configured=false/mode=simulation/缺项清单/keyConfigured布尔；无任何秘密值 |
| T12a-d | ✅ | analyze未配置 → 503 MODEL_NOT_CONFIGURED 含缺项；不落库；失败不占幂等缓存 |
| T12e | ✅ | 暂停中 analyze → 409 SESSION_PAUSED（暂停门先于配置检查，服务端执行门有效） |
| T12f | ✅ | 恢复正常 |

## UI浏览器验证（00:20，只读）
- 真实分析按钮：`模型辅助分析（真实·未启用）` **disabled**，title=「真实调用不可用：缺少 JIANWEI_MODEL_BASE_URL、JIANWEI_MODEL_NAME、JIANWEI_MODEL_API_KEY。接线就绪，未发起真实调用」→ R7 通过。
- model_simulation 回复全部显示「模型（模拟）」标签 + SIMULATED 中文声明 → R1（模拟侧）通过。截图 `shots-ui-real-disabled.png`。
- 演示设置区配置状态行如实显示（mode=simulation + 缺项清单）。
- model_real 标签渲染与 CSS 区分：代码审查通过（page.tsx L602、CSS data-kind），**未在真实输出上目验**（需真实模式）。

## 对照A测试套件的关键核对（源码级）
- RA3/RA4/RA13（enrich 正文注入）：生产组合（interim transport + 生产 enrich 工厂 + 假 fetchImpl）下，**标注问题、证据 id/version、人工纠正原文均实证进入发往模型的请求体**；上一轮模型输出不回灌（防回声）。R2 的单测级证据成立。
- RA11b（F-001 并发回归）：判别性成立（旧实现会失败）。
- RA12（预算20先到即停）：MODEL_BUDGET_EXHAUSTED。

## 追加：B集成后复测 + 诊断（00:35–00:45）
- A 于 00:00 集成 B 路 transport（`server-http-transport.mjs` → `site/.../http-fetch.mjs`，**D 已 diff 核实仅 import 路径一行差异**，A 声明属实；interim 已删除）。
- **B 集成后重跑 regress_api.py**：首跑 25/26，T10b FAIL——经一次性诊断脚本定位为 **D 脚本捕获 bug**（顺序重试的 no-op 响应覆盖了并发写者的成功响应），非产品缺陷。诊断同时实证产品行为正确：并发写者 9 条回复完整落盘、迟到者入口版本门 409（v67→v68）、无任何丢写。
- 修正断言（强判定：每个写者的回复按 replyId 必须是最终 store 子集）后重跑：**26/26 全绿**（`regress-api-final2.log`，针对 B 集成后的当前二进制）。
- **model_real 标签目验完成**：A 的 mock 全链路验证截图 `../evidence-ui-model-real.png`（3468 隔离实例+本地mock端点，非付费）显示「模型辅助（真实）」深色标签与「模型（模拟）」琥珀标签、「业务」/「专业域」人工标签清晰区分；basedOn 递进（store v5→v7）与人工回复数进请求（0→1）可见。R1（真实侧UI）在有 mock 证据条件下通过；**真实 provider 在线调用仍为 0，未验证**。

## F-001-RETEST 闭环确认（01:10，回应 A STATUS 01:05 分析）
- A 的 run4 T10b 分析与 D 诊断**完全一致**（409版本门 + 顺序重试命中"每标注一轮"如实no-op；真正竞态由 RA11b 进程内覆盖）。
- D 已按 A 建议完成：① 新脚本三态断言 + replyId 子集强判定重跑 **26/26 全绿**（`regress-api-final2.log`）；② 一次性全响应体诊断实证并发写者 9 条回复完整落盘、迟到者 409（v67→v68）、无丢失。
- **F-001-RETEST：CLOSED（通过）**。若 A 后续改动 simulate/存储合并逻辑，按 regress_api.py T10 段重跑即可。

## 结论（截至 00:50）
- 模拟链路：全部通过。
- 真实链路：接线完成、未配置、未验证——**模拟测试不能证明真实API已接通**。
- 未测清单（等真实模式配置后）：R1真实标签目验、R2真实请求实证（当前仅单测级）、analyze同requestId重放/再分析/MODEL_RESULT_STALE在途改判（真实延迟下）、预算耗尽实测。
