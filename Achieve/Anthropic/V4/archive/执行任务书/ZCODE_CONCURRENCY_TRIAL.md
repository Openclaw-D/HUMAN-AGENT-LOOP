# ZCode 20 路受控并发试验追加书

状态：`USER-AUTHORIZED / ONE-TIME TRIAL / 2026-09-04`

本文件只追加并发策略，不重写 `ZCODE_BACKEND_GOAL.md` 的产品语义、ownership、禁止范围、Definition of Done 或串行整合 Gate。原 Goal 中“恰好四个并发 lane”被本追加书替代；四个原实现 lane 仍可保留为 writer 拆分，不再代表 Harness 总并发上限。

## 目标

在不重启已完成工作、不制造双写、不扩大产品范围的前提下，尝试一次“同一时段最多 20 个 subagent 运行”的真实试验，得到 ZCode 当前版本、当前套餐和当前资源条件下的 observed concurrency，而不是凭口头信息假定硬上限。

## 调度规则

1. 主 Agent 先读取当前进度和已改文件，只处理尚未完成的 Goal；不得回滚或重复实现已完成内容。
2. 启动前列出最多 20 个有真实价值的 lane：唯一 ID、类型、目标、精确读取范围、精确写入范围、预期证据和停止条件。
3. Writer lane 最多 4 个，必须拥有互斥文件；共享 schema、contract、公共类型、migration、lockfile 和集成修正仍由主 Agent 串行处理。
4. 其余 lane 必须是只读 Explore/reviewer/validator，可分别检查 authority、状态迁移、角色权限、幂等、乐观并发、事件顺序、重放、不可变性、API 校验、错误 envelope、分页、依赖语义、退回/否决、贡献保留、数据泄露及 build/test 风险。
5. 只读 lane 不修改实现、测试或文档；报告保持短小，只返回证据、缺陷、文件位置和建议测试。
6. Subagent 不得再创建 subagent；所有结果回到主 Agent，由主 Agent 串行去重、裁决和整合。
7. 如果当前剩余工作无法形成 20 个真实且不重叠的任务，允许少于 20，禁止为达到数字拆出无意义 lane。

## 容量试验与失败处理

- 尝试在一个批次中请求最多 20 个 foreground/background subagent，并记录 `requested / started / peak-active / completed / failed / throttled / cancelled`。
- 20 是试验目标，不是已确认平台上限。遇到平台拒绝、rate limit、认证、网络或 Harness 异常时，保留原始 Evidence，不隐藏失败。
- 若 20 在启动阶段被容量限制，只允许按 ZCode 明确反馈的可接受数量降档一次；平台未给出数量时最多再试 12。不得连续盲测或用高频重试冲击风控。
- 任一 writer ownership 冲突、共享契约未冻结或正式测试出现非隔离污染时，立即停止新增 writer；只读审计可继续。

## 交付证据

在 `docs/v4/BACKEND_PROGRESS.md` 追加：

1. 20 路任务表及 writer/read-only 分类；
2. 实际并发计数、时间窗口、失败类型和是否触发降档；
3. 每个 lane 的输出摘要与采用/拒绝原因；
4. 主 Agent 串行整合产生的真实 diff；
5. 全量 test、typecheck、lint、build 结果；
6. 对未来稳定默认并发的建议，至少区分 writer ceiling 与 read-only reviewer concurrency。

本试验通过的标准不是“看到 20 个 Agent 卡片”，而是并发 Evidence 可核验、没有双写或隐藏失败，并且最终后端 Gate 不回退。
