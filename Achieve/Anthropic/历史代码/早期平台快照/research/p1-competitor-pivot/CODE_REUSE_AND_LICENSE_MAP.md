# 代码复用与许可证地图

访问日期：2026-08-27。本文是工程风险提示，不是法律意见；“可复用”仅指许可证文本表面允许的工程方向，接入前应由法务/采购对精确 commit、全部依赖、NOTICE、商标、部署模式和商业条款复核。

## 结论

不要把“公开可读”“可下载二进制”“可在企业账号使用”误认为可嵌入或再分发。当前最稳妥路径是：**自研见微业务内核；仅按明确许可证复用低耦合 adapter/SDK/RAG 组件；不复制任何闭源 UI、商标、云服务协议或未公开实现。**

## 可复用代码库

| 仓库与访问版本 | 许可证/证据 | 可评估复用层 | 不可当作可复用层 | 修改/商用/再分发与 notice 风险 |
| --- | --- | --- | --- | --- |
| [openai/codex](https://github.com/openai/codex)（`main`，2026-08-27） | Apache-2.0，[LICENSE](https://github.com/openai/codex/blob/main/LICENSE)；[E01] | CLI session、事件输出、沙箱/approval 配置的实现思路；SDK/协议封装 | Codex App/Web 服务、品牌、账号体系、企业工作台与任何未公开编排 | Apache-2.0 通常允许修改/商用/分发，但须保留 LICENSE、NOTICE（如有）及版权/专利条款；逐文件查第三方依赖 |
| [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python)（`main`） | MIT，[仓库](https://github.com/anthropics/claude-agent-sdk-python)；[E25] | SDK 调用封装、示例中的 Agent orchestration 习惯 | Claude Code 本体：其 LICENSE.md 写明 all rights reserved/受商业条款约束 [E21] | MIT SDK 需保留版权与许可；模型服务/商标/Claude Code UI 不随 SDK 获得 |
| [infiniflow/ragflow](https://github.com/infiniflow/ragflow)（`main`） | Apache-2.0，[LICENSE](https://github.com/infiniflow/ragflow/blob/main/LICENSE)；[E18] | 文档解析、检索、RAG adapter；作为证据/知识层候选 | 见微的 Work、责任、Gate、回执、三视图 | 保留 Apache LICENSE/NOTICE；部署依赖与模型连接器另审 |
| [geekan/MetaGPT](https://github.com/geekan/MetaGPT)（`main`） | MIT，[LICENSE](https://github.com/geekan/MetaGPT/blob/main/LICENSE)；[E20] | 多角色 prompt/消息抽象的参考或隔离试验 | 企业身份、授权、审计、可恢复状态 | 保留 MIT notice；不把“软件公司模拟”宣传成企业控制系统 |
| [OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev)（`main`） | Apache-2.0，[LICENSE](https://github.com/OpenBMB/ChatDev/blob/main/LICENSE)；[E34] | 角色通信/任务拆解实验代码 | 生产级权限、审计、长任务恢复 | 保留 Apache LICENSE/NOTICE；研究代码的安全性和依赖不自动达标 |
| [agentscope-ai/agentscope](https://github.com/agentscope-ai/agentscope)（`main`） | Apache-2.0，[LICENSE](https://github.com/agentscope-ai/agentscope/blob/main/LICENSE)；[E35] | Agent/消息/可观测 adapter 的候选 | 业务 event sourcing、人工 Gate、企业 RBAC | 保留 Apache LICENSE/NOTICE；将工具执行放到见微策略层而非 SDK 默认行为 |
| [1Panel-dev/MaxKB](https://github.com/1Panel-dev/MaxKB)（`v2`） | GPL-3.0，[LICENSE](https://github.com/1Panel-dev/MaxKB/blob/v2/LICENSE)；[E17] | 更适合进程外部署/接口集成，而非复制源码 | 直接复制/链接入闭源或拟商业内核 | GPL 的衍生作品义务与网络部署边界需法律判断；未经法务批准不纳入见微代码 |

## 有附加条件：不按“普通 Apache/MIT”处理

| 仓库 | 官方许可证事实 | 允许的谨慎用途 | 禁止的默认假设 |
| --- | --- | --- | --- |
| [langgenius/dify](https://github.com/langgenius/dify) | LICENSE 是“modified Apache-2.0”；多租户 SaaS 需书面授权，前端 LOGO/版权信息不得移除或修改，交互设计受外观专利保护。[E15] | 进程外单租户部署、API 集成，或经商业授权后的方案 | 不能把它当无条件 Apache；不能复制/白标其 `web/` 前端或交互 |
| [labring/FastGPT](https://github.com/labring/FastGPT) | FastGPT Open Source License：可作 backend 商用，但类似多租户 SaaS 需授权，未经商业授权的商用服务需保留版权信息。[E16] | 进程外单企业部署、API/插件集成或取得授权 | 不能白标 UI、不能将源码作为多租户 SaaS 核心直接发布 |
| [mannaandpoem/OpenManus](https://github.com/mannaandpoem/OpenManus) | 本次访问仓库元数据为 `license: NONE`，根 `LICENSE` 路径 404。[E19] | 仅可阅读思想、独立重写 | 没有许可不等于可复制、修改或再分发；默认不引入源码 |

## 闭源或服务能力：只能学习/购买/集成

| 项目 | 可以做 | 不可以做 |
| --- | --- | --- |
| Codex App/Web、Claude Code、Qoder、Trae、扣子、通义灵码、百炼、钉钉、CodeBuddy、腾讯云智能体、Comate、CodeArts | 依据各自合同/开放 API 购买或接入；学习公开文档中的问题分解、权限和可观察性设计 | 复制 UI、标识、云端服务实现、未公开协议；把账号可用权解释为源码再分发权 |

## 见微的工程许可 Guardrail

1. 引入任何代码前，记录仓库、commit/tag、许可证全文、NOTICE、依赖 SPDX 清单、用途与替代方案。
2. Apache/MIT 复用也必须保留版权/许可证/NOTICE；不能删掉上游声明或混同自研代码归属。
3. GPL/自定义许可/无许可仓库先停在“阅读或隔离部署”，不得拷贝进入见微内核。
4. 外部 Agent/RAG/IM 连接器的输入输出只可产生 Proposal/Artifact；是否改 owner、过 Gate、执行外部动作仍由见微自研策略和事件链决定。
5. 不将第三方产品截图、logo、配色、交互文案或商标放进最终作品展示。

## 事实、推断、假设

- **事实：**许可证文本与仓库状态来自链接的官方仓库，访问日为 2026-08-27。
- **证据推断：**“进程外集成优先”由许可证不确定性、产品耦合度和 P1 需要保留内核边界共同得出。
- **假设：**见微未来可能商业化/多租户；若仅单企业内部部署，Dify/FastGPT 的实际风险范围仍须按许可文本核验。
