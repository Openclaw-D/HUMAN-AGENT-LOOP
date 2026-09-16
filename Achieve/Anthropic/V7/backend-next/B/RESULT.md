# V7 backend-next B RESULT｜2026-09-16 夜间交付

## 结论（一句话）

B 路全部 DoD 项完成并验证:**53/53 自动化测试 + 13/13 真实 A 集成全绿**;LangGraph 持久化执行、
可信路由、三分发送语义、D-9 恢复身份、崩溃恢复、超时/取消/陈旧丢弃、Celery 有界 spike 均有
可复现证据;真实 GLM-5.2 保持 0 调用(仅预留),Celery 采用与否列待裁决。

## 验证矩阵（DoD → 证据）

| 任务书 DoD 项 | 实现 | 验证 | 证据 |
|---|---|---|---|
| 消费 A 唯一契约,等待期不造共享 schema | contract/client.mjs(v1.0)+stub(标注测试替身) | 真实集成 13/13 + stub 组 10/10 | a-integration-night-20260916.txt |
| 可配置目标执行图 | 路由规则表(config/routes)→ 线性执行计划;goal 粒度 | goal-graph 组 6/6 | test-run-all-night-20260916.txt |
| 规则限定可信路由 | router.mjs(首中即用/ruleId 审计/NO_ROUTE 升级/非法配置失败关闭) | router 组 6/6 | 同上 |
| LangGraph 持久化 checkpoint | FileCheckpointSaver(原子写,thread 隔离) | 跨进程 SIGKILL 恢复 3/3 | crash-recovery 组 |
| 人工 interrupt/resume | interrupt()+D-9 身份门(包装层盖章,凭据不进图) | resume-identity 组 8/8 + checkpoint 零凭据断言 | 同上 |
| 未发送/确定失败/发送后未知 三分 | transport 语义 + 回执 intent/terminal | three-way 组 12/12(真实 socket) | 同上 |
| unknown 零盲重发 | 回执门+unknown 终态永不自动重做;重领仅限结果确定 | 断言服务端恰 1 次调用(goal-graph/crash 组) | 同上 |
| lease 过期 ≠ API 未执行 | 回执查询判效果;A 门序拒绝按 FENCING/LEASE 分码 | crash 组 + worker 组 + A 真实集成 S4 | 同上+集成 JSON |
| 恢复时节点重入检查业务回执 | recover/continueRun 查 B 回执+A 回执,确定性 requestId 回推 | crash 组 3/3 | 同上 |
| 超时/并发上限/取消 | worker 软超时→步边界取消;并发槽;取消双通道 | worker 组 7/7 | 同上 |
| 陈旧结果丢弃 | completed 前重读 A 版本 → stale | goal-graph stale 用例 | 同上 |
| 凭据不进 checkpoint/日志/错误(含异常文本) | redact.mjs 全出口脱敏;D-10 修复 | redact 组 7/7 | 同上 |
| 最小上下文/项目隔离 | buildModelRequest 只装当前目标;x-jw-project 串线锚点 | three-way 最小上下文用例 | 同上 |
| mock/real 强标记;未配置如实拒绝 | source.mode/simulationOnly;not_configured 缺省 | three-way 组 | 同上 |
| GLM-5.2 transport 预留 | real 模式(endpoint/model/key 注入+出站允许+成本记录) | real 模式用例(打 C mock 端点) | 同上 |
| 独立 worker | worker.mjs(claim→执行→回执→恢复) | worker 组 + 真实集成 | 同上 |
| Celery 隔离 spike | redis+celery 5.4 Linux 容器;有界重试;跨语言回调 | 容器内实测:3 目标 500→retry→200 | celery-deliveries.jsonl + SPIKE_RESULT.md |
| STATUS/RESULT/evidence | 本文件+STATUS+evidence/ | — | 目录在案 |

## 数字

- 自动化测试:53 项,53 过,0 失败(`npm test`;node --test 显式清单,--test-force-exit)。
- 真实集成:13 项断言全过(对 48080 常驻实例 + C mock 3731;业务库真实 PostgreSQL)。
- Celery:3 目标投递,首次 500→2s 退避重试→200 成功,0 幂等冲突;容器栈已 down 清理。
- 依赖:Node 22.23.1;@langchain/langgraph 0.2.62 / core 0.3.68 / checkpoint 0.0.18(包内锁版);
  spike 侧 celery 5.4.0 / redis-py 5.0.8 / requests 2.32.3(PyPI 锁版)。

## 真实边界（不宣称的部分）

1. 真实 provider 未测:GLM-5.2 0 调用;transport real 路径只对 C mock/loopback 验证过形状与门序。
2. 生产权限未测:身份源是 A 的合成 principal + B 注入测试验证器;真实岗位授权制度属用户确认事项。
3. 第二机器未测:checkpoint/回执/registry 均单机目录;跨机部署未验证。
4. Celery 未测项:worker kill -9 重投、broker 持久化、生产并发调优(SPIKE_RESULT §6)。
5. 结论分层:模拟工程链路(≈A+stub/C mock+B)已验证;真实模型链路、生产身份、跨机 = 未测门。
