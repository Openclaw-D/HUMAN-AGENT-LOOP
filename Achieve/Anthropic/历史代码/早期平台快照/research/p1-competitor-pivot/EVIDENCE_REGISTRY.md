# 一手证据登记册

访问日期统一为 **2026-08-27**。技术事实优先官方文档/官方 GitHub；市场/产品事实优先厂商官方页面。短释义为研究者概括，不是长篇原文摘录。`A` = 官方一手且直接，`B` = 官方一手但只覆盖局部，`C` = 官方入口存在但本次未取得门槛级细节；C 不能用来宣称能力。

## OpenAI 与 Anthropic

| ID | 标题与 URL | 发布方 | 等级 | 短释义 |
| --- | --- | --- | --- | --- |
| E01 | [openai/codex README](https://github.com/openai/codex) / [LICENSE](https://github.com/openai/codex/blob/main/LICENSE) | OpenAI GitHub | A | 明确是本地 coding agent，并区分 CLI、desktop app、Codex Web；仓库为 Apache-2.0。 |
| E02 | [Codex CLI features](https://learn.chatgpt.com/docs/codex/cli) | OpenAI | A | 官方功能页列出 resume、subagents、AGENTS.md、record/replay 等入口。 |
| E03 | [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) | OpenAI | A | `codex resume`、`codex exec resume`、`codex fork`、`/subagents` 与 `--json` 的精确边界；本次在该页检索 `handoff` 无匹配。 |
| E04 | [Developer commands: approval/sandbox](https://learn.chatgpt.com/docs/developer-commands?surface=cli) | OpenAI | A | `--ask-for-approval`、sandbox、额外写目录和安全提醒是命令执行权限，不是企业业务 Gate。 |
| E21 | [anthropics/claude-code LICENSE.md](https://github.com/anthropics/claude-code/blob/main/LICENSE.md) | Anthropic GitHub | A | 文本为“all rights reserved; subject to Commercial Terms”，Claude Code 本体不是开源可复用代码。 |
| E22 | [Claude Code: custom subagents](https://code.claude.com/docs/en/sub-agents) | Anthropic | A | 子代理各有上下文、工具和独立权限；可配置 permission mode、hooks、persistent memory。 |
| E23 | [Claude Code: agent teams](https://code.claude.com/docs/en/agent-teams) | Anthropic | A | 共享 task list、mailbox、team lead/teammate；任务本地持久，但 team 限于 session。 |
| E24 | [Claude Code: agent team limitations](https://code.claude.com/docs/en/agent-teams) | Anthropic | A | 恢复后不恢复 in-process teammates，且一个 team 仅限一个 session；是重要反证。 |
| E25 | [claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) | Anthropic GitHub | A | 官方 SDK 仓库以 MIT 发布；与闭源 Claude Code 本体分开。 |

## 中国厂商和产品

| ID | 标题与 URL | 发布方 | 等级 | 短释义 |
| --- | --- | --- | --- | --- |
| E05 | [扣子团队版](https://docs.coze.cn/about-coze-team) | 扣子官方文档 | A | 团队/企业 workspace、资源隔离与人/Agent 协作定位。 |
| E06 | [扣子数据安全能力](https://docs.coze.cn/guides_data_security_capability) | 扣子官方文档 | A | RBAC、OBO、动态权限校验、访问审计与资源类型。 |
| E07 | [扣子消息日志](https://docs.coze.cn/guides_queries) | 扣子官方文档 | A | 企业套餐日志保留、导出与角色可见范围；不是业务 event replay 承诺。 |
| E08 | [Qoder 多智能体编排](https://docs.qoder.cn/cloud-agents/multi-agents) | Qoder 官方文档 | A | Coordinator、独立 Session Thread、子 Agent 委派/汇总。 |
| E09 | [Qoder Agent Teams](https://docs.qoder.com/zh/cli/agent-teams) | Qoder 官方文档 | A | main Agent、teammate、共享 Task list、消息；产品在 coding CLI 会话中。 |
| E10 | [华为云码道多任务并行](https://support.huaweicloud.com/usermanual-space/codeartsagent_space_0003.html) | 华为云 | A | Agent Team 的持续化上下文、共享任务池、自由通信、故障恢复与事件驱动可视化。 |
| E11 | [CodeArts Agent 团队与成员](https://support.huaweicloud.com/intl/en-us/usermanual-enterprise/codeartsagent_enterprise_0003.html) | 华为云 | A | tenant owner、enterprise/team administrator、member 的企业角色。 |
| E12 | [CodeArts CLI 权限](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0006.html) | 华为云 | A | edit/write/delete/bash 可配置自动、提示审批、禁止。 |
| E13 | [Comate Subagents](https://cloud.baidu.com/doc/COMATE/s/4mfbxqbmd) | 百度智能云 | A | 主 Agent 拆解，多子 Agent 协作、统一调度的 coding 多智能体引擎。 |
| E14 | [Comate Zulu 智能体](https://cloud.baidu.com/doc/COMATE/s/vm66asjm4) | 百度智能云 | A | 自定义 Agent 与 Subagents、编码任务语境。 |
| E26 | [Trae 官方网站](https://www.trae.ai/) | Trae | C | 官方入口；本次未找到足以填满七项门槛的公开一手详情。 |
| E27 | [Qoder Quest 概览](https://docs.qoder.cn/user-guide/quest/overview) | Qoder 官方文档 | A | Agent/Experts 多智能体、任务管理和会话流的 IDE 产品边界。 |
| E28 | [通义灵码官网](https://lingma.aliyun.com/) | 阿里云 | C | 官方产品入口；本次未取得七项门槛级资料，不能据此夸大协同能力。 |
| E29 | [阿里云百炼](https://bailian.aliyun.com/) | 阿里云 | C | 官方产品入口；仅列为 Agent 应用平台候选，未以此证明业务 handoff/Gate。 |
| E30 | [钉钉开放平台](https://open.dingtalk.com/) | 钉钉 | C | 官方开放平台入口；审批/组织能力须在具体客户 API 与授权范围中复核。 |
| E31 | [CodeBuddy Code CLI](https://cloud.tencent.com/document/product/1039/131814) | 腾讯云 | B | 官方文档列 `--resume [会话ID]`，只能证明会话恢复。 |
| E32 | [腾讯云智能体开发平台](https://cloud.tencent.com/product/agent) | 腾讯云 | C | 官方产品入口；本次未获得满足七项的公开细节。 |
| E33 | [百度千帆 AppBuilder 文档](https://cloud.baidu.com/doc/AppBuilder/index.html) | 百度智能云 | C | 官方平台入口；本次将社区内容排除为核心能力证据。 |

## 开源中国生态与许可证

| ID | 标题与 URL | 发布方 | 等级 | 短释义 |
| --- | --- | --- | --- | --- |
| E15 | [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE) | LangGenius GitHub | A | modified Apache-2.0；多租户与前端 logo/版权/外观专利有附加限制。 |
| E16 | [FastGPT README](https://github.com/labring/FastGPT) / [LICENSE](https://github.com/labring/FastGPT/blob/main/LICENSE) | FastGPT GitHub | A | RAG/可视流程/自托管；许可证附加 SaaS 与版权信息条件。 |
| E17 | [MaxKB README](https://github.com/1Panel-dev/MaxKB) / [LICENSE](https://github.com/1Panel-dev/MaxKB/blob/v2/LICENSE) | 1Panel GitHub | A | 企业 Agent/RAG/工作流；GPL-3.0。 |
| E18 | [RAGFlow](https://github.com/infiniflow/ragflow) / [LICENSE](https://github.com/infiniflow/ragflow/blob/main/LICENSE) | InfinityFlow GitHub | A | RAG + Agent 上下文层；Apache-2.0。 |
| E19 | [OpenManus](https://github.com/mannaandpoem/OpenManus) | 官方仓库 | B | 2026-08-27 GitHub API 返回 `license: NONE`，根 LICENSE 路径未找到；只可阅读思想。 |
| E20 | [MetaGPT](https://github.com/geekan/MetaGPT) / [LICENSE](https://github.com/geekan/MetaGPT/blob/main/LICENSE) | MetaGPT GitHub | A | 多角色 framework；MIT。 |
| E34 | [ChatDev](https://github.com/OpenBMB/ChatDev) / [LICENSE](https://github.com/OpenBMB/ChatDev/blob/main/LICENSE) | OpenBMB GitHub | A | LLM 多角色软件开发；Apache-2.0。 |
| E35 | [AgentScope](https://github.com/agentscope-ai/agentscope) / [LICENSE](https://github.com/agentscope-ai/agentscope/blob/main/LICENSE) | AgentScope GitHub | A | multi-agent SDK/可观测运行候选；Apache-2.0。 |

## 本地化、企业控制与法规

| ID | 标题与 URL | 发布方 | 等级 | 短释义 |
| --- | --- | --- | --- | --- |
| E36 | [飞书应用发布的权限申请与审核](https://www.feishu.cn/content/788114687974) | 飞书 | A | 应用可用范围、通讯录范围、字段级权限、管理员审批。 |
| E37 | [飞书 CLI 能力与安全说明](https://www.feishu.cn/content/article/7641519075810069471) | 飞书 | A | app scope、管理员审批、用户/应用身份分离及 API 操作审计。 |
| E38 | [飞书应用发布审核](https://www.feishu.cn/content/kjtmg83u) | 飞书 | A | 发布预览、权限申请与审核人流程。 |
| E39 | [个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm) | 中央网信办/中国法律法规数据库 | A | 第38—40条关于个人信息出境、条件与特定主体境内存储。 |
| E40 | [促进和规范数据跨境流动规定](https://www.gov.cn/gongbao/2024/issue_11366/202405/content_6954192.html) | 中国政府网 | A | 列出部分豁免和数据出境义务，防止把本地化绝对化。 |

## 证据缺口纪律

1. 没有付费登录、绕过访问限制、抓取内部控制台或使用非官方“测评/营销”材料。
2. 对 Trae、通义灵码、百炼、钉钉、腾讯云智能体、千帆，C 级只表达“存在官方入口/本次未证实”，不在结论中当成能力证据。
3. 非公开产品、私有部署定制、供应商 roadmap、口头销售承诺均不计入直接同类判定。
