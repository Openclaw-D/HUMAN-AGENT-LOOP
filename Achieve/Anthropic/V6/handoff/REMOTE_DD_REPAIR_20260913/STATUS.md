# STATUS｜REMOTE_DD_REPAIR_20260913

更新：2026-09-13 01:33。startedAt：01:30。

## 当前目标
按 ZCODE_REMOTE_DD_REPAIR_20260913 顺序执行：基线与红例 → A 核心状态（F1–F4）→ A 移动端（F5）→ B 协议 → C 本地相机入口 → 全回归/交付。

## 已验证
- 上轮独立验收 CHANGES_REQUIRED（F1–F7）已完整读取；probe.mjs 语义理解：其 assert 钉住缺陷行为，修复后探针会抛错（以 findings 记录期望值），返修以自身红绿回归+真实组件证据为准。
- site **是** Git 仓库：HEAD 63c41c3，92 项 dirty（历史多轮遗留）；v5-preview 写面全部未跟踪。已纠正上轮 BASELINE 的"非 Git 仓库"错误（F7-1）。
- 8 个涉及文件快照 + SHA256（evidence/pre-snapshot/）+ git-status-site.txt。

## 修复计划（红先于绿）
- F1：runWrite 持久化完整请求记录（path/body/owner/generation/草稿关联，sessionStorage）+ 同载荷重试 + 错误态；红例=组件级连续 NETWORK 同 ID/同载荷 + 刷新恢复。
- F2：服务端 paused 门（阻断模型步骤与 confirm 类；resume_round 显式留痕；generation 隔离在途）。
- F3：确认资格撤销（confirm 后 retake/correct/resupply → 非 human_verified）；superseded 证据拒新 confirm；关联显示过期。
- F4：核算幂等摘要含 mode+inputs；CalculationRecord 绑定 remoteVersion/ruleConfig 版本 → stale 现算。
- F5：Pointer Events 圈选（capture/cancel/钳制）+ 数字输入替代标疑 + 移动首屏重排 + 中文角色。
- F6：evidence sha256 = renderFixtureSvg 实际字节摘要；旧记录标 digestOf='fixture_meta_legacy'。
- F7：BASELINE/REPORT 更正；READY_FOR_INTEGRATION 失败语义独立（真实失败≠model_simulation）。

## 失败/未知
- 真机触控/相机：无真机条件，设备仿真+NOT TESTED 标注。

## 用量
真实模型 tokens=0；无新依赖；3311 只读。
