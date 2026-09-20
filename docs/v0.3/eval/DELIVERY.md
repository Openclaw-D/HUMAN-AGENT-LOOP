# V0.3-EVAL 安全停止检查点

2026-09-20。按 CTRL 转达的用户最新要求停止持续推进；本阶段未全部交付，不在后台继续、不等待新任务。仅保存当前结果，未改产品源码、Materials、公共文件，未使用 subagent/worktree、未 commit/push。后端修复归 TEC，后续必须等其稳定源码 hash 再复验。

## 已完成的独立证据

- 离线实跑：B 默认显式文件清单 105/105，补跑默认入口漏挂的 context-brief 4/4，Edge 根目录套件 94/94，C 解析/规范化/Gate/五域子集 34/34。共237项通过，0失败/跳过。不是AI准确率。命令、退出码、耗时、TAP与日志hash：`.local/v03-eval/test-results.json`及对应`.log`。
- 使用owned cwd和TMP，loopback替身、隔离临时文件。Edge装配测试只启停本测试新建run-dir标识的临时实例。未连接共享PG；A/Connectors/Edge e1 的真实PG/完整链本轮NOT_RUN，未证明现有测试库归属，不运行其建库/删库脚本。Front按分工NOT_RUN。
- 缓存保护反例5项：3失败、2通过。候选变化后模块错误复用旧答；实际Edge HTTP路由也复现同问题；租户变化且customerId相同的模块调用复用他租户回执。前两项是同一缺陷的不同层级证据，不能计作三个独立缺陷；跨租户模块反例不证明真实路由权限已被突破。输入版本变化、新实例重启后的同载荷幂等为正向对照，均通过。见`.local/v03-eval/cache-repro.test.mjs`、`cache-repro.log`、`cache-repro-run.json`及`cache-*.json`。
- A源码核对：`updateAdmissionRequest`推进admission_request_revision/assessment.version；`submitCandidate`推进候选revision/assessment.version；两者不推进input_version。Edge优先以inputVersion构造请求标识，回执不比较实际payloadHash。证据为源码审读+上述替身HTTP复现，未伪称已在真实PG修改验证。
- 修复前171个源码/测试文件已封存，2026-09-20T11:32:27Z复制时全部hash吻合、无漂移。见`.local/v03-eval/baseline-seal.json`、`source-hashes-before.json`、`source-hash-drift.json`、`source-snapshot/`。测试日期不使后续修改自动获得通过状态。
- 真实模型旧记录只读对账：Edge 12 reserve与12回执逐ID吻合，9 succeeded/3 unknown，成功回执2653入/14046出tokens。B旧冒烟另有1 reserve/1 actual；其71/837 tokens仍是接受报告记载，未核到独立冒烟响应原件。本轮新增真实调用0。见`.local/v03-eval/existing-model-audit.json`。
- 成本语义：持久账本`actual.amount`是超过reserve的补记差额，0不代表免费。Edge预占4.2元、冒烟预占0.35元。按旧报告8/28元每百万tokens假设，Edge成功部分可重算为0.414512元；加报告中的冒烟用量为0.438516元。该费率本轮未重新查价，控制台实账未核，3个unknown费用仍未知。不得把预占金额、差额、费率估算、提供方实账混用。
- 当前旧观察链只传投影摘要，服务端evidenceRefs固定空数组；连通成功不支持材料理解率/原件引用正确率主张。原始三表不变证据为生产者记录的计数前后0/0/0，本轮只读复核，不冒充独立数据库前后状态验收。
- 三客户manifest共174条记录，hash/bytes全一致；GOLD的126处文件hash及引文行匹配，场景清单49个文件hash一致。45条答案/15个场景已到件，humanReviewStatus仍PENDING_BUSINESS_REVIEW。见`.local/v03-eval/material-manifest-audit.json`和`ground-truth-audit.json`。

## 已生成但尚未配齐协议的表格

- `raw-metrics.csv`：15场景×人工/规则模板/规则+AI=45条待填试验记录；所有测量值NOT_MEASURED，不能称45次已测。时间拆主动人工、总历时、被动等待；含返工、风险TP/FN/FP/TN、无依据结论、引用、tokens/费用、冷热启动、编排/模型耗时及原始记录定位。code_snapshot当前为准备时基线，真正开测须改为实际稳定快照。
- `event-log.csv`：一条未测占位说明，开测时替换为真实事件；不是运行日志。
- `scoring-items.csv`：360条scorer-only判分项，含字段与场景标准；不可发给三臂参与者/模型。业务风险严重性、适用性、缺件可答性与安全负例仍需冻结，不宜直接计算召回率。GOLD中缺少输入来源的项目标为待裁决，不能强迫猜答案。
- 三CSV用artifact-tool读回和CSV往返校验通过，见`.local/v03-eval/csv-validation.json`。CSV无样式或公式，不另造XLSX。构建器在`.local/v03-eval/build-tables.mjs`；填入真人结果后不要直接重跑覆盖。

## 尚未完成与恢复顺序

1. `CURRENT_BASELINE.md`、`TEST_PROTOCOL.md`、`GATE_REPORT.md`尚未编写；十小时窗口门、完整覆盖矩阵、S1/S2/S3/S4/S5=20/20/20/30/10证据矩阵尚未整理。本DELIVERY仅为停止检查点，不替代这些交付物。
2. 三臂需要同材料同任务、参与者/顺序与练习效应控制、计时起止和返工定义、基准答案业务复核、留出规则、计分分母及冷热启动口径。真人测量仍0，不能填提效百分比。原始产品解析兼容性由材料任务报告自报，本路未另跑其24条样本，不冒充独立解析验收。
3. 测试覆盖仍要区分已跑替身、仅源码存在、真实链NOT_RUN、实现缺口。重点为正常/冲突/缺件/补证/陈旧/越权/重复/未知/重启/无权审批；全周期履约、异常、结清、多轮返单必须保留缺口，不得删除目标。
4. 依据最新MODEL_PORTABILITY_CONTRACT与AUTHORITY§8，待TEC稳定交付后验证双loopback A→B运行期切换、在途旧profile绑定、tenant/context/config/prompt/schema回执身份、并发单飞、unknown不重发、无静默mock/外网回退、费率未知如实标记、真实LangGraph路径与实际开销。修复前createAssistantModel只在创建时读配置，运行期热切换未实现；本轮没有热切换成功证据。内网验收按最新决定后置，Dify不在当前主线。
5. 恢复需用户/CTRL新的具体To Do；先确认TEC稳定hash及唯一writer，再复验失败反例与相关回归，最后由CTRL安排Front冻结后的页面/人工验证。本轮无后台任务继续运行。
