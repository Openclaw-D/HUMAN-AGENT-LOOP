# goal-03 · HANDOFF（Edge 与工作台数据 → 用户 / goal-01 / goal-04）

- 日期：2026-09-17；基线 main @ `1ec0ee4`；性质：commit-ready，**未 commit/push**（awaiting 用户明确授权）
- 执行者：ZCode（goal-03 路；唯一写域 `Back/Edge/src|contract|test(非e1)` + `Front/**` + 本文档目录）

## 1｜交付清单（本轮改动文件）

### Back/Edge（本路）
| 文件 | 变更 |
|---|---|
| `src/kernel-store.mjs` | C1：明细缓存（事件失效+TTL `JW_EDGE_DETAIL_CACHE_MS`，默认 60s，0=关）、同请求在途合并、`_qCounters/_resetQCounters/_dropDetailCaches`、**404 撤权断流**（曾可读桶遇上游 404 → `CUSTOMER_ACCESS_REVOKED` auth 帧 + 销桶） |
| `src/server.mjs` | C3：`--serve-front <dir>` 同源受控前端（默认关；SPA 回退；API 404 不遮蔽；CSP 不放宽） |
| `src/static.mjs` | 泛化静态服务（`urlPrefix=''` 根挂载；MIME +.map/.woff2；/harness 行为不变） |
| `scripts/edge-start.mjs` | 透传 `--serve-front`（Edge 启动入口属本路；goal-04 若有归属主张请复核，改动仅 5 行） |
| `contract/consumed-surface-v1.json` | revision `goal03-1`：缓存/合并/计数/404 撤权/serve-front 语义登记 |
| `test/g03-c1-kernel-store.test.mjs` | 新增 5 用例（缓存命中与标注、失效钩子、合并、失败不缓存、404 撤权断流） |
| `test/g03-c3-same-origin.test.mjs` | 新增 2 用例（根挂载/回退/CSP/API 隔离；未配置时行为不变） |

### Front（本路）
| 文件 | 变更 |
|---|---|
| `lib/v5-preview/edge/use-edge-live.ts` | 重写：epoch 代际守卫（P1-3/切客户原子性/刷新竞态）、onOpen 回 live + 指数退避（P1-2）、resync 退避、有界去重（5000 FIFO）、unknown 消息同 requestId 幂等对账（一次）、404 终态、定时器全量清理 |
| `lib/v5-preview/edge/edge-client.ts` | openEvents +onOpen |
| `lib/v5-preview/edge/edge-logic.ts` | parseSseFrames CRLF/CR/多行 data；deriveSessionActions → `{acts, fromServer}`（服务端 availableActions 优先）；session 形状 +availableActions |
| `app/v5-preview/edge-panels.tsx` | 会话条消费服务端动作（兜底标注）；off 态"客户目录未提供/范围不完整"提示 |
| `app/v5-preview/home-chat.tsx` | **P1-1 根因修复**（line-clamp 下 scrollHeight==clientHeight，检测改为"钳制高 vs 解除 clamp 完整高"；展开态不测量）；草稿键按模式隔离；计数注记按模式（live=真实后台回执） |
| `app/v5-preview/home-overview.tsx` | 传 draftStorageKey / countNote |
| `preview/test/edge-logic.test.mjs` | 用例同步（CRLF/多行、服务端动作优先/兜底标注） |
| `dist/**` | vite 重建（用户要求随仓库）：`assets/index-C4ixqN64.js` + `assets/index-Coao7djn.css`；旧 `index-B5AqWFQa.js` 移除 |

### 文档（本路）
`docs/backend-upgrade/goal-03/{DESIGN,CHANGELOG,TEST_RESULTS,PERF_BEFORE_AFTER,HANDOFF}.md`、
`docs/backend-upgrade/INTERFACE_REQUESTS.md`、`evidence/browser-live-*.png`；
`Back/Edge/STATUS.md` 追加本轮记录。

## 2｜运行态（当前机器上仍在运行，可直接复验）

```
PG@15442（容器 jw-v01-pg）
A 内核@48180   node Back/A/src/index.ts --port 48180 --db postgres://jw:***@127.0.0.1:15442/jw
               --dispatch --principal-tokens <10 个合成主体，含 grant 模式 tok-lim1>
               --credit-matrix matrix-delivery-synthetic --credit-concentration conc-delivery-synthetic
               --allow-legacy-basis          ← 兼容核开关：种子/演示数据未绑定依据包（见 §4 缺口①）
Edge@48200     node scripts/edge-start.mjs --port 48200 --live --kernel-port 48180 --db-port 15442
               --auth-file config/edge-auth.json --serve-front C:\Users\22673\Desktop\JW\Front\dist
入口           http://127.0.0.1:48200/（同源前端；凭据 tok-biz1，客户 cust-mu5pgdsj-bbcb6e479773）
```

- A 的 pidfile：`%TEMP%/jw-goal03/a-kernel.pid`；Edge 用 `node scripts/edge-stop.mjs` 安全停止。
- 演示客户含大量本轮测量造的事件（3100+ 条）与 30 个 S5 测量评估——工作台数据真实但偏"脏"，
  现场演示建议重跑 `node scripts/delivery-seed.mjs` 造新客户。
- count-proxy@17925（BEFORE/AFTER 测量用）已停止；Edge 已切回直连 A。

## 3｜给 goal-01（A 与共享契约）的缺口（全部 OPEN，见 INTERFACE_REQUESTS.md）

1. `GET /api/v2/customers` 授权客户列表 → 工作台客户选择（等待期 UI 已如实标注范围不完整）。
2. `GET /api/v2/customers/:id/assessments|financing-requests` 权威列表 → 移除 refsSource='event_buffer'
   非穷尽标注（目前历史超缓冲窗口后快照明细引用会减少——已如实标注，不冒充完整）。
3. 事件提交序 / 已提交水位 → 消除 Edge 滞后重查窗口（128）的残余漏事件风险（窗口内自愈已验）。
4. 提示：本轮实测期间曾遇 A 源码中间态（analysis.ts 引用 v2kit 未再导出的 requireVerified）导致
   内核暂不可启动——按并行纪律未代修，等待其完成后续测。此为过程记录，非缺陷移交。

## 4｜给 goal-04（e1/交付/性能脚本）的移交

1. `delivery-seed.mjs` 已与任务01 A2 门冲突（proposeFacility 无 packageId → 409 BASIS_PACKAGE_REQUIRED）。
   我未代修（交付脚本归 goal-04）：本轮以 A `--allow-legacy-basis` 兼容核绕行并如实记录。
   修复方向二选一：seed 绑定依据包（走 Gate 回执/分析运行登记）或 delivery-runtime 显式带兼容核开关。
2. `scripts/public-submission-scan.mjs` 工作区另有他路在途修改（非本路所改），未触碰。
3. 测试需求：见 CHANGELOG §4 与 TEST_RESULTS §NOT_RUN（撤权 404 断流复测、缓存正确性、同源 CSRF
   浏览器四态矩阵、慢客户端/心跳长测、perf 脚本 live 形态）。
4. E1 冻结门照旧（契约 v1.3 登记制）；本路不代开。

## 5｜遗留能力与如实标注（本交付不含）

- 三维场区/人物建模/Unity（D27-S BLOCKED）；音视频媒体传输（blocked_external_access）；手机上传/
  实时视频通道未建——面板均如实标注"未建/未接线"。
- 模型 authority=none；正式审批权限始终在人（服务端矩阵裁决）。
- 已知 P3（未修，不阻塞）：聊天输入 aria-label 在 live 模式带"（合成演示）"字样；
  `demo-data.ts` 无运行时消费方（历史遗留）；rows-logic 深审盲区（前轮审查记录）。

## 6｜回退说明

- Edge C1 缓存/合并：`JW_EDGE_DETAIL_CACHE_MS=0` 关 TTL（事件失效仍在）；缓存与合并均在
  kernel-store 内，不影响对外协议——回退即还原 `kernel-store.mjs` 单文件。
- `--serve-front` 默认关；不传参即回到既有部署形态。
- 前端各修复相互独立；dist 与源码同构可重建（`npm run build`）。无数据库/迁移变更，无数据回滚面。
