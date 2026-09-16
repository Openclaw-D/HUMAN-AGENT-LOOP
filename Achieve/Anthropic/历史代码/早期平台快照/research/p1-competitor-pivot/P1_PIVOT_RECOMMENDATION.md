# P1 重大转向建议：保留自研最小控制内核，复用边缘能力

状态：研究建议，不实施，不替代 `P1_V2_PRODUCT_FREEZE.md` 的用户/主控最终 Gate。依据：`DIRECT_COMPETITOR_VERDICT.md`、`COMPETITOR_CAPABILITY_MATRIX.md` 及公开一手证据。

## 三选一建议

| 选项 | 判定 | 原因 |
| --- | --- | --- |
| 复用现成核心并本地化 | 不建议 | 没有一项公开候选被证实同时有七项门槛；买/接入其产品只能覆盖部分边缘能力 |
| 组合多个开源底座 | 不建议作为 P1 主线 | RAG/Agent/工作流可以组合，却会留下最关键的 Work/版本/责任/Gate/receipt/event 语义；Dify/FastGPT/MaxKB 的许可也增加组合约束 |
| **保留自研内核但复用局部** | **建议** | 把唯一差异放在可验证的状态与控制；将模型、RAG、IM、审批、研发 Agent 变成替换性 adapter |

此建议是**证据推断**，不主张从竞争产品“抄功能”。它的目标是及时止损：不再把 P1 的价值押在“多 Agent 聊天/编排”这个已高度拥挤的层，而验证“受控的、可恢复的企业协同事实”。

## 对 V2 冻结的逐条处置

| V2 冻结项 | 处置 | 依据与边界 |
| --- | --- | --- |
| 十场景与 ScenarioPack | **保留，延后 9 个完整实现** | 十场景仍是压力测试集合；P1 先用风控业务协同验证内核，不把其余九个写成装饰性样例 |
| 单一权威 Projection 与三视图同源 | **保留** | 这是公开候选未证明替代的核心；关系/进度/矩阵应读取同一 event-derived snapshot |
| `Work/目标版本/参与者/责任/证据/质疑/Gate/动作/回执` | **保留并冻结为最小内核** | 是 seven-gate 的承载对象；不从 Agent builder 的 App/Workflow schema 借名替代 |
| 结构化 handoff/context package | **保留** | 不能降级为普通聊天摘要；每次交接必须含对象、版本、待办、证据、权限、风险、接收人/结果 |
| 人工 Gate、禁权与 `unknown` | **保留且优先** | 这是与 coding/Agent builder 的关键分界；无 receipt 不得显示成功 |
| 右侧聊天 + 接续台 | **保留但缩小** | P1 只呈现选中 Work 的阻塞、下一步、权限、handoff、Gate、证据、模型运行，不做通用 IM |
| 模型显式运行与 `none/propose` authority | **保留** | 模型 provider 可替换；不将外部 Agent team 当作业务决策者 |
| 关系视图 | **保留为最小可操作读模型** | 只画当前 Work 的责任、证据、Gate、风险和 action/receipt，不追求大图谱产品化 |
| 进度视图 | **保留为默认主视图** | 首个场景必须演示补证→复核→Gate→动作→receipt/unknown 循环 |
| 矩阵视图 | **延后为只读切片** | P1 先证明同源字段和单元格下钻；不做跨十场景聚合/效率评分 |
| 1920×1080 全中文视觉 | **保留** | 这是用户验证的体验要求；不复制竞品 UI |
| 飞书/钉钉/企业微信连接器 | **替换为一个可插拔上游 adapter，延后真实生产连接** | 先验证 identity/Gate/receipt 契约；没有客户授权不接真实组织数据 |
| RAG/知识库 | **替换为可选 Evidence adapter** | 可从 RAGFlow/Dify 等学习或集成；证据版本/适用范围仍归见微内核 |
| 多 Agent 团队 | **替换为 provider-agnostic `AgentRun` adapter** | 可接 CodeArts/Qoder/AgentScope 等，但不得由其直接改变权威业务状态 |
| 全量十场景后端、真实 connector、部署认证 | **延后** | 没有 P1 product acceptance 与客户约束前，不能用工程体量冒充产品验证 |

## 新的最小纵向闭环

以“风控业务协同—补证到资金动作回执”为唯一 P1 验证闭环：

```text
创建 Work@目标版本
  → 分配人/Agent 的受限 Authority
  → 请求模型 Proposal 或 Evidence（显式触发）
  → 结构化 Handoff 给具名复核人
  → 人工 Gate 以版本与证据作决定
  → 请求外部 Action（幂等）
  → Receipt=confirmed / unknown
  → event replay 生成同一 Projection
  → 进度主视图 + 关系切片 + 矩阵单元格 + 右侧接续一致显示
```

必测负向路径：无权限、旧版本 Gate、重复 action、connector 超时、重启、交接给无资格主体、模型声称“已批准”、receipt 缺失。任一项不得伪造成功。

## 任务依赖与停止 Gate

| 顺序 | 任务 | 依赖 | 可验收输出 | 停止条件 |
| --- | --- | --- | --- |
| 0 | 主控/用户产品 Gate | 本研究 | 确认是否接受“自研内核+局部复用” | 用户不同意转向或首场景改变 |
| 1 | 最小内核契约 | 0 | Event/Command/Projection/Handoff/Gate/Receipt 的 V2 schema 与拒绝语义 | 对象语义或权限模型仍未冻结 |
| 2 | 单场景 ScenarioPack | 1 | 风控流程与至少五个负向事件序列 | 需要接真实敏感系统或无法定义 Gate owner |
| 3 | 假 adapter + replay | 1、2 | confirmed/unknown/重启/幂等的 event replay 测试 | 必须使用真实凭据或出现数据授权问题 |
| 4 | 三视图最小读模型 | 3 | 一份 snapshot 驱动三视图和右侧选择上下文 | 前端需要另建 local state 才能演示成功 |
| 5 | 受控模型/IM/审批 adapter spike | 3 | 只读/假 adapter 对齐授权、审计、错误与取消语义 | 供应商许可/数据出境/付费登录未获授权 |
| 6 | 第二、第三场景压力测试 | 4、5 | 证明内核不被研发/客服等不同责任语义击穿 | 需要改写内核而非 ScenarioPack 时回到 1 |

## 不变的产品声明

见微不是“又一个多 Agent 平台”或“企业聊天/审批替代品”。它只在可证明的范围内主张：把既有身份、模型、Agent、工具、证据与企业系统放到一个**可恢复、可控、可审计的协同 Work**上，并在关系、进度、矩阵中呈现同一事实。

## 未决问题

- P1 的外部 action 是否必须真实执行，还是先用假 adapter 验证 receipt/unknown？这需要主控决定。
- 首个企业入口选飞书、钉钉还是企业微信？需要目标客户与访问授权，不能凭市场热度选择。
- 是否引入任何开源 RAG/Agent 代码？先通过 `CODE_REUSE_AND_LICENSE_MAP.md` 的逐仓库 Gate。
