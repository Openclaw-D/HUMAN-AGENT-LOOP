# STATUS｜任务C：演示状态逻辑、部分并行与人工决策模块

- 接手：2026-09-14 01:35（北京时间）。Ownership：仅写 `V6/handoff/NIGHT_SIMPLIFY_20260914/story/**`；原 cases、产品源码、共享 CONTRACT 只读（探针以隔离临时数据目录执行产品代码，不写产品）。
- 当前状态：**首轮（CP1–CP5）与续轮（机制↔产品差异收敛）均已完成交付**。主交付：`CORE_MAPPING.md` 对照表 + v3 最小修正候选 + 产品行为探针实录。

## 续轮时间线（截止取消·差异收敛）

- 08:1x 接续指令；读 A 实际实现（INTEGRATION_LOG、types/data/service/panel/page、A 测试 9 项）。发现 A 已采用 C 的 22 步表（含三处映射补丁）并于续轮落地机制统一：链式推进 `chainFrom`（注释明示同 C `advanceAuto`）、`holdForHuman` 四步（= C 的 DD-01/DD-03/DD-RT-1/SG-RT）、退回仅一次（s12/s17 去 return，对齐 C 有限路径）、三分支结果提示。
- 期间捕获 A 并行修改（04:45 快照 → 08:10 数据）：s12/s17 删除 return 选项——基于旧快照的 v2 候选作废，改为以**产品现行数据为基底**的 v3 外科手术补丁。
- 逐行为核对（探针，真实 service + 隔离临时数据目录，21 项）：16 已落地；退回有限性=A 已对齐（关闭）；story 待办 notes 张力=合理映射/需产品决定（保留）。
- 实录缺口 3 项：①纠正判断更新不可见（correct 与确认预设内容完全不可区分、UI"已并入档"提示超前于持久化内容）；②主线判断灯回退（s09 绿灯集缩小；数据级 s07/s08 同类，继承自 C v1 并行快照缺陷）；③纠正后证据引用不升版。
- v3 修复：`candidate/a-shape/demo-story-a-v3.json`（23 步 = 产品 22 步 + s13c 效果应用步；D1 累积式四域行 + D2 纠正可见）。补丁器七项自校验；`test/a-shape.test.mjs` 6 项判别性测试（决定门/链式推进/纠正可见/退回有限/灯单调/全绿不变式/诚实标注）。
- 回归：机制套件 29/29 + a-shape 6/6 = **35/35**（`test-output.txt` 实跑）；探针 21 行重跑实录存 `product-behavior-findings.md`。

## 首轮记录（CP1–CP5，03:35 完成）

- CP1 主线 `demo-story.json`（22 节点，五阶段→结清；每步稳定 ID/触发/预设中文消息/四域状态/证据版本/自动人工/前提/后继；材料补充为阶段内动作；六方仅必要发言——测试断言政策/商务各发言一次）。
- CP2 远程尽调：疑点 DD-DOUBT-1（满负荷 vs 一半产能 + 电费张力，双侧绑定、不判真伪）；现场/远程边界；系统标疑→人工补证/纠正→相关域更新；全程标合成。
- CP3 `BRANCHES.md`：确认/纠正/退回有限路径（纠正升版 v1→v2 且旧引用被拒；退回红灯不全绿；自动推进仅在人工边界停）。
- CP4 `candidate/demo-state.mjs` 纯函数状态机（init/可用动作/推进/决定/重置/快照恢复/视图/证据核验；不可变、确定性、非法动作显式中文拒绝码）。
- CP5 `INTEGRATION.md`（含串行→部分并行机制映射，不虚构效果）。

## 反馈通道

- **A 反馈入口登记（v3 采用说明，详见 `CORE_MAPPING.md` §三）**：以 `candidate/a-shape/demo-story-a-v3.json` 整体替换 `demo-story-data.ts` 的 steps 数组（仅数据层，零 service/type/CSS/路由改动；s00/终点步与产品完全一致，链式推进/幂等/签名推导全部兼容；构建器与七项自校验见 `candidate/a-shape/build-a-shape.mjs`）；采用后重跑 `node --experimental-strip-types candidate/probe-product-behavior.mjs`，探针 #9/#11/#17 三行 GAP 应转 OK（即差异关闭的复核方式）。
- 保留项（需产品决定）：story 待办 notes 张力三选一（见 CORE_MAPPING §二）；机制级引用拒绝/意见作废追踪保持对照实现定位（见 CORE_MAPPING §二.6 与三）。
- 其他问题写 `../main/feedback-inbox.md` 或在 `../main/INTEGRATION_LOG.md` 登记采用 hash；本路按需响应。
