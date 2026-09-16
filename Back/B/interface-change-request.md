# B 路接口观察（对 A CONTRACT v1.0；2026-09-16 夜间集成实测）

状态:观察清单(非阻断;全部有 B 侧兼容/绕行)。按合同前言约定,接口变更由 A 裁量后升版本号发布,B 不擅自改共享面。

## OBS-1 human-requests 列表端点泄漏蛇形列名

- 现象:`GET /api/v1/projects/:projectId/human-requests` 的响应条目为蛇形
  (`hrequest_id/project_id/goal_id/requested_role/required_evidence_kinds/created_by`),
  与契约 §2 "所有 API 响应字段驼峰(数据库列名蛇形不外泄)" 不一致。
- 实测证据:`evidence/a-integration-*.json`(S2 用例;2026-09-16 06:38 前后多次复现)。
- B 侧处置:读取时兼容 `goalId`/`goal_id` 两种形状;写路径不受影响
  (POST 创建响应为驼峰 `hrequestId`)。
- 建议:A 在该端点统一投影为驼峰。

## OBS-2 goal 投影不含 projectId

- 现象:`GET /api/v1/goals/:goalId` 的 goal 对象无 `projectId` 字段。
  B 需要它给人工待办挂项目(POST human-requests 路径参数其实也用它定位权限)。
- B 侧处置:B worker 的目标发现走 outbox 事件(`GOAL_READY` 事件带 `projectId`),
  从事件取,不依赖 goal 投影。
- 建议:A 在 goal 投影补 `projectId`(方便非事件路径消费方)。

## OBS-3 人工待办 requestedRole 必填(1..64 string)

- 现象:契约 §4 的 human-requests 创建体未标注 `requestedRole` 必填;
  实测缺失 → 400 `INVALID_INPUT: requestedRole 必须是 1..64 长度的 string`。
- B 侧处置:B 兜底传目标 `responsibleRole`(缺省 'business')。
- 建议:A 在契约 §4 标注必填性(文档澄清即可)。

## OBS-4(确认,非问题) claim 无独立续租端点

- 契约 §4 无 lease 续期端点;lease 时长由 A 侧定(当前 90s)。
- B 处置:worker 周期核对 `leaseUntil`,到期即停写回;不重领打断(过期能被重领是 A 的恢复语义)。
  B 的任务软超时(默认 60s)配置必须小于 A 的 lease(90s),已写入 B config 注释。
