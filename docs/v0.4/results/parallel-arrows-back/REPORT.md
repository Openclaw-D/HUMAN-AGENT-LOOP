# 并行左右后端交付

2026-09-21。已提供可运行隔离后端，不再限于第一列。当前 [入口](http://127.0.0.1:62032) 保持运行，加载本包源码并原样托管 Front/dist；**后端 HTTP 通过不等于前端点击或用户视觉验收通过**。

## 已完成

1. 五专业按声明材料依赖就绪后并行执行真实 C 确定性分析，A 既有 analysis.start/finish 与 package.domain-result 登记真实运行和候选。初次输入对五专业均就绪时一起运行；浏览顺序不充当执行依赖。实测 5 个不同 worker threadId，CPU 分析起止区间重叠，证据见 PARALLEL_EVIDENCE.json。
2. 显式选择接通既有 package.adopt；商机映射只补 business:['business']，正负权限回归通过。候选始终 authority=none，service 不能采用。信审明确拒绝调用既有评估命令链，再逻辑归档本流程；不产生额度、放款或其他正式批准。
3. customer/process/domain/round/version/material/result/selection/event 关联持久化。一次 repeatable-read 查询供给平台、材料、决策、流程、历史和相关事件记录；选择保存真实 candidateId/result_id 与 eventId，不把查询身份当执行者。
4. 真实输入驱动三例：好例五专业显式采用后 CASE_COMPLETED/diamond；中例现金流等级不足，实际更正版登记后重评再完成；差例低覆盖率产生风险意见，明确人类拒绝后 rejection+archiveRef，迟到结果不能复活流程。收入为 2200 万元，资产负债关系自洽，交易地区明确新疆喀什；旧喀什超红线材料不改动。场景名只作展示，不决定结局。
5. 本包启动/停止脚本、资源归属、稳定案例 manifest 已装配。GET /api/jw/v2/arrow-cases 返回稳定 caseId→真实 customerId；同源 root、客户列表、workspace、plan、manifest 已在常驻实例读验成功。Front 原按 runtimeDisplayName 匹配旧名称会禁用卡片，必须消费新 manifest；具体契约见 CASE_MAPPING.md。

## 验证证据

- A npm run typecheck：通过。
- Back/A/test/parallel-arrows-http.test.mjs：12 个子测试加父测试，Node 统计 **13 pass / 0 fail / 0 skip**，见 HTTP_TEST.txt。
- B column-runner 与 Edge proxy/CSRF：**13 pass / 0 fail / 0 skip**，见 REGRESSION_TEST.txt。
- HTTP 覆盖实际三例、材料更正、真实采用与拒绝、并行时间重叠、版本视图、选中事件关联、同ID复用、跨租户、商机角色正负、service禁止代人采用、超时取消、拒绝后的迟到政策结果、采用已提交但响应丢失时 unknown 围栏，以及实际 Node 进程停止/重启后的已完成和处理中状态恢复，均不额外执行。
- 中途进程测试曾因父进程 --input-type 参数被 worker 继承而失败；已过滤不适用于文件 worker 的该参数，最终全套通过。日志中的故意500为“采用已提交后响应丢失”故障注入，不是遗留失败。

测试专用旧容器 jw-arrow-back-test-20260921 已停止；验收专用 jw-parallel-arrows-back 和 Node 常驻入口保持运行，归属见 OWNERSHIP.json/RUNTIME.json。所有测试子进程均清理。

## 文件范围

- Back/A/src/domain/advance-round.ts：完整隔离 adapter，同时保留旧默认 adapter。
- Back/A/src/domain/package.ts：仅已获准的 business 角色映射遗漏修复。
- Back/A/src/http/server.ts：最小隔离 adapter 注入、decision 与 case manifest 路由。
- Back/A/migrations/016_parallel_arrow_process.sql：流程、任务、幂等请求及版本事件增量表（与015一起只用于自有隔离库）。
- Back/B/src/worker/column-runner.mjs：现有 C 分析复用、真实多线程并行、超时/取消；测试相应扩充。
- Back/Edge/src/advance-round.mjs：decision/manifest 白名单，复用原 proxy/readproxy；未改 messages/store/model/decisions 或 Edge server。
- Back/A/scripts/parallel-arrows-runtime.mjs、start-parallel-arrows.ps1、stop-parallel-arrows.ps1：显式合成身份、三例 seed、隔离服务与资源归属。
- Back/A/test/parallel-arrows-http.test.mjs：真实集成与重启故障测试。

## 后续验收边界与限制

Front 需接新 manifest、requiredDecision/decision POST、同版本 receipt.views、非当前列状态及 caseOutcome。Back 未改 Front，也未操控其他对话或用户标签；本包不声称浏览器三例点击已通过，主协调继续按最终目标验收。

当前 C 声明各域全量材料依赖，补证保守重评所有依赖域；因此中例可多于约六次，不通过篡改依赖或绿勾凑次数。专业办结表示该意见处理/采用完成，不代表正式融资审批通过。当前流程按发起主体隔离，完整测试用显式五角色测试身份；单角色身份只执行自身获准专业，不自动借用其他人的权限。

unknown 保持只读恢复和防重复，不自动解除。人工采用后缺最终本包回执时同样不会盲目重发或假定成功。已终止流程保留历史；全新演练用新 seed-suffix/新客户，不清空旧记录。没有共享数据库迁移、共享服务重启、真实模型调用、Git提交或发布。
