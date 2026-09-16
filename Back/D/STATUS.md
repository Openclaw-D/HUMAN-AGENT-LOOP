# D路 STATUS（2026-09-16 夜间批次 · 当前概要，历史见 evidence/）

更新：2026-09-16 06:45 +08:00（矩阵收口：40唯一id 37 PASS/1 FAIL(D-25e不稳定)/2 BLOCKED，DEF-03/04已解决确认，DEF-01业务语义待用户裁决）

## 当前总览（对A CONTRACT v1.0 的独立黑盒验收）

- **矩阵执行：39项判据实际验收：33 PASS / 5 FAIL（DEF-04同一根因：预算门未接线——并发击穿/目录账本/坏账本/非法预算/重启绕过，交B）/ 2 BLOCKED。G0框架自检8/8。累计1600+断言，全部真实HTTP+真实PostgreSQL+真实子进程kill/restart（D自有隔离容器15433，A的48080/15432未触碰）。**
  - **D-25预算反证系列已落地**（D-25a并发/D-25b目录账本/D-25c坏账本/D-25d非法预算/D-25e重启持久，真实子进程3-6并发、真实socket mock计数），复现 Codex 独立探针的 P1：根因=runtime.mjs 未透传 config.budget（glm.mjs 严格实现成死代码）。B 修复发布后 `D_SUITES=g8 D_ONLY=D-25a,D-25b,D-25c,D-25d,D-25e node harness/run-all.mjs retest-def04` 定向复测。
  - **当前开放FAIL：仅 D-27b 已于 04:50 随 B 修复转 PASS**（见 DEFECTS.md DEF-03 解决确认）。全部35项中：**33 PASS / 2 BLOCKED / 0 未解决FAIL**。
  - **v1.3独立验证（D-19/19b/19c/19d，220+断言）**：传递stale投影跨accepted/decided可见、UPSTREAM_STALE复核门fail-closed（staleRoots列根因）、staleReviewAck放行+审计留痕、decided历史不改写、执行面不受门影响——全部与契约文字一致。
  - **D-28/D-29 复测**：manifest发布后程序化核对PASS（7断言，传递源图+lockfile零缺失）；v1.3源码干净目录启动PASS（13断言）。
  - **生产边界（如实）**：principal均为A官方SPEC合成token；提交证据/GET项目的匿名与跨项目边界、生产身份源与项目隔离**未验收**；synthetic身份测试不构成生产授权。
  - **v1.3独立验证（D-19/19b/19c/19d，220+断言）**：传递stale投影跨accepted/decided可见、UPSTREAM_STALE复核门fail-closed（staleRoots列根因）、staleReviewAck放行+审计留痕、decided历史不改写、执行面不受门影响——全部与契约文字一致。
  - **生产边界（如实）**：principal均为A官方SPEC合成token；提交证据/GET项目的匿名与跨项目边界、生产身份源与项目隔离**未验收**；synthetic身份测试不构成生产授权。
- **缺陷报告：DEFECTS.md** — DEF-01按03:05监督拆两层：(a)实现一致性vs v1.2=PASS（D-19/19b/19c）；(b)原需求缺口=OPEN待用户裁决（D-19d常设FAIL）。DEF-02已关闭（B CLI交付，D完成接入）。**新增DEF-03（P1·B）**：人工授权retry_step被D-9门接受但不触发transport重发，goal滞留leased——unknown恢复闭环的"重发腿"未走通（复现：`D_SUITES=g4 D_ONLY=D-27b node harness/run-all.mjs repro-def03`）。
- **B接入亮点**：B worker经`--config/--data-dir`全 overrides 以D自有配置/运行时目录运行（B源码零写入）：claim→LangGraph执行→C mock transport→complete→candidate全链；mid-flight SIGKILL→checkpoint跨进程恢复→**零盲重发实锤（C mock调用数1→1）**；D-9无凭据拒绝实锤。
- **契约跟踪：CONTRACT v1.0→v1.2**（v1.1吸收B路4观察：human-requests驼峰/goal投影补projectId/requestedRole必填/无续租端点到期可重领；v1.2按D路D-19反证澄清级联停止）。D-08已补v1.1#4到期直接重领验证，D-19已按v1.2翻转并新增D-19b。
- 4项G0 harness自检语义、PG容器管理健壮性（hash命名/身份探针/库级ready）、runner退出码0/1/2/3语义均经回归。

## 已做（02:05–02:55）
- 监督补充适配：A入口改为 `node src/index.ts` 直跑（无dist）；CONTRACT v0.1→v1.0 全量差异核对并落进断言（projectInputVersion、门序、失效重算语义、敏感清单含templates(admin)、证据content不套禁用键、每订阅独立投递簿、订阅只收注册后事件）。
- principal词汇对齐A官方SPEC（tok-admin/business/agent/approver…），D-21项目级principal经restartApi注入真实projectId。
- 全量r1（02:30）：21过/10败/6留门→10败全部分类为D侧测试bug（旧词汇残留/断言顺序/计数范围/路径少算一层/ensurePg竞态）或断言过严，零冤枉SUT。
- 全量r2+定向r3：**g0 8/8、g1 4/4（132断言）、g2 3/3、g3 3/3、g4 2/2+2留门、g5 3/3、g6 1/2（DEF-01证据轮45断言）、g7 3/3、g8 2/3过+D-27留门、g9 2/2**。
- 亮点实锤：四态状态机全链、双客户端争抢恰一胜、过期租约+fencing单调拒绝且零写副作用、outbox同事务+至少一次重投+requestId幂等、API/DB重启逐字节持久、跨项目敏感写403双向、注入零提权、凭据零泄漏（403响应+日志+DB全列扫描）、干净目录src直跑端到端、C假API凭据掩码+泄漏哨兵。

## 真实失败（SUT侧）
- DEF-01（见DEFECTS.md）：唯一SUT侧FAIL，P1，owner A，可一条命令复现。

## 依赖与下一步
- B：发布worker CLI后 D-12/15/26/27 端到端即测（g4/g8脚本已就绪，探测到入口即走）。
- A：DEF-01 裁决（改码或升契约）后 `D_SUITES=g6 node harness/run-all.mjs retest-def01` 定向复测。
- 计划：~05:00再跑一轮全量验证可重复性（同一版本应得相同结果）；06:30冻结最终RESULT.md。

## 恢复方法
- 全矩阵：`node D/harness/run-all.mjs <run>`；单套件 `D_SUITES=g2 ...`；单测 `D_ONLY=D-08 D_SUITES=g2 ...`。
- 退出码：0全过/1有FAIL/2套件崩溃/3零断言不得PASS。
- D自有容器清理（精确名）：`docker ps -a --format '{{.Names}}' | grep ^v7d-` 逐个确认后 `docker rm -f <name>`。
