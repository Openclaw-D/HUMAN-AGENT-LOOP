# ENG01_REPORT｜材料核验最小闭环（ZCode 主控交付）

状态：`COMPLETE_CANDIDATE（等待 Codex Ctrl 只读复验/裁决；不自写 Accepted）`
`controlRevisionRead`: **0005**（ENG01 AUTHORIZED / SENT）
执行书：`V4/ENGINEERING_CONTRACT.md`（唯一执行书）；控制文件 `docs/v4/ZCODE_CONTROL_CHANNEL.md` Rev 0005。
`updatedAt`: 2026-09-05T15:45:00+08:00

## 1｜实际启动的任务标识与 owner（原生 Harness subagent）

| Lane | Agent ID | Owner 文件（单文件单 writer） | 交付 |
| --- | --- | --- | --- |
| BE | `agent_ae1822c9-481c-4263-8182-4cfd690cf602` | `app/api/v4life/cases/[caseId]/verification/route.ts`（新建） | 1 轮交付，无返工 |
| FE | `agent_0729f6d4-ffbf-40dd-9928-b1bf731c9755` | `app/work/VerificationPanel.tsx`、`app/work/verification.module.css`（均新建）、`app/work/WorkShell.tsx`（最小插入） | 3 轮：初版 → Control 纠偏 3 缺陷 → 修正版 2 项 |
| TEST | `agent_bd6c360d-d6ee-4005-a81b-608b5bb37e88` | `test/v4life-verification-http.test.mjs`、`test/v4life-verification-ui.test.mjs`（均新建） | 3 轮：26 断言 → 行为回归 → 24/25 误判修正 |
| 主控 | 本会话（sess_d099dd9f-5d15-41d7-b8a0-5035e2c1c45f） | 仅 `docs/v4/ENG01_REPORT.md` | 串行整合 + 全量 Gate + 本报告 |

派发前 writer 检查：最近 2 小时仓库零代码写入（仅 Codex Ctrl 写自己的控制文档）；无活跃 lane；未重做并发实验。

## 2｜exact changed files（本轮会话全部，其余工作区 dirty 为 312 文件既有基线）

1. `app/api/v4life/cases/[caseId]/verification/route.ts`（新增）
2. `app/work/VerificationPanel.tsx`（新增）
3. `app/work/verification.module.css`（新增）
4. `app/work/WorkShell.tsx`（修改：import + 单一共享未决 state + verification 元素单定义/desktop·mobile 两处挂载）
5. `test/v4life-verification-http.test.mjs`（新增）
6. `test/v4life-verification-ui.test.mjs`（新增）

共享边界确认：`lib/v4life/**`（engine/types/runtime/seed/journal）、`app/api/v4life/**` 既有路由、`/work/screen`、scripts、package/lockfile **0 diff**；seed 未动；未启动/重启服务、未抢端口、未操作浏览器、未操作/联系 Codex。旧 3100 服务为上一轮任务自有遗留，本轮未触碰。

## 3｜交付语义（对应执行书 ENG01 条款）

**BE（冻结接口）**：`POST /api/v4life/cases/[caseId]/verification`。守卫按序失败关闭：① `NODE_ENV=production` → 404 伪装 CASE_NOT_FOUND（不读 params/body）；② `caseId !== V4LIFE_DEMO_CASE_ID` → 404；③ `resolveV4LifeCaseEngine` undefined → 404；④ body 经既有 `parseChangeVerificationBody`，失败 400；⑤ `engine.changeVerification` 原样调用（不在路由新建引擎、不传 mode）。accepted→201 / replayed→200；错误经 `v4LifeErrorResponse`（ROLE_MISMATCH 403、EVIDENCE_NOT_FOUND 404、VERSION_CONFLICT/IDEMPOTENCY_CONFLICT 409 等）。默认 strict 引擎因 P1-BE-01 candidate 闸门返回 400——请求不能把默认引擎打开 candidate；demo runtime（`p1CandidateSemantics='demo'`）正常工作。不产生 Receipt，不冒充审批。

**FE（窄核验区域）**：`/work` 主工作区窄面板，精确标注「合成演示 / 候选岗位语义，非正式审批」；材料下拉带服务端核验状态文字；目标状态仅四值（无 'claimed'）；理由必填禁用提交；灰阶线框（CSS 全中性灰、语义走文字）、未改历史 CSS；desktop mainCol 与 mobile「事项」pane 两处挂载。命令纪律（经两轮 Control 纠偏后最终形态）：
- 严格 envelope 判定 `parseVerificationOutcome`：成功必须 200/201 + 合法 JSON + `status ∈ {accepted,replayed}` + `evidence.evidenceId` 与命令一致 + rev 为整数；409+VERSION_CONFLICT → version_conflict（清未决、onRefresh、不自动重发）；其余 4xx → rejected（终结）；**5xx/格式异常/网络异常 → 结果未知：保留原命令、不清空、不伪造成功、仅可重试同一原载荷**；
- `canComposeCommand`：存在未决命令期间禁止组装/提交新命令（两端一律）；
- 命令组装时冻结 caseId+actorId；绑定不一致 → 显式待确认态（重试/新提交禁用、显示原绑定摘要、切回原绑定可重试）；**无任何清空/放弃入口**——未决命令在明确结果前不清空、不被覆盖（无持久化，页面刷新丢失本地记录，服务端 journal 幂等兜底）；
- **单实例语义**：未决命令 state 上提 WorkShell（`verificationPendingCommand` 唯一 useState），`<VerificationPanel>` 受控（`pendingCommand`/`onPendingCommandChange`），verification 元素单定义、desktop/mobile 两处挂载共享同一 state——viewport 切换无法绕过保护。

**TEST（26 断言，含可执行行为测试）**：HTTP 10（G1 全矩阵：201+投影/rev/事件回读、幂等不重复事件、版本/角色/演员/目标状态/空理由/缺字段 400·403·404·409、非 demo case 404、production 404、**默认 strict 引擎不被请求打开 candidate** 400）；UI 源码不变量 11；**可执行行为 5**：从 `VerificationPanel.tsx` 的 `<!-- ENG01-VERIFICATION-PURE-LOGIC-START/END -->` 标记区切取真实交付源码 → 临时目录动态 import（strip-types）→ 执行 envelope 全矩阵 13 行（200 非 JSON/空体/缺绑定/rev 非整数→unknown；5xx→unknown；409/403/404/400 精确分类）、canCompose 门控、双端绑定 match/stale、载荷逐字段一致；另有变异抽查证明检出力（绑定恒假/删 rev 校验均被捕获）。

## 4｜Gate（G0/G2，真实退出码，无截断）

| Gate | 命令 | 结果 | 退出码 |
| --- | --- | --- | --- |
| G0 基线 full test（派发前） | `npm.cmd test` | 574/574，0 失败 | 0 |
| Focused（本轮新增） | `node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-verification-http.test.mjs test/v4life-verification-ui.test.mjs` | 26/26 | 0 |
| Full test（整合后） | `npm.cmd test` | **600/600，0 失败**（574 + 26） | 0 |
| typecheck | `npm.cmd run typecheck` | 无错误 | 0 |
| lint | `npm.cmd run lint` | 0 问题 | 0 |
| build | `npm.cmd run build` | Build complete（vinext） | 0 |

## 5｜Control 中途审查与纠偏记录（两轮，全部合并）

**第一轮（3 缺陷）**：① 成功判定仅凭 response.ok → 改严格 envelope 校验，异常/5xx 归"结果未知"不清空不伪造；② 未决存在时可绕过重试新提命令 → `canComposeCommand` 共享门控；③ case/actor 无绑定 → 命令冻结绑定 + 待确认态。TEST 同步补可执行行为回归（标记区切取→动态 import，非仅正则）。

**第二轮修正版（A/B + C）**：A. 移除"放弃未决命令"清空入口——未决在明确结果前不清空/不覆盖，stale 只禁用+显示原绑定、切回可重试；B. WorkShell 双挂载绕过 → 未决 state 上提父级单一 useState、组件受控化、元素单定义两处挂载；C. lane 报告改为摘要制（已执行）。

**第三轮（复跑裁定）**：Ctrl 独立复跑定位 test 24/25 为 TEST 结构检查误判（元素单定义双挂载引用、解构别名即 prop 通道）；TEST 按真实数据流修正断言，真不变量（父级唯一未决 state、无本地未决 state、两端共享、无丢弃入口、未决不清空不覆盖）全部保留；复跑 26/26 exit 0。

## 6｜未验证项与风险（不自写 Accepted）

1. **浏览器/桌面·手机操作 Gate 未做**（G3 归 Codex Ctrl）：本 environment 本轮禁止起服务与浏览器；面板真实交互（pending 文案、stale 待确认块、双端切换）仅有源码断言 + 纯逻辑行为执行，无渲染级验证。Ctrl 按契约用独占合成状态 HTTP/浏览器复验。
2. 双挂载实例各自持有实例内 in-flight `pending` 布尔旗标：极窄窗口内双端可并发重试**同一** commandId+同一载荷，服务端按幂等返回 replayed，无重复副作用（未扩产品语义）。
3. 页面刷新丢失本地未决记录（无持久化，按 Control"无需新增数据库"）；服务端 commandId journal 兜底幂等。
4. HTTP Gate 为进程内 handler 集成测试（不启动网络服务），未做真实端口冒烟；`/work` 页面在 dev/prod 服务器上的端到端核验留待 Ctrl。
5. test 24/25 的结构断言锚定当前实现形态（`const verification = (<VerificationPanel/>)` 单定义、解构别名），实现形态大改时需按意图微调（TEST 报告风险 1/2/3 原样记录）。
6. 核验仍是 CANDIDATE 岗位语义：不代表正式核验岗位已被用户/有权专家接受；candidate 隔离默认关闭未被本轮改变。

主控停写。等待 Codex Ctrl 只读复验与裁决。
