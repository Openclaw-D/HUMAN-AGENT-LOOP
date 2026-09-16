# STATUS｜R3 A:适配器→产品合成接入契约(2026-09-13)

**状态:IN_PROGRESS(06:22 接手)——完成后更新 READY_FOR_REVIEW 并冻结;09:00 收束。**

- 任务书:`V6/ZCODE_R3_A_20260913.md`(Objective:关闭"192 测试通过但真实产品没接上"的断点,交可验证接入桥与人控/分歧/提醒语义)。
- 写入范围:仅 `V6/handoff/R3_MODEL_20260913/**`。产品代码只读;R2 批次(`R2_MODEL_20260913/`)冻结不动——以 R2 拷贝为演进基线,输入 hash 见 `evidence/r2-baseline-input-hashes.txt`(35 文件)。
- 并发:默认 2、最多 3 subagent(接入验证/反例审查),限流退避。真实产品 API 调用 0;不读凭证;不操作 Codex;无 Git 写/新依赖。

## R2→R3 缺口与关闭方式(任务书顺序 1–5 对应)

| # | R2 遗留缺口 | R3 关闭物 | Owner |
| --- | --- | --- | --- |
| 1 | 产品 generation 0 起步 vs 协议正整数(R2 留给主任务的裁决) | 桥层 **+1 偏移**:协议代次 = 产品代次 + 1(不改产品事实、不改协议),暂停/恢复/缓存全链一致 | 主线程(桥) |
| 2 | contextVersion 供给需"同一快照读取"(防证据与版本撕裂) | 桥只接受 `storeReader()` **单次一致性读**(产品 remote-store 单文件 JSON 读天然满足);一次读取同时产出 generation/contextVersion/evidenceRefs;reader 缺任一元 → 失败关闭,不用默认常数补齐 | 主线程(桥) |
| 3 | MAIN 需要可执行的接入样例与回执凭据 | `sample/MAIN_CALL_SAMPLE.md` + `receipt-protocol.mjs`:`R3_BRIDGE_RECEIPT@1`(纯结果投影,不复制业务状态);接入前 **candidate**,收到合格回执才 **integrated** | 主线程 |
| 4 | 接入一致性/故障测试未按产品形状构建 | 16(接入:generation0/1、多次暂停恢复、证据升级、缓存/在途不越门、异议/人定分离、提醒授权与去重)+ 17(压测:跨会话/容量满/延迟/取消/版本替换/刷新重放/账本守恒,固定 seed,不重复绿测凑量)+ 定向 mutation | Agent-BRIDGE-TEST / Agent-BRIDGE-FAULT |
| 5 | 人工纠偏→待审核改进预案(跨案例+人的决定才推进) | 复用 R2 human-feedback(不做训练/不改全局规则/不自动升级);桥样例演示 | 主线程/复用 |

## 执行记录

- 06:22 接手,基线拷贝与 hash 记录完成;产品形状源码核对(remote-types.ts:44-81、remote-store.ts:44-56:status 枚举 scheduled/live/paused/ended,generation 初始 0,store.version=remoteVersion)。
- 06:25–06:45 主线程实现桥(src/bridge/product-bridge.mjs、receipt-protocol.mjs)与 fixtures/product-snapshots.mjs(6 组冻结产品形状);R2 192 项回归零失败。
- 06:30 派 2 subagent:BRIDGE-FAULT 成功(17:11/11,全量 203/203,mutation 2/2);BRIDGE-TEST 触发 1302 限流 → 按覆盖条款退避,主线程接手实现 16(9/9 全绿)。
- 07:10 全量 **212/212**(退出码 0);交接物齐备(sample/INTERFACE/INTEGRATION_CHECKLIST/REPORT/AGENT_LEDGER)。

## 最终状态(08:50 收束前填写)

**READY_FOR_REVIEW(本批文件自 MANIFEST.json 生成时刻起冻结)。**

- 测试:212/212,退出码 0;R2 套件 mutation 7/7(分母7)回归 + R3 定向 mutation 2/2(分母2)。
- 冻结核验:gen-manifest → 复跑(只写 runtime/)→ `verify-frozen-hash` 46+ 文件全部匹配、退出码 0;核验输出在 `runtime/verify/`(不回写冻结区)。
- DoD 逐条:generation0/1、多次暂停恢复、证据升级均有请求/快照双断言 ✅;缓存/在途不越版本与权限门 ✅;跨项目污染0、在途淘汰0、静默未知重试0、异议丢失0 ✅;MAIN 可消费 fixture+expected ✅(candidate→回执→integrated);192 回归+新接口测试+定向 mutation 分母报告 ✅;真实 provider 兼容与模型质量 NOT TESTED ✅。
- 转下一批:MAIN 回传合格回执后标 integrated;真实 provider 端点联测(无凭据);提醒/纠偏协议接产品事件流。
