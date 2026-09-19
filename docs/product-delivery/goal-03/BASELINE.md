# goal-03 本轮基线登记（2026-09-18，任务书 `JW_product_delivery_four_tasks`）

## 启动状态（只读核对）

- 本地分支：`v02-goal1234-delivery`；HEAD：`e4ed7a53c41367e14ce87f993ca088f6896fb904`（PR#4 四轮合交点，未切 main，遵守任务书"不盲目切 main"）。
- 脏文件：仅未跟踪目录 `JW_product_delivery_four_tasks/`（任务书原件，00_START_HERE 视为执行指令非证据，本轮不回写）。
- 本路所有权（唯一 writer）：`Front/**`、`Back/Edge/src/**`、`Back/Edge/contract/**`、Back/Edge 非 e1 测试（`test/*.test.mjs`、`helpers.mjs`、`run-all.mjs`）、Back/Edge `package.json` 与依赖。**不碰** `Back/Edge/scripts/**`、`Back/Edge/test/e1/**`（04 路），不碰 A/B/C/D。
- 相关文件摘要：Front 源码 = `Front/preview/`（入口/构建）+ `Front/site-mirror/app/v5-preview/`+`lib/v5-preview/`（24 文件，六角色训练演示 + Edge live 面板）；Edge = 无框架 Node BFF（server/proxy/session/kernel-store/static/messages/store/probes/audit/version），非 e1 测试 8 文件 34 用例全绿（启动时未重跑，以交付时实跑为准）。

## 运行态资源登记（本轮自用，不与他路共享）

| 资源 | 值 | 说明 |
|---|---|---|
| PG 容器 | `jw-g03c-pg` @ `127.0.0.1:15456`（pg16，库 `jw_g03c`，用户/密码 `jwg03c/jwg03c`） | 本轮新建，仅 loopback 合成环境 |
| A 内核 | `127.0.0.1:17933` | `node src/index.ts --port 17933 --db .../15456 ...` |
| Edge | `127.0.0.1:17935` | `node src/server.mjs --port 17935 --live --auth-file <本轮 config> --kernel-port 17933 --serve-front Front/dist`（同源托管） |

- 启动时已存在的他人资源（**一律不停不抢**）：3618（Front 预览）、48180（A）、48200（Edge live）、48280（未知监听）、PG 15433/15442/15443/15444/15446/15452 及对应容器。
- 凭据来源：本轮自建受控目录（部署配置，Git 排除），不把任何凭据写入仓库/前端包/日志。
- 测试子进程：Edge 非 e1 测试维持 helpers 自足栈（随机端口，无 docker/PG 依赖）；真实链路验证用上表登记端口。

## 对照任务书的启动申明

本轮是新一轮要求，不构成对 PR#3/PR#4 已通过项的认定。上一轮遗留如实带入：目录/邀请/原件预览无上游端点（见 INTERFACE_REQUESTS.md）、delivery-seed 决策链兼容核绕行（04 路范围）、customer-only 无事件流（A 既有策略）。C09（回放训练命名空间）仍未建。

## 续轮运行态登记（2026-09-19，goal-03 续·J1.1–J1.5 做实）

| 资源 | 值 | 说明 |
|---|---|---|
| PG 容器 | `jw-g03c-pg` @ `127.0.0.1:15456`（复用上轮容器） | A 库 `jw_g03c`（迁移 001–009）+ 通道库 `jwg03c_conn`（Connectors 自迁移） |
| A 内核 | `127.0.0.1:17933` | 新增旗标 `--required-domains-policy pol-delivery-synthetic`（四域 required，种子见 DB）；principalTokens 增 `svc1`(service)、`pol1`(policy)；规则包 `1.0.0` 已激活；主客户 `cust-mu77o9re-cd03fb5a5ed2` 为部署初始化建 |
| Connectors | `127.0.0.1:17937` | `node scripts/start-connectors.mjs`（`.run/config.json`：pg=jwg03c_conn、aBridge→A、service=tok-svc1、aPackageDomainResults=false）；处理驱动 2s |
| Edge | `127.0.0.1:17935` | 新增 `--connectors-url http://127.0.0.1:17937 --connectors-token-file config/g03d-conn-token.txt`（两者 git-ignored） |
| 凭据文件 | `Back/Edge/config/g03c-{runtime,auth}.json`、`g03d-conn-token.txt`、`Back/Connectors/.run/config.json` | 全部 git-ignored |
| 部署初始化（非用户路径） | 主客户建档、规则包激活、必需域政策种子、`a_customer_links` 直插（start-connectors 不透传种子，见 IR-03-8⑤）、客户2 检查会话种子（tools/seed-g03c.mjs） | 均记 `linked_by/created_by=goal-03-*` 可审计 |

## goal-03e 独立验证段（2026-09-19 下午）

| 资源 | 值 | 说明 |
|---|---|---|
| Edge 验证段 | `127.0.0.1:17947` | 本路新代码+新 dist 同源托管；`--live --auth-file config/g03c-auth.json --kernel-port 17933 --db-port 15456 --connectors-url http://127.0.0.1:17937 --connectors-token-file config/g03d-conn-token.txt`；日志 `Back/Edge/.run-g03e/edge-17947.log`（git-ignored）。**复用 PG 15456 / A 17933 / Connectors 17937，未重启未抢占；17935 原样保留未动** |
