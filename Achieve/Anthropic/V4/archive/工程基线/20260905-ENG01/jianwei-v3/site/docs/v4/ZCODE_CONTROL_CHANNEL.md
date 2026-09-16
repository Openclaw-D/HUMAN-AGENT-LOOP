# ZCode｜V4当前执行边界

归属：V4。Revision：**0004 / 2026-09-05**。
状态：`HOLD_MANUAL_DOCUMENT_CHECKPOINT / NO CODE TASK AUTHORIZED THIS ROUND`。

## 当前唯一指令边界

用户已改为手动单任务。本轮只有 [文档收口](../../../../V4/CURRENT_CHECKPOINT.md)，结束后等待用户验收；不自动接续后端、前端、平台或新版本任务。

旧Revision 0001–0003和整夜任务书均为历史，不能恢复持续执行许可。以前已测试通过、已有任务包或用户未反对，不构成本轮新授权。原协议全文保存在 [修改前快照](../../../../archive/90-tooling/workspace-organization-20260905/before-edit/jianwei-v3/site/docs/v4/ZCODE_CONTROL_CHANNEL.md)。

## 权威与协作

- 当前产品主干只读项目 [NORTH_STAR.md](../../../../NORTH_STAR.md)；版本与执行许可只读 [全局决定](../../../../DECISIONS.md)。
- 每项后续任务必须由用户授权，冻结objective、allowed writes、forbidden scope、interfaces、DoD、evidence、stop condition；一个文件只有一个writer。
- ZCode通过自身Harness执行，不能改走旧GLM runner；Codex负责讨论、契约、复核。
- ZCode操作或联系Codex前，必须在当前ZCode对话中口头询问精确动作，并在用户随后明确回复“同意使用 Codex”后才可执行一次。授权限范围、不可转授、不可从历史或共享目录推定。
- 本文件的更新不代表已向ZCode发送任务或已确认ZCode读取；本轮未做UI派工。

本文件只规定工程执行边界，不能新增岗位权力、制度规则或实现范围。
