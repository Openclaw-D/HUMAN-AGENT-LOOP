# Arrow Back implementation report

> 此文件记录首个报告切片；阶段1接续新增真实商机分析与统一视图，当前结果和限制以 STAGE1_RESULT.md、API.md 为准。

2026-09-21。第一切片已实现并经隔离真实 HTTP 验证：业务补件报告 → 持久轮次/动作结果 → GET 恢复 → 持久政策等待任务。共享运行实例未接通，不能宣称用户页面左右按钮已修好。接口见 [API.md](API.md)。

## 文件与实际行为

- `Back/A/src/domain/advance-round.ts`：服务端计划、依据摘要、事务接受、客户行锁、幂等复用、unknown 围栏、报告执行、结果/事件/下游任务持久化及身份隔离读回。
- `Back/A/migrations/015_advance_round.sql`：新增 advance_rounds 和 advance_column_tasks；不修改原业务表数据。
- `Back/A/src/http/server.ts`：最小注册 GET/POST，保留已有 upload 差异；未改 kernel。
- `Back/Edge/src/advance-round.mjs`、`proxy.mjs`、`readproxy.mjs`：最小白名单注册，复用现有会话与 CSRF；未改 Edge server 或 R2 messages/store/model/decisions/upload。
- `Back/A/test/advance-round-http.test.mjs`：真实 Edge/A HTTP 和隔离 PostgreSQL 测试。未改 Front、未调用真实模型、未新建 B worker、未控制其他任务。

## 验证

以下命令在本轮最后源代码变更后 exit 0：

```powershell
# cwd C:\Users\22673\Desktop\JW\Back\A
npm run typecheck
# cwd C:\Users\22673\Desktop\JW
$env:ARROW_TEST_DB_URL='postgres://arrow_test:arrow_test_only@127.0.0.1:63151/arrow_test'
node --test Back/A/test/advance-round-http.test.mjs
node --test Back/Edge/test/s3-proxy.test.mjs Back/Edge/test/s3-csrf.test.mjs
```

Arrow 测试为 1 个父测试与 9 个子测试，Node 共计 10 pass、0 fail、0 skip；既有代理/CSRF 回归 11 pass、0 fail、0 skip。覆盖：只读计划与未执行列、真实报告/outbox/等待任务、同ID及新ID有效结果复用、六请求并发仅一次写入、版本/动作集合/伪造字段/畸形输入、跨租户/身份/角色权限、真实报告提交后故障注入导致 unknown 且不重发、HTTP 服务和 Kernel 重建后的持久恢复、正式信审拒绝停止。服务重建测试不是操作系统进程崩溃测试；未知故障为合成注入，其报告写入调用真实命令。Edge 测试身份与会话为合成配置，不代表生产身份部署验收。

## 限制和运行装配

仅业务补件报告已执行；没有五列完整分析、核验或办结，没有下游政策合法 executor/service 委托，因此政策任务只持久等待，不能报告 running/绿色。未知轮次只恢复并阻止重复，不自动对账或解除围栏；发送前已知失败也保守保留 unknown。来源校验在已有报告命令前后进行，不宣称跨命令事务原子锁定；依据改变标记 current=false/needs_reassessment。当前客户任一历史拒绝都会保守阻断，尚无独立生命周期实例划分。未验证执行期间权限撤销、跨进程并发或用户视觉效果。

共享 A 数据库需要显式获准后应用 015（当前迁移器会补跑所有缺失迁移，先核对目标 applied 集合）。准确命令模板如下，本轮未执行：

```powershell
# cwd C:\Users\22673\Desktop\JW\Back\A
npm run migrate -- --db '<明确授权的目标 PostgreSQL URL>'
```

还需在授权维护窗口由运行实例负责人加载本轮 A/Edge 源码并重启对应服务，保留现有身份、配置及端口；没有通用端口/配置可安全代猜，本轮不执行。无需部署 B worker。先 GET advance-plan 核验路由/迁移/身份，再在授权合成客户明确 POST；共享服务完成装配前不能声称真实前后联调通过。

隔离测试资源为本任务创建的 Docker 容器 `jw-arrow-back-test-20260921`，标签 `jw.owner=arrow-wiring-back`，仅监听 127.0.0.1:63151。测试 HTTP 实例已由清理钩子关闭，数据库容器在交付前停止，保留测试数据以便恢复。无共享数据库迁移、共享服务重启、Git 提交或发布。
