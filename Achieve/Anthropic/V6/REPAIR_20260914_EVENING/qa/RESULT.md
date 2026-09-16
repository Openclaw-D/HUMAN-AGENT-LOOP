# D路 RESULT —— 首轮独立验收（REPAIR_20260914_EVENING）

日期：2026-09-15 01:40 前后。执行：ZCode（GLM 5.3 Flash · max thinking）。写面仅 `qa/**`；产品与其他路目录只读。

## 总判定

**R-01～R-08 首轮独立验收：八项全部通过；无高/中severity缺陷；3 项低severity接口符合性/呈现缺陷（E-01/E-02/E-03，全部归组 owner=A）移交 R1。**

共享状态机制（本轮核心目标）**真实落地**：现场纠正产生真实证据复核记录（取代链+chainVersion+contested+pendingReview），受影响域获得"证据纠正待复核"标记并投影到首页，对照实验证明投影只触及相关域（政策/信审/商务逐字节不变），投影不改判断灯色，人工门（决定点 409+徽章+authority=none）全程未被越过，重开仅清当前专属演示（其他会话与记录不动），中断恢复（离线提交→可读错误+草稿保留→恢复重试成功）真实可用。

## 运行版本与 hash

- 被测版本：site 源码（A 集成 B/C 后），D 抽查 hash 与 `main/final-hashes.sha256` 一致（store.ts 8292af60 / shared-facts.ts b0f42ce2 / home-overview.tsx ca684f1f 等）。
- C 候选采用：4 文件逐字节一致（D 独立比对 `remote/candidate/*` ↔ `site/app/v5-preview/remote-session/*`，hash 匹配 C RESULT 冻结值）。
- 3467 共享入口：已部署同版（稳定指纹 2502fca3…，新 UI 渲染确认；D 仅 GET+截图）。
- D 测试装置：隔离实例 3469 生产模式（app-r1 副本 + data-d-r1 数据目录）；**D 副本源码与产品零差异**（QA 专用 next.config.ts 仅 turbopack.root 声明，见文件头注释）。

## 证据清单（qa/evidence/ + qa/logs/）

- API：`logs/shared-state-r1.json`（30/33+对照修正）、`logs/` 内 regress 输出（remote 20/20）。
- 对照实验：`runtime/projection_control_probe.mjs` 输出（仅资产域差异）。
- 退回分支：`runtime/return_path_probe.mjs` 输出（red 保持/仅confirm/无规则化措辞）。
- 截图（全部标注实例）：before 组（`before-home-1920-viewport` / `before-home-375-full` 旧双列溢出 / `before-dd-1920-viewport`）、R-01（menu-open / reopen-confirm-dialog / after-reopen）、R-02/R-03/R-05（`r01-home-1920-gate17` 三态之一 / `r05-after-correct-ui-1920`）、R-04（`r04-dd-1920x1080` / `r04-dd-1920-customer-view` / `r08-dd-375x667`）、R-08（`r08-home-375x667`/`390x844`/`1920-at-125`/`1920-at-80`；`r08-dd-1920-at-125`/`1920-at-80`）、3467 部署抽查（`deploy-3467-home-check.png`）、中断恢复（`r07-offline-submit.png`）。

## 缺陷台账（一次归组，后续复测只验关闭）

| ID | 严重度 | 摘要 | owner |
| --- | --- | --- | --- |
| E-01 | 低 | shared-state 响应缺 INTERFACE §3 承诺的 projectId | A |
| E-02 | 低 | reset 后指针未置 null（记录已清空；文档-实现漂移，二选一闭环） | A |
| E-03 | 低 | 尽调页客户端导航首入"尚无访谈会话"空态闪现（应映射 loading 态） | A |

观察项 O-1～O-5（工具伪影/来源供数/并行线性化遗留/缩放未由A复测/C lint）见 DEFECTS.md，不构成阻断。

## 轮次声明（停止机制）

- 首轮完整验收完成，缺陷已一次归组。按 COMMON：A 修复后 D 做 R1 批量复测（仅针对 E-01/E-02/E-03 及相邻受影响面，不无漂移重刷已通过项）；R1 后如有残留交最终 R2；之后**停止本轮**。
- 本轮任何结论不降低验收标准；PARTIAL 不会被写成 PASS。

## 边界（独立保留，不被本判定替代）

- **用户视觉接受**独立保留（D 的通过结论不替代用户看页面的最终判断）。
- **Codex 独立复验**独立保留。
- 未验证项（真实 zoom 引擎/真机/F1 展开态实页/键盘可及性/MODE=real/3467 写路径）如实列于 ACCEPTANCE.md，不以静态证据冒充。

## 复现方法（供复验者）

1. 隔离实例：`bash qa/runtime/sync_isolated.sh`（注意：本轮实际用 app-r1 副本——`cp site→app-r1` + node junction + QA next.config，见 RESULTS_LOG；`next build` 后 `V5_PREVIEW_DATA_DIR=<数据目录> node node_modules/next/dist/bin/next start -p 3469`）。
2. API 套件：`node qa/runtime/shared_state_tests.mjs http://127.0.0.1:3469 --json <输出>`（期望：除 SS-01b/SS-11c 两项已知接口偏差外全 PASS）。
3. 对照实验/退回分支：`node qa/runtime/projection_control_probe.mjs`、`node qa/runtime/return_path_probe.mjs`。
4. 防回退：`python qa/runtime/regress_base.py http://127.0.0.1:3469 --remote`（期望 20/20）。
5. 版本核对：`main/final-hashes.sha256` ↔ site 源码（sha256sum 抽查）。
