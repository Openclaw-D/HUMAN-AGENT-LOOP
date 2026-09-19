# 任务04 · NEXT_ACTION

更新：2026-09-19（页面旅程已在冻结快照下执行；剩余收口路径明确）。

## 1. 剩余收口路径（D27-L/D27-L-UI 转 PASS 的唯一缺口）

1. **任务02 交付**：IR-04-2A（Connectors 服务端逐资源授权）+ IR-04-2C 裁定（统一上传编排 + customerId↔aCustomerId 授权客户链接机制）。
2. **获准配置合成必需域政策位**（A 启动 `--required-domains-policy` + `domain_requirement_policies` 种子；政策内容须明确标注非公司制度或经公司批准）。
3. **重跑旅程步骤 9/10/11**（提问补证 A 侧检查会话链 / 人工转录复核 / 有权人类决定）+ 页面级第二客户并行走查与撤权走查——快照重新冻结后执行。
4. 结果回写 TEST_RESULTS §4/JOURNEY_RECORD；Codex 复核 → 用户验收（真人试用另列）。

## 2. 已完成（本轮）

冻结快照（E-12/13）下的页面旅程已执行：8 PASS / 1 PARTIAL / 2 NOT_RUN / 1 BLOCKED(设计内)（`evidence/final-journey/JOURNEY_RECORD.md`）；旅程发现并修复 D-04-12。装配/消息/授权/健康检查/资源台账全部交付并验证（CURRENT_STATE §本轮已交付）。

## 3. 随时可复跑

- `node test/run-all.mjs`（Back/Edge，67 项）。
- `node scripts/delivery-up.mjs --config config/delivery-runtime.acceptance.json --serve-front <Front/dist 绝对路径>`（合成验收栈；停止 `node scripts/delivery-down.mjs`）。
- `node docs/v02-remediation/task-04/evidence/assembly-smoke.mjs 48210`（栈在跑时）。

## 4. 明确不做（本路边界）

不代修 Connectors/A/Front 代码；不以 SQL 补状态、预填分析/Gate 或绕过 POLICY_PENDING 证明办理；不把组件测试计数当页面验收；无 commit/push/部署。
