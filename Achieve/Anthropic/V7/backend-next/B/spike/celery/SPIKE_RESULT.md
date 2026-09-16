# Celery 隔离技术 spike 结果（B 路；2026-09-16 夜间；结论：列待裁决）

状态:**有界验证完成,未宣称采用**。任务书边界:Celery 只候选"任务投递/领取重试";
执行归 LangGraph worker;业务状态唯一权威是 A。若采用与否未裁决,现状(Node worker 轮询)
继续有效,spike 不阻断任何工作。

## 1. 验证了什么(真实 Linux 容器,非纸面)

环境:Docker Desktop Linux 后端(A 路拉起);`redis:7-alpine` + `python:3.11-slim`
(celery 5.4.0 / redis-py 5.0.8 / requests 2.32.3,PyPI 锁版),独立项目名
`b-celery-spike-*`、独立网络,未触碰 Dify 容器。宿主侧收集器 = Node(`scripts/celery-collector.mjs`,模拟 B 执行器入口)。

| 断言 | 结果 | 证据 |
|---|---|---|
| Linux 容器内 celery worker 启动并连上 Redis broker | ✅ `celery@... ready` | evidence/celery-worker-log.txt |
| 跨语言投递:容器内 Python → 宿主 Windows Node(真实 socket) | ✅ 3/3 送达 | evidence/celery-deliveries.jsonl |
| 首次投递失败(模拟 500)→ 有界自动重试(指数退避 2s,max_retries=3) | ✅ 每目标恰好重试 1 次后成功 | 同上 + worker log `retry: Retry in 2s` |
| 4xx 确定拒绝不重试(代码路径) | ✅(任务定义:4xx 直接返回,不进 autoretry) | tasks.py |
| acks_late + reject_on_worker_lost(worker 崩溃重投,至少一次) | 配置生效(未单独杀进程验证,标注为未测项) | celery_app.py |

## 2. 架构分工(若采用)

```
A(队列唯一 owner,PostgreSQL claim/lease/fencing)
   │ GOAL_READY 事件
   ▼
[Celery 候选层] redis broker → dispatch_goal_execution(goalId) → B 执行器 HTTP
   (只投递通知,不携业务载荷;重试=再通知,有界)
   ▼
B worker(现状即执行器):claim→LangGraph 执行→complete/fail
   (幂等由 A 的 claim/fencing 保证:重投任务领取不到目标 = no-op,不会盲重 LLM)
```

关键点:即使 Celery 重投 N 次,B 执行器向 A 的 claim 是唯一判幂等的门——
目标已 leased/candidate_ready 时重投直接 no-op。**Celery 与 LangGraph 不各自掌握业务状态。**

## 3. 成本/收益证据(与窄闭环比较)

窄闭环现状:A 是队列 owner(claim/lease/fencing/幂等表全部 PostgreSQL 事务化),
B worker 已实现 **事件拉取→领取→执行→回执→恢复** 全链(53 项单测+13 项真实集成全绿)。

引入 Celery 的增量成本(实测):
1. **双语言运行时**:Python 容器链(pip 锁版安装、镜像、升级面)+ Node 宿主,部署/排障双份;
2. **新增 broker 基础设施**:Redis 容器(或 RabbitMQ)= 第 4 个有状态组件(A PG、C mock、B worker 之外),
   需要独立隔离/监控/恢复;
3. **投递语义重叠**:A 的 outbox+订阅已是"至少一次投递"(§3.5,dispatcher 指数重试+dead 置位),
   Celery 再做一层投递重试 = 两层 at-least-once 叠加,重复投递面变大(靠幂等消化,但排障链路变长);
4. **跨进程可观测性**:一次目标执行的排障横跨 A 日志/Redis 队列/Celery 日志/B checkpoint。

增量收益(实测可确认的):
- 投递层与执行层进程解耦(执行器可滚动重启,任务滞留队列);
- 成熟的定时/延迟任务(本轮无用例);
- 若未来执行器横向扩容跨多机,broker 分发比事件轮询更直接(本轮单机窄闭环用不到)。

## 4. 更小替代建议(已实现,即现状)

- **默认(已实现)**:B worker 轮询 `GET /api/v1/events`(游标持久化,断点续拉)+ claim/fencing。
  零新增组件、零双语言成本,语义已覆盖"投递/领取/有限重试/崩溃恢复"(A 是重试策略与队列权威)。
- **若要推力代替拉力**:A 已支持 loopback **订阅推送**(§4 `POST /api/v1/subscriptions`,
  outbox dispatcher 至少一次 + eventId 幂等)。B 只需加一个 ~50 行的 HTTP 接收端点转内部执行,
  即可获得"准实时投递+重试",仍无新语言/新中间件。
- **Celery 适用信号(留待裁决)**:出现多机执行器扩容、复杂定时编排、跨项目任务优先级队列等
  需求时,本 spike 的 compose/任务定义可直接复用,迁移成本已探明(约 1 天)。

## 5. 复现命令(启动/停止/恢复)

```bash
# 宿主侧收集器(模拟 B 执行器)
cd V7/backend-next/B && node scripts/celery-collector.mjs --port 3799 --out spike/celery/deliveries.jsonl
# 容器栈(隔离:b-celery-spike-*;Docker Linux 后端需在运行)
docker compose -f spike/celery/docker-compose.yml up -d redis worker
docker compose -f spike/celery/docker-compose.yml run --rm producer
# 验证:GET http://127.0.0.1:3799/_records → 每目标 2 条投递(500→200)
docker compose -f spike/celery/docker-compose.yml down   # 停止并清理
```

## 6. 未测项(如实)

- worker 进程 kill -9 后的重投(acks_late 配置就位但未单独注入;置信度中);
- Redis broker 自身持久化/高可用(spike 用裸 Redis);
- 生产级并发(prefetch/concurrency 调优)。
