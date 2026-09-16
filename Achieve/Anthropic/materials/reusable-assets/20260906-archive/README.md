# 从 Archive 精选的复用资产

2026-09-06 按用户授权迁入，共 450 个原文件、103,612,053 字节，逐文件 SHA256 校验后删除源文件。

状态：**历史参考 / 非当前产品权威 / 不自动加载**。唯一活动实现仍为 `jianwei-v3/site`。不要把本目录的历史 AGENTS、README、契约或流程当成 Anthropic 当前规则。

| 目录 | 何时使用 |
| --- | --- |
| 01-stars-a2a | 查 A2A 子集、任务持久化、人工 Gate 与 HTTP 测试参考；未认定通过官方兼容测试 |
| 02-jw-backend | 查历史后端、审计、证据处理、安全与模型网关离线评测；旧业务规则不直接移植 |
| 03-synthetic-cases | project-01/02/03，共 168 份材料，manifest 的 synthetic 标记与文件 SHA256 已核验 |
| 04-presentation | 两份可编辑 PPT 与一份讲解提示卡；不是当前产品已验收稿 |
| 05-tq-demo | 离线交互演示参考；没有本轮运行或启动服务 |

`03-synthetic-cases/package-index.json` 是原始完整索引，可能列出未本地保留的其他案例。这里只精选前三个；其余按冷备仓库清单恢复。

精确来源及 SHA256：`V5/archive-cleanup-20260906/retained-receipt.json`（Anthropic 根目录起算）。冷备与清除结果见同目录执行报告。

其余旧资产的私有冷备：[GitHub 只读归档库](https://github.com/Openclaw-D/archive-legacy-projects-20260906)。本次结果：`V5/archive-cleanup-20260906/RESULT.md`。

使用方式：先提出一个当前验收问题，再按需查看一个子目录。不要整包复制进活动源码或每轮全文读取。

V5已完成定向经验梳理，见 [历史复用映射](../../../V5/HISTORICAL_REUSE.md)：按B0四项审查问题定位到源码/测试及下一步验证。该映射吸收经验，不宣布旧模块已适配V5或测试已通过。
