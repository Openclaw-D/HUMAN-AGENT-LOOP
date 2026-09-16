# R2 独立复验｜2026-09-13 06:15 起
## 结论
模块回归通过；整体产品 CHANGES_REQUIRED，visual_accepted=false。不能宣布四路整体完成。
本次只读产品代码、阅读交付报告、检查两张交付截图并复跑指定测试；没有实际浏览器交互、真机、真实媒体或模型联测。测试数量不代表产品接受。
## 实测
| 路 | 独立命令与结果 | 判定 |
|---|---|---|
| MAIN | site 内 manifest 所列9文件，node --experimental-strip-types --test --experimental-test-isolation=none；108/108 exit0 | 回归通过，界面返工 |
| A | R2_MODEL 内 node test/run-all.mjs；192/192 exit0；node tools/verify-frozen-hash.mjs 46/46 | 独立候选通过，产品接入未证实 |
| B | R2_CAMERA 内 node --test test/camera-controller.test.mjs test/resource-tracking.test.mjs test/adversarial.test.mjs test/stress-loop.test.mjs test/metadata-integrity.test.mjs；96/96 exit0 | 独立候选通过，产品仍旧面板 |
| C | R2_EVAL 内 node tools/eval-cli-r2.mjs selftest；109/109 exit0 | 评分工具回归通过，真实模型质量未测 |
A 复跑只生成 runtime 下输出，随后冻结清单46项全部匹配。本次不运行 C 会写 evidence-r2 的 metamorphic 命令，避免污染冻结件。未复跑 build/typecheck、全量HTTP或真机。
## 返工项
1. P1：prod-402-overview.png 中整个页面存在滚动条，首屏看不到聊天输入；四专业仍是大卡片，点阵和进度条重复，占用高度。与用户明确的一屏五行加聊天冲突。不是等待用户重新确认才能修改。
2. P1：MAIN 晨报明示请求402×874实际442×961、DPR0.91。截图文件名/缩放后的宽度不能证明402 CSS viewport，更不是真机DPR3。B也明示窄屏只是缩放、布局视口固定；必须重新取得可测量证据。
3. P1：MAIN 明示 B 新控制器未合并；A INTEGRATION §3仍有 generation 起点、contextVersion 同快照接入缺口。组件可靠不等于系统可靠。
4. P2：prod-402-fullscreen.png 仍有整页滚动条；字幕为空时才看到三键，长字幕/长提示/短可用高度尚未证明。不得靠整页滚动找到挂断。
5. P2：B 晨报保留作废capture不立即关轨的语义。先区分仅证据作废、用户取消、挂断、收起、离页，补产品映射与资源验证，不能拿最后dispose为所有中间状态担保。
6. P2：C 的字段/关键词守门不是风险识别能力；其晨报承认同形字符去重遗漏及越权措辞局限。应转向实际产品事件回放和保留分歧的断言，不堆手写高分。
## 证据
- handoff/R2_MAIN_20260913/MORNING_REPORT.md、MANIFEST.md、STATUS.md
- handoff/R2_MAIN_20260913/screenshots/prod-402-overview.png、prod-402-fullscreen.png（本次实际看图）
- app/v5-preview/preview.module.css：root/min-height、remoteRoot及各大卡片布局；聊天自身滚动不代表页面无滚动。
- handoff/R2_MODEL_20260913/INTEGRATION.md
- 各路 MORNING_REPORT.md
后续以 R3 四路 Goal 为本轮新任务入口；R2冻结源保留。

