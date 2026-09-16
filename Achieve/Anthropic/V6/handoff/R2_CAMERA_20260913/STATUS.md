# STATUS｜R2-B 手机采集生命周期与可视验证

- 日期：2026-09-13
- 任务入口：`V6/ZCODE_R2_B_20260913.md`；协调入口 `V6/ZCODE_FOUR_TASKS_ROUND2_20260913.md`；验收输入 `V6/CODEX_REVIEW_FOUR_TASKS_20260913/REPORT.md`（B节）
- 状态：**READY_FOR_REVIEW — 已收束冻结**（Goal工作包1–7全部完成；96/96回归全绿；本批自本文件本次修改起冻结，续改须开新批次。晨报见MORNING_REPORT.md，接入映射见MAPPING.md）
- 写面：仅 `V6/handoff/R2_CAMERA_20260913/**`；旧批次 `PARALLEL_CAMERA_20260913` 与产品代码只读。

## Goal接收记录（2026-09-13 03:31 +0800）

| 文件 | sha256 |
| --- | --- |
| V6/OVERNIGHT_TO_0700_20260913.md | 893330329771b5e29fb582d79bc187b9fae1f1496a1a309d23e8898c49ab1556 |
| V6/ZCODE_GOALS_TO_0900_20260913.md | 84f6865526614dea3005b7f8495f38630e70d35503662fa183f64cb9bbd9e550 |
| V6/ZCODE_GOAL_B_TO_0700_20260913.md | fa965536a550ee0c7a908f939d218c77249a27eb982b6a9821b1f91538246c11 |

- 并发政策已按最新覆盖执行：默认2个、最多3个原生Subagent；首轮5并发触发账户限流(1302)，SA3/SA4失败；已退避并降并发，SA4范围由主agent接管（所有权转移记入AGENT_LEDGER），SA3待重派。
- 已完成：SA1控制器v0.2.0（41/41，single默认拍完关轨/超时/外部ended/同步throw/getResourceUsage）、SA2资源核算（21/21，麦克风0/上传0/track与URL泄漏0）、SA5 MAPPING.md、主agent完成壳三件套+合成PNG素材。

## Goal工作包对照（接续待办）

1. 单拍关轨/取消/离开/dispose/迟到/外部ended/同步throw/超时 ✅（SA1+SA2）
2. 原图/缩略图/元数据分离：补同图多次选择、损坏图、大合成图、objectURL错误专项 → SA6
3. 嵌入展开收起保持状态+离开关轨+本机语义 → 主agent壳改+浏览器验证
4. 402×874壳：安全区/字体/触控/取消/焦点/长宽比/错误提示/回退选图+390/360回归 → 主agent浏览器证据
5. 浏览器内真实canvas缩略图+默认降级验证 → 主agent
6. 压力循环（固定seed+累计track/URL统计） → SA6
7. MAPPING补预览待保存等状态与资源责任 → SA5增补

## 约束声明

自动化仅合成File与虚拟依赖（含浏览器内虚拟媒体钩子），不开启物理相机/麦克风；不上传、不部署、无新依赖、无Git写操作、不操作Codex、不动3321/3399/3311与共享浏览器上下文；真机iOS/Android未测保持NOT TESTED；不冒称visual_accepted=true，候选待Codex复验与用户视觉接受。

## 接手确认

- 上一轮B交付（v0.1.0-candidate，32/32）作为只读基线保留；本轮不回写旧批次。
- 已确认验收报告B节缺陷成立：probe复现“拍照成功后track仍live直到dispose”，旧测试24期望连续拍摄与父契约“拍完后关闭”冲突；真实浏览器缩略图/触控/真机未验收。
- 本轮修复主线：**默认单次拍照（成功与失败均关轨）**；连续模式必须显式开启并有持续提示；新增超时、同步抛错、外部轨道结束、decode慢返回、dispose竞态的清理与对抗测试；以iPhone 17标准版竖屏402×874 CSS px、DPR3为仿真基准出真实浏览器模块预览证据；真机继续明确NOT TESTED。

## 基线输入（sha256）

| 输入 | sha256 |
| --- | --- |
| V6/ZCODE_R2_B_20260913.md | a8b2467a6312a410dad44a5a54dfbfbaaa31e9fdabdd13aa9210cce5d6a832f3 |
| V6/ZCODE_FOUR_TASKS_ROUND2_20260913.md | 6511fc4ad981d5d71bdf514491640b0b3d6626921699c41f769487f82c6cd480 |
| V6/CODEX_REVIEW_FOUR_TASKS_20260913/REPORT.md | af63b6ecda715a5176593af1d5734eab192d802e6e494c50f10ef9f5f333249d |
| 旧批次 src/camera-controller.mjs (v0.1.0) | fbfac814db7bd469530985ec3465dfe05f519b6635b4f8293278aff29a511351 |
| 旧批次 INTEGRATION.md | d3699c8cf0c790d9c97b012125ade0c4d9191eeefdd4b08f201580de5d35d836 |
| 旧批次 src/thumbnail.mjs | 8722747b7a560f73dcf72120accd658310419590df6ea0ad07fdad786c6f042e |
| 旧批次 test/camera-controller.test.mjs | 87feb7809a423b35ed8c945e9d2034da7b14767d89d735d784f925e620240858 |

## 并行分工（ZCode原生Subagent，每文件唯一writer）

| Owner | 目标 | 独占文件 |
| --- | --- | --- |
| 主agent（本文件writer） | 总控、接口冻结口径、浏览器可视证据（Browser Use仅主agent）、缩略图浏览器测试、整合验收、REPORT/MANIFEST/AGENT_LEDGER | STATUS/REPORT/MANIFEST/AGENT_LEDGER、evidence/browser-*、screenshots/*、src/thumbnail.mjs（原样入新批次）、tools/make-synthetic-png.mjs |
| SA1 状态机 | 控制器v0.2.0：单次默认关轨、连续显式模式、超时、外部ended、同步throw加固、getResourceUsage | src/camera-controller.mjs、test/camera-controller.test.mjs |
| SA2 资源测试 | 全场景track/URL/麦克风/上传零泄漏核算 | test/resource-tracking.test.mjs |
| SA3 对抗测试 | 永不resolve/同步throw/外部ended/慢decode/dispose竞态/非Blob返回 | test/adversarial.test.mjs |
| SA4 移动可用性壳 | 402×874优先测试壳重设计+可访问性+测试钩子 | src/standalone/index.html、src/standalone/standalone-main.mjs、tools/serve-standalone.mjs、SHELL_A11Y.md |
| SA5 集成映射 | v0.1.0→v0.2.0差异与主任务接入映射 | MAPPING.md |

## 约束声明

自动化仅合成File与虚拟依赖（含浏览器内虚拟媒体钩子），不开启物理相机/麦克风；不上传、不部署、无新依赖、无Git写操作、不操作Codex、不动3321/3399/3311与共享浏览器上下文；真机iOS/Android未测保持NOT TESTED。
