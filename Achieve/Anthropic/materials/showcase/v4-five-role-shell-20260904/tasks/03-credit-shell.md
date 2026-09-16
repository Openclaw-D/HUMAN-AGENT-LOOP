# 任务 3｜信审角色双端框架 Candidate

## 目标

为小微融资租赁 Golden Case 设计“信审角色”在同一系统中的 desktop-first 与 mobile 响应式框架。当前只做框架，不冻结最终授信指标或业务数字。

## 共同壳（不得改变）

- Desktop：顶部 Case Context；左侧角色看板与当前事项；右侧 Case Chat。
- Mobile：紧凑 Case Context；切换“看板 / 事项 / 协同”。
- 五个角色共用同一 caseId、Projection、导航语义和视觉语言。
- Chat 可以归纳财务 Evidence、提示矛盾、起草审查意见；不能批准/否决、生成 Receipt 或改变正式状态。

## 本角色重点

- Desktop 默认突出：材料完整性、偿付能力事项、跨证据矛盾、政策 Receipt 依赖、信审 Human Gate、贡献记录。
- 必须看出可提前完成的核验与必须等待政策 Receipt 的正式签批不是一回事。
- Mobile 保留查看 Evidence、处理当前事项、填写意见和制度允许的 Human Gate，通过分层页面而不是压缩桌面三栏。
- 不设计评分卡配置平台、全量授信模型、客户主档或管理 KPI。

## Ownership

只允许创建或修改：

- `materials/showcase/v4-five-role-shell-20260904/outputs/03-credit/**`

不得修改 `jianwei-v3/site/**`、根部 Markdown、其他角色输出、package/lockfile，不接 API、不安装依赖。

## 输出

1. `credit-shell.html`：纯 HTML/CSS/少量本地 JS，包含 Desktop 与 Mobile 框架。
2. `REPORT.md`：说明信息架构、依赖表现、正式决策入口、Chat 边界和未决定项。

只用合成占位内容；不编造真实模型分、通过概率或审批结果。

## Definition of Done

- Desktop 一眼区分 Evidence、Candidate、依赖与 Human Decision；
- Mobile 能完成相同被授权能力，不产生第二套状态；
- 退回/否决/等待的视觉语义不同；
- 不触碰任何非 ownership 文件。
