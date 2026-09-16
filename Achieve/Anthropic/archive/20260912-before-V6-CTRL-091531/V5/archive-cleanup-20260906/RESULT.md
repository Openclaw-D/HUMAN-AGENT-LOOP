# Archive 迁移与清除结果

2026-09-06。用户本轮明确授权精选迁入、其余适当 GitHub 归档后删除、录音直接删除。

## 已完成

- 精选 450 个原文件、103,612,053 字节，迁入 `materials/reusable-assets/20260906-archive/`。逐文件 SHA256 一致，原位置已移除。
- 保留 A2A 参考、JW 后端/评测、3 份合成案例、2 份 PPT 与讲稿、TQ 小演示。168 份合成材料的标记与 manifest SHA256 均验证通过。
- 私有冷备仓库：https://github.com/Openclaw-D/archive-legacy-projects-20260906 ，已设为 archived，只作恢复。
- Release：https://github.com/Openclaw-D/archive-legacy-projects-20260906/releases/tag/snapshot-20260906 。5,681 条原路径映射到 2,742 个去重文件，10 个分包共 1,187,930,452 字节。
- 本地恢复脚本 verify-only 校验全部路径/内容；GitHub 服务端 10 个文件的 SHA256、大小、uploaded 状态均与本地一致。远端提交 `fff855914fbb751288db2ec7589bc9a4f8b0b0c2` 与本地一致。
- 原 Archive 已清除 181,413 个文件，共 16,419,060,351 字节；30 个精确删除目标完成。9 份调研录音已删除，没有上传。
- 48 个重复 ZIP 的全部成员已通过哈希证明有保留副本，因此不重复上传。依赖、缓存、构建、旧 Git 元数据与运行时数据不属于恢复内容。
- 2 个 node_modules junction 仅移除链接本身，未遍历或删除链接目标。
- 未修改当前活动代码、分支、运行服务或 ZCode ownership。Git 提交/推送仅发生于新建冷备仓库。

## 保留例外与未完成尾项

1. 原 Archive 仅剩 12 张 `.codex-remote-attachments` 图片，752,560 字节，前后 SHA256 未变化。位置为 TAG-sources-20260821/JW 与 Stars 各自的该隐藏目录。依据 Anthropic/AGENTS.md 的明确规则：`.codex-remote-attachments/ 不移动、不整理`。
2. 上传临时目录 `C:\Users\22673\Desktop\Archive-transfer-20260906` 仍在，47 个文件，共 1,189,862,914 字节。删除整个临时目录/压缩后证据原文件的组合操作被自动审批拒绝；缩小为逐个校验后删除上传 ZIP 的操作也被拒绝。两次只返回 `blocked by policy`，没有更具体理由，没有执行或绕过。全部远端归档已验证，这里属于可恢复上传副本，不是唯一资产。
3. 本目录 `audit-evidence.zip` 已压缩并逐成员验证（约 6.2 MB）；未压缩的 inventory.json、plan.json、remote-manifest.json 仍留在本地，因为上述组合清理没有执行。日常只读本结果或精选 README，不读取大清单。

## 恢复入口

- 精选资料入口：`materials/reusable-assets/20260906-archive/README.md`。
- 冷备恢复：GitHub README 中的 release 下载与 `restore_archive.py` 命令；恢复脚本拒绝覆盖已存在文件。
- 文件级证据：retained-receipt.json、remote-verification.json、source-verification.json、cleanup-receipt.json；原始扫描及源/目标映射亦保存在 audit-evidence.zip。

上述旧文件均为历史参考，不取得 V5 当前产品权威。冷备是工作目录快照，不宣称完整 Git 历史保存或旧应用运行验收。

## 后续复核：用户手动删除原目录
用户随后手动删除了原Archive。只读复核确认Desktop/Archive已不存在，精选入口仍存在；GitHub Release 10份分包及哈希仍与验证记录一致。transfer临时目录仍存在；此前自动审批拒绝删除的尾项未解除，本轮未重试或绕过。上文12张附件原位保留描述仅适用于Codex清理完成当时。

