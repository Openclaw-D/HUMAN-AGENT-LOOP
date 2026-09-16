# 见微｜项目唯一入口

当前阶段：**V6-CTRL**。当前任务：以本机Dify 1.13.2承载六角色的真实模型协作，保留一套mobile/desktop响应式业务页面。先完成环境与接口检查点，再小批联调；不把预设看板当成核心AI成果。产品代码由ZCode修改，Codex负责需求、环境配置、任务包和独立验收。

最新入口：[六角色改造方案](V6/DIFY_SIX_ROLE_PLAN.md)、[ZCode任务书（未代发）](V6/ZCODE_DIFY_SIX_ROLE_EXECUTION.md)、[本机环境与恢复](V6/DIFY_LOCAL_SETUP.md)。

## 先读这三份

1. [产品主干](NORTH_STAR.md)：产品是什么、当前做什么、哪些不扩展。
2. [当前决定](DECISIONS.md)：有效决定、候选、历史与优先级。
3. [V6交接](V6/HANDOFF.md)：已做、未做和当前执行事实。

[当前工作顺序](V6/ROADMAP.md)不按天排期；[全项目检视](V6/PROJECT_REVIEW_20260912.md)提供沿革与差距证据，其中旧时间估计已由用户要求撤回。

## 文件职责

| 文件 | 唯一职责 |
| --- | --- |
| NORTH_STAR.md | 当前产品主干与继承的底线 |
| DECISIONS.md | 当前版本及决定分类 |
| ROADMAP.md | 指向当前版本的工作顺序 |
| CHALLENGE_LOG.md | 当前跨版本风险与防漂移检查 |
| AGENTS.md | 执行边界和协作规则 |
| CHANGELOG.md | 已发生的变化，非执行授权 |
| V6/CONTRACT.md | 当前实施范围与完成条件 |

唯一活动代码仓库：[jianwei-v3/site](jianwei-v3/site/)。路径名不决定产品版本。当前页面为业务单项目概览，不能据其存在宣称完整四域专业平台已交付。

## 历史与复用

[V1](V1/README.md)、[V2](V2/README.md)、[V3](V3/README.md)、[V4](V4/README.md)、[V5](V5/README.md)均为前阶段来源，不是当前执行入口；其中保留的“当前”“ACTIVE”“FROZEN”只代表当时状态。[V5历史复用索引](V5/HISTORICAL_REUSE.md)按具体缺口查阅，不恢复旧任务。

[materials](materials/README.md)仅作证据，[archive](archive/README.md)用于恢复，Unity及历史代码另行保留。当前不整理或删除这些资产。

2026-09-12文档梳理前的11份原文已逐份复制并SHA256核验，见 [恢复说明](archive/20260912-before-current-authority-reconciliation/README.md)。本次不是版本切换、Git提交或产品重构。
