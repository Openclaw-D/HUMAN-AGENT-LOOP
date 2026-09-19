# 任务02 · 证据索引（board-round-02）

日期：2026-09-19。执行者自验证据（用户验收未发生）。

## 测试日志（.local/task02-round2/）

| 文件 | 内容 | 结果 |
|---|---|---|
| connectors-full-test.log | Connectors 全量 `npm test`（14 文件：B1/I/E1/processing.e2e/goal02-*/defects） | 88/88 PASS，0 skip |
| goal02-link-chain.log | 真实 A 内核全链 L1-L6（零配置/映射/判重/伪造/崩溃重启/不利材料） | 6/6 PASS |
| goal02-blocked-recovery.log | R1-R3（A 未配置恢复/受控映射/健康与回执观测） | 3/3 PASS |
| goal02-actor-trust.log | T1-T2（actor 代理权/服务身份/归属校验/读面隔离） | 2/2 PASS |
| actor-trust-debug.log | 修复过程留痕（门与绑定错误码差异定位） | 过程件 |

Back/C 套件（parse 适配器回归）：`npm test`（Back/C run-all.mjs）→ 101/101 PASS（终端运行，
未落盘文件；复跑命令 `cd Back/C && npm test`）。

## 代码锚点（本轮改动）

- Back/Connectors/src/http/server.mjs：callerBindings 绑定与 actorCtx 守卫；correct-fact 归属校验
  与 from_artifacts[0] 修复；/healthz processing 分项；upload/preview 归属（接续在制）。
- Back/Connectors/src/evidence/service.mjs：manualEntry 归属校验；requeueForAnalysis 尝试代数（接续）。
- Back/Connectors/src/processing/coordinator.mjs：runTask 游标先行语义；受控映射链/等待态（接续在制）。
- Back/Connectors/src/errors.mjs：ACTOR_NOT_DELEGABLE / CALLER_NOT_TRUSTED。
- Back/C/src/parse/adapters.mjs：extractKvCsvFacts 表头感知。
- Back/Connectors/config/connectors.config.example.json、scripts/start-connectors.mjs：callerBindings 透传。
- Back/Connectors/package.json：测试清单纳入三份 goal02 新测试。
- 测试：Back/Connectors/test/goal02-{link-chain,blocked-recovery,actor-trust}.test.mjs。

## 环境凭据核对（运行前）

- jw-connectors-pg@15443（cnext/cnext/cnext）、jw-cc-kernel-pg@15444（jwcc/postgres 管理库）：
  与 Back/Connectors/README.md、TEST_PLAN.md 登记一致，docker 容器名核对一致；jw-v01-pg@15442 未触碰。
