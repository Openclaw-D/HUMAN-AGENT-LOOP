# FINAL_REPORT｜R4 A:验证模型桥真正进入产品(2026-09-13)

任务:`V6/ZCODE_R4_A_20260913.md`;共同契约:`V6/ZCODE_R4_GOALS_20260913.md`。批次:`V6/handoff/R4_MODEL_20260913/`(冻结,READY_FOR_REVIEW)。独立审查:`AUDIT_REPORT_R4.md`(PASS-WITH-NOTES)。

## 1. 一句话结论

产品桥(MAIN 侧 `remote-model-adapter-bridge.ts`)已真实进入产品调用链(remote-service.ts:513→539,UI 追问→桥→回写,service 级端到端实测通过);四个点名风险经反例验证:**1 项确认缺陷(R-c,partial 丢 unknown 人控语义,P1)+ 2 项接口/接线缺口(R-b/R-d,P2)+ 1 项风险无实际逃逸(R-a)**;修复请求全部落 `CHANGE_REQUEST.md`(MAIN 单 writer 执行);集成回执升级为 hash 机器核对(`R4_INTEGRATION_RECEIPT@1`),candidate 与 integrated 分离。

## 2. 验收闭环(A 路责任项)

| 项 | 状态 | 证据 |
| --- | --- | --- |
| UI→service→桥真实链路 | **确认存在并实测**:service 级端到端(18 R-6):`simulateFollowUps`(隔离 store)→ 四角色经桥 → annotation.replies 回写(模拟声明显著、authority=none 标注、多角色覆盖)+ 幂等重放不追加;requestId 全链(service 幂等表 + 桥 candidate.requestIds) | 18 R-6;INTERFACE §2 |
| 四风险反例 | R-a 风险无逃逸(失败关闭实测);R-b 接口缺口;**R-c 缺陷复现**(partial UI 动作未反映 unknown 须核实);R-d 接线缺失(桥级机制有效证明) | 18(6/6);CHANGE_REQUEST CR-1..4 |
| 模拟 transport + 回执样例 | MAIN_CALL_SAMPLE(R3)仍然有效;R4 新增 receipt-v4(hash 机器核对,修复 R3 五个自填 boolean 弱点) | src/bridge/receipt-v4.mjs;19 测试 |
| MAIN 输入包 | **已接收并引用**:R4_MAIN_20260913/evidence(iso-dev-3451.log、iso-runtime-data、pre-snapshot)+ trajectories(r4-trajectory-run.json 等);回执 integrationInput.manifest 引用其路径/hash | src/bridge/receipt-v4.mjs(CODE_FILES/manifest 契约) |
| 未等 MAIN 不空转 | 产品桥 delta 审查、四风险反例、CR、回执 v4 均为独立交付 | INTERFACE.md、CHANGE_REQUEST.md |

## 3. 测试与分母(实测)

- 全量:**222/222 通过,退出码 0**(`node test/run-all.mjs`;212 R3 回归零失败 + 6 反例 + 4 回执)。
- R3 套件 mutation 7/7(分母 7)、R3 定向 2/2(分母 2)回归在套件内;R4 新增定向:R-c/R-a/R-d 反例即"红绿"证据(缺陷现状红、修复方向绿在 CHANGE_REQUEST 验收断言),R-b/R-d 接线缺口为代码级确认(无行为红可造)——分母与性质如实区分。
- 独立审查(AUDIT_REPORT_R4,PASS-WITH-NOTES):独立复演 R-c/R-a、打穿尝试 A2/A3(产品写语义不可达)、措辞审计(无风险↔缺陷互串;STATUS 预判错误已被实测纠正而非沿用)。其 N1(逃逸组合入 CR)、N2(注释归因)已落实;N3/N4(冻结/STATUS)由本轮收尾完成;N5 行号 540→539 已按实际修正。

## 4. 缺陷与风险清单(移交 MAIN)

| ID | 级别 | 摘要 | 状态 |
| --- | --- | --- | --- |
| CR-1 | P1 | partial 的 productAction 未反映 unknown"须先核实";调用点 partial 分支不落失败说明 | 反例复现,待 MAIN 修 |
| CR-2 | P2 | remote-service.ts:539 调桥未传 stateProbe(post 复核 UI 链路缺失;残余风险趋零) | 接线缺口,待 MAIN 修 |
| CR-3 | P2 | 候选 gate(预处理人控门)在产品桥不可达(产品层有等价门) | 接口缺口,待 MAIN 修 |
| CR-4 | P3 | 会话消失快照回退旧值(version 兜底无实际逃逸;A2/A3 组合防御) | 风险,防御建议 |

## 5. NOT TESTED 与边界

真实模型推理质量与真实 provider 端点(产品 API 真实调用 0);HTTP 层以上真机 UI(402×874 视觉归 MAIN/B);真实会话删除路径的产品行为(产品无删除 API,反例为合成写);提醒/纠偏协议未接产品事件流;越权词表启发式。**未读凭证、未操作 Codex、无 Git 写、无新依赖、未动 3311/3321/3399**。

## 6. 恢复说明

本批只写 R4_MODEL;产品零改动无需恢复。测试运行产生的唯一产品树外副作用=runtime/isolated-store(隔离数据目录,可整目录删除);冻结核验:`node tools/verify-frozen-hash.mjs`(退出码 0=未改);复现:`node test/run-all.mjs`。
