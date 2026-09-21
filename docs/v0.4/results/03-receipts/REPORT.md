# V0.4 · 03 模型回执/未知防重发专项回归与历史用量对账 · 报告

2026-09-21 · ZCode（单writer，仅本路 ownership 内写入）· 基线 git HEAD=`e298a789bc9d49eac23a17f9dfe75244f73ca64f`

**结论：验收完成。历史用量对账逐 requestId 闭合（28 次出站全部找到证据，含回执层补齐 2 次误出站的 usage）；所有权文件（`Back/Edge/src/assistant-receipts.mjs`、`Back/B/src/transport/glm.mjs`）经 37 例替身回归核验未发现已证实缺陷，故产品源码零改动、无需修复；两处历史报告口径差异如实呈报（不改历史报告）。全部本地替身回归两轮 37/37 全绿（exit 0），既有基线 37/37 全绿，源码 SHA256 零漂移。未跑真实 GLM、零真实出站、零凭据读取、未触碰历史账本/回执/其他三路在途文件。**

---

## 1. 历史用量对账（real-api-qa 轮，zloop 栈，2026-09-20 17:20–18:00Z）

工具：`reconcile.mjs`（只读），输出 `RECONCILIATION.md`（人读对账表）与 `reconciliation.json`（39 行逐 requestId 机读表）。三源串联：`docs/v0.3/real-api-qa/evidence/run-log.jsonl`（42行）、`Back/Edge/.run/zloop/model-cost-ledger.jsonl`（112条，窗口内56条，窗口外56条属更早轮次原样不动）、`Back/Edge/.run/zloop/model-receipts/receipts/`（117个文件）。全程只读。

### 1.1 口径解释（"28次出站""27次usage"）

| 口径 | 值 | 构成 |
|---|---|---|
| 权威出站尝试 | **28** | 25 条案例调用（含首次R25截断）+ R05-replay 误出站 + R28-replay 误出站 + R25b 复验（CORRECTION-FINAL L41 权威口径） |
| run-log 带 requestId 出站行 | 26 行 / 26 个 requestId | R28 两次、R25 首次与复验为不同调用（不同 requestId） |
| run-log 带 usage 行 | 27 行 | **其中 L41（R25b 注解）与 L34（17:58:31 R25 复验）是同一调用的注解复写** |
| 逐条 usage 留证（去重） | **26 次不同调用，入 94,264 / 出 33,762 tokens** | REPORT §3 的"27次 入97,358/出35,340"为 27 行直和，**含 R25b 注解行重复计数**，差值恰为 3094/1578 |
| 2 次误出站的 usage | **回执层已补齐**：4427/1321（R05-replay，回执 `cust-mu9yu9db…v2-9d68993…`@17:46:08Z）与 4697/1216（R28-replay，回执 `cust-mu9zheml…v2-43433639…`@17:47:14Z） | driver 台账当时未记（run-log 无 usage/requestId），但 transport 回执完整落盘——"driver 未记"≠"未留证"；据此 28 次出站 usage 全部闭合 |
| 28 出站 usage 总和（含误出站，回执层补齐后） | 入 103,388 / 出 36,299 tokens | 94,264+4,427+4,697 与 33,762+1,321+1,216；仅作对账陈述，不代表可按此开票 |
| 成本账本（窗口内） | reserve **28** 条 × 0.35 = **9.8 元**；actual 28 条（差额全 0，billKnown 全 true） | REPORT §3 写"预占累计 9.45 元（含28次预占）"——9.45=27×0.35，**与账本不符（差 1 次预占 0.35 元），以账本为准** |
| 零出站门（如实计入口径） | R04(503)、R15(422)、R21/R21b(GET)、R26(409)、R27(400)、R29 两行、R01-replay(409) 共 9 行 + R30-replay（replayed=true 零出站重放） | 均无对应 reserve，替身/账本两侧一致 |
| 账本孤儿条目 | 0 | 窗口内每条 reserve/actual 都能对上 requestId 与出站 |
| 出站 requestId 缺 terminal 回执 | 0 | 交叉核对通过 |
| 供应商账单口径 | **未知，无法确认**（以智谱控制台为准） | 不做费用猜测；本表不构成开票依据 |

### 1.2 证据缺口（来源与缺失分开）

- **run-log（driver 层）缺失**：2 次误出站无 requestId、无 usage（L34/L37）；已由回执目录补齐（见上表），属证据源差异而非数据丢失。
- **run-log 重复**：L41 R25b 注解行与 L34 重复计数（CORRECTION-FINAL 已言明出站总数重复，但 REPORT §3 的 usage 直和仍含此次重复）。
- **不可确认项**：供应商实际账单、2 次误出站当时的网络细节（仅回执时间戳与 usage 可证）。证据不足处一律记"无法确认"，不推断。
- **更早轮次残留**：回执目录含更早轮次（同日 15:52Z 前）回执/仅 intent 残留共 13 个无 run-log 行的 terminal（含历史 unknown 的 intent 残留），原样保留未动，已在 `reconciliation.json` 列明。

## 2. 只读核验：operationId 与 scope 语义（现行契约图）

- **requestId（回执围栏键）**= `amq:<customerId>:v2-<digest(identity)>::obs:<assistant>:<qHash>::a1`；identity={receiptVersion, tenantId, customerId, assistant, question, context(含 decisionTask{operationId,principalId,feedback,taskKind?}), contextHash, configHash, promptVersion, brief}（`assistant-model.mjs`）。**decisions 路径的 operationId 经 decisionTask 进入身份——同 operationId 才可能命中同一回执；换 operationId 即换身份。**
- **三分发送语义**（`glm.mjs`，不可破坏）：未发送（not_configured/4xx/OUTBOUND_NOT_ALLOWED/预算阻断/连接未建立）≠ 确定失败（5xx/200非JSON）≠ 发送后未知（超时/断连/响应体中断）。
- **回执三分阶段**：INTENT 先落 → transport.complete → TERMINAL 后落；unknown 也落 TERMINAL（重放如实返回原始未知错误码）；仅 intent 残留 = `RECOVERED_INTENT_WITHOUT_RECEIPT`；claim 文件 wx 独占、超时不被抢。
- **decisions 幂等**（`assistant-decisions.mjs`）：requestHash=digest({question, baseHash, taskKind(path_forecast 才进)}); 同 operationId 同 requestHash 且已 finish → 重放零出站；同 operationId 异 requestHash → 409 `IDEMPOTENCY_CONFLICT`；unknown 后 pending 未决 → 同 operationId 重试走回执围栏零出站、其他 operationId → 409 `DECISION_PENDING`。
- **D1 边界（现行契约，本路不改约）**：身份含 operationId，故"新 operationId=新身份"；决策仓库无 pending 时（如仓库重置后首析），新 operationId 同问题会产生真实新出站（R03/D1 实证语义，V04-OP-05 机器复现）；范围锁属业务政策，维持交 CTRL 裁决，**本报告不将其称为缺陷，也未修复**。

## 3. 本地可计数替身回归（新测试，37 例）

替身：`Back/B/test/v04-transport-stub.mjs`（仅 127.0.0.1、系统分配端口；记录每次请求头/正文与命中数；八种形态：ok / malformed / 5xx / 4xx / 响应头前断连 / 响应体中断 / 延迟超时 / decisions 校验可通过模式）。**每例断言替身真实命中数，不以 HTTP 返回码代替。**替身形态验证协议语义，**不构成真实模型质量测试**。

### 3.1 运行命令（独立可复跑，工作区根执行）

```bash
# ① 本包专项（37例，两轮一致 EXIT=0）
node --test Back/B/test/v04-transport-three-state.test.mjs Back/B/test/v04-transport-budget-ledger.test.mjs Back/Edge/test/v04-receipts-unknown-fence.test.mjs Back/Edge/test/v04-receipts-operation-scope.test.mjs
# ② 既有基线（4个输入测试文件，37例 EXIT=0，证明零干扰）
node --test --test-reporter=tap Back/Edge/test/assistant-cache.test.mjs Back/Edge/test/assistant-evidence-http.test.mjs Back/Edge/test/decision-feedback.test.mjs Back/Edge/test/assistant-profiles.test.mjs
# ③ 历史对账（只读，重跑覆盖本目录 reconciliation.json/RECONCILIATION.md）
node docs/v0.4/results/03-receipts/reconcile.mjs
```

### 3.2 覆盖矩阵（目标场景 → 用例 → 替身出站断言）

| 要求场景 | 用例 | 出站断言（替身命中） |
|---|---|---|
| 同请求重放 | TR-02、RF-01、OP-01 | transport 层不去重（2次2命中，幂等属回执层职责）；模型层同进程+重启重放 1 命中；decisions 重放 1 命中 |
| 载荷变化 | TR-11、RF-06 | 同输入 payloadHash 逐字节稳定；brief 变化载荷变化；上下文版本/问题变化各+1 命中；键序重排 0 新增 |
| 同operation不同request | OP-02、OP-03 | 异问题/换kind 均 409 `IDEMPOTENCY_CONFLICT`，命中数不变 |
| 未知后重启 | RF-02、RF-03、OP-04 | 断连/超时→unknown 各 1 命中；同进程与重启重试 0 新增；decisions 未知重试跨重启 0 新增 |
| 新operation | OP-04、OP-05 | pending 未决→新 operationId 409 零出站；仓库重置后（无pending）新 operationId=新身份=新出站（D1 现行契约，如实呈现）；老 operationId 仍被回执围栏拦住 0 新增 |
| 不同principal/customer/scope | RF-09、OP-06、TR-10、BL-03 | requestId 内嵌客户身份、互不复用；principal 参与身份各出站一次、反馈按 principal 绑定互不带入；projectId 锚点隔离；会话/客户子限额互不影响 |
| 并发重复 | RF-05 | 12 并发（双实例）合并 1 命中，requestId 唯一 |
| 进程重启 | RF-01/02/03、OP-04、BL-04 | 持久回执重放、未知围栏持久、预算重启不绕过 |
| 发送前失败 | TR-09、TR-13、RF-07 | 不可达 `TRANSPORT_UNREACHABLE` sent=false；白名单外 `OUTBOUND_NOT_ALLOWED` 0 命中；证据缺失 0 命中且**无 claim/intent 残留**（修复后可安全发送） |
| 发送后断连/超时 | TR-03/04/05、RF-02/03 | 三态错误码各自正确，命中=1 证明"请求已到达"，重试 0 新增 |
| 回执损坏 | RF-04 | 坏 JSON→`RECEIPT_OR_TRANSPORT_UNCERTAIN`；身份篡改→`RECEIPT_IDENTITY_MISMATCH`；文件逐字节保留；全部 0 新增出站 |
| 账本预占/结算 | BL-01/02/04/05、RF-10、OP-08 | **替身命中时 reserve 已落账（预占严格先于出站）**；reserve 数=命中数；unknown 无 actual；坏账本行失败关闭 0 命中且不改写原文件；次数/客户/会话子限额语义与作用域隔离 |
| 旧结果当前性 | RF-08、OP-07 | 撤权回调→current=false 且随回执诚实持久不翻转；材料变化→latest.current=false、候选清空（R21b 语义），0 新增出站 |

## 4. 修复与未修复（如实）

- **已修复：无。** 所有权两文件经 37 例回归＋只读语义核验，未发现"允许文件内有明确证据"的缺陷；此前 backend-qa-r2 02包亦报"无产品缺陷需交最小复现"。开发期间全部 5 次测试失败均为**测试侧对契约理解偏差**（mock model 取值、检查门顺序、checkCurrent 缺省值、unknown 落 terminal、D1 场景顺序），逐一按产品真实契约修正断言，未弱化任何断言、未改产品代码。
- **未修复（明确交 CTRL/不属本路）**：
  1. **D1 范围锁**：unknown 终局后新 operationId 在无 pending 仓库中可新出站（OP-05 机器复现）。属业务政策（重试权 vs 资金风险），任务书明确"不擅自规定所有未知全局封锁或所有新operation都放行"，维持 CTRL 裁决。
  2. **REPORT §3 两处口径差异（文档层，历史报告未改动）**：①"27次usage 入97,358/出35,340"含 R25b 注解行重复，去重后 26 次 94,264/33,762；②"预占累计9.45元"与账本 28×0.35=9.8 元不符（差一次预占）。账本为权威口径。
  3. **观察项（非缺陷，未改动）**：响应头已到后超时会归入 `RESULT_UNKNOWN_TRUNCATED` 而非 TIMEOUT——两态同为 unknown、同样禁止自动重发，方向保守，无行为影响，故不动。

## 5. 源码与交付物 SHA256

见 `source-sha256.txt`（执行后复核零漂移）：所有权文件 `assistant-receipts.mjs`=`3177fb8d…`、`glm.mjs`=`59729456…`（**与执行前一致，零改动**）；另登记 `assistant-model.mjs`、`assistant-decisions.mjs`（只读核验对象）与 6 个新增交付文件指纹。

## 6. 资源清单

- **进程/端口**：全部测试服务监听 127.0.0.1、系统分配端口，finally 中关闭；未触碰共享栈（48210/48214/48304/48284/48324 等本轮零接触）。
- **数据库**：被测面零 SQL 依赖，未创建/启动任何 PG 容器。
- **临时目录**：`os.tmpdir()` 下 `v04-*` 前缀，逐例 finally 自清理。
- **真实出站**：0（全程替身）；未读取/输出任何凭据；预算未重置；历史账本/回执/run-log/响应证据只读，未覆盖、未删除、未回写。
- **其他三路**：`Back/A`、`Front`、`docs/v0.3` 等在途修改一律未触碰；未依赖其新代码。

## 7. 交付物清单（本目录）

| 文件 | 说明 |
|---|---|
| `REPORT.md` | 本报告 |
| `RECONCILIATION.md` / `reconciliation.json` | 逐 requestId 对账表（人读/机读，39 行，三源串联、来源与缺失分开） |
| `reconcile.mjs` | 只读对账脚本（可重跑） |
| `source-sha256.txt` | 源码与交付物指纹（前后复核零漂移） |
| `logs/v04-receipts-run1.log` / `-run2.log` | 两轮 37/37 全绿（exit 0） |
| `logs/baseline-input-tests.log` | 既有基线 37/37（exit 0） |
| 新测试 | `Back/B/test/v04-transport-three-state.test.mjs`(13)、`Back/B/test/v04-transport-budget-ledger.test.mjs`(6)、`Back/B/test/v04-transport-stub.mjs`(替身)、`Back/Edge/test/v04-receipts-unknown-fence.test.mjs`(10)、`Back/Edge/test/v04-receipts-operation-scope.test.mjs`(8) |

## 8. 验收对照（任务书口径）

- **既有语义内未知不重复出站** ✓（RF-02/03、OP-04：同进程/重启/跨仓库同身份均 0 新增出站）
- **授权作用域不串结果** ✓（RF-09、OP-06、TR-10、BL-03：客户/租户/principal/会话各自独立）
- **账本与真实替身计数可核对** ✓（BL-01/02、RF-10、OP-08：reserve 数=命中数、预占先于出站、孤儿 0）
- **替身不称真实模型质量测试** ✓（本报告及测试注释均声明：替身验证协议语义，模型输出质量属 real-api-qa 轮的真实调用验收范畴）
