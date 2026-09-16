# 见微 V3 Acceptance Matrix

更新：2026-08-30  
状态：`FROZEN CONTROL CONTRACT / IMPLEMENTATION EVIDENCE PENDING`  
上位权威：`V3_DIRECTION_FREEZE.md` Gate 1–19

## 1. 判定规则

- 本矩阵验收的是比赛 Demo，不外推 production readiness。
- `MUST` 条目全部通过才能进入决赛打磨；任何一个失败都不得以截图、口头说明或其他绿色测试替代。
- 所有证据必须来自同一已标识的 build、同一 Scenario version 和同一 acceptance run；旧截图、旧服务、worker 自报或源码存在不等于通过。
- Browser evidence 证明“评委能看见并操作”；Backend evidence 证明“状态真实发生并受 Authority 约束”；两者缺一不可。
- 未实现 extension path 不进入通过率，只能记录在限制清单。
- 用户拥有最终产品验收权；自动 Gate 通过不等于用户已接受视觉或业务内容。

状态枚举：`NOT_RUN | PASS | FAIL | BLOCKED | NOT_APPLICABLE`。当前所有实现相关条目默认 `NOT_RUN`，本文件不把现有局部测试冒充整体验收。

## 2. 证据包

每次正式验收生成独立只读目录：

```text
V3_ACCEPTANCE_EVIDENCE/<acceptanceRunId>/
  manifest.json
  commands/
  http/
  browser/
  scenario-runs/
  events/
  receipts/
  security/
  LIMITATIONS.md
```

`manifest.json` 至少记录：`acceptanceRunId`、代码版本 / 工作区 fingerprint、build 时间、Scenario id/version/seed、Node 版本、server PID/command/port、开始结束时间、测试命令与每项矩阵状态。不得记录 token、cookie、真实客户身份或其他凭据。

## 3. Authority 与唯一真相

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| AUTH-01 | MUST | 唯一 `FinancingLeasingCase` Authority | runtime audit + code boundary test | 四应用、背景 Case、Portfolio 均不维护第二份可写业务状态 |
| AUTH-02 | MUST | 前端 / Chat / Agent authority=none | negative API tests + browser attempt | 无正式 Receipt 时不能把候选显示为正式状态 |
| AUTH-03 | MUST | 正式写入可定位 | Event + Context + principal + Action/Gate + Receipt capture | 每次正式变化均可完整回链 |
| AUTH-04 | MUST | 失败关闭 | invalid / timeout / injected failure HTTP evidence | 失败不递增 Context、不追加成功 Event/Receipt、不显示成功 |
| AUTH-05 | MUST | idempotency（幂等性） | same-key replay、same-key-different-payload conflict、并发测试 | 重放不重复，冲突不写入，顺序稳定 |
| AUTH-06 | MUST | 历史保留 | T1/T2/T3 snapshot、diff 与旧 run | 新 Context 不覆盖旧 Evidence/run；旧 run 标记 stale/superseded |

## 4. Golden Case Scenario

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| SCN-01 | MUST | 固定 Scenario identity | manifest + reset response | `JW-V3-DL-GOLDEN-001` / 指定 version / `FL-DEMO-001` 一致 |
| SCN-02 | MUST | reset 干净 | reset 前后 Event/Receipt/runtime audit | 不残留上一轮 Evidence、run、Gate 或 commencement Receipt |
| SCN-03 | MUST | T1 商机事实成立 | 业务确认 UI + Evidence / ContextCommit Receipt +五路 run | 一次具名 `ContextCommit` 产生一个 Context transition 并 trigger 五路 |
| SCN-04 | MUST | T2 风险事实暴露 | 外联客户 UI + Evidence / ContextCommit Receipt + T2 diff + 信审 Projection | invitation 只允许该事实的一次 T2 commit；信审至少回退一档或新增补件；不得五路同步变好 |
| SCN-05 | MUST | T3 外部证据补强 | 客户、供应商独立操作与 Receipt +业务确认 +五路 rerun | 两个 external principal Receipt 进入同一 batch，业务只 commit 一次 T3；T1/T2 history 可回看 |
| SCN-06 | MUST | 专业 Gate | 四类账号正向与越权测试 | 仅对应 principal 可确认本专业 Gate |
| SCN-07 | MUST | 正式起租 | commencement Action/Receipt + Case/Projection diff | 所需条件满足后五格全黑并进入已起租/已起息；非租后结清 |
| SCN-08 | MUST | 背景 Case 独立 | 每个背景 caseId 的 API/UI evidence | 只有稀疏只读摘要，不复用 Golden Context/Evidence/Receipt |
| SCN-09 | MUST | 三次连续 full run | run-1/run-2/run-3 manifest 与结构比较 | 三次 `reset→T1→T2→T3→Gates→起租→replay` 全部通过，无手工改代码/状态救场 |

## 5. 五路异步与 Context

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| ASYNC-01 | MUST | 单一 trigger 五路消费 | Event/run binding capture | 商机、政策、信审、商务、资产绑定同一 caseId/contextVersion |
| ASYNC-02 | MUST | partial completion | 时间序列 / polling capture | 五路允许完成时间不同，前端实时更新，不伪装原子同时完成 |
| ASYNC-03 | MUST | 方向独立 | T1/T2/T3 五路 diff | 推进、保持、回退按各路影响决定，不复制同一模板状态 |
| ASYNC-04 | MUST | 版本节制 | Chat、Evidence staging 与 ContextCommit 对比测试 | 普通聊天、单条 Evidence 接受和 Human Gate / Action 不递增 Context；具名 `ContextCommit` 才触发 |
| ASYNC-05 | MUST | 五档呈现 | 角色页面截图 + DOM assertion | UI 不出现业务 readiness 精确百分比；档位与后端状态一致 |

## 6. Role Projection 与权限

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| ROLE-01 | MUST | 四个两字入口 | Desktop/Mobile DOM + screenshot | `协同 / 业务 / 风控 / 外联`；active V3 前端无可见“领导” |
| ROLE-02 | MUST | 同 Case 不同 Projection | 四角色连续 browser trace + API capture | caseId/context identity 不变，信息与动作按角色真实变化 |
| ROLE-03 | MUST | Case Panel + Workbench | 四角色 Desktop/Mobile browser evidence | 每个内部应用均能选择 Case 并进入 role-specific workbench |
| ROLE-04 | MUST | 业务全局可见 | business Projection + browser | 看五路完整 Context，能处理商机/材料，不拥有其他专业代签权 |
| ROLE-05 | MUST | 风控四账号 | 四 principal API/browser + denial tests | 都看五路，只写本专业 Gate |
| ROLE-06 | MUST | 外联隔离 | 客户/供应商 browser + direct URL/API denial | 只见 invitation、有限进度与自身问题；内部专业 Context 不可见 |
| ROLE-07 | MUST | 协同不覆盖专业 Gate | management Action success + professional Gate denial | 可追问/协调/下发管理要求，不能直接通过/否决专业 Gate |

## 7. Management / God View

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| MGMT-01 | MUST | KPI 价值层级 | metric definition + formula version + value class + UI | 默认主驾驶舱服务本期 / 本年 KPI，突出可验证净收入与单位资产产出效率；全周期利润只作辅助校验，三者不得混写 |
| MGMT-02 | MUST | 时间与真实性口径 | 当期 / 当年 / 全周期和 actual / forecast / scenario browser trace | 切换来自同一受控公式与来源；图表、摘要、截至时间和数据覆盖一致 |
| MGMT-03 | MUST | 组织/Case 下钻 | Portfolio→事业部→Case trace | 能从偏差定位 Golden Case；无第二业务 Authority |
| MGMT-04 | MUST | 偏差解释与 Shadow 候选 | candidate payload + UI + authority test | 候选列明假设/依据，不自动成为正式管理命令 |
| MGMT-05 | MUST | Management Action | Human Gate + Action Receipt +目标角色反馈 | 确认后可追溯下发，但不改专业 Gate 结论 |
| MGMT-06 | MUST | 起租后经营回流 | pre/post commencement Projection diff | 主展示本期 / 本年净收入贡献与单位资产产出；全周期利润预测位于辅助层；forecast / scenario 不冒充 actual |
| MGMT-07 | MUST | 净收入与单位资产公式 | component payload + formula assertion + UI | `净收入 = 总收入 - 资金成本 - 渠道成本 - 附加税`；`单位资产产出 = 净收入 / 起租金额`；不把后者包装为完整 ROI |

## 8. 客户与供应商直接触达

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| EXT-01 | MUST | 客户 invitation | external-customer browser trace | 能看问题、有限进度、上传/确认；不能见内部判断底稿 |
| EXT-02 | MUST | 供应商 invitation | external-supplier browser trace | 能看设备/交付/付款相关受邀步骤；不能见客户或内部无关信息 |
| EXT-03 | MUST | 外部 Evidence 真实入核 | POST/Receipt/Event/Context diff + browser refresh | 操作不是前端本地状态，内部角色能在同 Case 看到更新 |
| EXT-04 | MUST | invitation 过期/越权 | negative HTTP/browser evidence | 未邀请、错误 principal、错误 caseId/step 均失败关闭 |
| EXT-05 | MUST | 客户体验连续性 | Mobile browser full path | 390px 下完成受邀任务，无整体横向溢出或内部术语泄露 |

## 9. Frontend 与真实浏览器

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| UI-01 | MUST | 1920×1080 Desktop | fresh screenshot + DOM/layout metrics + console | 首屏 3–5 秒可读；无整体横向溢出；fresh error/warning=0 |
| UI-02 | MUST | 1366×768 Laptop | screenshot +关键路径 trace | Case、目标、五路、主要动作可达，不因高度截断核心操作 |
| UI-03 | MUST | 390×844 Mobile | 四应用关键页 screenshot/trace | 响应式压缩而非另一套产品；无整体横向溢出 |
| UI-04 | MUST | 项目群聊 | browser interactions | Case/目标/成员/状态/Thread/消息/@/输入存在；非孤立文本框 |
| UI-05 | MUST | 起租主线 | screenshot + DOM/state assertion | 五路明确并行、正式起租为共同端点，不显示精确百分比 |
| UI-06 | MUST | 状态覆盖 | loading/empty/error/success/disabled capture | 状态清楚、失败不闪现成功、背景 Case 只读明确 |
| UI-07 | MUST | Accessibility baseline | keyboard trace + semantic assertions | 主要操作键盘可达、focus visible、label/role/contrast 合理、reduced-motion 生效 |
| UI-08 | MUST | Receipt 不串页 | role/case/process switch trace | 当前页只显示当前 case/context/action 的 Receipt |

## 10. Engineering / HTTP / Security

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| ENG-01 | MUST | full local check | `npm.cmd run check` 原始日志 | tests/typecheck/lint/production build exit 0 |
| ENG-02 | MUST | V3 acceptance runner | `npm.cmd run v3:acceptance` 原始日志 | 自动生成本矩阵 machine-readable result；失败 exit 非 0 |
| ENG-03 | MUST | HTTP contract | normal/invalid/404/405/413/timeout/concurrency results | 状态码、error shape、失败关闭与 schema 符合契约 |
| ENG-04 | MUST | 最新 production build 服务 | PID/command/port/build fingerprint + HTTP | 浏览器指向该 build；不是 stale dev server 冒充 |
| ENG-05 | MUST | credential scan | scoped scan manifest | 源码、日志、截图、证据包无 secret/token/cookie/真实个人信息 |
| ENG-06 | MUST | workspace residue | git/status + artifact scan | 无临时 patch、隐藏副本、意外依赖、未授权 deploy/commit/push |
| ENG-07 | MUST | responsive/static artifacts | build manifest + asset checks | 资源可加载、无 404、无依赖公网字体/图片造成现场失败 |

## 11. 真实性与评分证据

| ID | 级别 | 验收项 | 必需证据 | 通过标准 |
| --- | --- | --- | --- | --- |
| TRUTH-01 | MUST | 合成来源后端留痕 | Scenario metadata capture | source/version/seed 可查，业务页面不必常驻水印 |
| TRUTH-02 | MUST | 模型状态诚实 | configured/unconfigured/failure UI+API evidence | 本地候选与 live 调用可区分；失败不伪装成功 |
| TRUTH-03 | MUST | 宣传 claim 对应证据 | claim→UI→backend/test mapping | 每项已完成能力同时有可操作页面和系统证据 |
| TRUTH-04 | MUST | 价值因果链 | KPI driver note + pre/post Projection + source coverage | 不编造已经实现的准确率、节省比例、净收入或利润；未接通财务、费用、人力和风险来源时不得宣称全周期利润已核实 |
| TRUTH-05 | MUST | extension path 隔离 | LIMITATIONS.md + UI review | 未实现能力不放进“已完成”或主操作路径 |

## 12. Gate 顺序与停止条件

1. `Contract Gate`：五份 Control contract 互相一致；
2. `Static Gate`：tests/typecheck/lint/build 通过；
3. `HTTP Gate`：Authority、权限、幂等、失败与并发通过；
4. `Scenario Gate`：一次自动 full run 通过；
5. `Browser Gate`：四角色、外联、三种 viewport 通过；
6. `Repeatability Gate`：三次连续 full run 结构一致；
7. `Truth/Security Gate`：claim mapping、凭据与身份扫描通过；
8. `User Acceptance`：用户检查视觉、业务 fidelity 与比赛表达。

任一 Gate 失败即停在该 Gate 修复，不跳过、不用下游成功掩盖上游失败。只有全部 `MUST=PASS` 才能把 V3 Demo 标为完成；否则目标保持 active。
