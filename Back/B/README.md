# V7 backend-next / B 路 — 持久执行与路由（persistent execution & routing）

LangGraph JS 持久化编排 + 独立 worker + 规则限定可信路由。消费共享契约
[`../CONTRACT.md`](../CONTRACT.md)（v1.0 FROZEN）。状态与结果:[`STATUS.md`](STATUS.md) / [`RESULT.md`](RESULT.md)。

## 边界（对账 A 契约 §0/§6）

- **A 是业务事实权威与唯一队列 owner**:B 只做"领取→执行→回执",不自建队列、不自报验收/决定
  （complete 最多 `candidate_ready`;failed/unknown/needs_* 走 fail+note+人工待办）。
- **三分发送语义**:未发送(not_configured/cancelled/4xx) ≠ 确定失败(5xx/响应损坏) ≠ 发送后未知
  (超时/断连)。unknown 零盲重发;显式重试只走人工(D-9 身份门)或 A 重授的新 fencing 周期。
- **凭据卫生**:apiKey 只显式注入、只进请求头;凭据不进 checkpoint/日志/错误返回
  (含 verifier/authorizer 异常文本,全部经 `src/redact.mjs` 脱敏)。
- **最小上下文**:模型请求只含当前目标标签+证据引用三元组+角色指令;无仓库路径/聊天历史;
  `contextTags` 隔离 project/goal/run/role(C mock 的 canary 串线探针锚点)。

## 启动（依序;命令已验证）

```bash
# 1) 依赖(锁版: @langchain/langgraph 0.2.62 + core 0.3.68 + checkpoint 0.0.18;Node ≥22)
cd V7/backend-next/B && npm install

# 2) 配置(transport/routes/contract/worker)
cp config/b-config.example.json config/b-config.json   # 按需修改;apiKey 只写在此文件

# 3) 单元+集成测试(stub 契约+B 本地 loopback fixture;53 项)
npm test

# 4) 真实 A 集成(需 A 内核 48080 运行 + C 可启动;13 项)
#    A 侧: cd ../A && docker start v7next-a-pg && node scripts/start-kernel.mjs
node scripts/run-a-integration.mjs          # A 不可达 → exit 3 BLOCKED(如实)

# 5) 常驻 worker(真实消费 A 队列;长期运行入口;D 验收按 HANDOFF-D.md)
cp config/b-config.http-sample.json config/b-config.json   # http 模式样例(A 48080 + C 3730 + projectFilter)
node src/cli.mjs worker                     # 常驻:恢复扫描→消费主循环;SIGINT 优雅停,SIGKILL 靠恢复
node src/cli.mjs recover                    # 只做崩溃恢复扫描(回执对账+补提交)
node src/cli.mjs view <taskRunId>           # 查看运行视图
node src/cli.mjs cancel <goalId> --reason x # 跨进程取消(标志文件;步边界生效)
B_RESUME_CREDENTIAL=cred:boss node src/cli.mjs resume <taskRunId> retry_step --step <stepId>
node src/cli.mjs status                     # transport/路由/契约指纹(不含密钥)

# 6) Celery 隔离 spike(可选;Linux 容器;结论见 spike/celery/SPIKE_RESULT.md)
node scripts/celery-collector.mjs --port 3799 --out spike/celery/deliveries.jsonl &
docker compose -f spike/celery/docker-compose.yml up -d redis worker
docker compose -f spike/celery/docker-compose.yml run --rm producer
docker compose -f spike/celery/docker-compose.yml down
```

## 目录

```
src/
  codes.mjs                 协议常量(三分发送/终态优先级/错误码)
  redact.mjs                凭据卫生(结构化+形状脱敏;D-10 修复:异常文本过脱敏)
  ports.mjs                 端口定义+本地文件实现(回执/工具/原子写)
  resume-core.mjs           D-9 可信恢复身份门+命令校验(失败关闭)
  router.mjs                规则限定可信路由(首中即用;NO_ROUTE 升级人工;配置非法失败关闭)
  runtime.mjs               装配工厂(stub/http 契约、transport、路由、checkpointer、worker)
  cli.mjs                   CLI(worker/recover/view/resume/seed-demo/status)
  contract/
    stub.mjs                A 契约本地测试替身(v2;对齐 §3.4 门序)
    client.mjs              A v1.0 HTTP 客户端(events 拉取/claim/complete/fail/回执/待办)
  transport/
    glm.mjs                 GLM-5.2 transport(注入式配置/OpenAI 形状/出站允许/成本记录/三分语义)
  graph/
    decision.mjs            就绪门/终局裁决/候选汇总(纯函数)
    task-run-orchestrator.mjs  LangGraph 任务执行图(持久 checkpoint/interrupt/取消/陈旧丢弃)
  worker/
    worker.mjs              独立 worker(pollWork/软超时/租约自检/有界安全重领/recoverAll)
  langgraph/file-checkpointer.mjs  LangGraph 文件 checkpointer(真实落盘,跨进程恢复)
test/                       53 项自动化测试(node --test;含 SIGKILL 跨进程崩溃恢复)
spike/celery/               Celery 有界技术 spike(Linux 容器已验证;结论待裁决)
config/b-config.example.json
scripts/run-a-integration.mjs   真实 A 集成验证(13 项)
scripts/celery-collector.mjs    spike 收集器
evidence/                   测试输出/集成记录/哈希/依赖清单
runtime/                    运行时数据(回执/checkpoint/registry;不入证据)
```

## 未完成门（如实）

- 真实 GLM-5.2:仅预留 transport(0 调用);待用户授权地址/模型/费率后按 `transport.mode='real'` 小流量实测。
- Celery:Linux 容器技术验证通过,采用与否待裁决(`spike/celery/SPIKE_RESULT.md`;未测 worker kill -9 重投)。
- D 路独立验收:常驻交付面见 **`HANDOFF-D.md`**(入口/配置/端口/路径/恢复/固定 hash/反证配方);
  本轮修复 4 项相关缺陷(恢复缺 expectedVersion、resume 重领 token 复用碰撞、跨进程取消、常驻日志),
  常驻端到端自证 20/20(`scripts/verify-resident.mjs`);等 D 黑盒复测与 R1。
