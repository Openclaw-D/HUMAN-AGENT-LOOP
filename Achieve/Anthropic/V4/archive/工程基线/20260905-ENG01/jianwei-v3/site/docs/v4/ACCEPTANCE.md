# V4工程验收｜当前记录

归属：V4。状态：`FUNCTIONAL CANDIDATE ACCEPTED / PRODUCT ACCEPTANCE OPEN / PRODUCTION NOT READY`。

本文件只索引**最近一次已记录的验收**，不是2026-09-05的新测试结果。本轮只有文档/目录整理，没有重新运行代码测试。

## 最近独立验收：2026-09-04 22:00

- P1 focused：31/31；全量测试：574/574；HTTP quality：27/27。
- typecheck、lint、build通过；当时canonical API、/work、/work/screen均HTTP200。
- 默认隔离未确认P1语义，demo显式opt-in；Agent/模型保持authority=none。

## 仍未完成

- P1核验与Context窗口命令尚无完整HTTP/交互面；角色、风险内容、stale阈值、自动封存/重开和正式核验Receipt仍待产品确认。
- 浏览器异常流程、完整双端、键盘/焦点/console验收未闭合。
- 当前canonical候选是确定性规则，不是已经接入真实模型的AI系统。
- 文件event log与command journal不是原子事务；不能承诺exactly-once或跨所有故障恢复原响应。无生产级认证/租户隔离与部署验收。

## 原始证据

[9月4日完整验收原文](../../../../V4/archive/工程验收/ACCEPTANCE.md)；[工程报告](../../../../V4/archive/工程验收/BACKEND_PROGRESS.md)；[执行记录](../../../../V4/archive/工程验收/ZCODE_RUN_STATUS.md)。

新代码变更后必须重做受影响Gate，不能沿用上述数字。用户接受、工程通过、完整E2E和生产可用分别判断。
