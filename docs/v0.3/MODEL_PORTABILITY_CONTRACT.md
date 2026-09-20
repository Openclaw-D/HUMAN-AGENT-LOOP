# V0.3 模型接口可切换契约

2026-09-20｜用户新增硬要求｜CTRL独占writer｜状态：需求冻结、实现待核。不是已经热切换完成的声明。

目标：开发环境可用获准外部模型，进入内网后通过服务端配置/适配器切换到获准内网模型；真实请求和业务闭环继续运行，页面不携带提供方密钥，不依赖虚假成功或预置回复。

最新顺序覆盖：用户曾提供“Dify应用API”，但随后明确性能优先、暂不考虑内网，并最终指定LangGraph/LangChain、不要Dify。当前不实现Dify adapter、不依赖Dify运行；先完成LangGraph实际路径、受控transport、性能与切换机械行为。内网端到端验收保留为后续目标。LangGraph/LangChain是编排/应用组件，profile仍需描述真正的模型提供方协议。

## 不变部分与变化部分

- 不变：前端同源业务API、客户/证据权限、业务状态、输出候选语义、人工确认、任务与证据归属。
- 变化：provider adapter、base URL、模型标识、认证引用、超时、输入/输出限制、能力、费用/用量口径与允许出站域。
- 内网接口协议未知，待用户/技术人员确认。OpenAI-compatible、Dify应用API等属于不同协议；不得用名称相似当兼容证明。
- 前台保持角色直达，不增加普通业务人员的服务地址或密钥设置。配置加载/切换属于受控管理面，不能让材料或模型输出修改配置。

## Profile候选字段

profileId、revision、adapterKind、endpoint、model、credentialRef、timeoutMs、maxInputChars、maxOutputTokens、capabilities、allowedHosts、networkMode、pricingStatus。秘密通过既有服务端机制引用，不能出现在前端、代码仓库、回执或审计中。是否需要额外字段按真实内网协议冻结。

业务调用只依赖统一结果：status（succeeded/failed/unknown）、sent、requestId、profileId/profileRevision、configFingerprint、contextHash、observations、questions、evidenceRefs、usage、costStatus、error。模型输出仍authority=none，不能用成功HTTP代替输出校验。

## 热切换行为

1. 加载候选profile，验证协议/地址/认证引用可用性、超时、预算、出站规则；敏感值不回显。
2. 验证不通过不激活，返回清晰错误；不会替换成mock、继续偷偷使用旧服务或转外网。
3. 显式激活原子更新active profile revision；所有新请求捕获新revision。旧在途请求保留旧revision，回执记录其实际服务，不能中途被新配置覆盖。
4. 请求/回执身份至少绑定tenant、customer、有效上下文hash、问题、助手、profile/configFingerprint与prompt/schema版本。相同材料在不同模型/配置下的回答不得误命中旧回执。
5. 已发送但未取得明确结果维持unknown，切换接口不是自动重发许可。相同并发请求须单飞或租约保护，不能只靠先查后写的非原子去重。
6. 回退是明确激活前一profile并留审计；不自动把内网请求转到外网。networkMode=internal时拒绝非获准外部地址，禁止带出不获准数据。

本契约要求运行期切换，无需改业务代码。若当前只能修改配置后重启，应明确记为“配置可替换，运行期热切换未实现”，不能降格替代用户目标。

## 必需验收

| 用例 | 证据 | 判定 |
|---|---|---|
| 外部profile A真实调用 | 真实提供方响应、模型/配置指纹、调用时间、状态/用量、业务展示 | 不能用mock计为真实成功；优先复用既有获准证据但核对版本 |
| 运行期A→B切换 | 两个独立loopback HTTP服务实际收到不同请求；B新请求、A在途请求各自正确返回 | 本地真HTTP证明切换机械行为，不证明内网模型可用 |
| 配置变化与回执 | 同客户/问题切换profile后不错误命中旧答；同profile同输入幂等 | 明确actual context与配置hash |
| 非兼容/认证失败/无服务 | 返回真实失败，不落mock成功；原件与人工流程可用 | 零虚假成功 |
| 超时/未知后切换 | 原unknown保留；不自动再发；费用未知如实标记 | 不把超时记零费用 |
| 内网断外网 | 内网profile无外网依赖；外网地址被拒；真实内网请求成功 | 仅内网环境实测可通过 |
| 端到端业务 | 获准合成材料→受控模型→引用校验→辅助结果→人工决定；刷新可追溯 | 权限与正式业务不变量保持 |

原始记录至少包括时间、测试/真实模式、profile revision、输入hash、调用次数、tokens、耗时、错误及收费是否已知。不要保存秘密或未获准原文。费率未配置/未知时不能默认费用0。

## 执行归属

TEC给出已有transport差距并按CTRL冻结范围直接实施普通中小规模后端任务；EVAL负责离线真HTTP和故障反例设计及独立复验；FRONT只消费统一状态，不硬编码任何provider。CTRL协调共享文件与放行，禁止多个writer同时改Edge/B。内网环境缺失只阻断后续真实内网验收，不阻断适配契约、本地切换与现有页面工作。
