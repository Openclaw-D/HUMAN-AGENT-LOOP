# TAKEOFF-FA-1.0.0 最终验收结果（TEST_RESULTS · 2026-09-20 集成收口）

状态标记：PASS / FAIL / BLOCKED / NOT_RUN。本文件为**最终快照验收**记录（非诊断跑）；诊断跑历史见 implementation/04/00_START.md 与 git 历史；本文件 2026-09-20 早间版本（接手核对轮，全部 NOT_RUN/BLOCKED）已被本版替代，历史见 git。执行者：ZCode 集成收口会话（04 路收口位）；与 Codex 独立复核、用户视觉/业务验收分开，不互相替代。

## 快照冻结（最终轮）

- git HEAD：`8c6d3b0edc7d0c467ab6876a765b80a30b1e268b`（main；未 commit/push，工作区约 120 文件在制增量）
- Front/dist：index.html=`cc9b6fe4f0fb4aa7…`、js=`index-CQiqZlda.js`=`cf78ea04a0e2b292…`、css=`index-DlbUUUlR.css`=`73fd80a51e041125…`（SHA-256；由当前源码重建）
- Edge versionz buildId：`2f51e6a1bf80d460`（sealedAt 2026-09-20T00:31:35Z；其后 Edge 改动经两次受控重启加载，源码以工作区为准）
- A 迁移：001–014 全部应用（`jw_fa_final` 库；012 预评估确认 / 013 五域词表 / 014 需求登记）
- 装配：`takeoff-up --serve-front Front/dist`：Edge 48214 / A 48194 / Connectors 48114 / `jw-takeoff-pg@15446`；**全新库** `jw_fa_final` + `cnext_takeoff_final`（诊断库 `jw`/`cnext_takeoff` 原样保留未销毁）
- 配置模式：合成（takeoff-runtime.json `_synthetic=true`；`tenantId=tt1`；`aRegisterDomains` 五域全开；规则包 `takeoff-first-admission-rule-pack-v1@1.0.0` 激活）
- 测试资源 owner：takeoff-fa-04（resources.json 登记）；jw-cc-kernel-pg@15444（01 路测试资源）；jw-connectors-pg@15443（Docker 守护进程异常重启致退出后，本会话按登记恢复）
- 真实模型 API：**未授权，NOT_RUN**（0 调用；无提供方/数据范围/预算授权）

## 一、六套件独立复验（当前工作树，集成会话本地复跑）

| 套件 | 命令 | 结果 |
|---|---|---|
| A 预评估确认定向（PA-01..18） | Back/A `node --test test/preassessment-confirm.test.mjs`（JW_A_ADMIN_DB_URL→15444） | **18/18 PASS** |
| B 全量 | Back/B `npm test` | **105/105 PASS**（首轮 1 例负载抖动，隔离+全量复跑均绿） |
| C 全量 | Back/C `node test/run-all.mjs` | **113/113 PASS** |
| Connectors 全量 | Back/Connectors `npm test`（隔离 PG 15443） | **93/93 PASS** |
| Edge 全套件 | Back/Edge `node test/run-all.mjs` | **78/78 PASS**（含本会话 channel-authz/kernel-store/session 租户改动后复跑） |
| Front | `npm run typecheck` + `npm test` | **typecheck 绿；82/82 PASS**（含新增 takeoff-assistant-brief 8 例） |

## 二、API 主链最终快照（run-chain.mjs 严格版，无诊断放行）

命令：`Back/Edge node scripts/acceptance/run-chain.mjs`（Edge 48214；每轮唯一全新合成客户）。证据：`Back/Edge/.run/takeoff/acceptance/chain-results.json`（`mode:"acceptance"`）。

结果：**61/61 PASS**。要点步（步号为该轮实录）：

- #26 T06：冲突（涉诉 HARD_BLOCK Gate 回执）下正面确认被拒 **409 `GATE_BLOCKED`**（附 receipt/gateResult/ruleIds）——D-03 修复端到端实证。
- #34/#39：人工转录（manual-entry，录入=biz）+ **人工核验 7/7**（questions/verify，核验=cred；verified 只能由人产生，转录≠核验分人）。
- #41 T06 解冻：撤诉裁定 A2 取代 A1（新有效依据）→ 新收口 **Gate=CLEAR**（解冻随新收口产生，无一键豁免）。
- #53 T09：**正面确认成功**（confirmationId + `scope=preassessment_only`）。
- #54 T09：**账本零变化** `ZERO_CHANGE_PASS counts={"credit_facilities":0,"financing_requests":0,"exposure_entries":0}`（整表前后逐行一致）。
- T03：缺口补证=人工录入（source_supported）→ 收口 evaluable=true。
- T04/T08：C1 纠正 supersedes N3 → stale=true+inputVersion+1；迟到旧依据候选 409 `STALE_BASIS`；重建快照=新评估；纠正后新收口。
- T05：D1 同字节副本判重（duplicateOf），不增证明力、finId 不变。
- T11 幂等：同号同载荷单效果（replayed）、同号异载荷 409 `IDEM_POTENCY_REPLAY_CONFLICT` 语义（契约码 IDEMPOTENCY_REPLAY_CONFLICT）。
- T12：跨租户 403/404 不泄露存在性、客户身份读内部证据 403（B13）、假 actor 不提权（ROLE_FORBIDDEN）、业务角色确认 403 PERMISSION_DENIED、指令注入材料 authority=none 恒定且**账本二次复核零变化**。
- T10：负面结论可完成（硬门不适用、不要求刷绿）；行政撤回与拒绝分离；客户档案不删。

验收脚本整改（本会话，04 ownership）：移除 `D03=1` 放行分支（诊断步标 `DIAG` 不入 PASS 计数、结果标 `mode:"diagnostic"`、退出码 3=不出具验收通过）；T06 期望族按契约 §13.1 补 `GATE_BLOCKED`；删除两处"必过"断言（`|| true`/硬编码 true）改为真实断言（指令注入后账本二次 verify）；邀请断言布尔化。历史"53/53 诊断 PASS"不构成验收，已由本严格轮替代。

## 三、定向故障/恢复

| 项 | 结果 | 要点 |
|---|---|---|
| T07 技术失败 | **7/7 PASS** | 不可解析件→`needs_followup`+`FORMAT_UNSUPPORTED`+转人工入口（自含唯一字节夹具，不依赖主链状态演进）；停 Connectors→502 `UPSTREAM_UNKNOWN`+原 requestId 回显→重启同号重试续跑；客户不被自动拒绝/清零 |
| T11 重启恢复 | **10/10 PASS** | 多证受控 down→up；工作区/工件/确认（scope=preassessment_only）/候选历史/**账本跨重启复核**完整读回 |

## 四、页面级证据（真实登录·真实链数据·浏览器独立上下文）

证据目录：`Back/Edge/.run/takeoff/acceptance/pages/`。登录：受控身份目录（cred1=credit）；客户：`cust-mu9809zc`（页面确认演练·合成）。

| 项 | 断言 | 结果 | 证据 |
|---|---|---|---|
| T01 页面范围 | 二十格（五列四行）+六助手；顶栏待补/待评估/待估不用 0 冒充；无提款/租后/结清/正式额度入口 | PASS | final-board-1920x1080.png |
| T13 抽屉/高亮 | 格点击→抽屉五段（当前问题→依据位置→需要谁→允许动作→输出与历史）；选中格边框加深；遮罩+放大入口 | PASS | final-drawer-credit-input-1920.png |
| T14 助手受控简报 | 「受控简报」=服务端读面确定性组答（真实模型 NOT_RUN 如实标注；同收口按助手去重；失败诚实转达不伪造）；聊天文本不改变业务状态 | PASS | final-enddialog-enabled-1920.png（简报+对话框同框；DOM 断言含 Gate CLEAR/¥240.56 元口径/候选 r1·输入 v0） |
| T09 页面驱动确认 | cred1 于「结束」对话框选支持→理由必填→二次确认（版本 v3·候选 r1·对账编号）→**服务端落库** `pac-mu9822rx`（confirmed_by=tkcred1）→顶栏读回「预评估结论：支持（tkcred1·时间）+ preassessment_confirmed」 | PASS | final-confirmed-readback-1920.png；DB `preassessment_confirmations` 行实录 |
| T13 第二尺寸 | 1366×768 双区铺满、无滚动、确认读回完整 | PASS | final-confirmed-1366x768.png |
| 账本不变量（页面确认后） | 三表整表零变化 | PASS | `ZERO_CHANGE_PASS`（页面确认落库后复验） |
| T14 辅助页 | 流程只读/记录同源事件时间轴/待办回格（02 路交付+04 诊断轮页面取证延续有效；本会话复核主路径） | PASS | 04 诊断轮 pages/ 证据 + 本轮快照 |

## 五、响应表现（实测口径：本机宿主 Node v22.23.1；Edge/A 同宿主、PG/Connectors 同宿主容器；空载合成客户）

| 指标 | 实测（3 次或标明） |
|---|---|
| 会话交换（principalId→会话） | 7 / 33 / 45 ms |
| workspace 快照（A 全量投影+admission） | 107 / 128 / 136 ms |
| 03 收口读面（Edge→Connectors 透传） | 12 / 32 / 48 ms |
| 处理状态读面 | 46–48 ms |
| SSE 首字节 | 11 ms |
| 页面确认→服务端落库读回 | 1s 轮询粒度内可见（DB confirmed_at 与读回一致；未做毫秒级专项） |

边界：点击至首帧本地渲染时延未逐项单测；确定性链无流式生成，"首段真实内容"以 SSE 首字节+读面时延为准，不用动画造数；未做无收益压力测试；不为速度绕过权限/证据/持久化。

## 六、缺陷与整改台账（收口态）

| # | 验收项 | 缺陷 | 责任路 | 状态 |
|---|---|---|---|---|
| D-01 | T09/T10 页面 | 02 结束对话框确认按钮禁用待接线 | 02 | **已闭合**：02 路二轮接线+真实栈验证；集成会话接手收尾（陈旧注释/文案清理、§13.5 需求读回投影、测试纠偏） |
| D-02 | T14 助手 | 智能应答未接 | 03/04/02 | **已闭合（替身形态）**：受控简报=服务端读面确定性组答（takeoff-assistant-brief.ts+组件接线，集成会话实现）；真实模型=NOT_RUN 如实分列 |
| D-03 | T06 确认硬门 | 确认门未消费 Gate 回执 | 01 | **已闭合**：01 PA-16 修复（GATE_BLOCKED/STALE_BASIS）；严格链 #26 端到端实证 |
| OBS-03-01 | 五域 | A 域枚举未含 business | 01 | **已闭合**：迁移 013+词表扩展；装配 aRegisterDomains 加 business（集成会话） |
| DEF-04-01 | 夹具 | PDF 生成器编码损毁 | 04 | 已闭合（04 路二轮修复，03 探针验证） |
| INT-01 | T09 页面 | 前端命令帧硬编码 `tenantId:'t1'`，tt1 栈 403 CUSTOMER_SCOPE_VIOLATION | 04+02 | **已闭合（集成会话）**：装配 auth 条目补 tenantId→Edge 会话透出→wb-client 命令帧与会话保持一致；收口/状态/预览等读面 tid 以服务端权威租户归一（channel-authz+kernel-store，页面自报 tid 不采信）；页面确认端到端打通 |
| INT-02 | 验收脚本 | run-chain D03 放行+两处必过断言+T06 期望族缺 GATE_BLOCKED+chain-results 结构变更致 t07/t11 读取失配 | 04 | **已闭合（集成会话）**；最终快照以严格版出具，t07/t11 兼容双结构 |
| INT-03 | T14 简报 | 简报金额误用分口径显示收口元值（¥2.41 应为 ¥240.56）；去重粒度跨助手误命中 | 02（集成会话修） | **已闭合**：fmtYuan 区分 03 收口（元）/A 候选（分）口径；去重按助手分键 |
| REQ-01 | 03 路整改请求 | Connectors conflict findings `impactScope.actions` 仍为 `['approve_facility','reserve']`（coordinator.mjs 约 L1655），未含 `preassessment.confirm` | 03 | **开放（不阻断）**：A 侧确认门已由 Gate 回执硬门+快照内事实冲突门双保险覆盖（PA-04/#26 实证）；仍请 03 路按防御纵深补该动作位并定向复测 |
| REQ-02 | 02 路观察 | §13.5 需求登记读回已接（顶栏+商机格）；页面侧"登记/修正需求"输入 UI 未建（命令面 Edge/A 已通） | 02 | **开放（不阻断）**：未登记如实显示"待录入"；登记可经命令面完成，页面输入为后续增强 |

## 七、限制与 NOT_RUN（如实）

- 真实模型/收费 API：NOT_RUN（未授权，0 调用）。助手智能应答以**确定性替身**验证接线结构，不称为真实模型验证。
- 页面侧"需求登记"输入 UI：未建（读回/命令面已通）——REQ-02。
- 点击至首帧本地渲染时延、取消/超时/重试专项：未单测（确定性链无流式可取消语义；SSE 断线退避重连已由 02 路行为测试覆盖）。
- B 套件历史负载抖动 1 例（crash-recovery 恢复后取消语义）：隔离与复跑均绿，判环境抖动非回归；最终快照轮如再现已录。
- 本轮所有 PASS 为**执行者自验**；Codex 独立复核与用户视觉/业务验收另行进行，不因本记录视为完成。
