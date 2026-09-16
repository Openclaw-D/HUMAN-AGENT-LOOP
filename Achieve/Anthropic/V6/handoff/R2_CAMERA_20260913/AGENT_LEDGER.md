# AGENT_LEDGER｜R2-B Subagent台账

授权链：ZCODE_R2_B_20260913 → ZCODE_FOUR_TASKS_ROUND2_20260913（“不设上限”并发）→ OVERNIGHT_TO_0700 → ZCODE_GOALS_TO_0900/ZCODE_GOAL_B（**最新覆盖：默认2个、最多3个，限流退避**）。首轮5并发发生在GOALS覆盖下发之前；覆盖生效后即收敛≤2并保持。

| 任务 | Owner | 独占写面 | 输入(sha256前8位) | 结果 | 证据 | 资源记录 |
| --- | --- | --- | --- | --- | --- | --- |
| SA1 状态机v0.2.0 | subagent | src/camera-controller.mjs, test/camera-controller.test.mjs, evidence/state-machine-run.log | R2_B=a8b2467a, 评审REPORT=af63b6ec, 旧控制器=fbfac814, 旧测试=87feb780 | ✅ 41/41，exit 0 | evidence/state-machine-run.log | tokens≈596,150；时长约28分；模型调用均为ZCode开发额度，具体计费未知 |
| SA2 资源零泄漏 | subagent | test/resource-tracking.test.mjs, evidence/resource-tracking-run.log, evidence/handoff-to-main.md(未需要) | 同上+旧INTEGRATION=d3699c8c | ✅ 21/21，麦克风0/上传0/泄漏0，与SA1零冲突 | evidence/resource-tracking-run.log | tokens≈883,105；约29分 |
| SA3 对抗测试 | subagent | test/adversarial.test.mjs, evidence/adversarial-run.log | 同SA1+GOAL_B=fa965536 | 首次❌限流1302；重试✅ 26/26 | evidence/adversarial-run.log | 重试tokens≈945,438；约24分 |
| SA4 手机测试壳 | 首派subagent❌限流1302→**主agent接管** | src/standalone/*, tools/serve-standalone.mjs, SHELL_A11Y.md | ROUND2=6511fc4a, 旧样例目录 | ✅ 完成（402×874基准+可访问性+钩子） | SHELL_A11Y.md, evidence/shell-serve-check.log, screenshots/* | subagent无产出即失败；主agent完成，额度未知 |
| SA5 集成映射 | subagent | MAPPING.md | 旧INTEGRATION/REPORT+评审B节+R2_B | ✅ 完成（§1–§5） | MAPPING.md | tokens≈181,654；约6分 |
| SA6 压力+元数据 | subagent | test/stress-loop.test.mjs, test/metadata-integrity.test.mjs, evidence/stress-metadata-run.log | GOAL_B包2/6+控制器=fd19c44a(现值) | ✅ 8/8；四文件合跑70/70；同seed复现一致 | evidence/stress-metadata-run.log | tokens≈3,980,297；约45分 |
| 主agent | — | STATUS/REPORT/MANIFEST/MORNING_REPORT/AGENT_LEDGER、screenshots/INDEX.md、MAPPING增补(接管)、src/thumbnail.mjs迁移、tools/make-synthetic-png.mjs、evidence/assets、evidence/browser-*.json、evidence/full-regression.log、evidence/viewport-record.json | 全部Goal链路文件（见STATUS接收记录） | ✅ 浏览器证据+整合回归96/96+文档冻结 | screenshots/INDEX.md, evidence/full-regression.log | 自身额度未知；产品API付费调用0 |

- **并发峰值**：首轮5（ROUND2授权期，GOALS覆盖送达前）；覆盖后峰值2，限流期间1。
- **限流事件**：账户1302速率限制×1波（SA3/SA4失败，SA4无文件落盘）；处置=等待+降并发重派，未重试风暴、未嵌套绕过。
- **所有权转移记录**：SA4范围（壳）与MAPPING增补由主agent接管，原owner批次内容未改动（SA5的§1–§5原样保留，增补仅追加§6+清单文件行更新）。
- **额度声明**：subagent token数为运行环境回报值；主agent与总账户剩余额度未读到接口，记**未知**。ZCode开发额度与产品API额度分开；本轮产品付费调用=0。
