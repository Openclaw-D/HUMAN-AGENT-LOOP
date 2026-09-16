# STATUS｜A 路共享状态与最终集成（REPAIR_20260914_EVENING/main）

更新：2026-09-14 深夜。状态：**首次完整交付完成，自检全绿；待 D 独立复验与用户视觉接受。**

## 一句话

固定演示与远程尽调现已共享同一演示项目事实（专属会话 rs-demo-run + 证据取代链 + 真实复核记录 + 首页投影），稳定步游标替代签名定位，重开仅作用当前专属演示；B/C 候选均已实际集成进产品并实测渲染与交互。

## 唯一入口

- **http://127.0.0.1:3467/v5-preview**（+ `/v5-preview/remote-session`）；源 site ↔ 预览副本 `diff -rq` 全量一致（已复核）。
- 3467 现状：story 起点 s00（v154 保留）、home/DD 均 200、专属会话空、10 个历史会话完整。

## 交付物

| 文件 | 内容 |
| --- | --- |
| BASELINE_GATE.md | 基线范围/差异归属/快照/恢复方法（用户 Git 授权前不 commit） |
| INTERFACE.md | 共享状态接口 v1（标识/命令/出口/投影/恢复规则，B/C 对接依据） |
| INTEGRATION_LOG.md | 32 文件逐项变更 |
| ADOPTION.md | B/C 采用结论 + R-01~R-08 逐项映射 + 未采用项 |
| RESULT.md | 验证结果、证据路径、剩余项 |
| final-hashes.sha256 | 采用/运行 hash（32 文件） |
| baseline/ | 写入前快照（11 源码 + 2 数据 + pre-hashes） |
| evidence/ | 全链 HTTP 输出 + 5 张集成实页截图 + 验证脚本 |

## 验证状态（自检）

- 单测 93/93 绿：shared-facts 8 + demo-story 11 + v5-preview 20 + remote 12 + rework1 11 + rework2 5 + v6fix 26。
- typecheck 0 错；改动文件 eslint 0 错（3 条 warning：2 条基线已有、1 条 C 组件内部）；`npm run build` exit 0。
- 隔离实例全链 HTTP 32/32；浏览器实测（1280/375 + 决定交互）通过。
- 3467 只读核对通过；未触碰 3311/3321/3399；真实模型调用 0 次；无 commit/tag；无新依赖。

## 剩余（详见 RESULT §四）

独立缩放实页未复测（以 B/C 候选证据为准）、真实模型在线端到端（0 付费调用）、键盘焦点的运行时验证、移动端真机、**用户视觉接受与 Codex 复验未宣称**。R1/R2 批量修复窗口按 COMMON 待缺陷清单。
