# 任务三 · 非作者复核移交包（REVIEW BRIEF）

2026-09-17。用途：交由 Codex 或其他非作者执行者对本轮任务三自写代码做独立复核。
作者：ZCode（任务三执行槽）。纪律：复核者**只读运行验证**，不修改文件；不 commit/push；
不停止未知进程；测试使用隔离端口/数据库（脚本已内置）。本包不含真实凭据（运行时配置在 Git 排除项中）。

## 1｜复核范围（本轮任务三新增/修改，非 A/B/C 业务实现）

### Back/Edge（任务三主写入域）
| 文件 | 内容 |
|---|---|
| `src/kernel-store.mjs` | 真实 A 内核→Edge 投影（workspace/SSE/轮询/受限降级）。重点：一致性边界（游标/去重）、错误透传、不缓存授权 |
| `src/server.mjs` | --live 装配、workspace/events 会话凭据传递、上游错误映射、回执代理、CORS/OPTIONS 允许列表 |
| `src/session.mjs` | 会话记录保留上游凭据（服务端内存；响应绝不回传） |
| `src/proxy.mjs` | 白名单扩展（v2 授信面 + 检查会话面）；requestId 强制；UPSTREAM_UNKNOWN 不重试 |
| `src/version.mjs` | 版本封存扩展（consumedSurface/rulePack/fourDomainTools/lockfiles/scene/unityBuild） |
| `src/store.mjs` | 未改（fixture 基线，供对照） |
| `contract/consumed-surface-v1.json` | 消费面契约快照（版本化；上游漂移判据的基准） |
| `scripts/delivery-up.mjs` / `delivery-down.mjs` | 编排启停（前置检查/幂等迁移/矩阵播种/三证复核停止） |
| `scripts/delivery-seed.mjs` | 演示种子（全部真实 API，无 DB 直写；已冒烟验证） |
| `scripts/perf-m4-probe.mjs` | §7 全链路可见性测针（20 样本，独立于 perf-baseline） |
| `scripts/env-check.mjs` | 环境只读检查 |
| `scripts/repeat-scenario.mjs` | C11 稳定性执行器（轮次/时长模式） |
| `scripts/perf-baseline.mjs` | 性能基线（新增 M4 全链路内核模式） |
| `scripts/backup-restore-drill.mjs` | 演练扩展到全部迁移 + 幂等建库（其余逻辑未动） |
| `scripts/edge-start.mjs` | 透传 --live/--auth-file/--allowed-origin；fixture-auth 仅非 live |
| `test/e1/task3-boot.mjs` / `task3-gate.mjs` | E1 共享引导/任务三门 |
| `test/e1/e1-task3-scenario.test.mjs` | 贯穿场景 E1 |
| `test/e1/e1-task3-inspection.test.mjs` | 检查会话面 E1 |
| `test/e1/e1-d02-real.test.mjs` | 仅修 pgctl 导入路径（历史缺陷） |
| `delivery/OPS.md`、`delivery/DELIVERY_MATRIX.md`、`delivery/HANDOFF_DEFECTS.md` | 操作手册/验收矩阵/缺陷转交 |

### Front（本轮必要前端接线；页面结构与既有组件未重做）
| 文件 | 内容 |
|---|---|
| `site-mirror/lib/v5-preview/edge/edge-logic.ts` | 纯逻辑（SSE 解析/状态机/动作推导/额度文案）——重点复核"只做形状转换、不发明状态" |
| `site-mirror/lib/v5-preview/edge/edge-client.ts` | HTTP/SSE 客户端（凭据只送一次；SSE 手动流解析；UPSTREAM_UNKNOWN 保留 requestId） |
| `site-mirror/lib/v5-preview/edge/use-edge-live.ts` | 连接生命周期 hook（去重/防抖/对账中状态） |
| `site-mirror/lib/v5-preview/edge/edge-panels.css` | 面板样式 |
| `site-mirror/app/v5-preview/edge-panels.tsx` | 四项 UI（状态条/会话操作条/核验卡/额度报告区） |
| `site-mirror/app/v5-preview/home-overview.tsx` / `home-role-view.tsx` | 挂接点（最小改动） |
| `preview/test/edge-logic.test.mjs` | 纯逻辑 8 用例 |
| `package.json` | 仅 test 脚本追加一个文件 |
| `dist/**` | `npm run build` 重建产物（hash index-Cymdx02J.js） |

### 根
- `.gitignore`：追加 2 行（delivery-runtime.json / edge-auth.json 凭据排除；示例文件保持跟踪）。

## 2｜建议复核问题（按风险排序）

1. kernel-store 的"至少一次投递 + eventId 去重"是否有缺口（尤其订阅注册窗口、Edge 重启 resync、多订阅者共享缓冲）？
   ——本会话实测发现并已修的两处请重点过目：①A 返回 bigint `seq` 为字符串 → `lastSeq` 水位曾永不推进（已 Number() 归一，
   `src/kernel-store.mjs` toEnvelope/pullEvents）；②轮询间隔默认 600ms（跨客户端可见性 p95 目标的主导项，M4 实测 p95=612ms）。
2. 会话凭据留存（session.credential）是否可能泄漏到响应/日志/静态资源？审计与日志路径是否已排除？
3. proxy 白名单是否有任意 URL 代理面（正则是否过宽/顺序是否可被绕过）？
4. kernel-store 对 403（customer 角色受限）的降级是否可能掩盖本应失败的写路径？（只读路径降级、写路径透传——验证之）
5. delivery-up/down 的三证复核是否可被 PID 复用绕过？heartbeat 30s 阈值是否合理？
6. 前端四项是否存在"本地造状态"（后端拒绝被吞掉/绿灯先于服务端确认）？
7. consumed-surface-v1.json 是否与 A 实际路由一致（漂移点指出即可，不要求改）？

## 3｜验证命令（逐条给退出码；全部只读/隔离）

```bash
cd Back/Edge
node scripts/env-check.mjs                      # 期望 exit 0（FAIL=0）
node test/run-all.mjs                           # 期望 27/27, exit 0
node --test test/e1/e1-task3-inspection.test.mjs  # 期望 1/1（需 docker；15434/17919 空闲）
node --test test/e1/e1-task3-scenario.test.mjs    # 期望 1/1（同上）
node scripts/backup-restore-drill.mjs           # 期望 PASS（12 步）
cd ../../Front && npm run typecheck && npm test # 期望 0 错 / 19/19
```

交付栈现场（可选）：`cd Back/Edge && node scripts/delivery-up.mjs`（需 config/delivery-runtime.json，
复制 `.example`）→ `node scripts/delivery-seed.mjs` → 浏览器 http://127.0.0.1:48200/harness/ 与
Front 首页连接真实后台 → `node scripts/delivery-down.mjs`。

## 4｜既有证据位置（复核者可抽查，不必信任自报）

- `docs/customer-next/acceptance/evidence/task3-20260917/`（env-check.json / edge-all.log / a-suite-final.log / delivery-updown.log / stability-copy/）
- `docs/customer-next/acceptance/evidence/task3-stability-20260916T183026/`（十轮逐轮日志+汇总）
- `docs/customer-next/acceptance/evidence/perf-baseline-*/`（性能测量 JSON）
- `Back/Edge/.run/task3-e2e/`（connection-matrix.json / scenario-result.json；Git 排除的运行态）

## 5｜复核结论口径

接受 / 有条件接受（列整改项）/ 拒绝（列缺陷）。结论回填本文件末尾"复核记录"一节并签名（执行者标识+时间）。
**未复核前，任务三自写代码只能标记"作者自报通过"，不得作为独立验收。**

## 复核记录

（待非作者复核者填写）
