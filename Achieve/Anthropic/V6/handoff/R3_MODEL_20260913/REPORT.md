# REPORT｜R3 A:适配器→产品合成接入契约(2026-09-13)

任务书:`V6/ZCODE_R3_A_20260913.md`。基线:R2 冻结批次拷贝(输入 hash `evidence/r2-baseline-input-hashes.txt`,35 文件);产品源码只读。执行台账 `AGENT_LEDGER.md`;状态 `STATUS.md`。

## 1. 关闭的断点(Codex/R2 验收遗留:"192 测试通过但真实产品没接上")

| 缺口 | R3 关闭物 | 证据 |
| --- | --- | --- |
| 产品 generation 0 起步 vs 协议正整数(R2 留给主任务的裁决) | 桥层 +1 偏移:`协议代次 = 产品代次 + 1`,请求侧与快照侧同源;回执并列回显两个口径 | 16 测试 gen0→1 / gen2→3 / 暂停恢复链 gen0→2→3→协议4;**mutant-E1**(删偏移)被适配器 REQUEST_INVALID 抓住(2/2 之一) |
| contextVersion 与证据必须同快照读取 | 桥只接受 `storeReader()` 单次一致性读;一次读取同时产出 generation/contextVersion/evidenceRefs;缺任一元 → `MAPPING_MISSING_FIELDS` 失败关闭,无默认常数 | 16 原子读取四连测(missingVersion/legacyNoGeneration/reader 非函数/reader 抛错);**mutant-E2**(缺失补 0)被失败关闭语义测试抓住(2/2) |
| MAIN 需要可执行样例与接入凭据 | `sample/MAIN_CALL_SAMPLE.md` + `src/bridge/receipt-protocol.mjs`(`R3_BRIDGE_RECEIPT@1`)+ `sample/expected-receipt-succeeded.json`(端到端真实产出,isIntegratedReady=true);**candidate → 收合格回执 → integrated** | INTEGRATION_CHECKLIST.md A/B 组 |

## 2. 指标对账(任务书 DoD)

| DoD | 结果(实测) |
| --- | --- |
| generation0/1、多次暂停恢复、证据升级:每条请求/快照一致性断言 | 16:gen0→1(请求+快照+bridgeMeta 三点)、gen2→3、暂停恢复链(0→2→3,含缓存命中 stale 与 transport 计数)、证据升级(remoteVersion/superseded 过滤/contextVersion 推进)逐条双断言 |
| 缓存/在途返回不越当前版本及权限门 | 16(stale/SESSION_PAUSED/gate scope)+ 17(S4 版本替换中途翻转 reader → stale,数据保留、usage committed);R2 套件 S8/S12 回归 |
| 跨项目污染 0 | 17 S1:两会话并发交替 10 次,证据集/requestId 零交集 |
| 在途淘汰 0 | 17 S2:容量 6、8 请求含永久在飞 → 背压 2、零淘汰(registry 行为断言) |
| 静默未知重试 0 | 17 S3:unknown 后同ID重试=完整新调用(计数 2);unknown 回执缺 mustHumanVerify → isIntegratedReady 拒绝 |
| 异议丢失 0 | 16:两结果聚合 findings×2 + dissent×1 + pendingDecisions 只列双方(键集断言);问题 text 合并保留 sources |
| MAIN 可消费 fixture+expected | `sample/expected-receipt-succeeded.json`(真实端到端产出)+ `fixtures/product-snapshots.mjs`(6 组冻结产品形状) |
| 原 192 回归 + 新接口测试 + 定向 mutation(分母/失败/限制) | **212/212**(192 R2 回归 + 9 接入一致性 + 11 故障压测),退出码 0;**定向 mutation 2/2(分母 2:E1 偏移/E2 默认常数)**;R2 套件 mutation 7/7(分母 7)回归在 09。压测分母:25 调用(19 succeeded/2 stale/1 cancelled/2 failed/1 unknown)+ 账本逐笔溯源 |
| 真实 provider 兼容与模型质量 | **NOT TESTED**(产品 API 真实调用 0) |

## 3. 账本守恒与未知费用(实测)

17 全场景共享账本终态:occupied=reserved+committed+unknownHold=7463(reserved 2000=永久在飞、unknownHold 1000=ABORTED_AFTER_SEND、committed 4463 逐场景、released 1000=确定未送出且留痕 `TRANSPORT_REPORTED_NOT_SENT`、rejectedCount=0);每笔按 reservationId 溯源;**未知费用释放 0**。

## 4. 执行与限流事实

- Subagent:BRIDGE-FAULT 成功(11/11,mutation 2/2);BRIDGE-TEST 06:35 触发 1302 限流,**按覆盖条款退避并由主线程接手**(16 的 9 项由主线程实现并全绿),未重试风暴;并发峰值 2,符合"默认 2 最多 3"。
- 主线程:STATUS/桥(product-bridge/receipt-protocol)/fixtures/16/文档/冻结。全过程见 AGENT_LEDGER.md。

## 5. NOT TESTED 与边界

真实产品 store 实例端到端联测(产品只读,形状按源码静态核对:remote-types.ts:44-81、remote-store.ts:44-56);真实 provider 兼容;模型推理质量;越权词表启发式;提醒/纠偏协议未接产品事件流。**产品 API 真实调用 0**;未读凭证;未操作 Codex;无 Git 写/新依赖。MAIN 接入前适配器能力为 **candidate**。
