# INTERFACE｜R4 产品桥 delta 审查与接线点(2026-09-13)

任务:`V6/ZCODE_R4_A_20260913.md`(不重写适配器;审查产品桥与 R3 桥差异,关闭产品调用链/人控/部分失败缺口,取得实际接入回执)。反例证据:`test/unit/18-product-bridge-risks.test.mjs`;修改请求:`CHANGE_REQUEST.md`;独立复核:`AUDIT_REPORT_R4.md`(PASS-WITH-NOTES)。

## 1. 最小差异:产品桥 vs R3 桥(结论:不重写,产品桥为正)

| 维度 | R3 桥(src/bridge/product-bridge.mjs) | 产品桥(remote-model-adapter-bridge.ts,MAIN 侧) |
| --- | --- | --- |
| 形态 | 纯映射:产出协议请求 + snapshot 回调,MAIN 自行调 analyze | 产品语义包装:`generateFollowUps(req, probe)` → 产品四状态 ModelProviderResult |
| generation | +1 偏移 | 同(+1,`GENERATION_OFFSET`),裁决一致 |
| contextVersion | `rv${version}` 字符串 | 数字 `state.version`(同源同效;候选校验两者皆收) |
| 原子读取 | storeReader 单次读约定 | `readRemoteStoreState()` 单次读(单文件 JSON,天然满足) |
| 证据解析 | 整清单映射(evidenceToRefs) | **更强**:annotation→evidenceId 回链 + sha256 比对 + superseded 拒绝(fixtureId 仅作种类标识) |
| 状态门 | 快照核对(stale/paused 拒绝) | pre-gate + 候选内部快照 + post-await probe(见 §2 R-d) |
| 多角色 | 无(单角色按需) | 逐角色循环 + aggregateResults 聚合(dissent 保留/pendingDecisions 不裁决) |
| 状态映射 | 七状态→产品动作表 | 七状态→四状态分桶(ok/partial/failed/rejected)+ productAction |
| 人控 gate | context.gate 透传 | **不可达**(CR-3) |
| 会话消失 | 快照保守停摆(paused:true) | 回退旧 generation+paused:false(**CR-4**,被 version 推进兜底) |

**判定**:产品桥覆盖并超出 R3 桥职责,是正确的集成层;R3 桥保留为候选协议参考。R4 不重写任何一侧。

## 2. MAIN 精确接线点(实际代码位置)

1. **UI→service**:`app/api` 追问端点 → `remote-service.ts#simulateFollowUps(body)`(:513;body=sessionId/annotationId/requestId/expectedVersion,幂等+OCC)。
2. **service→桥**:`remote-service.ts:539` `createBridgedModelAdapter()`(模拟通道)+ `:540` `bridge.generateFollowUps({sessionId, annotationId, evidenceRef, domainRoles:[credit,policy,commerce,asset], purpose:'follow_up_generation'})`——**未传 stateProbe(CR-2)**。
3. **桥→候选**:产品桥内部经 `lib/v5-preview/model-adapter/`(R2 冻结版拷贝)逐角色 analyze。
4. **回写**:ok/partial → replies(model_simulation 显著标注)写回 annotation;failed/rejected → 失败说明回复 + 确定性表兜底(如实标注)。

## 3. 四风险判定(反例 18,6/6;独立审查 PASS-WITH-NOTES)

| 风险 | 判定 | 关键证据 |
| --- | --- | --- |
| R-a 会话消失快照回退旧 generation/paused=false | **风险确认,无实际逃逸**(脆弱模式):消失必推进 version → 候选 CONTEXT_VERSION_CHANGED → rejected 失败关闭;审查者 A2/A3 组合(消失不改 version/删文件重播种)产品写语义不可达但已在 CR-4 列防御 | 18 R-a;AUDIT_REPORT_R4 |
| R-b gate 未传 | **接口缺口确认**:产品桥无 gate 入口,候选 scope 恒 null;产品层 reviews/human_verified 承担等价门 | 18 R-b;CR-3 |
| R-c partial 丢 unknown 人控动作 | **缺陷确认(形态修正)**:R2 冻结动作表 succeeded.mustHumanVerify=true 掩盖了布尔丢失;真实形态=partial 沿用 succeeded 动作,unknown 的"先核实外部是否实际发生"专属语义只在 failureReason 文字/perRole 元数据,调用点 partial 分支不落任何说明 | 18 R-c;CR-1(P1) |
| R-d 多角色末尾只核旧 probe | **接线缺口确认**(remote-service.ts:539 无 probe 实参);桥级机制有效(pre-call 门+post-await 复核均验证降级),角色内部 fresh 快照兜住暂停/换代,未复现实际逃逸;残余窗口趋零 | 18 R-d;CR-2(P2) |

## 4. 集成回执(R4_INTEGRATION_RECEIPT@1,替代 R3 自填布尔)

`src/bridge/receipt-v4.mjs`:`buildIntegrationReceipt({integrationInputId, inputManifest, runEvidence, siteRoot})` → 回执内嵌**判定时点现算**的代码 hash(产品桥/remote-service/候选 adapter 三文件);`judgeIntegrationReceipt(receipt, {siteRoot|expectCodeHashes})` —— **判定方现算基准,不采信回执自填 hash**;缺 siteRoot/期望 → 拒绝。状态机:candidate(本批)→ MAIN 交 integration-inputs 编号 + 合格回执 → A 路机器核对 → integrated。

## 5. NOT TESTED

真实模型推理质量与真实 provider 端点(调用 0);真机 UI 链路(HTTP 层以上)归 MAIN 验收;提醒/纠偏协议未接产品事件流。本轮产品代码零改动、真实模型调用 0。
