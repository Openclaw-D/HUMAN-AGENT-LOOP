# 任务 5｜资产角色双端框架 Candidate

## 目标

为小微融资租赁 Golden Case 设计“资产角色”在同一系统中的 desktop-first 与 mobile 响应式框架。资产既提供前向历史 Evidence，也承担起租后的独立贷后责任，但当前只做框架。

## 共同壳（不得改变）

- Desktop：顶部 Case Context；左侧角色看板与当前事项；右侧 Case Chat。
- Mobile：紧凑 Case Context；切换“看板 / 事项 / 协同”。
- 五个角色共用同一 caseId、Projection、导航语义和视觉语言。
- Chat 可以总结历史资产 Evidence、起草巡检计划和提示异常；不能确认资产承接、替代现场核验或生成 Receipt。

## 本角色重点

- Desktop 默认突出：历史资产表现、租赁物可识别性、待核 Evidence、商务 Receipt 依赖、贷后巡检计划、AG Human Gate。
- 体现资产可在前期提供历史反馈，同时正式资产承接仍等待必要 Receipt。
- Mobile 必须支持现场使用：查看对象、记录简短 Evidence、处理事项和制度允许的 Human Gate；不要求把桌面密度硬塞入一屏。
- 不设计完整催收、诉讼、法务供应商、三维重建或资产管理平台。

## Ownership

只允许创建或修改：

- `materials/showcase/v4-five-role-shell-20260904/outputs/05-asset/**`

不得修改 `jianwei-v3/site/**`、根部 Markdown、其他角色输出、package/lockfile，不接 API、不安装依赖。

## 输出

1. `asset-shell.html`：纯 HTML/CSS/少量本地 JS，包含 Desktop 与 Mobile 框架。
2. `REPORT.md`：说明前向反馈、正式承接、现场移动使用、Chat 边界和未决定项。

只用合成占位内容，不把多模态推断冒充现场事实。

## Definition of Done

- 前向 Evidence 与贷后责任同时可见但不混同；
- Desktop/Mobile 都能完成被授权的必要动作；
- Chat 建议与现场/Human 决定边界清晰；
- 不触碰任何非 ownership 文件。
