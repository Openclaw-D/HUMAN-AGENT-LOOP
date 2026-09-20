# 路04 · T01–T14 验收结果（工作文件，最终版回写本包 TEST_RESULTS.md）

状态标记：PASS / FAIL / BLOCKED / NOT_RUN。不混合快照：每项记录运行版本（git 工作区 hash + Front dist hash + Edge versionz buildId + A 迁移版本）、配置模式、输入、动作、断言、证据路径。初始全部 NOT_RUN。

## 诊断跑实录（2026-09-20，D03 缺陷模式；最终快照验收在 D-03 修复后重置重跑）

- 装配：takeoff-up 全栈就绪（Edge 48214 build cdfbd555…、A 48194 迁移含 012、Connectors 48114、jw-takeoff-pg@15446）；规则包 1.0.0 激活（admin 合成）。
- **API 主链 run-chain.mjs：53/53 PASS**（#26 T06 正面确认阻断为 D-03 缺陷模式放行——实际 200，待01修复后必须 409）。
- **T07 技术失败 t07-failure.mjs：7/7 PASS**（A 解析失败诚实转人工 needs_followup+FORMAT_UNSUPPORTED+转人工入口；B 停 Connectors 注入上游不可达→502 UPSTREAM_UNKNOWN+原 requestId 回显→重启后同号重试成功、无重复登记、客户不被自动拒绝/清零）。
- **T11 重启恢复 t11-restart.mjs：10/10 PASS**（down 多证停止→up 重启→工作区/工件/确认(scope=preassessment_only)/候选历史/账本复核全部读回；needsReview 失效投影实证工作）。

### 页面级取证（T01/T13/T14，浏览器独立测试上下文，真实登录 biz1+真实链数据）

| 断言 | 结果 | 证据（evidence/pages/） |
|---|---|---|
| T01 二十格+六助手；无提款/租后/结清/合作历程/总进度/使用率；无正式授信/融资动作按钮（禁词命中=[]、动作命中=[]、cells=20、六助手齐） | PASS | board-1920x1080 / board-1366x768 |
| T01 未知≠0：申请金额=待补、建议额度=待评估、参考价格=口径未配置、预计=待估；方案标记 scope=preassessment_only+评估依据已过时 | PASS | board-*.png 顶部 |
| T13 格点击→事项抽屉按标准顺序（当前问题→依据位置→需要谁→允许动作→输出与历史），选中格边框加深 | PASS | cell-drawer-credit-completion-stale-1366.png |
| T14 记录=服务端事件时间轴（同源投影，放大/定位最新），非独立状态 | PASS | records-timeline-1366.png |
| 结束对话框：三类确认按钮 disabled=true（待01接线，D-01 页面证据）、行政撤回可用、scope=preassessment_only 与服务端强制说明完整 | PASS | finish-dialog-1366-confirm-disabled-withdraw-enabled.png |
| 页面观察 O-2：记录页时间列显示"时间未记录"（事件载荷无可读时间戳，前端不伪造——诚实但可改进）；window.stop() 停 SSE 后页面提示"事件流断开…退避重连，不做本地状态补写"（断线语义诚实） | 观察项 | 同上截图 |

### 性能记录（实测口径：本机宿主，Node v22.23.1，Edge/A 同宿主进程、PG/Connectors 同宿主容器，空载诊断栈；curl 计时）

| 操作 | 耗时（3次） |
|---|---|
| 会话交换（principalId→不透明会话，含 A 目录探针） | 14ms |
| workspace 快照（A 全量投影+admission 聚合） | 100 / 125 / 104 ms |
| 收口读面（Edge→Connectors 透传） | 19 / 29 / 32 ms |

操作反馈/首段响应（SSE 首事件）未单测——NOT_RUN（最终快照轮补）。

## 快照冻结（执行前填写）

- 快照ID/时间：
- git 工作区 hash（HEAD + status 摘要）：
- Front/dist 构建 hash：
- Edge versionz buildId：
- A 迁移版本（001–012+）：
- 依赖 lock hash：
- 装配：takeoff-up（Edge 48214 / A 48194 / Connectors 48114 / jw-takeoff-pg@15446）；配置模式=合成（takeoff-runtime.json，_synthetic=true）；真实模型 API=未授权 NOT_RUN。

## 主链

| 项 | 场景 | 状态 | 关键断言 | 证据 |
|---|---|---|---|---|
| T01 | 页面与范围 | NOT_RUN | 五列四行+六助手铺满；无提款/租后/结清/合作历程/总进度/使用率/底部卡；默认路径无 facility/financing 写入口 | 截图×2尺寸+DOM/网络记录 |
| T02 | 单次上传与来源 | NOT_RUN | N1–N4 各一份一条链；A 登记归属正确；原件读回字节一致 | 请求/响应+hash 比对 |
| T03 | 部分并行 | NOT_RUN | 资产核验不等商务；分母未知=null 未闭合≤75% | workspace.admission JSON+截图 |
| T04 | 有利与不利证据 | NOT_RUN | P1→候选可增；C1→可减；每次变化带依据/输入/规则/运行引用 | 候选历史（candidates 读口） |
| T05 | 重复/相关证据 | NOT_RUN | D1 判重不增证明力不涨额不重复写入 | duplicateOf 标记+版本不变 |
| T06 | 冲突与冻结 | NOT_RUN | A1 阻断正面确认（409 原样透传）；冻结版本保留；无一键解除 | 拒绝响应+霜冻投影截图 |
| T07 | 技术失败 | NOT_RUN | 故障→failed+nextAction 不自动拒绝/清零；同号重试续跑 | 注入记录+恢复回执 |
| T08 | 新旧版本竞争 | NOT_RUN | 迟到旧结果不覆盖新版；只重算受影响范围；旧决定保留 | 运行时间线+候选版本读回 |
| T09 | 正面人工确认 | NOT_RUN | credit 角色+版本+硬门服务端校验；confirmationId scope=preassessment_only；**三表零变化 verify 退出码0** | 确认响应+baseline/verify 输出 |
| T10 | 负面/撤回结束 | NOT_RUN | not_support 可完成（硬门不适用）；withdraw 与拒绝分开；客户不删 | 确认/撤回回执 |
| T11 | 重复提交与恢复 | NOT_RUN | 同号同载荷 replayed:true；异载荷 409；重启后原件/方案/消息/确认完整读回 | 重放响应+重启前后对比 |
| T12 | 越权与不可信输入 | NOT_RUN | 跨客户 403/404；假角色不可写；材料内指令无授权语义 | 403/404 集+处理回执+审计 |
| T13 | 点选与视觉 | NOT_RUN | 行列高亮/顺时针黄扇区/绿无勾/白霜；无蓝紫青；放大还原；输入法不误发 | 交互截图序列+CSS 记录 |
| T14 | 辅助页与模型预算 | NOT_RUN | 流程只读缩放平移；记录/材料同源；Agent 去重；未授权 API 不调用（NOT_RUN 如实） | 辅助页截图+能力位响应 |

## 定向回归

| 项 | 范围 | 状态 | 证据 |
|---|---|---|---|
| R1 | Edge 全套件（含 takeoff-surface 6 项） | PASS（2026-09-20，78/78，e0 形态非快照） | test 输出 |
| R2 | 既有安全/状态套件按风险定向（快照期执行） | NOT_RUN | 待填 |
| R3 | A 侧 preassessment-confirm 套件（01路交付） | NOT_RUN（01路责任，04复验） | 待填 |
| R4 | 03路反例套件（解析/权属/冲突/去重/预算/恢复） | NOT_RUN（03路责任，04复验） | 待填 |

## 性能记录（未测不承诺）

操作反馈 / 首段响应（SSE 首事件）/ 完整响应 / 回执耗时：NOT_RUN（快照期实测后填；注明本机 CPU/Node/容器同宿主环境）。

## 缺陷与复验台账

| # | 验收项 | 缺陷描述 | 责任路 | 修复 | 复验 |
|---|---|---|---|---|---|
| D-01 | T09/T10 页面侧 | 02路结束对话框三类预评估确认按钮=禁用+待01说明（其交付时点早于01契约冻结）；01契约现已冻结（§13），需02接线 confirm-preassessment（绑定 assessmentVersion+candidateRevision，VERSION_CONFLICT 按 serverVersion 刷新）+确认读回/需复核投影。撤回路径已接真实 decide ✓ | 02路 | 待02 | 待04 |
| D-02 | T14 助手 | 03路受控分析工具的页面接线未接（页面明示"待03/04受控工具接入"）；待03施工完成后02/04联调 | 02/03路 | 待03/02 | 待04 |

## 设计观察（非缺陷，收口时呈报）

- O-1：二十格投影现为双实现——Edge `workspace.snapshot.admission`（01契约 §7 指定的 Edge 聚合，本路已交付）与 Front `takeoff-projection.ts`（02路显示层投影，自服务端字段计算）。两者口径一致（分母未知null/不伪造绿）；02 交付先于契约冻结发布，未消费 admission。不改判02为缺陷；验收按实际页面行为断言，admission 供 API 级验收与后续消费方使用。
