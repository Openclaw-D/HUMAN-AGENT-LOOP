# MODEL_READINESS｜真实模型接入就绪度（返修后）

## 现状（如实）

- **modelCalls = 0**（无凭证，未做任何真实推理）。
- 本期实现：`fixed_stub` provider adapter（`createModelProviderAdapter`），输出显式 `model_simulation` + `authority=none`。
- **上轮声明更正（F7）**：所谓"六角色链路"实为固定问句表的确定性选取，无推理；本轮已补 adapter 契约与故障路径测试，但真实推理质量仍 NOT TESTED。

## 已验证的契约与故障路径（本地 fake provider，测试注入，无密钥）

| 故障注入 | 期望 | 实测（v5-preview-remote-repair.test.mjs B 项） |
| --- | --- | --- |
| 超时 | failed（独立失败态，零回复） | PASS |
| 畸形响应（缺 followUps） | failed（格式错误） | PASS |
| 空结果/全无效 | failed | PASS |
| 部分无效 | partial（坏项过滤，1 条有效保留） | PASS |
| 不存在的证据引用 | rejected | PASS |
| 暂停中调用 | rejected（paused） | PASS |
| 过期证据版本 | rejected | PASS |
| 同 requestId 重复 | 幂等返回同一结果 | PASS |
| **真实/注入失败不得回退 model_simulation 冒充成功** | failed 时 replies 为空 | PASS（所有 failed/rejected 用例 replies=[]） |

## 真实接入前置（不变）

用户安全提供产品凭证 + 用途确认；凭证仅注入服务端环境，不进源码/URL/日志；50 万 tokens 总上限合并统计（本返修未消耗：真实调用 0）。

## 明确更正

真实 provider 调用超时/格式错误/异常 → `failed`（独立失败态）+ `failureReason`；**绝不回退生成 model_simulation 替代回复**。上轮 READY_FOR_INTEGRATION 中相关表述已在本文件与本轮 CHANGE_LIST 更正。
