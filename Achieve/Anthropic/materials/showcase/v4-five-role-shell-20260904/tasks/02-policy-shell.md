# 任务 2｜政策角色双端框架 Candidate

## 目标

为小微融资租赁 Golden Case 设计“政策角色”在同一系统中的 desktop-first 与 mobile 响应式框架。当前案例具象采用直租，但系统抽象仍覆盖融资租赁，不建立仅直租导航。

## 共同壳（不得改变）

- Desktop：顶部 Case Context；左侧角色看板与当前事项；右侧 Case Chat。
- Mobile：紧凑 Case Context；切换“看板 / 事项 / 协同”。
- 五个角色共用同一 caseId、Projection、导航语义和视觉语言。
- Chat 只能解释 Evidence、起草政策 Candidate、提示缺口；正式通过/退回/否决必须在左侧 Human Gate 显式操作。

## 本角色重点

- Desktop 默认突出：适用政策版本、准入事项、Evidence basis、规则命中、模糊项 Candidate、当前 Human Gate。
- 必须把“确定性规则结果”“模型 Candidate”“政策人员正式决定”分层显示。
- Mobile 不是纯只读页：保留查看依据、打开事项、填写理由和完成制度允许的 Human Gate，但通过渐进展开降低密度。
- 不设计全制度库、规则配置后台、模型参数管理或管理 KPI。

## Ownership

只允许创建或修改：

- `materials/showcase/v4-five-role-shell-20260904/outputs/02-policy/**`

不得修改 `jianwei-v3/site/**`、根部 Markdown、其他角色输出、package/lockfile，不接 API、不安装依赖。

## 输出

1. `policy-shell.html`：纯 HTML/CSS/少量本地 JS，包含 Desktop 与 Mobile 框架。
2. `REPORT.md`：说明信息优先级、Human Gate 位置、Candidate/规则分层、Chat 边界和未决定项。

只用合成占位内容，不编造真实制度条款，不做完整业务逻辑。

## Definition of Done

- 1920×1080、1440×900、390×844 均可理解；
- 当前 Evidence、Candidate、Human Gate 和等待原因可在首个专业视口找到；
- Mobile 保留必要正式动作，但不会误触或把 Chat 当审批；
- 不触碰任何非 ownership 文件。
