# OWNERSHIP｜REMOTE_DD_LONG_RUN

Writer：ZCode 主 Agent（单 writer 串行）。Codex：根 authority + 独立验收（不在场，不宣称其监视）。

## 产品写面（本轮实际落点）

| 文件/目录 | 本轮动作 |
| --- | --- |
| `lib/v5-preview/remote-types.ts` | 新增：会话/证据/标注/复核/规则/核算类型 |
| `lib/v5-preview/remote-store.ts` | 新增：独立存储（remote-store.json@1、原子写、失败关闭校验、幂等表、OCC） |
| `lib/v5-preview/remote-service.ts` | 新增：会话/证据/标注/复核/规则/核算服务逻辑（错误码、过期计算、模拟模型步骤） |
| `lib/v5-preview/shared-types.ts` | 仅追加导出（既有类型不动） |
| `app/api/v5-preview/remote-session/**` | 新增：session / evidence / fixture/[id] / annotations / annotations/replies / reviews / rule-config / calculation 路由 |
| `app/api/v5-preview/remote-session/route.ts` 等 | 共享 `bounded-json-body` 复用；无新依赖 |
| `app/v5-preview/remote-session/page.tsx` | 新增：会议视图（子路由；返回总览保留其状态） |
| `app/v5-preview/remote-session/` 组件 | 新增：meeting/evidence/annotation/review/calc 面板组件 |
| `app/v5-preview/page.tsx` | 最小增量：四域概览加"远程尽调"入口（不改既有逻辑） |
| `app/v5-preview/preview.module.css` | 追加 remote-* 样式（既有类不动） |
| `test/v5-preview-remote.test.mjs` | 新增回归 |

## 明确不改

`rows-store.json@1` 及其读写/校验、既有 notes/messages/project/seed 路由、既有前端恢复机制、其他路由、认证、package/lockfile、Dify 配置、3311 现场。

## 测试服务与数据

- 3321 dev / 3399 生产：沿用既有隔离实例，重启前端口→PID→命令行归属核验；remote 数据目录 `V6/handoff/REMOTE_DD_LONG_RUN/evidence/remote-data/`（与 rows 数据分开）。
- 3311：只读。
- fixture：确定性 SVG 测试图形（显著"合成测试证据"标记），无外网素材。

## 隔离与安全

无新依赖；无真实视频 provider/密钥；modelCalls=0（真实模型未接入，仅 SIMULATION stub）；无真实客户数据；凭证不进源码/URL/日志。
