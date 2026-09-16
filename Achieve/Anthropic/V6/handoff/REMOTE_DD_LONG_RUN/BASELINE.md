# BASELINE｜REMOTE_DD_LONG_RUN

记录时间：2026-09-12 23:31（startedAt）。任务窗口：约 8–10 小时（计划收口不早于 07:31，硬上限 09:31，2026-09-13）。

## 代码基线

- 工作区：`C:\Users\22673\Desktop\Anthropic`，**非 Git 仓库**（`git status` = fatal: not a git repository）——重大改版所需的 Git baseline 缺口如实存在；本轮不做重大改版（新增独立 remote-store 文件 + v5-preview 内增量路由/页面，无存储迁移、无框架替换），故不触发该硬门；文件快照不冒充 Git baseline。
- 唯一活动代码：`jianwei-v3/site/`（Next 16.2.6 + React 19 + TS strict；npm.cmd on Git Bash）。

## 开工前复验（P0 实测，非沿用自报）

- rework-2 聚焦回归：`node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview*.test.mjs` → **64/64 PASS**（F1 草稿-requestId 关联、F2 情景门/所有权门保持）。
- 运行实例：3311 现场（PID 28568，只读）；3321 dev（PID 21340，rework-2 数据目录）；3399 生产（PID 28572，rework-2 构建）。均非本轮启动，复用前逐一归属核验。

## 涉及文件快照（开工原样副本 + SHA256）

`evidence/pre-run-snapshot/`：app/v5-preview 全部 8 文件、lib/v5-preview 4 文件、app/api/v5-preview 5 路由、test 5 文件——SHA256SUMS.txt。已有未跟踪/删除文件一律视为用户成果，不清理。

## 非Git数据状态

- 隔离数据目录：`rework-2/evidence/{runtime-data,production-data}/rows-store.json`（rows-store.json@1，含浏览器矩阵合成标记，保留不改写）。
- 本轮远程尽调新增状态将使用**独立文件** remote-store.json（schema `v5-preview-remote-store@1`），不触碰 rows-store.json@1——零迁移、既有 API 兼容。
- 3311 现场数据：只读，不触碰。

## 恢复路径

1. 产品代码：`evidence/pre-run-snapshot/` 逐文件复制回。
2. 本轮新增文件（remote-* 增量）删除即回退（全部为新增文件或明确记录的修改点，见 OWNERSHIP.md）。
3. 隔离数据：删除 rework-2/rework-1 的 runtime-data/production-data 中本轮新增 remote-store.json 即可（rows-store.json 不动）。
