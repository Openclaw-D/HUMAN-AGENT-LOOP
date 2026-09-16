# 任务三 · 受控交付操作手册（安装 / 启动 / 停止 / 备份恢复 / 回退）

2026-09-17。交付范围：本仓（JW）客户空间协同尽调——客户授信 v2 + 检查会话 + Edge 实时投影 + 二维前端最小接线。
结论口径：本手册只能支撑"本范围受控交付"的启动与恢复；**不**代表真实资金支付、真实视频提供方或全公司生产上线获批（能力位见 §7）。

## 1｜安装（一次性）

| 依赖 | 口径 | 检查 |
|---|---|---|
| Node.js | 22.x（Front engines ≥22.13；实测 v22.23.1） | `node --version` |
| Docker Desktop | 引擎可达（就绪判据用 `docker ps`，勿只看 `docker info`） | `docker ps` |
| PostgreSQL 容器 | `jw-v01-pg`（127.0.0.1:15442，卷 jw_v01_pgdata）——按 Back/START.md 的 docker run 一次性创建；交付脚本只 start/stop，**永不创建/删除** | `docker ps -a --filter name=jw-v01-pg` |
| 前端构建 | 仓库已含 `Front/dist`；改动源码后须 `cd Front && npm run build` | 文件存在 |
| 运行时配置 | `Back/Edge/config/delivery-runtime.json`（复制 `delivery-runtime.example.json` 修改；Git 排除）。**不提交任何真实令牌** | 文件存在 |

环境自检（只读，不强杀）：`cd Back/Edge && node scripts/env-check.mjs`（`--json` 输出机器可读证据）。
FAIL=0 才继续；BUSY 端口需人工核实归属（脚本不动它们）。

## 2｜启动（每次演示）

```bash
cd Back/Edge
node scripts/delivery-up.mjs
```

脚本按序执行：预检 → `docker start jw-v01-pg`（如未运行）→ 等待 pg_isready → A 迁移（migrate-cli，A 路簿记）→
权限矩阵幂等播种（取自配置 matrixSeedSql）→ A 内核（48180，合成政策位，marker+pidfile+heartbeat）→
Edge `--live`（48200，内核投影 + 会话鉴权 + 动作白名单代理）→ 就绪报告。
任一步失败即停止并保留现场日志（`Back/Edge/.run/delivery/`），不做无边界重试。

入口地址：

| 面 | 地址 |
|---|---|
| 二维前端（本地合成演示 + 连接真实后台入口） | `cd Front && node start-preview.mjs` → http://127.0.0.1:3618/ |
| Edge 版本封存 | http://127.0.0.1:48200/versionz （buildId/gitSha/dirty/迁移/规则包/能力位，无私人路径） |
| Edge readiness（逐依赖独立，无 all_ok 汇总） | http://127.0.0.1:48200/healthz/ready |
| 浏览器操作验证页（E0 语义：SSE 断线补取/受众守卫/回执重试） | http://127.0.0.1:48200/harness/ |
| 演示种子（现场验收前运行一次） | `node scripts/delivery-seed.mjs` → 打印客户 ID 与现场动线（全程真实 API，不改库） |

前端连接真实后台：页面顶部"连接与模式"条填 Edge 地址（跨端口演示需 Edge 加
`--allowed-origin http://127.0.0.1:3618`，见 edge-start 参数）、凭据与客户 ID——凭据只提交到 Edge 服务端换
不透明会话，浏览器不再持有上游凭据。**127.0.0.1 仅指本机**；跨机访问须经受控地址/反代与获准认证，不得为演示取消隔离。

## 3｜停止

```bash
node scripts/delivery-down.mjs            # 停 Edge + A（三证复核），数据库保持运行
node scripts/delivery-down.mjs --with-db  # 另停 jw-v01-pg 容器（数据卷原样保留）
```

A 的停止需 pidfile + heartbeat（≤30s）+ 端口 `/healthz` 内容标识三证相符；任一不符 → exit 5 拒杀并提示人工核实。
注意（Windows 控制台实测）：delivery-up 为前台监督进程，直接杀掉监督窗口会连带终止其拉起的 A；规范停止路径是
Ctrl+C（触发 delivery-down 三证复核）或另窗口执行 `node scripts/delivery-down.mjs`。
未知进程、旧卷一律不触碰。端口冲突时 env-check 只报 BUSY。

## 4｜备份与恢复

- 演练（全迁移 + 合成数据 + pg_dump/pg_restore 指纹比对）：`cd Back/Edge && node scripts/backup-restore-drill.mjs`
  （隔离容器 v7d- 前缀/15434，用后即毁；证据写 `docs/customer-next/acceptance/evidence/s5-drill-<stamp>/`）。
- 生产化备份（如获批部署）：对 jw-v01-pg 定期 `docker exec jw-v01-pg pg_dump -U jw -Fc jw > 备份文件`，
  恢复按演练同法 pg_restore；**恢复验证=逐表指纹一致**，"空库能启动"不算恢复成功。
- 演练结论（2026-09-17，全迁移扩展版）与回滚边界见 `docs/customer-next/acceptance/BACKUP_RESTORE_DRILL.md`。

## 5｜回退

| 场景 | 处理 | 边界 |
|---|---|---|
| 代码回退 | Git 回到基线 commit（工作区各任务交付未提交，回退=丢弃未提交变更，须用户逐文件确认） | 代码回退 ≠ 数据库回退 |
| 数据回退 | 恢复最近备份（§4）；旧库 + 新代码优先向前兼容（迁移只增不改；004 旧列 NULL=未知，不补造历史） | 不可逆迁移不做反向脚本，走向前修复 |
| 已产生外部副作用（confirm-external 后） | **禁止**用恢复旧库让系统重发；先对账（A `fr.confirm-external` 人工复核），残余影响人工闭环 | A12：unknown 不自动清理/重发 |
| 回放/历史查询 | 读冻结记录仅解释，不执行原外发/批准/预占命令 | 回放不计入实时验收 |

## 6｜已知受限（如实，不模拟顶替）

三维场区（本仓无 Unity/3D，交付形态为二维页面）、真实视频/录制（企微/TRTC 未授权）、真实模型（未配置，transport 预留 0 调用）、
真实出账（仅受控模拟回执）、回放/训练命名空间（未建）。各能力位独立输出，永不汇总 all_ok。

## 7｜任务三自写代码的独立复核要求

本路新增/修改（Back/Edge/**、Front 接线文件、delivery 脚本、docs）按约定需 Codex 或非作者复核后接受；
自报全绿不构成独立验收。复核入口建议：`contract/consumed-surface-v1.json` → `src/kernel-store.mjs` →
`test/e1/` 两个真实变体 → `scripts/delivery-up/down.mjs`。
