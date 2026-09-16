# V6-CTRL 第一批修复｜交付报告（FIX_REPORT）

日期：2026-09-12。执行：ZCode（主 Agent 单 writer 串行实现；未派生 sub-agent——本批为小范围点修，四个缺陷均为单文件局部逻辑，按任务书"共享接口由一个集成 owner 串行修改"直接实施）。任务契约：`V6/ZCODE_FIX_BATCH_1.md`（未改写）。

## 1｜精确修改文件清单（全部在允许写面内）

| 文件 | 修改内容 |
| --- | --- |
| `lib/v5-preview/service.ts` | A：postMessage 增加与 submitNote 一致的乐观并发门（幂等重放后、写入前，409+serverVersion）；D：seedScenario 版本改为全局单调（当前+1，不再回 7/23/41）；E：submitNote 后总体说明按四域判断灯动态派生（deriveOverallDescription），系统消息与三情景描述改为中文口径（去除 Decision/Receipt），新增投影出口 projectOverview（GET/notes/messages/seed 响应统一重派描述，纠正存量不一致状态） |
| `lib/v5-preview/store.ts` | B：新增纯校验函数 validateProjectOverviewShape（项目字段/情景/版本/时间/整体进展/待办或 null/消息数组/恰好四域按序各一次、每域四合法段状态+四非空段名+合法判断灯+非空文本摘要）；parseStoredState 深递归调用；幂等表逐项校验 requestId/hash/完整 response.overview/replayed 只能为 boolean 或缺省 |
| `app/v5-preview/rows-logic.ts` | C：新增 reuseAttemptBody（完整原请求复用判定）与 shouldApplyOverview（旧 overview 不回退判定）纯函数 |
| `app/v5-preview/api-client.ts` | C：新增 postNoteBody/postMessageBody（按调用方准备的完整请求体发送） |
| `app/v5-preview/page.tsx` | C：PendingAttempt 改存完整原请求体；同文本重试原样重放（含首次 expectedVersion/todoId），文本被改则作废按新请求；重放响应经 shouldApplyOverview 防回退；D：切换成功显示"已切换演示情景；此前演示记录已重置"；E：顶栏改"合成演示数据，不执行正式审批"，情景切换失败提示不再暴露内部错误码 |
| `app/v5-preview/todo-card.tsx` | E：入口"提交材料"→"补充说明"；表单 label 去英文；placeholder 不暗示附件 |
| `app/v5-preview/chat-panel.tsx` | E：label 去英文 |
| `app/v5-preview/rows-view.tsx` | E：页脚去除重复英文边界提示（保留顶栏一处） |
| `app/v5-preview/domain-row.tsx` | E：四段名称点击"段名"轻量展开/收起（chips：段名·状态），默认收起，手机无需悬停 |
| `app/v5-preview/preview.module.css` | E：segToggle/segNameChip 样式；顶部间距压缩（首屏待办提前） |
| `test/v5-preview.test.mjs` | 断言适配（补充说明/无英文/新增 C 纯逻辑与接线断言）：22/22 |
| `test/v5-preview-v6fix.test.mjs` | **新增**进程内 A-D+E 测试：21/21 |
| `test/v5-preview-http.test.mjs`、`test/v5-preview-recovery.test.mjs` | D 语义适配：seed 版本断言改为"当前+1"关系断言（**本批未运行**，见 §4） |

说明：任务书清单未列 `api-client.ts`/`rows-logic.ts`，按其兜底条款"以现有 app/v5-preview/** 对应组件为准"纳入实现面；`progress-ruler.tsx` 实际不存在（ROW 交付时未建此文件）。共享类型 `shared-types.ts` 本批零修改（未扩大业务接口）。

## 2｜逐项缺陷：旧复现 → 通过

复现命令（隔离 probe-data，不触碰演示存储）：
`node --experimental-strip-types V5/handoff/ROWS_FULLSTACK/V6_FIX_BATCH_1/evidence/probe/probe.mjs`（副本仅改两行 import 相对深度以适配目录层级；Codex 原件与原 probe-results.json 未动）

| 探针检查 | 修复前（probe-results.json） | 修复后（probe-rerun.json） |
| --- | --- | --- |
| 旧版本沟通应拒绝 | **accepted:true, version 8→9（缺陷 A）** | `VERSION_CONFLICT` |
| 结构损坏应拒绝 | **accepted:true，返回四个 null 域（缺陷 B）** | `STORE_CORRUPT` |
| 情景重置后旧版本请求 | **accepted:true, version 8（缺陷 D）** | `VERSION_CONFLICT` |
| 补充说明保存/黄灯待复核/重放不重复 | 通过 | 通过（无回归） |
| 模拟前端轮询后重试 | REQUEST_MISMATCH | 仍 REQUEST_MISMATCH——**该探针行模拟的是旧前端行为**（换 expectedVersion 重试）；C 的修复在前端保留完整原载荷：FE 测试断言重试体 expectedVersion=7，v6fix"C"用例证明原载荷重试 → replayed:true 且服务端不重复记账。请求-响应丢失的端到端重放由 Codex 隔离环境按 http 套件复验 |

新增进程内断言（v6fix 21 用例）覆盖：A 拒绝后不递增不追加；B 11 种畸形总览 + 3 种畸形幂等响应全部 STORE_CORRUPT 且文件保留原样；C 重放命中且服务端不回退；D 三连切换版本单调（7→8→9→10…）+ 旧批次 7 被拒；E 描述同步"信审待复核"且黄灯不变、全部消息无英文边界词。

## 3｜测试与构建（实际命令与结果）

| 命令 | 结果 | exit |
| --- | --- | --- |
| `node --experimental-strip-types --test test/v5-preview-v6fix.test.mjs` | 21/21（隔离数据目录，进程内直调 service/store） | 0 |
| `node --experimental-strip-types --test test/v5-preview.test.mjs` | 22/22（含 V6-CTRL E/C 新断言） | 0 |
| `npm.cmd run typecheck` | 无错误 | 0 |
| `npm.cmd run lint` | 0 error / 1 warning（既有 v4life 未用变量，非本轮写面） | 0 |
| `npm.cmd run build` | Build complete，v5-preview 全路由注册 | 0 |
| **未运行**：`npm.cmd test`（全量 647）与 `test/v5-preview-{http,recovery}.test.mjs` | **原因**：需自起 next dev 实例，而项目开发锁（`.next/dev/lock`）被现场 3311 服务持有；契约禁止中断/重启该服务。两文件的 D 版本断言已适配（语法检查通过），建议 Codex 隔离环境复验时执行 | — |

## 4｜浏览器证据（3311 现场服务未中断；HMR 热加载修复后验证）

- **桌面 1920×1080**（实测 innerWidth）：`v6-01-desktop-1920x1080.png`（收口后总览）、`v6-02-desktop-seg-names-expanded.png`（信审"段名"展开四枚 chips：材料齐备性·已完成 等）、`v6-03-desktop-scenario-switch-notice.png`（顶部"已切换演示情景；此前演示记录已重置"提示 + 全绿已结清情景）。
- **手机 390×844**（实测 391×844）：`v6-04-mobile-390x844-firstscreen.png`——无横向溢出；顶部说明压缩后待办卡于折线处进入首屏（todoTop≈842px）；"段名"切换与中文口径在位。
- 演示操作说明：验收截图过程中执行过演示情景切换与还原（合成数据，属演示控制；现场数据除情景切换重置外未清除，切换提示已在页面明示）。

## 5｜已知限制与未运行项

1. HTTP 全量回归未运行（开发锁，见 §3）——http/recovery 两文件已适配 D 语义且语法校验通过，待 Codex 隔离环境执行。
2. 演示身份为服务端受控本地合成角色，非生产鉴权；JSON 文件为单进程合成存储，非多实例数据库（与契约口径一致，本批未改变）。
3. BE 侧 NOT_FOUND 文案仍含内部 todoId（前端已映射友好文案）；属低优先遗留，不在本批四项缺陷范围。
4. 截图管道（IAB）偶发超时为本 Harness 已知问题；所有关键断言均以 DOM/接口读取二次取证。

## 6｜停止原因

四项缺陷与中文收口已完成并自证；无越界需求、无资源阻塞。按任务书停止，等 Codex 独立复验（A-D、HTTP 异常、刷新与重启恢复、390×844 与 1920×1080 真实浏览器）。
