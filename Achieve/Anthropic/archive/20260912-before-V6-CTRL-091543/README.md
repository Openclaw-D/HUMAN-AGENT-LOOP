# 见微｜项目唯一入口

当前生效版本：**V5-RISK**。当前模式：**产品定义与风险协同收敛**。入口：[V5](V5/README.md)。

## 全局主文件

| 文件 | 唯一职责 |
| --- | --- |
| [NORTH_STAR.md](NORTH_STAR.md) | 当前生效的产品主干与制度底线；目前承接V5-RISK |
| [DECISIONS.md](DECISIONS.md) | 当前版本指向、跨版本治理和本轮执行边界 |
| [ROADMAP.md](ROADMAP.md) | 当前检查点及下一步的启动条件，不自动派工 |
| [CHALLENGE_LOG.md](CHALLENGE_LOG.md) | 全局权威、范围与交付真实性风险 |
| [AGENTS.md](AGENTS.md) | 文件归属、写入边界、协作和验收规则 |
| [CHANGELOG.md](CHANGELOG.md) | 已发生的结构与全局文档变化，不是执行指令 |

“全局”仅指 **Anthropic项目跨版本层**，不指Codex/ZCode全局Memory。平台Memory不代替这些文件。

## 版本与保留资产

| 入口 | 内容与状态 |
| --- | --- |
| [V1](V1/README.md) | 早期历史导航；不虚构正式发布记录 |
| [V2](V2/README.md) | P2发现与V2Z实验来源；只读历史 |
| [V3](V3/README.md) | V3契约、证据、展示与PPT；只读历史 |
| [V4](V4/README.md) | 已保留的架构与工程验证历史；暂停，未完整产品验收 |
| [V5-RISK](V5/README.md) | 当前产品定义、八项决定、开放问题与验收框架 |
| [Unity](Unity/WORKSPACE_ENTRY.md) | 独立保留的3D/Unity历史项目，原内容未改 |
| [历史代码](历史代码/README.md) | 早期系统、V2Z、旧静态壳与原型，非活动后端 |
| [materials](materials/README.md) | 共用原始材料，仅提供证据 |
| [archive](archive/README.md) | 恢复快照、工具与路径迁移记录 |

唯一活动代码仓库仍是 [jianwei-v3/site](jianwei-v3/site/README.md)，保留路径以避免破坏既有引用和运行环境；名称含v3不代表当前产品版本。其 [docs/v4](jianwei-v3/site/docs/v4/README.md) 是V4专属工程契约与证据，不是第二套产品主干。

## 现在从哪里开始

先读全局主干，再读 [V5决定](V5/DECISIONS.md) 与 [V5契约](V5/CONTRACT.md)。V4 已有工程作为复用候选；当前收敛产品，不继续旧工程目标。切换前的333文件快照见 archive/20260905-V4-before-V5-RISK。

历史文件中的CURRENT、FROZEN、Goal、自动运行等词只描述当时状态，不自动重新生效。`.codex-remote-attachments/`保持原位。没有为本次整理创建Git commit/tag或移动Codex任务历史。
