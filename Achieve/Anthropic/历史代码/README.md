# 历史代码｜保留与恢复

归属：只读历史，不参与当前后端扩展。

- [早期平台快照](早期平台快照/)：原 archive/00-pre-financing-leasing-mvp。
- [V2Z实验](V2Z实验/)：原 archive/10-v2z-experiments。
- [V3静态展示壳](V3静态展示壳/)：原V3静态实现。
- [V3原型](V3原型/)：原prototype。

历史源码未删除。早期平台中旧TAG的展开依赖已压缩为同层 node_modules.restore.zip，27590个文件逐项大小和SHA256验证一致；原展开目录在Windows回收站。恢复依赖需先检查目标无冲突，再将ZIP解到其所在site目录；ZIP已包含node_modules顶层。

迁移后未逐个启动旧系统；历史绝对路径、链接和启动脚本可能仍指向原位置，不自动改写。查 [路径映射与恢复](../archive/90-tooling/workspace-organization-20260905/README.md)。当前运行仓库仍是 jianwei-v3/site。
