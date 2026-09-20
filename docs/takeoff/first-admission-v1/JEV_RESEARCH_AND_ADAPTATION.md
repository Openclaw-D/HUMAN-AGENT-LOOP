# TypeSafe / Jev 研究与JW适配提案

核查日期：2026-09-20。状态：研究及实施提案，不替代TAKEOFF-FA-1.0.0，不表示Jev已接入或付费调用获授权。未改在制产品源码，未安装SDK，未读取Key。技术实施由原ZCode writer接续。

## 结论

高度契合的是原子判断、结构化输出、代码组合、按需升级的工程方式。Jev可以成为可替换的快速语义判断组件；不能承担JW的权限门、规则门、授信计算或人工确认。先验证中文小任务，默认off，离线mock通过后，在明确数据与预算授权下shadow评测；shadow只记评测结果，不改变业务办理。

## 已核实资料与限制

| 项目 | 证据与判断 |
|---|---|
| 产品 | 官方2026-09-15宣布System One和首个公共模型Jev；输入state和typed questions。RLCD与速度优势为厂商声明。[S1] |
| 类型 | Choice返回选项/分布/confidence；Score返回等级期望/分布/confidence；Noul返回yes概率，无独立confidence。[S2/S3] |
| 工程 | POST https://api.typesafe.ai/v1/systemone；官方JS SDK @typesafe-ai/sdk，支持Node20+，与本项目Node22匹配。不是替换chat/completions的URL即可接通。[S3/S4] |
| 当前模型 | jev-1.13.0；latest/preview会移动，评测须锁定版本并记录实际返回模型。官方价格$0.042/百万输入token、输出免费；64k总请求、state+最长问题32k；限流会变，调用前再核对。[S5] |
| 输入与语言 | 仅文本/文本结构，不处理原始图像音视频；英文表现最好，中文等语言须实测。不能替代扫描件OCR。[S5] |
| 已知弱点 | 数学、日期比较、多跳、无关长上下文、对抗文本；类型正确不能证明语义正确。运算留在代码，不把Score插值当精确金额。[S6] |
| 置信度 | confidence由返回分布计算，不是信用违约概率，也不等于原件核验等级。阈值需本任务校准，不能照抄0.9。[S7] |
| 评测强度 | 官方四工作流以强模型共识为参考，并假设工作流正确；不是租赁专家标注，更不是中文回租风险验证。193.6x/444.6x不能当JW收益承诺。[S1/S8] |
| 开放程度 | 已核实公开MIT客户端及Python LLM对照adapter；本次未找到Jev权重或可复现RLCD训练实现，不能把SDK开源称为模型开源。[S4/S9] |
| 数据 | 隐私政策承诺不以输入训练，说明美国托管和保留安排；不等于所有账号零保留。模型文档提企业ZDR，具体账户需另核对。本轮只允许未来获授权的合成数据测试。[S5/S10] |

搜索覆盖官网发布/文档/API/模型限制/公开评测、官方GitHub、社区SDK与评测工具、公开讨论。技术结论以上述原始资料为准。非官方同名站及社区重复宣传不作为官方API或性能证据；未做全网穷尽声明。社区jevcal可参考分离校准集/验证集和统计方法，不安装为本轮新依赖，其LLM标签仍不是业务真值。[S11]

## 与现有后端的对应（本轮源码定向读取）

| 现有接缝 | 适配职责 | 边界 |
|---|---|---|
| Back/B/src/runtime.mjs、transport/glm.mjs | 另加typed decision provider，通过既有授权/预算/回执纪律调用 | 不替换当前聊天transport；配置显式注入，不自行扫描环境找Key |
| Back/B/src/domains/four-domain-tools.mjs | 可调用独立建议工具，记录authority=none及版本 | 当前fd工具是确定性calculation；不能把外部推理伪装成原计算工具 |
| Back/B/src/schedule/recalc-planner.mjs | 对比模型建议域与现有依赖调度 | shadow不能删减既有必跑域，不能漏重算来制造提速 |
| Back/C/domains/pipeline.mjs及规则/amount | 保留确定性算术、日期、硬规则与方案组合 | 不用Jev分数算金额/期限/价格，不让模型修改政策 |
| Connectors处理链 | 生成最小证据切片及版本引用，消费观察记录 | 不重上传，不自动升级verified，不把模型标签变原件事实 |
| A确认/Gate、Edge/Front | 首阶段保持不变 | 不新增审批权，不改二十格业务状态，不影响当前T01–T14收口 |

## 第一切片：三个窄问题

1. 材料类型建议：在既有kind词表内分类，明确other/insufficient，不覆盖原声明和权威绑定。
2. 分域相关性建议：对business/policy/credit/commerce/asset分别问“这段材料是否包含与该域相关的信息”，允许多域。旁路与既有依赖映射比较，禁止用单选域遗漏交叉风险。
3. 两条已定位声明关系：consistent/conflicting/not_comparable/insufficient；只比较具体主体/设备/期间明确的片段，数值与日期先由代码规范化。输出是待核验线索，不直接冻结或解冻。

不问“是否批准”“贷多少”“产权是否真实”“违约率多少”。Jev也不生成解释段落；解释由固定问题说明＋真实片段引用组成，必要自然语言仍走既有受控生成模型。

## 拟议内部契约（非已部署API）

请求：tenantId/customerId/assessmentId、inputVersion、evidenceRefs及excerptHash、questionSetVersion、modelVersion、ruleVersion、purpose、mode、budgetRef、deadline。

响应：status=ok|abstained|unavailable|unknown|invalid；typed answers；provider及actualModel；questionSetVersion/inputVersion/evidenceRefs；usage/costKnown/attemptCount/durationMs；authority=none；mode=shadow。

引用由调用方绑定输入来源，不能声称Jev自行生成了精确证据引用。question key只是标识，官方API说明不会作为问题语义送入模型，必须把完整条件写进instructions/criteria。省略概率不能补0；Noul=0.5不能直接解释为“证据未知”，数据缺失由输入完整性规则或明确insufficient选项处理。

响应校验覆盖问题ID、枚举、类型、有限数、范围、分布完整性/容差；不默默归一化坏分布掩盖协议错误。缓存键含租户/客户/评估、输入/片段hash、问题/规则/模型版本，禁止跨客户复用业务结果。旧结果只留评测，不应用到新版本。

## 分阶段验收

J0 接缝冻结：03确认实际调用链（B worker或Connectors直接调C），不假定生产请求一定经过B；off模式0出站，关闭后原行为相同。

J1 无网契约：mock覆盖三类响应、异常、缺字段/NaN、未知枚举、超时/429/529、取消、预算耗尽、重复及迟到。所有结果无权威业务写入；同号逻辑去重不代表供应商计费幂等。SDK自动重试须关闭或每次实际尝试都进入预算门，避免一次预占多次收费。

J2 数据集：建议首批60–100条纯合成中文样本用于可行性筛查，不据此宣称生产可靠。覆盖否定/引用/未知、混合文种、权属仅声明、重复、不同主体同名、日期单位、恶意指令；对应英文版本用于诊断，不擅自翻译真实材料。标签人工确认；按模板/来源分组划分调参与保留集，防近重复泄漏。

J3 获授权的真实shadow：锁模型/问题/数据集，对照当前确定性方法及可用已授权模型。所有额外LLM/翻译调用计入预算，不能因Jev便宜而忽略其他成本。统计逐类精确/召回、漏检、abstain比例、采纳准确率与覆盖率、概率校准（Brier/ECE及样本量）、P50/P95端到端耗时、总成本/有效样本。无足够标签则校准NOT_RUN，不凭模型自信补结论。

J4 启用决定：先提交中文可行性与收益证据；未满足预先约定质量/漏检目标或无明确收益则保持off/shadow。未经后续确认不改为业务在线路由。任何阈值按问题/模型/语言/样本分布登记，不设全局魔法阈值。正式Gate、权限和人类确认永不由本组件替换。

## 资料索引

- S1 https://typesafe.ai/blog/introducing-system-one-models-and-jev
- S2 https://docs.typesafe.ai/introduction
- S3 https://docs.typesafe.ai/api
- S4 https://github.com/typesafe-ai/typesafe-sdk-js （及src/client.ts）
- S5 https://docs.typesafe.ai/models
- S6 https://docs.typesafe.ai/model-jaggedness/jev-1.13
- S7 https://docs.typesafe.ai/confidence
- S8 https://evals.typesafe.ai/ （另读customer_service）
- S9 https://github.com/typesafe-ai/system-one-adapter-python
- S10 https://typesafe.ai/legal/privacy-policy 和 https://typesafe.ai/legal/data-processing
- S11 https://github.com/abhixhek/jevcal （社区，非官方，未安装/运行）
