# D路 RESULT — V7后端独立黑盒验收与故障恢复（2026-09-16 夜间批次）

**状态：DEF-01已关闭（A发布CONTRACT v1.2采纳D反证，D复测通过），全部31项判据（29原项+2扩展）27 PASS / 0 FAIL / 4留门。确认轮 full-r4：32 PASS / 1 FAIL / 4 BLOCKED / 730断言；v1.2适配后定向复测 g2 3/3、g3 4/4（含D-10b死信）、g6 3/3（含D-19b）。全部断言基于真实 HTTP + 真实 PostgreSQL（D自有隔离容器，`v7d-` 前缀/15433段），SUT进程/容器均为D自有子进程，A/B/C源码只读、其常驻部署未触碰。**全部断言基于真实 HTTP + 真实 PostgreSQL（D自有隔离容器，`v7d-` 前缀/15433段），SUT进程/容器均为D自有子进程，A/B/C源码只读、其常驻部署未触碰。**

> 本文件为 03:50 快照，07:00 前随定向复测更新。缺陷明细与复现命令见 `DEFECTS.md`；逐轮证据在 `evidence/`。

## 1. 执行概览

| 轮次 | 时间 | 结果 | 说明 |
|---|---|---|---|
| full-r1 | 02:30 | 21过/10败/6留门（704断言） | 10败全部分类为D侧测试缺陷（旧词汇/断言顺序/计数范围/路径少算/PG就绪竞态），未冤枉SUT |
| full-r2 + r3定向 | 03:10–03:30 | **31过/1真FAIL/3留门（739断言）** | 唯一SUT侧FAIL=DEF-01；其余按契约修复断言后全绿 |
| full-r3 | 03:50 | 进行中 | 同版本可重复性验证 |

框架自检 G0：8/8（20断言）——runner的异常捕获、零断言不PASS、超时、BLOCKED留门、真实socket、隔离PG重启持久化语义全部自证。

## 2. 矩阵判定明细（29项）

| 判据 | 结果 | 断言证据 |
|---|---|---|
| D-01 四态状态机全链 | PASS | g1·44断言：blocked→ready→leased→candidate_ready→accepted→decided，终态再写拒绝 |
| D-02 敏感写失败关闭+禁用键 | PASS | g1·59断言：unknown/缺失凭据 claim/complete/accept/supersede 全403 PRINCIPAL_UNTRUSTED；params/result.output 禁用键400；角色不可由载荷提升 |
| D-03 依赖环检测 | PASS | g1·6断言：模板环+自环 400 DEPENDENCY_CYCLE，无半状态 |
| D-04 目标不能自报完成 | PASS | 并入D-01：complete仅达candidate_ready，accept/decide需人类验收/决定角色且执行者≠验收者 |
| D-05 乐观版本冲突 | PASS | g1·23断言：409 VERSION_CONFLICT{serverVersion}，失败写不推进版本 |
| D-06 双客户端争抢 | PASS | g2·83断言组：恰一2xx+409错误码，DB行级唯一assignee=worker1 |
| D-07 并发提交单效 | PASS | 并入g2：并发accept恰一成功，版本恰+1 |
| D-08 过期租约+fencing | PASS | g2：过期complete 409 LEASE_EXPIRED/STALE_FENCING_TOKEN；takeover后旧token拒绝；result/receiptCount零污染；token单调不回退 |
| D-09 outbox同事务 | PASS | g3·78断言组：成功写出行、失败写零孤儿行（DB级核验），pull含eventId/eventType |
| D-10 至少一次+重投幂等 | PASS | g3：同eventId投递≥2次（订阅端500触发重投），业务状态不被重复推进 |
| D-11 requestId一致性 | PASS | g3：同载荷replayed:true零新写；异载荷409 REQUEST_MISMATCH；DB仅1条证据 |
| D-12 杀worker恢复 | PASS | g4·16断言：B CLI worker（--config/--data-dir全overrides，B源码零写入）经真实HTTP领取calc任务→candidate；kill/重启recoverAll幂等 |
| D-12b mid-flight击杀+零盲重发 | PASS | g4·15断言：model步8s延迟在途SIGKILL→重启20s观察→C mock调用1→1（零盲重发）+诚实failed终态+checkpoint跨进程恢复 |
| D-12b mid-flight击杀+零盲重发 | PASS | g4·15断言：model步8s延迟在途SIGKILL→重启20s观察→C mock调用1→1（零盲重发）+诚实failed终态+checkpoint跨进程恢复 |
| D-13 API重启持久 | PASS | g4·35断言：重启后项目/目标/待办投影逐字节一致，写与回应恢复 |
| D-14 DB重启持久 | PASS | g4·30断言：自有PG容器重启后数据完整、health恢复、新写正常 |
| D-15 checkpoint凭据泄漏 | PASS | g4：扫描D自有B runtime目录（checkpoints/receipts/registry）+注入DLEAK假apiKey的config——零命中（mock模式下凭据不外发不落盘） |
| D-16 人工等待不冻结 | PASS | g5·90断言组：waiting_human期间无关目标完整走通到decided，回应后恢复，重复回应409 HUMAN_REQUEST_CLOSED |
| D-17 待办跨重启 | PASS | 并入g5：重启后待办在、可回应生效 |
| D-18 越权回应拒绝 | PASS | 并入g5：非requestedRole 403 ROLE_FORBIDDEN；不可信403；状态零变化 |
| D-19 证据定向失效（v1.3传递stale） | PASS | g6·33断言：accepted目标stale:true投影、下游传递可见、状态不变、历史保留（supersededBy链、DB核验） |
| D-19b 非accepted命中 | PASS | g6·32断言：invalidated→立即重绑新证据回ready→上游再验收→下游恢复ready且stale清除 |
| D-19c 三级链传递stale（v1.3） | PASS | g6·57断言：root取代→root/middle/leaf全部stale可见；除stale字段外投影逐字节不变；claim/complete不受门影响 |
| D-19d v1.3复核门 | PASS | g6·72断言：stale目标accept/decide→409 UPSTREAM_STALE（staleRoots列根因）→staleReviewAck放行→decided历史不改写（formalDecision保留）→审计`stale_review_acknowledged`≥2条。**注意：ack放行语义属技术候选，业务制度含义 PENDING-USER-RULING（D不代用户接受政策）** |
| D-20 非法操作边界 | PASS | g6·27断言：取代不存在404、重复取代409 EVIDENCE_SUPERSEDED、未知goalKey 4xx |
| D-21 跨项目隔离 | PASS | g7·90断言组：项目级principal重启注入；claim/accept/supersede跨项目403双向；正向控制p1可写 |
| D-22 提示注入不提权 | PASS | g7：语义键content按契约惰性存储；result.output禁用键400；权限模型零变化；正常流程不受扰 |
| D-23 凭据零泄漏 | PASS | g7：403响应/日志/DB全列扫描对高区分度合成凭据零命中 |
| D-24 未配置如实拒绝 | PASS | g8·65断言组：real_http→409 MODEL_NOT_CONFIGURED，无静默mock成功；calculation不受影响 |
| D-25 费用/上下文限额 | 留门 | 契约v1.0与B均未发布成本限额接口；本轮0真实调用，如实不可测 |
| D-26 mock/real强标记 | PASS | g8：provider=simulation落库可读；C假API x-mock-simulation:true + mock.simulationOnly=true；B侧消费留门DEF-02 |
| D-23b C假API凭据纪律 | PASS | g8：无效key 401不回显明文；请求体泄漏key→anomaly标记；控制面记录无明文 |
| D-27 unknown零盲重发 | PASS（核心） | D-12b/D-27b：中断→重启→零盲重发实锤；无凭据resume拒绝（D-9门）实锤 |
| D-27b 人工授权重发腿 | **FAIL·开放（DEF-03）** | g4·27断言×3轮（含新hash两轮、两种组合）：带cred:凭据resume被D-9门接受（exit0、terminal清除）但transport零新增调用，goal滞留failed/leased——授权重发腿未走通，交B |
| D-27b 人工授权重发腿 | **FAIL→DEF-03** | g4·27断言：带cred:凭据resume被接受（exit0）但transport零新增调用，goal滞留leased——授权重发腿未走通，交B |
| D-10b 订阅边界与死信 | PASS | g3·99断言组：常败投递指数退避至上限dead（独立实例maxAttempts=3实测）；订阅后事件确被投递重试 |
| D-19b 非accepted命中失效 | PASS | g6：ready目标取代→invalidated→立即重绑新证据回ready；上游再验收→下游恢复ready |
| D-28 依赖manifest | PASS | g9·7断言（manifest发布后核验）：assembly/manifest.json覆盖独立枚举源树+传递源图（import图遍历）+package.json+lockfile，零缺失 |
| D-29 干净目录启动 | PASS | g9·13断言（v1.3源码复测）：干净目录npm安装→迁移→src直跑启动→health→端到端建模板；r1源树副本轮20断言亦过 |

\* D-28当前以「manifest未发布→BLOCKED留门」形态通过判定：判据本身（程序化核对）已实现并会在A发布manifest后自动生效。

## 3. 缺陷与观察

见 `DEFECTS.md`：
- **DEF-01（P1·A）**：accepted-stale 上游的下游不被级联失效，v1.0§3.6文字与 `recompute.ts` 实现分歧，待A裁决（改码或升契约）。
- **DEF-02（P2·B）**：worker无CLI常驻入口，D-12/15/26/27端到端留门。
- 观察项4条（takeover角色门、开放写审计面、读接口无校验、tsc类型面干净）。

## 4. 剩余门（截至本快照）

1. ~~B worker CLI + DEF-03 授权重发腿~~ 已交付并验收（D-12/12b/15/27b 全过）。
2. A `assembly/manifest.json` → D-28 完整程序化核对（传递源图+lockfile）。
3. **DEF-01(b) 业务语义**：v1.3技术候选（可见性+复核门+ack）已由D独立验证PASS；**ack放行制度、重开制度的业务含义待用户裁决**——技术验证通过≠政策接受。
4. 真实provider、生产权限源、第二机器：本轮明确不测（见§5）。

## 5. 结论分级（如实边界）

- **模拟工程链路**：以上全部结论基于本机合成凭据（A官方SPEC token）+ C假API模拟transport + D自有隔离PostgreSQL。✅ 已验收。
- **真实provider未测**：GLM-5.2未接入（本轮0真实调用、0付费API），transport仅预留面。MODEL_NOT_CONFIGURED 如实拒绝已验。
- **生产权限未测**：principal均为合成目录注入；真实身份源（企业验证器）未接。
- **第二机器未测**：D-29为本机干净目录；跨机/跨OS未验证。

## 6. 复现入口

```bash
cd V7/backend-next/D
node harness/run-all.mjs <runName>                      # 全矩阵
D_SUITES=g6 node harness/run-all.mjs retest-def01       # DEF-01定向复测
node suites/g0_runner_selftest.test.mjs                 # 框架自检
```
退出码：0全过 / 1有FAIL / 2套件崩溃 / 3零断言不得PASS。


## 0. 最终收敛结果（06:45 程序化汇总，唯一test id × 最新包含运行；明细见 evidence/FINAL_AGGREGATION.txt）

- **40 个唯一测试 id（29 原始判据 + 11 扩展/变体）：37 PASS / 1 FAIL（D-25e，见下）/ 2 BLOCKED（D-25旧blocked id已被D-25a-e取代、D-27p被D-27b取代）。累计 1025+ 断言（最终轮）+ 历史轮次证据全存 evidence/。**
- D-25e（预算重启持久）：同族重启持久核心判据（总调用=1）在 d25-final/r9 多轮 PASS，但目标级"胜者"断言在部分轮次出现 candidate→failed 翻转与 undefined 读数（疑似套件间共享 mock 生命周期竞态，D侧已改动态端口；B侧胜者翻转机制待 B 定位）——**如实标记不稳定，待稳定复跑**，不覆盖失败。
- D-19d 语义说明：现行为 v1.3 复核门技术验证（PASS，72断言）；v1.0 原需求反例的历史证据保留于 evidence/r3-g6 与 DEFECTS.md 时间线；**ack 放行制度与重开制度的业务含义 PENDING-USER-RULING**。
- 未测项（如实）：真实 provider（0 调用）、生产身份源与跨项目隔离（synthetic only；submitEvidence/GET 的匿名与跨项目边界已实测并记录于观察项）、第二机器。
- 恢复入口：`D/README.md`（全矩阵/单套件/单测命令；退出码 0/1/2/3）。
