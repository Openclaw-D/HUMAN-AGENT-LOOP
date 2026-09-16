# RESULT｜C路：合成案例与固定材料类目核对（V6-API-CASES）

- owner：C（V6-API-CASES）。接手：2026-09-13 23:08；本 RESULT 完成：2026-09-13 23:35（北京时间，09:00 截止前提前交付）。
- 只写 `V6/handoff/API_OVERNIGHT_20260913/cases/**`；产品代码只读未改；未调用任何模型（真实或模拟均未发起）；未建上传页面；未操作 Codex；未嵌套子代理；未覆写其他任务文件（A/CONTRACT、D/qa 均只读引用）。

## 交付清单（全部合成）

| 文件 | 内容 |
| --- | --- |
| `README.md` | 合成声明、导航、A 路接入说明 |
| `material-categories.md` | 材料类目核对：9 项查得（含确认状态与来源路径）+ 客户上传后续输入约定 + 未找到清单 |
| `main-case.md` / `main-case.model-input.json` / `main-case.expected.md` | 主案例 M1：岐明包装机械（虚构）售后回租；五阶段=早期资料→信审疑点→客户补充→人工纠正→专业意见更新；12 步操作序列对齐 CONTRACT §2/§5 |
| `variant-insufficient.md` / `.model-input.json` / `.expected.md` | 变体 V1 资料不足（M1 确定性裁剪派生） |
| `variant-contradiction.md` / `.model-input.json` / `.expected.md` | 变体 V2 前后陈述矛盾（M1 确定性派生，新增 M1-DOC-08） |
| `pre-interview-outline.md` | 最简访谈前提纲（含 2026-09-13 实控人/财务在场要求、七项基线必问） |

## 材料类目核对结论（详见 material-categories.md）

- **已实现**：产品 3 类合成证据 fixture（巡检/设备清单/合同要素，`remote-service.ts:285`）。
- **候选**：归档包五大类目（基本证照/经营证明/现场照片/增信/租赁标的，`materials/reusable-assets/20260906-archive/03-synthetic-cases/`，HISTORICAL_REUSE 定候选）；用户 2026-09-12 口述收集方向（租金电费/流水/设备发票照片铭牌/房产/财务报表，CONTEXT_LOG:17）。
- **用户明确需求（记录态）**：客户上传逐次存档、不可覆盖（DECISIONS 2026-09-13）——已整理为后续输入约定。
- **未找到**：公司正式必需材料清单；用户计划的三套真实客户资料（尚未收到）。均如实标注、未臆造。

## 接口对齐（CONTRACT.md，A 冻结于 23:10）

- 模型输入注入点=§2 `enrich`：JSON 的 `annotationQuestion`/回复 `text` 字段名与之一致；`domainRoles:['credit']`、`purpose:'follow_up_generation'` 与 §5 analyze 路由一致；`requestId` 建议 ≤64 字符、每步新值、幂等语义已注明（§5/§7）。
- 产品硬限制核对：标注 question 与回复 text 均 ≤2000 字符（已验证）；会话标题 ≤120；`kind` 取值 `business`/`domain` 在现有 `replyAnnotation` 白名单内（无需 A 扩展即可用）；步骤间 `expectedVersion` 由运行时 remoteVersion 递推，JSON 未预写死。

## 自检证据（本夜完成）

1. 三个 model-input.json 均通过 JSON 解析（schema `jw-api-demo-case@1`）；全部文本字段 ≤2000 字符（脚本校验，无告警）。
2. 预期答案隔离扫描：model-input 文件中无预期/验证要点内容（脚本关键词扫描 clean；V1 命中的"应保持"为标注问题中的中性提问语句，非答案）；预期只存在于 `*.expected.md` 与各 md 的"预期验证要点"小节。
3. 合成标识：全部文件含合成声明；虚构企业/金额/编号不影射；案例无"应批准/应否决"预设；金额/期限标注"一致性测试数字"。

## A 路使用提示（不要求 A 修改接口）

- M1 步骤序列即 MODEL_API_DEMO 演示闭环：attach×3 → annotate → analyze → business 回复 → analyze → domain 回复×2 → analyze → domain 回复（四域必要参与）→ read-back。
- 若 `analyze` 路由尚未可测：M1 的 attach/annotate/reply/read-back 步骤在现有 3467 实例上即可演练，analyze 步骤留待 A 就绪后补跑。
- 变体 V1/V2 为单轮（attach→annotate→analyze→read-back），供演示机动或 D 路复验。

## 边界与停止

- 本轮真实模型调用数=0；未读取凭据、真实客户材料或 ZCode/Codex 凭证；未改产品代码；无新依赖。
- C 路交付到此为止：无未完成项。后续仅在 A/D 针对性复核发现本目录缺陷时修复；不为额度扩案例。
