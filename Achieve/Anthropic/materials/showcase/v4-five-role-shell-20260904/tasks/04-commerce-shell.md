# 任务 4｜商务角色双端框架 Candidate

## 目标

为小微融资租赁 Golden Case 设计“商务角色”在同一系统中的 desktop-first 与 mobile 响应式框架。重点是承接已有政策/信审结论，而不是建设合同管理系统。

## 共同壳（不得改变）

- Desktop：顶部 Case Context；左侧角色看板与当前事项；右侧 Case Chat。
- Mobile：紧凑 Case Context；切换“看板 / 事项 / 协同”。
- 五个角色共用同一 caseId、Projection、导航语义和视觉语言。
- Chat 可以解释上游 Receipt、起草条款摘要和提示材料缺口；不能确认正式商务承接或生成 Receipt。

## 本角色重点

- Desktop 默认突出：合同草案 Evidence、可提前进行的制式核对、信审条件、商务承接事项、上游 Receipt 与 BG Human Gate。
- 必须体现“提前准备”和“正式承接”之间的硬依赖，不能画成纯线性进度条。
- Mobile 保留查看条件、处理当前事项、填写承接理由和制度允许的 Human Gate，但采用摘要→详情结构。
- 不设计完整合同生命周期、报价引擎、电子签章或管理 KPI。

## Ownership

只允许创建或修改：

- `materials/showcase/v4-five-role-shell-20260904/outputs/04-commerce/**`

不得修改 `jianwei-v3/site/**`、根部 Markdown、其他角色输出、package/lockfile，不接 API、不安装依赖。

## 输出

1. `commerce-shell.html`：纯 HTML/CSS/少量本地 JS，包含 Desktop 与 Mobile 框架。
2. `REPORT.md`：说明条件承接、依赖表现、正式 Gate、Chat 边界和未决定项。

只用合成占位内容，不编造真实合同条款、价格或正式法律意见。

## Definition of Done

- 能看出哪些准备可并行、哪些动作等待信审 Receipt；
- Desktop/Mobile 都保留被授权工作能力；
- Chat 草案与正式承接有明显边界；
- 不触碰任何非 ownership 文件。
