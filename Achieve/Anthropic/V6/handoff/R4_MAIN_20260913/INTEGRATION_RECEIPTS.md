# INTEGRATION_RECEIPTS｜R4_MAIN_20260913

输入包：`integration-inputs/INPUTS.json` + **官方批次 `integration-inputs/batch-001/`**（r4-integration-inputs@1，2026-09-13）。A/B/C 回执引用同一输入 id+hash。
运行实例：3321（HTTP 交互证据，代码滞后）+ 服务层隔离运行（evidence/iso-runtime-data，与 HTTP route 同一代码路径、**当前源码**）；3311/3321/3399 未重启未清理。

## C｜轨迹导出与回放 Gate（CLOSED，官方 Gate = R4_EVAL 工具，0 基 generation）

- 批次落位（C 的 inputs-check）：`node R4_EVAL_20260913/tools/replay-cli.mjs inputs-check` → **exit 0**（batch-001：trajectories=3 measurement=1 screenshots=2，满足回放前置）。
- 官方 Gate：`replay --gate` ×3 → **全部 exit 0**（pass=4 na=6，violation=0 undecided=0）：
  - trajectory-1（正常访谈：提问→回复→确认→挂断暂停→F2 三探针→显式恢复→A 桥接追问→人工接续）
  - trajectory-2（迟到：旧版 VERSION_CONFLICT 拒→同 ID 新版成功→再迟到拒→重试→暂停中模型推进拒→恢复）
  - trajectory-3（分歧并存：业务 vs 信审并存→confirm→correct 纠偏含 before/after）
- 导出：R4_EVAL `export-trajectory-from-store.mjs --timeline-from session`，来源 = 服务层隔离运行后的 remote-store.json（meta.source=product_export，非手写；store sha 见 INPUTS.json）。运行回执 r4-trajectory-run.json 逐项断言：t1 pausedModelFollowUpRejected/ pausedConfirmRejected=true、pausedHumanReplyAllowed=true（F2 设计：补证不受限）；t2 staleRejected / lateReplyRejected=true；t3 confirmOk / correctOk=true。
- **generation 双向对齐过程（如实）**：产品 create 原 0 基；R3_EVAL 旧 schema 要求 ≥1 → 我一度把产品改为 1 基；随后 R4_EVAL（C）交付新 schema 修正为 **≥0 并注明"0 合法——产品语义，勿 +1"** → 我**回退产品改动**，保持 0 基。净结果：产品 generation 语义未变（仅补注释），C 新工具接受现实，Gate 全绿。期间 1 基与 0 基两套运行均已验证、结论一致。
- **C 侧工具不一致（待 C/Codex 修正，MAIN 未代改）**：EXPORT_COMMANDS 让 MAIN 导出到 `integration-inputs/<批次>/`，但 replay 的 source 目录白名单仍只认路径含 `main-export/` 或 `trajectories/` → batch-001 内文件过 inputs-check 但过不了 --gate。MAIN 双落位解决：batch-001（inputs-check）+ `trajectories/main-export/r4-0base-t*.json`（--gate），文件内容同源同 hash 逻辑。建议 C 把 integration-inputs 路径加入白名单。
- timeline=0（store 不持久化 timeline；C 工具按 N/A 设计，R-HANG/R-LATE 如实 N/A）；暂停/迟到语义由运行回执直接断言。

## A｜模型桥接接入（CLOSED，MAIN 侧）

- 输入：`A-followup-bridge`（bridge sha `423fc00bf72365ac`；receipt sha `9a7906500c3c37dc`）。
- 接线：UI 追问 → `annotations/simulate` → `simulateFollowUps` → `createBridgedModelAdapter`（候选 simulated 通道）。非仅 export。
- 回执（evidence/iso-runtime-data/a-receipt-simulate.json）：`ok:true, simulated:true`；replies 首条"模型通道声明（SIMULATED · 显著标记）"，后续 per-role 发现/追问标注 `authority=none`；候选 `candidate.requestIds` 全链记录。
- 暂停门（F2）：暂停中 `simulateFollowUps` → SESSION_PAUSED；显式 resume 后同输入恢复成功。
- 单测：model-bridge 14/14。

## B｜相机控制器 0.3.0（产品已升级；独立验收回执待 R4-B lane 回填）

- 输入：`B-camera-controller`（camera-controller.mjs `0.3.0-r3-candidate`，sha `44695861628f47ef`）。
- MAIN 侧完成：产品运行 0.3.0（discardPreview/资源收据计数器在产品文件中）；MAIN 按 R4-B UPGRADE_DELTA 要求在 camera-panel.tsx 暴露只读 `window.__CAMERA_TEST={controller,buildReceipt}`（typecheck 0，camera-panel 13/13）。
- 待回填：R4-B 以 `tools/verify-product.mjs --entry <URL> --inputs integration-inputs/batch-001` 复验并回填 CAMERA_INTEGRATION_RECEIPT。MAIN 不代其自认。

## 同一输入 hash 汇总

| 输入 | sha256(16) | 回执状态 |
| --- | --- | --- |
| A-followup-bridge（receipt） | 9a7906500c3c37dc | ✅ CLOSED |
| B-camera-controller | 44695861628f47ef | ⏳ R4-B 回填 |
| C batch-001 trajectory-1/2/3 | 见 batch-001（inputs-check exit 0） | ✅ gate exit 0 ×3 |
| C measurement（含 screenshotHashes 绑定） | d55d9d49… / 926703b1…（sha256 全值在 batch-001 JSON 内） | ✅ measure exit 0 |
