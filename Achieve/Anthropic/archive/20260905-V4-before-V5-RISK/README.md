# 见微｜项目唯一入口

当前生效版本：**V4**。当前模式：**单一工程总目标，Control复验检查点后继续**。

## 全局主文件

| 文件 | 唯一职责 |
| --- | --- |
| [NORTH_STAR.md](NORTH_STAR.md) | 当前生效的产品主干与制度底线；目前承接V4 |
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
| [V4](V4/README.md) | 当前版本宪章、决定、候选、讨论与验收入口 |
| [Unity](Unity/WORKSPACE_ENTRY.md) | 独立保留的3D/Unity历史项目，原内容未改 |
| [历史代码](历史代码/README.md) | 早期系统、V2Z、旧静态壳与原型，非活动后端 |
| [materials](materials/README.md) | 共用原始材料，仅提供证据 |
| [archive](archive/README.md) | 恢复快照、工具与路径迁移记录 |

唯一活动代码仓库仍是 [jianwei-v3/site](jianwei-v3/site/README.md)，保留路径以避免破坏既有引用和运行环境；名称含v3不代表当前产品版本。其 [docs/v4](jianwei-v3/site/docs/v4/README.md) 是V4专属工程契约与证据，不是第二套产品主干。

## 现在从哪里开始

先读全局主干，再读 [V4当前检查点](V4/CURRENT_CHECKPOINT.md)。目录整理和四域骨架已交付；当前按 [滚动契约](V4/ENGINEERING_CONTRACT.md) 推进本地低保真前后端闭环。不进入新版本，不把工程验证当作用户产品接受。

历史文件中的CURRENT、FROZEN、Goal、自动运行等词只描述当时状态，不自动重新生效。`.codex-remote-attachments/`保持原位。没有为本次整理创建Git commit/tag或移动Codex任务历史。
