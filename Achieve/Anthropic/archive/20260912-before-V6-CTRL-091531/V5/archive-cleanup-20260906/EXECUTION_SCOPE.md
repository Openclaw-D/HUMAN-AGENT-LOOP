# Archive 清理执行范围

2026-09-06：用户明确授权精选资料剪切进当前项目，其余适当新建 GitHub 仓库上传后删除；9 份调研录音已有用户存档，直接删除。不操作当前活动代码、分支、服务或 ZCode ownership。

- 唯一源目录：`C:\Users\22673\Desktop\Archive`。
- 精选目标：`C:\Users\22673\Desktop\Anthropic\materials\reusable-assets\20260906-archive`。
- 冷备临时目录：`C:\Users\22673\Desktop\Archive-transfer-20260906`，仅本任务新建。
- 计划私有仓库：`Openclaw-D/archive-legacy-projects-20260906`。
- 精确文件对象见 `plan.json`，扫描时的大小与修改时间见 `inventory.json`。

恢复：精选文件保留原文与 SHA256 映射；其余有价值源码/文档/资产按 SHA256 去重打包至 GitHub Release，仓库保存路径映射和恢复脚本。上传完成后核验远端 commit、私有属性、Release 文件大小与 SHA256；再删除原文件。

直接清除：依赖、缓存、构建、运行时数据库/日志、已另存的9份录音，以及逐成员哈希证明已保留的重复 ZIP。旧 Git 元数据不迁移，此次是工作目录快照归档，不宣称保留全部 Git 历史。删去的本地状态和缓存不在恢复范围。

例外：12 份 `.codex-remote-attachments` 图片保持原位，遵守项目专属不移动/不整理规则。2 个 node_modules junction 只移除链接本身，不进入链接目标。

所有文件操作使用 PowerShell LiteralPath；删除/移动前验证绝对路径位于上述明确源/目标之内。源快照变化、外链、哈希不符、上传失败均停止相关删除。

这是执行范围记录，不是要求重复授权。用户本轮明确授权即为执行依据。
