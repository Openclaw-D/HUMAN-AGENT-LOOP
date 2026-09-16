# 见微 V3 诚实归档清单

状态：`HISTORICAL SNAPSHOT`

归档日期：2026-08-31

归档 tag：`v3.0.0-archive`

归档前基线：`8a9ca671afe5`（`v2.0.0`）

远端：`https://github.com/Openclaw-D/JIANWEI.git`

## 1. 归档目的

本 tag 保存 V3 当时真实存在的前端、后端、API、SQLite demo runtime、测试、脚本和产品契约，供恢复、比较和复盘。它不是 V4 contract，也不表示 V3 已完成真实集团集成、生产安全或业务试点。

V4 必须在本 tag 之后以独立 contract 开始。V3 不删除、不回写成 V4，也不把历史假设伪装成最新结论。

## 2. 纳入范围

- `app/`：V3 九入口、管理总览候选、工作台与 API Route Handlers；
- `lib/`：Authority、Context、Receipt、RBAC、SQLite shared runtime 与 Projection；
- `test/`：领域、API、幂等、错误路径、SQLite、前端 source contract 与集成回归；
- `scripts/`：本地服务、V3 场景和 HTTP acceptance；
- 根目录文档、技术栈、决策记录与 package lock；
- `docs/v3-archive/contracts/`：此前位于仓库外、实际约束 V3 的七份原始文本契约。

## 3. 明确排除

- `.data/` 下的本地 SQLite、WAL 与 SHM；
- `.glm53-*`、`.z-*`、`z-*.jsonl` 等 worker telemetry（执行遥测）和任务包；
- `.env*` 中的真实环境值、API key、token、cookie 或 session；
- `.next/`、`.vinext/`、`dist/`、coverage、日志和临时验收输出；
- 未授权集团数据、客户材料、内网代码、制度全文和真实 Adapter。

## 4. 已验证能力

- `FinancingLeasingCase` 的合成 Golden Case 与四个只读背景摘要；
- 本地 SQLite 持久化 Context、消息、候选回复、Receipt、Authority Event 和幂等记录；
- 模型、Agent 与普通消息始终 `authority=none`；
- 具名专业角色的 RBAC、Human Gate、Evidence lineage、Receipt、同键重放和同键异载荷冲突；
- timeout、oversize、unknown、busy 和非法输入失败关闭；
- V3 页面在 1920×1080 下无页面级横向或纵向溢出，首页与信审工作台可渲染，console 无 error/warn；
- demo reset 使用持久化唯一请求标识，避免服务重启后错误重放旧 reset。

## 5. 已知限制与 V4 必须替换的历史假设

- V3 Golden Case 固定为直租，domain 没有把直租、存回、新回建模为独立维度；
- V3 仍以 `opportunity / policy / credit / commercial / asset` 五路候选处理为主要运行假设，不等于当前真实线性正式流程；
- V3 没有完整冻结“退回 / 驳回 / 否决”的不同终止性、权限与重新发起规则；
- 自动信审通过与正式起租在 runtime 中虽有不同动作，但尚未形成 V4 所需的完整分段状态模型；
- 根页面的“协同层 / 智能层 / 运营层”、九入口与“价值”仍是 V3 视觉候选，不是 V4 最终认知地图；
- 旧 Role Projection、固定 `FL-DEMO-001`、演示身份和 synthetic KPI 不代表真实组织、真实权限或真实经营结果；
- SQLite 是本地 demo persistence，不是生产数据库；没有真实 SSO、组织目录、租户隔离、保留策略、灾备或生产审计；
- Adapter 仍为 fake/stub；没有接集团系统、真实规则、真实模型或真实客户数据；
- 测试与本机 HTTP/browser 结果不得外推 production SLA、试点价值或商业成功。

## 6. 归档验收证据

归档 commit 前已重新通过以下 Gate：

```powershell
npm.cmd run check
npm.cmd run v3:acceptance:http
git diff --check
```

- `npm.cmd run check`：237/237 tests 通过；typecheck、lint、Vinext build 通过；
- `npm.cmd run v3:acceptance:http`：连续 3 次完整场景通过；每次 50 events、13 receipts、5 个 negative checks；normalized structure 一致；
- `git diff --cached --check`：通过；archive contracts 以 `.gitattributes` 标记为原样历史快照；
- credential scan：未发现 private key 或已知 token 格式；仅存在 `.env.example` 和 README 中的明显占位符；
- Browser Gate：Codex in-app Browser，1920×1080，`/` 与 `/credit` 可真实渲染，无页面级溢出，console 无 error/warn。

这些是本机 archive evidence，不是 production SLA，也不是用户对 V3 产品方向的最终验收。

## 7. 原始契约完整性

以下仓库内快照与 2026-08-31 的仓库外原件 SHA-256 完全一致：

| 文件 | SHA-256 |
| --- | --- |
| `V3_DIRECTION_FREEZE.md` | `0519E9E0D95639F3A929228B93A9FC4EB06127198C6BE6DB5C28B72E78054F3E` |
| `V3_DEMO_NARRATIVE_CONTRACT.md` | `74B1695FBE9656016F126FC16E44FEFC021ED7F00C5FF6F3E7DFC3025944A05C` |
| `V3_GOLDEN_CASE_SCENARIO_CONTRACT.md` | `11783B8AF8B639CE9F1E6E6DE053F2BE779F97564EA6FE63F34A5A3457A7BF73` |
| `V3_ROLE_PROJECTION_CONTRACT.md` | `DF9FA416E48AB3087F49A51C67B58A9739DF48655A07ACC9140D8DC533B94F06` |
| `V3_API_AND_EVENT_CONTRACT.md` | `99BDADD68057F333F79D78665A4B0B1F30D1C0F38A8E05A0C7C20BE2845A251F` |
| `V3_ACCEPTANCE_MATRIX.md` | `5EFB4C3965F4155C27DAD8346C0EEB4EA6CDDC0220984DD47ED910D2A1F2C7C9` |
| `V3_FRONT_JW_HANDOFF.md` | `A4F11234339E409AF86DDB43F14E4E42D7CC2C9D2C1273DD84FC397EA26EB556` |

## 8. 外部视觉资产索引

视觉候选保留在本机 `C:\Users\22673\Desktop\Anthropic\V3_FRONT_JW_ASSETS`，不属于运行代码。为防止误认或错配，本清单记录其哈希：

| 文件 | Bytes | SHA-256 |
| --- | ---: | --- |
| `macro-architecture-v1.jpg` | 58,558 | `297C6921ED7FC7458DA3D08899C0968C47E23839261065996800D47F9B2FC119` |
| `option-1-executive-command-grid.png` | 1,031,255 | `49B21E6F51D74E7D0D6CC651B486342A1C152D7F0750A2A673FB07713C477A11` |
| `option-2-orange-orbit-map.png` | 1,182,342 | `475100224DDC808F6DF206FDEFCD13DF42385B2395419F1E03C36F19AEB4936A` |
| `option-3-modular-panel-map.png` | 1,006,114 | `A8967BFDD6D9738DF2A1F4F8A3D7D11A97C7E975C030971CB4EFA3E2BE93EDD4` |
| `V3-FRONT-JW-BLUEPRINT-v1.png` | 1,182,342 | `475100224DDC808F6DF206FDEFCD13DF42385B2395419F1E03C36F19AEB4936A` |

## 9. V4 边界

V4 的最新冻结入口不是本清单中的历史契约。V4 第一版从以下已确认结论开始：

- 首个活细胞为“直租 + 信审规则命中后的非标例外 Case”；
- 智能能力可以并行准备，正式权威保持线性；
- 退回＝补证后继续，驳回＝本次终止但允许重新发起，否决＝极少数高权威终局；
- 政策是贯穿 Case 的规则、例外和版本服务，不是逐案必经人工审批；
- 当前宏观骨架只作为管理总览，真实 Case 工作面从信审进入。
