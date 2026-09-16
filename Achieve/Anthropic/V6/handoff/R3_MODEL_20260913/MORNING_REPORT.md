# MORNING_REPORT｜R3 A(北京时间 2026-09-13)

任务:`V6/ZCODE_R3_A_20260913.md`。批次:`V6/handoff/R3_MODEL_20260913/`(READY_FOR_REVIEW,冻结)。**候选仍待 Codex 复验;MAIN 接入前适配器能力为 candidate;产品 API 真实调用 0;不自认 visual_accepted。**

## accepted-candidate(实测关闭,待 Codex 复验)

1. **generation 0→1 接入裁决落地**:桥层 +1 偏移(R2 遗留两项裁决之一),请求/快照/requestId/回执四点同源一致;gen0/2/3 全链测试;mutant-E1(删偏移)被适配器请求校验抓住。
2. **原子快照读取**:桥仅接受 storeReader 单次一致性读;载荷(generation/contextVersion/evidenceRefs)同源不撕裂;缺 version/generation → `MAPPING_MISSING_FIELDS` 失败关闭无默认常数;reader 异常/会话消失 → 保守停摆(在途必 stale);mutant-E2(缺失补 0)被抓住。
3. **回执协议 `R3_BRIDGE_RECEIPT@1`**:纯结果投影(不复制业务状态);五项桥自验 checks;`isIntegratedReady` 判 candidate→integrated 唯一凭据;`sample/expected-receipt-succeeded.json` 为端到端真实产出。
4. **接入一致性(16,9 项)**:多次暂停恢复链(0→2→3,缓存 stale 不增调用)、证据升级(EV-001 出/EV-004 进/supersededFiltered 计数/旧载荷 mismatch)、原始意见/异议/待人决定三者分离且去重不吞观点、提醒仅授权上下文+同 key 合并+动作白名单。
5. **故障压测(17,11 项)**:跨会话污染 0、容量满背压且零淘汰、延迟取消→unknown(账本保留)、刷新重放(成功后缓存/unknown 后完整重跑)、版本替换中途→stale;账本守恒 occupied 恒等式 + 逐笔 reservationId 溯源 + 未知费用释放 0;固定 seed=20260913 三次复跑逐位一致。
6. **回归与 mutation 分母**:全量 **212/212**(192 R2 回归);R3 定向 mutation **2/2(分母 2)**;R2 套件 mutation 7/7(分母 7)回归通过。
7. **冻结证据隔离机制沿用到 R3**:测试只写 runtime/;gen-manifest→复跑→verify-frozen-hash 全匹配(退出码 0)。

## changes-required(自报)

1. MAIN 需按 `INTEGRATION_CHECKLIST.md` 完成接入并把**合格回执**交回 `R3_MODEL_20260913/received/`(回执到位才标 integrated);清单 A1–A3 是 MAIN 侧动作,A 路无权限代做。
2. 桥的 superseded 过滤是桥层规则(显式计数);若产品要求"被取代证据也进清单供异议引用",需新批次改桥并同步 16 测试。
3. `evidence/` 冻结区与运行时核验输出的分工已固化(REPORT §5);若 MAIN 复跑时向 evidence/ 写文件会破坏冻结——须沿用 runtime/ 约定。

## deferred

1. 真实产品 store 实例端到端联测(产品代码本轮只读;形状按源码静态核对,remote-types.ts:44-81、remote-store.ts:44-56)。
2. 真实 provider 端点联测与模型质量(始终 NOT TESTED;无凭据,产品调用 0)。
3. 提醒/纠偏协议接产品事件流;性能仅报实测(0.35s/212 项),不做 SLA。

## 运行事实

- 测试:212/212,退出码 0(`node test/run-all.mjs`);复跑一致。
- 并发:峰值 2;限流 1 次(06:35 BRIDGE-TEST)→ 主线程接手,未重试风暴。台账:AGENT_LEDGER.md。
- 边界:仅写 R3_MODEL 目录;产品与 R2 只读;未操作 Codex;未读凭证;无 Git 写/新依赖/部署。
