# 任务04 · TEST_RESULTS（执行者自验口径）

**执行者自验声明**：本轮执行者（任务04）参与了 Edge 实现（Back/Edge/** 改动均在本路 writer 范围），以下全部结果为**执行者自验**；最终由 Codex 复核，页面旅程与真人体验由用户验收。测试环境：Windows、Node v22.23.1、Docker Desktop（postgres:16）。

## 1. 组件测试（隔离栈，无 docker 依赖的 E0 + 有 docker 的真实变体）

| 套件 | 结果 | 证据 |
|---|---|---|
| Edge 全量套件（run-all.mjs，串行） | **67/67 PASS**（0 fail / 0 skip） | `evidence/edge-suite-final.txt` |
| ├ 新增 `t4-message-store.test.mjs` | 7/7：分页缺陷回归（after=0,limit=2 → 1,2,cursor=2 逐页不漏）、首读=最新页、受众过滤游标、裁剪 truncated+retentionBase、客户隔离、**文件库重启恢复消息+回执**、回执有界 | 同上 |
| ├ 新增 `t4-channel-authz.test.mjs` | 6/6：客户身份调内部动作 403 零触达；改 customerId 越权 403 不转发；缺 customerId 400 失败关闭；仅持他人 taskId 404 不泄露；本人 taskId 200；无会话 401 / 裁决面缺失 503 失败关闭 | 同上 |
| ├ 新增 `t4-assembly.test.mjs` | 1/1（真实 edge-start 守护进程 + stub 上游）：透传生效（readiness 分项含 connectors/connectors-channel）、通道读写经会话与逐资源授权、**Edge 重启后消息线程仍在、同 requestId 重放 replayed:true** | 同上 |
| └ 存量 53 项 | 全 PASS；1 处旧语义断言更新（未配置通道 404→503 `CHANNEL_NOT_CONFIGURED`，即问题3 修复的预期变化） | 同上 |
| A 包（任务03）独立测试 | 102 项回归 + authoritative-reads 6 + risk-recheck 11（任务03 自报；本路未重跑） | `docs/v02-remediation/task-03/TEST_RESULTS.md` |

## 2. 消息与恢复语义（本轮冻结，源码头与实现一致）

- **首次历史读取**（GET 无 `after`）：保留窗口内最新一页（升序），cursor=本页最后一条（空页=当前最大 seq）。
- **增量读取**（`after=N`）：seq>N 的**最早**一页（升序、连续可续读）；cursor=本页最后一条 seq；空页 cursor=N 本身——游标绝不越过未返回区段。
- **分页**：`limit` 有界（1..500）；逐页 `after=cursor` 至空页即追平，此后转实时。
- **受众过滤**：只作用于返回集；cursor 按"最后一条返回记录"推进（被过滤区段重扫无害，不漏）。
- **保留窗口**：每客户默认 500 条，超出物理裁剪最旧；`after<retentionBase` 或首读即裁剪 → `truncated:true + retentionBase + note`（显式提示，不静默漏）。
- **幂等回执**：requestId → {fingerprint, response} 持久化；同 ID 同载荷重放 `replayed:true`、异载荷 409；重启后仍有效；有界（默认 4096，裁最旧）。
- **受众/客户/身份隔离**：服务端强制（customer-only 显式请求 internal → 403；目标客户 checkCustomer 逐请求裁决）。
- **诚实边界**：服务端回执 ≠ 送达企业微信（真实企微 BLOCKED_EXTERNAL，不 mock）；Crash 窗口（deliver 成功与回执落库之间）为至少一次，需上游幂等兜底——已如实登记。

## 3. 装配级验证（合成验收栈；**接线证据，非页面验收**）

栈：`delivery-up --config config/delivery-runtime.acceptance.json`（合成值，`_synthetic` 标注）→ PG(jw-v01-pg@15442) → A@48190（迁移 001–011）→ Connectors@48110（库 cnext + 对象存储 + 常驻驱动 + A bridge）→ Edge@48210（live + 通道 + 消息库 + 同源 Front/dist）。

| 步骤 | 结果 |
|---|---|
| readiness 分项 kernel-a / db / connectors / connectors-channel | 全 true；聚合 ok=true |
| 装配冒烟 14 项（登录→建客户→A受限邀请+兑换→通道邀请签发(内部)/反例(客户403)→接受→越权上传反例 404→上传→**常驻驱动 tick 处理 done**→任务详情归属预检→未知 taskId 404→A档案上传→消息双端） | **14/14 PASS** |
| 停止/重启：delivery-down（Edge→Connectors→A 多证复核）→ delivery-up 全循环 | PASS；任务/消息/对象数据保留（重启后查得重启前任务 status=done、消息线程在、回执可重放） |
| 权威清单消费（问题8） | workspace `refsSource='authoritative_list'、refsExhaustive=true` |

证据：`evidence/assembly-smoke-result.json`、`evidence/delivery-resources.json`、`evidence/connectors-boot.log`（含"处理驱动已启动"行）、version-seal `docs/customer-next/acceptance/evidence/s1-20260919-111922/version-seal.json`。

## 4. 联合页面验收（本轮已执行：部分 PASS + 结构性 BLOCKED 如实登记）

快照冻结（`evidence/final-journey/snapshot-fingerprint.txt`，HEAD=8dcef63+dirty 指纹；version-seal s1-20260919-114853）后，在合成验收栈上以真实页面交互执行任务书 §五 旅程。**12 步结果：8 PASS / 1 PARTIAL / 2 NOT_RUN / 1 BLOCKED(设计内 fail-closed)**，逐步页面证据见 `evidence/final-journey/JOURNEY_RECORD.md`：

- **PASS**：业务登录 / 新客户（一次进入）/ 受限邀请（码一次+白名单）/ 客户上传（门户"已登记（待处理）"如实）/ 持续处理-通道路径（页面驱动 邀请→接受→上传→常驻驱动→已完成，回执逐段留痕）/ 来源追溯（回执+处理投影+A 侧留痕）/ 原件预览（A 单件读回+通道签名 URL）/ 退出重进查回（第二张邀请重进，材料+消息持久可见，且跨 Edge 服务重启成立）。
- **旅程发现并修复缺陷 D-04-12**：客户消息发送 500（seam 计数器 messageId 与持久库冲突）——消息恢复能力揭示并修复，页面重试后 PASS。
- **BLOCKED（设计内）**：当前依据→有权人类决定 = 409 POLICY_PENDING（必需域政策未配置，fail-closed）+ Gate 链依赖 A 客户链接（任务02）——**不以绕过/补状态证明办理；fail-closed 完整性本身验证通过**。
- **NOT_RUN**：提问补证（A 侧检查会话链）、人工转录/复核（核验面板）——依赖检查会话上下文，本轮未建立，不并入 PASS。
- **任务02 依赖维持 OPEN**：门户上传→通道自动流转（IR-04-2C）与 Connectors 服务端授权加固（IR-04-2A）未交付；页面旅程在其交付后需重跑步骤5门户路径与步骤10/11。
- 任务01/任务03 交付在旅程中实际生效（重复建档修复、搜索三字段、处理状态投影、对账编号固定、上传文案诚实、A 权威清单消费）。

Front 37 项 / Edge 53 项为**此前轮**组件测试结果，不构成本轮页面验收；本轮 Edge 套件 67 项亦不构成——页面验收以上述旅程记录为准。**执行者自验**：旅程由本路（任务04，Edge 实现参与方）驱动；最终由 Codex 复核，真人体验由用户验收。

## 5. B 执行器判定

**不常驻**。依据：页面旅程消费面（Front dist 全量检索）仅触达 A v1/v2 面、Edge 会话/消息/代理面与 Connectors 处理面；无任何 agent 执行器（claim/complete）消费路径；材料处理由 Connectors 常驻驱动承担。已记录于资源台账 `bExecutor`；若联合验收旅程引入 agent 执行目标，需重新判定并显式启动。
