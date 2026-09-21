# 第一列接续实施结果

2026-09-21。按 COLUMN_PLAN_V1 最新接续授权恢复范围内实施，PAUSED.md 为上一阶段历史。本次已经修改源码，不止规划；**尚未达到一次点击业务整列全绿的验收条件**。

## 实际新增

- Back/B/src/worker/column-runner.mjs 调用现有 C 感知层与 assessBusiness，执行真实确定性商机候选分析。输入来自 A 当前材料和 fact_assertions；不提取未登记字段、不接受上传文件自己宣称已核验，不调用外部模型、不使用或新建 service 凭据。
- Back/A/src/domain/advance-round.ts 在同次 POST 报告后执行分析并持久完整候选，四格返回材料/分析/核验/办结各自真实状态。依据摘要新增事实值和等级，避免事实改变却复用旧结果。更新动作白名单版本，旧请求仍可按原 ID 恢复，新的旧计划拒绝。
- 同一 receipt 输出平台、材料、决策、流程、历史视图，统一轮次/版本/服务端时间；持久 timeline 与结果 outbox 时间/版本一致，结果事件关联 candidateRunId。刷新不再次执行。没有修改 Front 或 UI 图标，前端自动渲染由其 writer 负责。

## 验证

本轮 A typecheck 通过。HTTP 10/10 通过：真实报告+候选、各视图同版本与服务端时间、outbox 对齐、刷新同 runId、并发幂等、unknown 不重发、版本及权限、拒绝停止。新增 B runner 测试 2/2 通过：上传伪核验字段不成为事实、真实事实等级/来源保留、失效材料排除、非合成客户阻断。没有用户页面点击验收。

测试容器恢复后 Docker 随机端口由旧 63151 变为 49223，首次旧端口连接失败；核对 docker port 后重新运行 HTTP 全部通过。本轮实际命令：

```powershell
# C:\Users\22673\Desktop\JW\Back\A
npm run typecheck
# C:\Users\22673\Desktop\JW
node --test Back/B/test/column-runner.test.mjs
$env:ARROW_TEST_DB_URL='postgres://arrow_test:arrow_test_only@127.0.0.1:49223/arrow_test'
node --test Back/A/test/advance-round-http.test.mjs
```

## 精确缺口

1. 第一列仍没有对应本次候选的独立人工核验/采用回执与接线。现有 A analysis.start/finish 限 service，当前只获准 business 人类推进；package 的既有域结果/采用也不是本次候选的确认。不能直接写受保护分析表、借用凭据或默认用户已采纳新候选来制造全绿。当前 plan 明示 fullColumnReady=false、completionBlockers=HUMAN_VERIFICATION_REQUIRED；verification/completion 保留未完成。候选已经执行和保存不等于正式采用。
2. 后列仍为真实持久等待任务，没有政策执行服务。下一列自动办理未实现，按阶段范围不扩展。
3. 原共享数据库迁移和共享服务重启禁令仍有效，未对共享实例实施；当前用户页面未接通的风险仍在。准确迁移模板见 REPORT.md；需要实例负责人在授权维护范围装配，不得将隔离测试成功称为真实页面完成。

未更改正式权限、规则政策、三例材料、共享配置或其他 writer 文件；没有跨任务消息、subagent、worktree、提交或发布。交付后自有 HTTP 测试已清理，独立测试数据库容器停止，保留数据。
