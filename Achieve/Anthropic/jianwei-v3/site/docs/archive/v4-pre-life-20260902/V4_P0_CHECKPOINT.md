# 见微 V4 P0 检查点

状态：`CONTROL CANDIDATE ACCEPTED / USER OBSERVATION PENDING`

日期：2026-08-31

本文件记录当前真实证据，不代表 V4 P1、生产接入或最终产品验收已经完成。

## 1. 恢复边界

- V3 archive commit：`63c41c3db138215d40470098d80c405f2a6fd679`
- annotated tag：`v3.0.0-archive`
- tag object：`2c25a37f38a7cb881a7a0491d77daff8e72ea800`
- tag peeled target 与 archive commit 一致；V4 开始后未修改 V3 受保护路径。
- V4 当前版本：`4.0.0-dev.0`。
- V4 工作树尚未 commit 或 push；当前没有 V4 Git 发布授权。

## 2. P0-A Backend Contract Kernel

已实现：

- `lib/v4/**` 独立 namespace；
- 业务线、来源、审核路径、尽调方式四个正交字段；
- 信审、商务、资产、起租状态分离；
- 退回、驳回、否决与 attempt lineage；
- candidate authority none；
- authorized rule metadata；
- named Actor、injectable policy 与 fail-closed transition；
- 三条业务线乘两条审核路径的组合测试。

本期没有实现 SQLite、HTTP API、并发 idempotency runtime 或 P1 Case handoff。

## 3. P0-B Front Content Convergence

已实现：

- 保留现有宏观骨架和视觉语言；
- 主图改为真实 Case 主线、政策贯穿、信审 Gate、商务与资产承接；
- 区分人员、系统部门、智能部门、系统资产和智能资产；
- 右侧改为作业面、管理面、演进面三个非均分物理区域；
- 价值从第一可见层隐藏但未删除；
- 只使用“直租、存回、新回”短称；
- 明示信审通过仍待商务与资产。

第一次 1920×1080 浏览器观察发现右侧关键标签被 ellipsis 截断。原任务完成 scoped CSS 修复后，第二次观察确认标签完整换行。

## 4. Control 验收证据

- `npm.cmd run check`：245 tests / 5 suites 全部通过；typecheck、lint、Vinext build 通过。
- `git diff --check`：通过。
- V4 禁止术语扫描：无命中。
- 1920×1080 browser：document 与 body 均为 1920×1080，无页面级横向或纵向溢出。
- 主图模块：无 bounding-box overlap。
- 右侧区域高度约为 322 / 232 / 369 px，区域间隔均约 22.7 px，未机械均分。
- 右侧所有关键标签 `clientWidth=scrollWidth` 且 `clientHeight=scrollHeight`；无截断。
- Browser console：无 error 或 warning。

## 5. 未通过或待确认

- 用户尚未观察并给出本轮视觉纠偏；因此当前是 Control candidate，不是用户最终验收。
- V4-QA 可见任务已三次被派发并显示完成，但没有返回可读 review artifact；不得声明 independent QA pass。
- V4-SHOW 保持只读 hold；尚未基于 P0 证据制作新演示文件。
- V4 P1 runtime、API、SQLite、HTTP Gate、真实 Case work surface 和端到端闭环均未开始。

## 6. 下一 Gate

用户观察当前管理总览并给出第一轮纠偏后，Control 再决定：

1. 只继续调整 P0 内容与视觉；或
2. 冻结 P0，进入 P1-A 独立 Authority Runtime 与 P1-B 信审 Case 工作面。
