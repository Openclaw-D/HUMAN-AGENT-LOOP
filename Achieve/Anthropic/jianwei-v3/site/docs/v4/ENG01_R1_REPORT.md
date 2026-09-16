# ENG01_R1_REPORT｜未决核验恢复（sessionStorage 先存后发 + 失败关闭）

状态：`COMPLETE_CANDIDATE（等待 Codex Ctrl 只读复验/裁决；不自写 Accepted）`
`controlRevisionRead`: **0006**（ENG01-R1 AUTHORIZED / SENT）
执行书：`V4/ENGINEERING_CONTRACT.md` §当前增量 ENG01-R1；上一检查点 ENG01 已由 Ctrl 独立复验通过（600/600、真实双端核验）。
`updatedAt`: 2026-09-05T16:55:00+08:00

## 1｜lane 标识与 owner（复用原 FE / TEST，未重建 BE）

| Lane | Agent ID | R1 允许写入（实际写入） | 轮次 |
| --- | --- | --- | --- |
| FE（原） | `agent_0729f6d4-ffbf-40dd-9928-b1bf731c9755` | `app/work/verification-pending-store.ts`（新增，契约授权）、`app/work/VerificationPanel.tsx`、`app/work/WorkShell.tsx` | 3 轮：初版 → 中途审查 3 项 → 修正版 2 边界 |
| TEST（原） | `agent_bd6c360d-d6ee-4005-a81b-608b5bb37e88` | `test/v4life-verification-recovery.test.mjs`（新增，契约授权）、`test/v4life-verification-ui.test.mjs` | 3 轮：故障回归 7 用例 → 审查回归 → 修正版口径/四条件 |
| 主控 | 本会话 | 仅 `docs/v4/ENG01_R1_REPORT.md` | 串行整合 + 全量 Gate + 本报告 |

派发前 writer 核对：代码零活跃 writer；Ctrl 专属 3101 合成服务（PID 8396）未触碰；3100 旧任务自有服务未动；未操作服务/浏览器/端口/Codex；BE 未重建。

## 2｜exact changed files（R1 会话内全部）

1. `app/work/verification-pending-store.ts`（**新增**）
2. `app/work/VerificationPanel.tsx`（修改）
3. `app/work/WorkShell.tsx`（修改）
4. `test/v4life-verification-recovery.test.mjs`（**新增**）
5. `test/v4life-verification-ui.test.mjs`（修改：追加恢复接线断言 + 严格形状/四条件适配，旧断言意图零削弱）

共享边界：后端 `lib/v4life/**`、既有 API 路由、seed、样式 CSS、`/work/screen`、package/lock、根部 authority、旧 ENG01_REPORT **0 diff**；未安装依赖。

## 3｜交付语义（契约 R1 节逐条）

- **存储**：仅 sessionStorage，注入式适配器 `createVerificationPendingStore`；唯一 key `jw:v4:verification:pending:v1`、envelope `{version:1, command}`（strict exact-keys：多键/少键一律 `invalid_shape`）；不读不清理其他 key；无 TTL；无新数据库/服务。
- **先存后发**：发送前同步 `save()`，失败（`write_failure`/`invalid_shape`）→ 显式错误 + 禁用新提交 + 不发送；正常路径存储含 commandId/caseId/actorId/expectedRev 及完整冻结七字段载荷。
- **清除收紧**：仅 accepted/replayed/version_conflict/rejected 四类明确结果触发；`clear(expectedCommandId)` 带 commandId 绑定——记录不匹配 → 新失败原因 `'id_mismatch'`，**不删除**（乱序慢响应不得误清新命令恢复记录）；clear 失败保持未决保护、明示不伪称已清理（同 ID 重试由服务端幂等 replay）；unknown/网络异常分支零存储操作。
- **hydrate 门控**：WorkShell 唯一 owner 恰一次 `load()`；恢复仅建立未决态、**禁止自动发送**（useEffect 内无 send/save/fetch——断言钉住）；恢复完成前（`hydrated=false`）与存储错误（`storageError` 非 null）均禁用新提交；SSR 零 window 顶层访问（storage null → 全操作 `unavailable`）。
- **形状校验与 HTTP 同口径**：七字段恰键；四个 id/reason `trim()` 非空；reason **原始 `length ≤ 2000`**（首尾空白计入，与 `asNonEmptyString(value,2000)` 一致）；目标恰四枚举（'claimed' 非法）；expectedRev 非负整数；save/load/clear 共用同一校验；非法不清理不覆盖损坏记录（损坏原文逐字节保留，断言钉住）。
- **单一 in-flight 锁**：WorkShell owner 持有唯一 `verificationInFlight`，双挂载实例共享——任一端发送中，两端提交/重试禁用（消除同 ID 并发窗口）。
- **reset 门控四条件**：`resetBlocked = 未决存在 || 发送中 || !hydrated || storageError 非 null`——恢复未完成/坏记录/发送中/未决存在任一情形禁止演示 reset（不得清服务端 journal 后放行旧命令重试），未决记录不因 reset 静默丢失。
- **诚实边界**：仅同一标签页刷新恢复；不宣称跨标签页/关窗恢复/事务 exactly-once；无持久化（非生产合规方案）；后端角色/权威/默认 candidate 隔离零改动。

## 4｜Control 审查链（两轮，全部并入）

**中途只读审查 3 项**：① store 严格化（envelope/command exact-keys、全空格拒绝——Ctrl 用真实 store 验证出额外键放行）；② 单一 in-flight 锁 + clear 按 commandId 绑定（慢旧响应不得清新命令记录）+ 乱序回归；③ WorkShell reset 未决/发送中禁用。
**修正版 2 边界**：A. reason 长度改原始 `value.length` 口径（HTTP 一致）+ 首尾空白超限回归；B. resetBlocked 扩四条件（`!hydrated`、`storageError` 非空并入）。

## 5｜Gate（真实退出码，无截断）

| Gate | 命令 | 结果 | 退出码 |
| --- | --- | --- | --- |
| R1 前基线 full test | `npm.cmd test` | 600/600（ENG01 交付态，Ctrl 已复验） | 0 |
| Focused（verification 三文件） | `node --experimental-strip-types --test --experimental-test-isolation=none test/v4life-verification-{http,ui,recovery}.test.mjs` | **38/38**（HTTP 10 + UI 17 + recovery 11） | 0 |
| Full test | `npm.cmd test` | **612/612，0 失败** | 0 |
| typecheck | `npm.cmd run typecheck` | 无错误 | 0 |
| lint | `npm.cmd run lint` | 0 问题 | 0 |
| build | `npm.cmd run build` | Build complete（vinext） | 0 |

recovery 可执行回归要点（真实执行 store，非仅正则）：reload 七字段逐字段一致；先存后发（save 失败分支无网络语义）；三存储方法异常注入 → 精确 failure reason 不外抛、`clear_failure` 后原记录可回读；坏 JSON/版本 2/缺字段/'claimed'/非整数 rev → 拒收且原文逐字节不变；envelope/command 额外键拒收；全空格拒收；原始 2004（trim 后 2000）拒收；`clear('Y')` 对 X 记录 → `id_mismatch` 且 X 保留；SSR null/undefined storage 全 `unavailable`；hydrate 恰一次 + 恢复不自动发送；reset 门控四条件缺一即失败。

## 6｜未验证项与风险（不自写 Accepted）

1. **浏览器刷新恢复的运行时 Gate 未做**（归 Ctrl）：本环境禁操作服务/浏览器；sessionStorage 真实刷新行为、桌面/手机双端切换下的恢复仅有结构断言 + store/纯逻辑真执行，无渲染级与浏览器存储级验证。Ctrl 用独占 3101 合成面复验。
2. hydrate 在 client effect 内经 microtask 落定：存在极短 `hydrated=false` 窗口（提交与 reset 均禁用，保守方向）；StrictMode 开发态 effect 双跑只读幂等无副作用。
3. 存储不可用（隐私模式等）按契约整体失败关闭：新提交与 reset 持续禁用直至环境恢复，属契约要求而非缺陷。
4. `clearPendingFor` 的 ref 比对依赖 prop→effect 同步时序；极端乱序落入 `id_mismatch` 保持保护（保守）。
5. 双端 in-flight 共享锁会同时禁用另一端表单控件（比仅禁按钮更严，保守方向）。
6. TEST 结构断言锚定当前实现形态（`disabled={resetBlocked}` 单标识符 + 一跳 const 解析、箭头函数初始化等）；实现形态大改时按意图适配（TEST 报告风险原样记录）。

主控停写。等待 Codex Ctrl 只读复验与裁决。
