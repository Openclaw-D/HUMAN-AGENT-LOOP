# V7-A STATUS｜业务运行底座与最终组合

更新：2026-09-15 07:5x（心跳 0725 A 节执行完毕）。Owner: `V7/backend/A/**` + 独占 `V7/backend/CONTRACT.md`。GLM-5.3-Flash 最高 thinking；不操作 Codex；不写 site/home/V6/他路；无 commit/push/tag；真实付费 API 0 次。

## 当前状态：**D-9 恢复链经双候选实际组合验证 PASS（23/23）+ 组合 hash 23 文件固定 → 交 D 最终验收**

## 本轮完成（心跳 0725 A 节）

1. **消费 B D-9 可信恢复接口**：`assembly/recovery-round.mjs` 双候选（thin + LangGraph）各走完整恢复链——真实暂停（模型步 unknown，发送后不可知）→ **A 升级投影**（state=unknown）→ unknown 不自动重发（adapter 调用计数=1）→ **错凭据 resume 被拒**（两候选身份门均 throw PRINCIPAL_UNTRUSTED；无 A 副作用）→ **A 门匿名正式动作 403**（无副作用）→ **可信 retry_step**（人工核实后显式重试：新 attempt/新 requestId，非盲发，调用计数=2）→ **B 内部 completed 而 A 保持 unknown**（B 内部完成不冒充 A 正式人工审批；D-4 升级态意见门持住，重试候选未入库）→ **A 正式人工动作**（可信凭据）→ resolved + principalId 留痕。附加：LangGraph 凭据零落盘（checkpoint 全文扫描）。**23/23 PASS**（`evidence/assembly-recovery-round-final.txt`；含两轮失败留档 `assembly-recovery-round-1.txt`——断言前缀与 lg pauseNotice 语义两处测试错误，非产品缺陷）。
2. **合成 verifier/授权策略**在 assembly 注入（非生产认证）；未发明生产岗位规则；unknown 不自动重发与 authority=none 全程保持。
3. **组合 hash 重建**：`assembly/manifest-hashes.sha256` **23 文件**（B D-9 变更文件 thin/langgraph 编排器、resume-core、codes 已刷新入列）。**交 D 最终验收**（恢复链 + 编排级 unknown/崩溃恢复/重复副作用/可信 resume + 双候选投影一致性）。
4. **RUNBOOK 更新**：恢复命令形状与恢复链复跑入口入册。

## 证据清单（全绿）

单测 18/18（service 13 + http 5）；组合四组全 PASS：b-round（A×B×C）、integrated-round（A×C）、lg-round（双候选投影一致）、recovery-round（恢复链 23/23）。详见 `evidence/` 与 `assembly/MANIFEST.md`。

## 等待/阻断（如实）

- **D 最终验收**（外部）：被测版本 = 23 文件 hash。
- 真实模型通道：凭据未授权，0 付费调用；simulation 同接口不冒充真实。
- **生产身份源**：合成 token 仅为测试适配；无可信身份源环境正式动作保持失败关闭（能力边界）。
- site 接线：等用户基线操作 + 批准 `site-diff-proposal.md`（未接线未部署）。

## 恢复/复跑

见 `RUNBOOK.md`。
