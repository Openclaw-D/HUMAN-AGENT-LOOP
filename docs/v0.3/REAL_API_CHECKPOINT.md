# 真实API检查点 · 2026-09-20

CTRL执行；只用合成材料，无审批、资金、提交或发布操作。

## 已实际完成

- 三客户真实A建档、信审cred1建立collecting评估，申请200/500/1000万元来自case-index/D01。映射见 `.local/v03-recovery/case-runtime-map.json`。
- 每客户上传D01/D02/D11，共9原件，sourceMode=synthetic；真实邀请、上传、解析、A桥和9个原件SHA256白名单。
- policy1仅政策角色，tt1；真实登录200。A/Connectors/Edge均已受控重载，数据与账本保留。
- 两次Node直连结果未知，原回执与个人pending保留，不更换ID绕过重发。无推理HEAD另复现UND_ERR_CONNECT_TIMEOUT。Edge采用Node的环境代理，loopback保持直连；复用环境已有代理，无凭据输出。
- GLM-5.2返回曾被2000输出token耗于推理截断；依据官方文档 https://docs.bigmodel.cn/cn/guide/capabilities/thinking 配置thinkingType=disabled，并纳入配置身份。总正文显式配置12000字符，仍受分片和上限约束，不声称整本材料均进入模型。
- 单层JSON代码围栏解析已兼容；不从任意文字中截取JSON，引用与候选验证未放松。
- 有效当前结果：塑料cred1/credit（4建议，4326token）；金属policy1/policy（3建议，3549token）；棉纺policy1/policy（3建议，3922token）。每项均有有效本次引用；真实API通过不等于业务质量最终接受。
- 塑料候选select→读回→undo→读回均200，最终撤销。随后同scope再读仍current/valid=true，revision8。
- 显式unlimitedTotalCost=true，旧maxCalls与maxCallsPerSession按已有“省略即无限”语义移除。保留单并发1、2000输出token上限、60秒请求超时、单账本与未知不重发。账本actual.amount是超过预占的差额，不等于供应商账单总额；不将0差额报成免费。
- 原件信封不再写material:<kind>事实键。旧纯Connector信封按严格字段白名单从同键冲突计算排除，真实业务同键断言仍冲突，旧记录不删除。
- preview增加sourceGroup，供已批准案例原件名称回显。不是通用原始filename字段，不能对未知来源组猜名称。

## 验证

预算10项通过；JSON围栏+模型/缓存40项通过；上下文/证据20项通过；A独占PG读面7项通过；Connector桥接1项通过。Connector处理回归12/13通过，唯一失败为旧断言仍将仅含PDF头/EOF的损坏PDF视作不支持格式；PDF.js已支持PDF，正确应PARSE_FAILED，修正后该用例定向通过（未重跑其余已过项）。前置测试管理库缺失日志已保留，未操作共享业务库。

证据均在 `.local/v03-recovery/`：真实请求响应、feedback验证、定向测试日志、源码SHA256；运行配置备份在Git忽略目录，不提交。自建隔离QA容器已停止，未停止他人资源。

## 未完成

三案例仅3原件/客户，不是全量；五专业共享domain-results尚未接通真实模型，个人候选不得冒充共享专业办理成果。原件通用filename元数据、稳定重启代理配置持久化、完整两轮补证失效闭环、真实性能统计与人工最终接受未完成。

FRONT已独立实际验政策入口、500万元与真实PDF；候选初次打开异步anchor误判由FRONT修复。稳定窗口最终交回：cred1塑料4候选、policy1金属3候选、policy1棉纺3候选首次进入均可读；三原件名称、金属D01中文PDF及500万原文视觉通过。这是FRONT独立验收，用户最终接受仍未记录。窗口已释放，尚未追加全量材料。

后续五专业真实共享编排属于稳定中大型后端实现，按当前AGENTS单包交ZCode，见 ZCODE_REAL_MODULE_HANDOFF.md；CTRL未自动派工，未新增任务。真实费用和共享运行集成仍由CTRL单点执行。

## 条件化路径样例实测
按FRONT给定问题单次真实GLM：棉纺policy1/policy，v03-textile-policy-path-001，3939token、5项引用有效建议，current/valid=true。语义仍为核验行动，并非未来状态预测；现有服务端提示词限定核验补证行动。不得只因问题文本含预测而重标输出为未来状态概率。未修改正式状态、未重复调用；需冻结最小任务语义修订后再验。
