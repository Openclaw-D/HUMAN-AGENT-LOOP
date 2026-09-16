# BASELINE（更正版）｜REMOTE_DD_REPAIR_20260913

**本文件更正上轮 BASELINE.md 的错误结论**：上轮仅在外层 `Anthropic/` 目录运行 git 判定"非 Git 仓库"；本轮在活动代码目录核实——

## Git 状态（2026-09-13 01:30 实测，evidence/pre-snapshot/git-status-site.txt）

- 活动仓库：`jianwei-v3/site/` **是 Git 仓库**（`git rev-parse --show-toplevel` = 该目录）。
- HEAD：`63c41c3 archive: preserve Jianwei V3 snapshot`（无分支切换记录于本地；当前处于该提交）。
- `git status --short`：**92 项**——含历史多轮的修改（M）/删除（D）/未跟踪（??）。其中与本轮相关的 v5-preview 写面（`app/v5-preview/`、`app/api/v5-preview/`、`lib/v5-preview/`、相关 test）**全部为未跟踪（??）**，即从未提交过；其余 dirty（V4/文档/历史路由等）来自既往各轮，非本轮产物，未认定归属，一律不动。

## 重大改版 Git baseline 缺口（如实）

- 任何 commit/tag/push/worktree 仍需用户明确授权；文件快照（pre-snapshot/SHA256SUMS.txt，8 文件）不等于 Git baseline。
- 本轮返修不涉及存储格式破坏或重大迁移：remote-store.json@1 结构为**向后兼容增量**（新增 generation 必填字段只影响新建 store；存量 store 含旧记录时的兼容策略：`readRemoteStoreState` 校验器要求 generation——**首轮创建后的 store 均含 generation；升级前遗留的 remote-store.json（无 generation）会被 REMOTE_STORE_CORRUPT 拒绝**。兼容/恢复方案：删除该 remote-store.json 即以空状态重建（远程尽调状态均为合成演示数据，rows-store.json 不受影响）。若 Codex 判定此为破坏性迁移，暂停 remote 存储写面并等待决定——已在此声明，不静默。

## 快照

- `evidence/pre-snapshot/`：8 个涉及文件原样副本 + SHA256SUMS.txt。
- 涉及未跟踪新增（本轮新增/上轮遗留）：remote-session/ 页面与组件、remote-*.ts、remote-* 路由、test/v5-preview-remote*.test.mjs——全部在 v5-preview 写面内。
