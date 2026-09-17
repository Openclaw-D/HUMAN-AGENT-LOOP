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

### 非作者独立复核（2026-09-17，执行者：ZCode 非作者独立复核代理——未参与任务三任何被复核文件的编写；非 Codex）

按 REVIEW_BRIEF §1–§3 完成只读复核与运行验证。范围：§1 清单关键文件全读（Back/Edge：kernel-store/server/session/proxy/version/edge-start/edge-stop/delivery-up/delivery-down/task3-boot/task3-gate/两支 E1 用例/contract/consumed-surface-v1.json；Front：edge-logic/edge-client/use-edge-live/edge-panels），并对照 Back/A/src/http/server.ts 实际路由核验消费面。

验证命令真实退出码：env-check exit 0（fail=0，busy 端口未被处置，3 项能力位 BLOCKED 为如实标注）；node test/run-all.mjs exit 0（27/27）；e1-task3-inspection exit 0（1/1）；e1-task3-scenario exit 0（1/1）；Front typecheck exit 0 + npm test exit 0（19/19）；backup-restore-drill 首跑 exit 1（15434 被外部 e1-d02 测试族循环容器 v7d-pg-d6926d5071 占用，非本复核遗留，按边界未处置），端口空闲复跑 exit 0（PASS，12 步，证据 s5-drill-20260916-211808）。dist 产物 hash 与任务书声明一致（index-Cymdx02J.js）。

§2 七问结论：1/2/3/4 成立（含两处作者自报修复的实证确认：kernel-store.mjs:64,67,97-98 的 Number() 归一与 :20 的 600ms 轮询；凭据仅在服务端会话记录与上游头中出现，响应/日志/审计/静态资源全链 grep 无原文）；5 基本成立（Edge 停止三证含命令行 marker 可防 PID 复用；A 停止三证较弱，见 P3；30s 阈值失效方向为拒绝，安全）；6 大体成立（绿灯后于服务端确认、拒绝原样透出，两处 P3）；7 大体一致（消费读取 8 条与主要写路径全部在 A 路由实测在位；漂移 3 处均为快照滞后，列出不改）。

缺陷结论：无 P0–P2。P3 共 7 项（逐条文件：行号见复核报告）：①subscribe 游标失效静默（kernel-store.mjs:233-235，理论缺口）；②v1 族动作回执经 Edge 不可查而 502 提示指引查回执（server.mjs:260-278、proxy.mjs:168）；③UI 重试不复用 requestId（edge-panels.tsx:73，现受 expectedVersion 保护，额度命令接入前必须整改）；④事件流 401/403 并入无限重连、auth-failed 态从未派发（edge-client.ts:124-127、use-edge-live.ts:74-83）；⑤A 停止三证无命令行复核且 heartbeat 反映监督进程（delivery-down.mjs:40-57）；⑥消费面快照缺 disburse 与检查会话写面少列（consumed-surface-v1.json:42,51-56）；⑦凭据输入未掩码（edge-panels.tsx:48）。

环境备注（非代码缺陷）：本机存在外部循环拉起的 e1-d02 测试族 PG 容器（.run/e1-d02-pg，约每分钟起落）间歇占用 15434，与 drill/E1 共用固定端口会碰撞；建议长期为各族分配不同测试端口段。

复核结论：**接受**。P3 项不阻断任务三交付验收，作为非阻塞整改项带入下一迭代（其中③在额度命令接入前端前必须先改——复核后作者已修复③④⑦并补⑥口径、修正②提示文案，①⑤列为遗留见 HANDOFF_DEFECTS T5）。

### P2 整改闭合确认（2026-09-17，ZCode 非作者独立复核代理）

对增量复核 P2 项（kernel-store.mjs pullEvents 未声明变量 maxSeqThisPull）的整改进行只读闭合确认：①该行已按建议方案一删除，全仓 grep 无代码级遗留引用；②防死循环语义由既有三重保证覆盖（<500 退出 / byId eventId 去重 / MAX_POLL_PAGES=20 页上限），探针实证恒满页场景下单次 pull 恰 20 页收口、lastSeq 推进正常（7568）、notes 为空、freshness.events.ok=true 如实恢复；③整改后独立复跑：Edge E0 27/27、e1-task3-scenario 1/1 通过；e1-task3-inspection 曾因 A lane 06:51 对 inspection.ts 新增会话版本自增出现断言过期（VERSION_CONFLICT，与 Edge 整改无因果），已移交 A/test lane 对齐后由任务三以重读快照+换新 requestId 重试模式复绿。**P2 闭合成立，增量复核整体结论由有条件接受更新为接受**；遗留 P3 项保持非阻塞建议。

### 增量复核（2026-09-17，执行者：ZCode 非作者独立复核代理，同前次非作者复核身份）

针对 C1 授权修复版整体重写的 kernel-store.mjs 与 server.mjs csrfCheck/调用点增量、任务三 lane 两处外科修复（customer 主读取不走 settle 保 404 透传；exposure/findings/object-inventory 显式 pick）做只读增量复核。结论：**有条件接受**——唯一阻断整改项为 kernel-store.mjs:171 maxSeqThisPull 未定义（P2，满页必抛 ReferenceError，探针实证；E1 小数据量下休眠）→ **已整改并经上节确认闭合**。另 6 项 P3 非阻塞：throw 死代码、角色 403 并入撤权、重查窗口恒定放大、E1 snapshotVersion 字符串比较（已随整改修复）、boot 清理时序（已随整改修复）、server auth 帧前端无消费者（并行 writer 已在 edge-client/onAuth 接线）。csrfCheck X08/T6 收紧逐分支审查未发现新绕过；消费面契约已同步升版 task03-repair-1。


### 作者侧预审（2026-09-17，ZCode 自查；**不构成独立验收**）

按 review-agent 缺陷优先流程对 §1 全部文件复查一遍。发现并当场修复 1 项：
- [P2] delivery-up 在配置缺 authEntries 时静默写入空身份目录 → 改为显式提示"会话交换将失败关闭"并清理旧文件（`scripts/delivery-up.mjs`）。
确认安全的重点面（复核者可抽查）：订阅注册窗口/Edge 重启 resync/多订阅者共享缓冲（kernel-store）、
凭据仅存服务端会话记录（session.mjs；响应与日志无原文）、代理白名单正则与顺序（proxy.mjs）、
三证复核拒杀路径（delivery-down 两次实拒 + 一次放行均有留档）。
**§8 的"非作者复核"门仍待 Codex 或其他非作者执行——以下记录留空。**

（待非作者复核者填写）
