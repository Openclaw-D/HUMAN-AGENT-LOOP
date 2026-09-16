# 见微 V4-LIFE 收敛 Roadmap

状态：`P0 ACTIVE / FOUR-DOMAIN COMPONENT / PLATFORM FIT OPEN / NO IMPLEMENTATION AUTHORITY YET`

最后更新：2026-09-03

本路线图先收敛产品权威，再按后端优先进入契约、实现、联调和比赛表达。完成文档、产生代码或模型自报完成都不等于用户接受 Gate。当前交付时间箱约两周半；时间紧只允许缩小 Golden Case，不允许删除 authority、安全、失败关闭与可追溯性。

## P0｜产品方向与 Root Authority 收敛（当前）

唯一目标：形成并由用户接受一份完整 P0 产品宪章。最新已把全生命周期与六角色方案收窄为“业务送入上游项目 Context，首期只做政策、信审、商务、资产四域轻量协同组件”，并冻结 `REUSE FIRST / NO WHEEL`、Capability Graph 可编排、Authority Graph 不可拖动。当前还需核验 Dify/既有系统/成熟平台能承担什么，以及最小差异组件还需补什么。

可见产物：`NORTH_STAR.md`、`DECISIONS.md`、`CHALLENGE_LOG.md`、`versions/V4/P0_PRODUCT_CHARTER.md`、`versions/V4/P0_DIRECTION_QUESTIONS.md`、本路线图。

验收问题：产品宪章能否无矛盾地回答“为什么只做四域、业务如何送入 Context、哪些能力复用、哪些差异必须补、可编排能力如何不改变权力、首先创造什么风险价值”？

退出 Gate：P0-E 完成一次成熟平台能力核验，用户随后整体接受 `P0_PRODUCT_CHARTER.md` 中 P0-A 至 P0-G；根部权威同步后，P0 才结束。Golden Case 从 P1 起用于检验宪章。用户未接受前，不进入 P1，不画灰阶图、不进入前后端实现、不包装决赛 PPT。

## P1｜宏观 Operating Model

唯一目标：用一个狭窄 Golden Case 检验业务协同接口与政策、信审、商务、资产四域的关系。项目 Context 从既有受理/尽调结果进入，重点证明跨域 work item 可以按 Evidence/Receipt 依赖穿插并行；不展示商机、客户、尽调流程，也不展开全生命周期对象体系。

必须回答：

- 四域中的哪些对象是 Human authority，哪些只是能力；
- 哪些工作可并行准备，哪些动作必须等待正式批准；
- 否决、退回、例外和跨阶段协助如何保持一致；
- 业务输入如何引用上游事实且不复制客户/项目权威数据；外部输入如何保持内部核验 Gate。
- 政策、信审、商务、资产四个专业域如何共享事实与 Candidate，同时保留独立责任；
- 资产贷后事件如何向前反馈政策、信审，但不重排正式生命周期。
- 哪一项 Evidence 能同时触发两个无依赖专业 work item，哪一项正式动作必须等待特定 Receipt；不使用“整个阶段完成”作为默认依赖。

Gate：能够用一条宏观链路说明谁负责、谁支持、谁能阻断；不存在模型越权或外部信息直穿。

## P2｜风险与贡献评价模型

唯一目标：将“风险发现/拦截”“经营结果”“稳定产出”“响应与协作”“历史积累”拆成可解释的评价维度。

必须回答：

- 项目未起租时，哪些贡献仍被认可；
- 高/中/低风险如何决定 Human Gate 强度；
- 资深员工如何减少不必要摩擦，但不自动获得越权权限；
- 指标如何避免只看数量、速度或模型生成的单一分数。
- 小样本逾期预测如何回测、校准并在无增益时停止；
- 律所等服务供应商如何校正案件难度，避免以原始回款率制造逆向激励。

Gate：至少用一个“政策否决但专业贡献成立”的 Case 验证评价不会归零。

## P3｜最小业务与后端契约

唯一目标：在 P1、P2 被接受后，先完成平台能力差距表，再只冻结四域差异所需的 Project Reference、Actor、Evidence、Version、Candidate、Decision、Receipt、Contribution 和依赖取消契约。

范围包括：最小项目引用、Evidence、WorkItem、Dependency、Candidate、Decision/Receipt、Projection，四域风险分层、例外流程、资产多模态 Evidence、成熟编排平台适配和必要追加式记录；不包含商机、客户、尽调、CRM/BPM 或通用编排器契约。

Gate：schema、state transition、authority、persistence、idempotency、failure path 和 evaluation 均可验证；内网编排平台故障不能破坏权威状态；算力路由具有 SLO、计量和回退；旧 `docs/v4/**` 与新权威完成差异审计。

## P4｜后端核心与真实模型网关

唯一目标：只实现平台差距表证明无法复用的最小 vertical slice，覆盖四域 Evidence、Candidate、Human Gate、Decision/Receipt、依赖停止、贡献保留和资产反馈；若成熟能力已满足，则以配置和 adapter 交付，不为“有代码”而自建后端。

范围只包括真实缺口对应的持久化/引用、幂等、认证边界、审计、模型 adapter、失败关闭和稳定 Projection API。已有系统能力通过验收时直接复用；允许使用最小只读 Control Surface 观测，不建设通用工作台或画布。

进入条件：用户明确接受 P0–P3 的产品、Operating Model、评价边界和 exact backend contract。

Gate：真实 API、状态、持久化、权限、幂等、失败关闭、恢复、模型降级和可重放 Golden Case 全部有自动化证据；模型不可用不会伪造成功或破坏正式状态。否则不得进入正式前端。

## P5｜响应式前端、联调与部署

唯一目标：在已经通过 Gate 的平台组合之上补齐必要业务入口、四域工作面和大屏 Projection，并部署一个受控小微项目的真实 E2E。

范围包括：业务短输入、四域交互、响应式适配、约十米远距可读、单一 canonical 大屏镜像、只读二维码伴随页、真实 API 联调、loading/empty/error/success/stale/retry、网络与模型降级。

Gate：业务入口、四域工作面和大屏读取同一权威状态；Golden Case 在真实浏览器、部署域名和目标 viewport 中通过；公开免登录面不访问内部数据或正式写路径；故障路径与恢复同样通过。

## P6｜决赛领导表达

唯一目标：从已验证的 canonical model 生成领导可复述的极简 Projection、PPT 和约 10–13 分钟核心内容；其中约 5 分钟讲清政策、信审、商务、资产四域协同，其余用于问题、价值、受控编排与落地边界。

Gate：表达足够简洁，但不声称未实现能力，不删除 Human authority、风险增强和制度连续性；在实际大屏、约十米观看位置、会场网络、微信内置浏览器和投屏链路完成 full rehearsal。

## 当前压缩时间预算（Candidate）

- 今晚：完成 P0 整体接受与 Root Authority 冻结；
- 随后约 2–3 天：压缩完成 P1、P2 和 P3 的 Golden Case、评价边界与 exact backend contract；
- 随后约 7 天：P4 后端核心、持久化、模型网关、失败路径与自动化 Gate；
- 随后约 4 天：P5 Mobile/Web/大屏、部署和真实 E2E；
- 最后约 3–4 天：稳定性修复、现场全链路彩排、PPT 和最终脚本。

这只是初始资源预算，不是按日期自动放行。某个 Gate 失败时先缩小 Golden Case，不把未完成后端转移成前端假数据。
