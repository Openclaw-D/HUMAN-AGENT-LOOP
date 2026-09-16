# 2026-09-05整理证据与恢复

这是本次文档整理的恢复包，不是产品新版本或Git发布。

## 内容

- [backup-manifest.json](backup-manifest.json)：31份修改前文档的原路径与SHA256；正文在 [before-edit](before-edit/)，保持原字节。
- [verified-moves.json](verified-moves.json)：17项迁移的From/To、数量、字节、文件树摘要与校验时间；均在新增导航/修改当前文档之前核验。
- [move-plan.json](move-plan.json)：当时的迁移计划，当前实际结果以verified-moves为准。
- [dependency-archive.json](dependency-archive.json)：上一整理步骤旧TAG依赖压缩的逐文件核验；ZIP内27590文件验证一致。记录中的旧ArchivePath按下方路径映射查找。
- [organize.ps1](organize.ps1)：此次操作工具；已执行动作不可盲目重跑，目标存在会停止。
- [validation.json](validation.json)：本轮最终导航/备份/路径校验；不代表代码测试。

## 主要路径映射

| 原路径 | 现路径 |
| --- | --- |
| versions/V4 | V4 |
| archive/00-pre-financing-leasing-mvp | 历史代码/早期平台快照 |
| archive/10-v2z-experiments | 历史代码/V2Z实验 |
| archive/20-p2-discovery | V2/archive/P2探索 |
| archive/30-v3-materials/eye-unity | Unity |
| archive/30-v3-materials/legacy-static-shell-20260828 | 历史代码/V3静态展示壳 |
| archive/30-v3-materials/prototype | 历史代码/V3原型 |
| archive/30-v3-materials其余内容 | V3/archive |
| archive/40-v4-life-convergence | V4/archive/产品收敛记录 |
| materials/showcase/jianwei-v3-showcase | V3/materials/展示与PPT |
| docs/v4下四份旧ZCODE任务书 | V4/archive/执行任务书 |
| docs/v4下三份完整工程历史报告 | V4/archive/工程验收 |

全局DECISIONS/CHALLENGE_LOG的版本细节已提取为V4文件；原全局全文仍在before-edit，不是被删除。旧控制协议、技术栈与路线原文也在before-edit。

## 恢复边界

先确认要恢复的精确文件/目录及当前目标是否已有新内容，再按manifest或From/To逐项恢复；不要整树覆盖工作区。历史脚本的绝对路径未改写，移回前须检查依赖与环境。任何路径恢复不自动恢复产品权威。

旧依赖ZIP当前在历史代码/早期平台快照/sources/legacy/tag/lab/site/node_modules.restore.zip；ZIP包含node_modules顶层。原展开目录在Windows回收站，未清空回收站。活动node_modules、.next、dist、.data、.git及Remote附件本轮未修改；未将文件快照称作Git基线。
