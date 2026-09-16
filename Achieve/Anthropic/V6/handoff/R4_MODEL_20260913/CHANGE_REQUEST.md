# CHANGE_REQUEST｜R4 A → MAIN(2026-09-13)

来源:R4 A 反例测试(`test/unit/18-product-bridge-risks.test.mjs`,218/218 全绿)+ 独立审查(`AUDIT_REPORT_R4.md`,PASS-WITH-NOTES)。以下修改均属产品侧(MAIN 单 writer),A 路不代改;每项附精确位置与验收断言。

## CR-1(P1)|partial 的 UI 动作未反映 unknown 角色"须先人工核实"【R-c,已复现确认】

- 位置:`remote-model-bridge?` → `remote-model-adapter-bridge.ts:330-335`(productStatus 分桶)与 `:406-411`(productAction 取 primaryStatus)。
- 现状(反例实测):credit=succeeded + policy=unknown → `status:'partial'`、`productAction` 沿用 succeeded 动作(`show_result_pending_review`)——unknown 角色的"外部调用可能已发生,须先人工核实,禁止直接采信"专属语义只存在于 `failureReason` 文字与 `candidate.perRole` 元数据;且调用点(remote-service.ts:546-557)仅在 failed/rejected 分支消费 failureReason,**partial 分支不落任何说明**。
- 修法(任选或并用):
  1. productAction 合并规则:partial 且 perRole 含 `unknown`/`not_configured` → `productAction` 改用最严角色动作(`statusToProductAction('unknown')`,uiAction=`human_verify_before_retry`)或至少强制 `mustHumanVerify:true` + uiAction 注明"部分角色结果未知";
  2. 调用点 partial 分支:把 `bridgeResult.failureReason` 以"失败说明"回复落盘(与 failed/rejected 同款,显式非结论)。
- 验收断言:同反例输入下 `productAction.uiAction === 'human_verify_before_retry'`(或 mustHumanVerify=true 且 uiAction 文案含"未知/核实");annotation.replies 含部分失败说明。

## CR-2(P2)|调用点未传 stateProbe:post-await 状态复核在 UI 链路整体缺失【R-d,接线缺口】

- 位置:`remote-service.ts:539`(`bridge.generateFollowUps({...})` 无第二参)。
- 现状:产品桥支持 probe 且 post-await 复核有效(独立审计双态 probe 补证:probeCalls=2、降级留痕 post-await);但 UI 链路未接线,该防线整体缺失。实际逃逸被候选角色内部 fresh 快照兜住(18 R-d(1)),残余窗口趋零——故 P2 非 P1。
- 修法:调用点传入现读 probe:`() => { const s = readRemoteStoreState(); const sess = s.sessions.find(...); return { sessionStatus: sess?.status, currentEvidenceVersion: <当前证据版本> }; }`(与 fixed_stub 调用约定同形)。
- 验收断言:模拟通道下无法直接复现时序;以代码审查+单测(mokc probe 双态)确认接线即可。

## CR-3(P2)|候选 gate(预处理人控门)在产品桥不可达【R-b,接口缺口确认】

- 位置:`remote-model-adapter-bridge.ts` `createBridgedModelAdapter(options)` 与 `candidate.analyze` 调用(无 gate 键)。
- 现状:候选 `scope='preprocessing_only'` 语义(专业前序未通过→仅预处理)不可达;产品层等价门为 reviews/human_verified(服务端),影响有限——但桥既已在结果元数据保留 scope,入口却永远不给,属半接线。
- 修法:`options.gate?: () => { professionalReviewPassed: boolean }` 透传至 `analyze` 第二参;调用方(产品)按 reviews 现态提供。
- 验收断言:gate=false 时结果 `candidate.scope==='preprocessing_only'` 且 UI 不进入正式判定通道。

## CR-4(P3)|会话消失快照回退旧值(version 兜底,当前无实际逃逸)【R-a,风险/防御建议】

- 位置:`remote-model-adapter-bridge.ts:299-301`(snapshotForCandidate):`freshSession ? freshSession.generation : session.generation`(回退旧值)、`paused: freshSession ? ... : false`。
- 现状:会话消失必伴随 store 写入(version+1)→ 候选 CONTEXT_VERSION_CHANGED stale → 失败关闭(反例实测 rejected,误归类为"上下文版本变化"而非"会话消失")。独立审查找到两个**产品写语义不可达**的逃逸组合:A2 会话消失但 version 不变 → ok 放行;A3 store 文件删除 → 重播种 version=1 与请求重合 → ok 放行(备份恢复同样命中)。
- 修法(防御性,与 R3 桥对齐):freshSession 缺失 → 快照返回 `{ generation: 0, contextVersion: '', paused: true }`(保守停摆,必 stale 且语义正确);A3 场景建议 store 恢复流程保证 version 单调(恢复说明属 MAIN 职责)。
- 验收断言:A2/A3 组合下结果 rejected(不再 ok)。

## 附:不受影响项(审查确认)

- 桥的 generation +1 偏移、contextVersion 同源读取、superseded 证据失败关闭、七状态→四状态映射、dissent 保留:审查未发现缺陷。
- succeeded.mustHumanVerify=true 是 R2 冻结动作表事实(R2_FIELD_MAPPING §3 三处一致),非缺陷。
