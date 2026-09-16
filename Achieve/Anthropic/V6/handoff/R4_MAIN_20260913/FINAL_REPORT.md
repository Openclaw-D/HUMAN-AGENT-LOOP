# FINAL_REPORT｜R4_MAIN_20260913

日期：2026-09-13。执行入口：`V6/ZCODE_R4_MAIN_20260913.md`（"完成手机界面、A/B实际接入及C复验，持续修正到验收完成或真实阻塞，不再扩范围"）。
状态：**六项闭环全部落地；B 的独立产品验收回执待 R4-B lane 回填（唯一开放项，不阻塞 MAIN 交付）。**

## 1. 六项闭环结果

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | INCIDENT_RECORD（3311/3399） | ✅ 本轮前已完成（13:49）；含"3311只读"失实声明的纠正，历史原文保留 | INCIDENT_RECORD.md |
| 2 | 手机 402×874 新截图+量测 | ✅ 全新拍摄（非 R2 旧图）；量测 14 PASS / 0 FAIL | evidence/shots-r4s/、mobile-measurement-r4.json |
| 3 | A 实际接通 | ✅ simulateFollowUps→createBridgedModelAdapter（simulated）真实接线；SIMULATED 声明显著 | INTEGRATION_RECEIPTS.md §A；a-receipt-simulate.json |
| 4 | B 升级 0.3.0 | ✅ 产品已运行 0.3.0-r3-candidate + `__CAMERA_TEST` 只读验证口；独立回执待 R4-B | INTEGRATION_RECEIPTS.md §B |
| 5 | C 三条真实轨迹+回放 Gate | ✅ 三条 product_export 轨迹 replay 全部 violation=0 | INTEGRATION_RECEIPTS.md §C；integration-inputs/ |
| 6 | integration-inputs 不可变包 | ✅ r4-integration-inputs@1（A/B/C 同输入 hash） | integration-inputs/INPUTS.json |

## 2. Gate 结果

- typecheck：exit 0。
- build（vinext）：exit 0。
- 回归：v5-preview 全量 7 文件 **81/81 通过**（含 model-bridge 14/14、camera-panel 13/13、remote-repair 9、registry 7、timeline 9、compat 9、主套件 20）。
- lint：**fail（基线）**——1043 errors 为 R2–R4 各 lane 未提交脏树既有问题（@ts-ignore 禁用规则等）；本轮改动文件（remote-service.ts 一行语义改动+注释、camera-panel.tsx 钩子、camera-controller.mjs JSDoc）仅关联既有 warning（unused vars，改动前已存在），未引入新 error。lint 基线清理不在本轮范围。
- 手机量测：R3 版检查器 14 PASS/0 FAIL；**R4_EVAL 新检查器 exit 0**（同文件+screenshotHashes 绑定）。两页无整页滚动；输入/五行/视频入口/提交/挂断全部首屏可达。
- C 官方 Gate（R4_EVAL replay --gate ×3 + inputs-check）：**全部 exit 0**（violation=0）。

## 3. 本轮关键修正（产品写面，全部最小化）

1. `remote-service.ts`：会话 generation 自 1 起（原 0）——与 C 回放契约 `generation>=1` 对齐；pause/resume 仍 +1；旧 store 0 值兼容读取不迁移。单测 MB3a/MB3b 绝对断言同步。
2. `camera-panel.tsx`：暴露 `window.__CAMERA_TEST={controller,buildReceipt}`（R4-B UPGRADE_DELTA 要求的最小验证口，只读）。
3. `camera-controller.mjs`：buildResourceReceipt 补 JSDoc 类型（counters 等入参），无行为变化。
4. generation 一行改动的来龙去脉（如实）：R3_EVAL 旧 schema 要求 ≥1 → 曾改产品为 1 基；R4_EVAL（C）随后交付 schema 修正为 ≥0 并注明"0 合法——产品语义，勿 +1" → **已回退**，产品 generation 保持 0 基（仅补注释行）。两套基数的运行均已验证、结论一致；最终以 0 基 + C 官方 Gate 交付。
4. 测试脚本修正（非产品）：run-trajectories 系列的 wrapper 覆盖 expectedVersion 缺陷——此前"迟到"用例从未真正迟到；修正后 VERSION_CONFLICT 拒绝/同 ID 重试语义按真实行为记录。

**重要澄清**：X2c "迟到标注被接受"为测试工具缺陷（post 包装器每次覆盖 expectedVersion 为最新版本），非产品缺陷；产品版本门全程正确。此结论与"post() wrapper auto-overwrote expectedVersion"一致，已落本报告纠正口径。
5. （编号续）官方 C Gate 全部换用 **R4_EVAL 新工具**并全绿：`inputs-check` exit 0（batch-001：3 轨迹+1 量测+2 截图）；`replay --gate` ×3 exit 0；新 `mobile-measure-check` exit 0。发现并如实记录 C 工具自相矛盾一处（EXPORT_COMMANDS 指向 batch 目录 vs replay 白名单只认 main-export/trajectories）——MAIN 双落位解决，未代改 C 文件。量测 meta 已附 screenshotHashes 同运行绑定（C 的防旧图复用要求）。

## 4. 真实阻塞与未测项（如实）

- **B 独立产品验收回执**：待 R4-B 以同一输入包执行 verify-product 并回填（R4 契约禁止 MAIN 自认 C/B 通过）。
- **真机 DPR3**：NOT TESTED。仿真环境 IAB 经标定（请求 365×795→布局 402×875 实测，dpr=0.9091 如实记录）；量测 zoomHint 已标注 SIMULATED。
- **真机键盘**：不可测，如实列出（继承 R3 口径）。
- **lint 基线**：1043 errors 未清（脏树既有，超出本轮范围）。
- **标注版本历史持久化**：产品未持久化标注历史版本，回放器只见终值；当前靠轨迹编排约束（被复核标注不再演进）保证可回放。改进建议：store 增加标注版本链或 review 引用快照——列为产品改进项，未实现（避免超范围）。
- **timeline 持久化**：store 不含 timeline（C 工具按 N/A 设计处理）；若未来要求 R-HANG/R-LATE 由回放直接判定，需产品增加最小 timeline 落盘。
- 真实模型/真实视频/真实客户数据：未接入（modelCalls=0），SIMULATED 标注未隐藏。

## 5. 恢复说明（精确步骤，不笼统删数据）

- **批次落位双目录**（C 工具矛盾的实际解法，复验时两处都在）：`integration-inputs/batch-001/`（inputs-check 用）与 `trajectories/main-export/r4-0base-t*.json`（replay --gate 用）；内容同源。
- **3321 隔离实例**（本轮轨迹 HTTP 证据所在）：进程 PID 21700（`next dev --port 3321`），数据目录 `V6/handoff/R2_MAIN_20260913/evidence/runtime-data/`。未重启未清理；其 store 内含 R4 轨迹会话（标题 R4轨迹1/2/3，RUNTAG 见 r4-trajectory-run.json）与早期 X2c 诊断会话——均保留作证据，勿清理。
- **3321 代码滞后**：该实例未热加载本轮 lib 改动（generation=1）——重现代码新语义请勿依赖 3321，用服务层隔离运行或经授权重启。R4 期间三条轨迹在 3321（旧代码，gen 0 基，经 pause/resume 推到 ≥1）与服务层（新代码，gen 1 基）双跑，结论一致。
- **服务层隔离运行**：`cd V6/handoff/R4_MAIN_20260913/trajectories && V5_PREVIEW_DATA_DIR=<R4>/evidence/iso-runtime-data npx tsx run-trajectories-service.mts`。重跑会追加新会话（RUNTAG 区分），不覆盖旧证据。
- **回放复验**：`node R3_EVAL_20260913/tools/replay-cli.mjs replay --trajectory integration-inputs/r4s-t*.json`，预期 violation=0。
- **量测复验**：`node R3_EVAL_20260913/tools/mobile-measure-check.mjs --measurement evidence/mobile-measurement-r4.json`，预期 14 PASS。
- **隔离副本清理**：`jianwei-v3/.r4-iso-runtime`（junction 实验残留）可安全删除：先 `cmd /c rmdir node_modules`（只删链接），再删目录；不影响 site/node_modules。
- **禁止**：不得为"复现"而删除/重启 3311/3321/3399；不得清理 R2_MAIN runtime-data。

## 6. 交付入口

- 演示入口（唯一）：`http://localhost:3321/v5-preview`（手机竖屏一屏总览）→ `📹 远程尽调访谈` → `/v5-preview/remote-session`（全屏访谈）。
- 本轮报告集：FINAL_REPORT.md（本件）、INTEGRATION_RECEIPTS.md、INCIDENT_RECORD.md、STATUS.md、run-trajectories.py（HTTP 版）、trajectories/run-trajectories-service.mts（服务层版）、integration-inputs/。
