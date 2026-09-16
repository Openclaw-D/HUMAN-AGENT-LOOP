# 任务 1｜业务角色双端框架 Candidate

## 目标

为小微融资租赁 Golden Case 设计“业务角色”在同一系统中的 mobile-first 与 desktop 响应式框架。当前案例具象采用直租，但系统框架不能锁死直租或排除回租。

## 共同壳（不得改变）

- Desktop：顶部 Case Context；左侧角色看板与当前事项；右侧 Case Chat。
- Mobile：紧凑 Case Context；底部或顶部切换“看板 / 事项 / 协同”。
- 五个角色共用同一 caseId、Projection、导航语义和视觉语言。
- Chat 只能解释、起草 Candidate、提出补件建议；不得审批、生成 Receipt 或持有第二套状态。

## 本角色重点

- Mobile 默认首页突出：当前项目、四域状态、待补材料、反馈与下一动作。
- 业务可以提交 Evidence 草案、查看退回原因和四域反馈，但不能看到任何专业审批按钮。
- Desktop 必须保留相同能力，只允许提高信息密度，不得变成另一套产品。
- 左侧看板是事项协同看板，不是商机漏斗、CRM、业绩或管理 KPI。

## Ownership

只允许创建或修改：

- `materials/showcase/v4-five-role-shell-20260904/outputs/01-business/**`

不得修改 `jianwei-v3/site/**`、根部 Markdown、其他角色输出、package/lockfile，不接 API、不安装依赖。

## 输出

1. `business-shell.html`：纯 HTML/CSS/少量本地 JS，可直接打开；包含 Desktop 与 Mobile 两种可切换框架。
2. `REPORT.md`：列出布局、响应式重排、业务允许/禁止动作、Chat 边界和未决定项。

只用合成占位数据；不展开具体风险数字、制度条文或最终视觉。不得使用假聊天记录、假在线人数、假审批成功。

## Definition of Done

- 1440×900 与 390×844 均无横向溢出；
- 顶部/左侧/右侧三块职责一眼可辨；
- Mobile 能在三入口间切换且返回保持当前 Case Context；
- 业务权限边界清楚；
- 不触碰任何非 ownership 文件。
