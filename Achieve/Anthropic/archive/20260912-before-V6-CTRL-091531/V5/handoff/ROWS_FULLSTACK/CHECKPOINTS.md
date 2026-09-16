# ROWS_FULLSTACK CHECKPOINTS｜阶段证据与纠偏

主 Agent 维护；每个检查点留证据后继续。

## C0（2026-09-11 深夜）现状核对与冻结

- HEAD `63c41c3`，porcelain 81 条，与 F0-R1 收尾一致；快照 + 10 文件 SHA256 见 `evidence/c0-snapshot/`。
- 参考图 `design/20260911-business-five/06-horizontal-rows.png` 已实际打开核对（远山精密制造/新客回租·JW-2026-018；四横条+灰度四段+红黄绿灰信号灯；待办卡+提交材料；项目沟通折叠）。
- 复用决策：不动 v4life 核心；新增隔离 `lib/v5-preview` + `app/api/v5-preview`（理由见 IMPLEMENTATION §1）。
- 冻结：`lib/v5-preview/shared-types.ts`（主 Agent）+ `IMPLEMENTATION.md`（API/错误语义/种子/测试要求）。
- 端口核查：3311/3398/3399 空闲。

## C1（2026-09-12 凌晨）并行实现完成

- 三路原生 sub-agent 并行交付：FE（app/v5-preview 重写 8 文件 + 测试重写 14/14）、BE（store/service/4 路由 + 冒烟 13/13 on dev:node）、VERIF（两测试文件 14 用例 + PLAN/RESULTS/raw.log）。
- **DEFECT-1（平台事实）**：vinext dev（workerd）禁 node:fs、env 不可见 → 持久化不可行；主控裁决所有需持久化运行改用 `npm.cmd run dev:node`（BE 冒烟双证）；IMPLEMENTATION §1 已修订，不改 vite.config.ts。
- 集成：演示服务 3311（dev:node，PID 11208→重启后 21152），GET 返回 approval v7；页面 200。
- 浏览器实测（主 Agent，IAB 校准视口）：391×844 与 1920×1080（innerWidth 精确）渲染正常、无横向溢出；**验收闭环真实输入打通**：提交材料→键入→提交说明 → v7→v8、todo/信审转待复核、消息 2→4 条；截图 rows-01/02/03。
- 发现并退回 FE：①抬头项目编号重复渲染；②待复核状态仍渲染"提交材料"入口。FE 已修复（projectLine 纯函数 + 按状态收敛提交入口），测试 16/16，scoped tsc/eslint 绿。

## C2（2026-09-12 凌晨）一致性与恢复

- 刷新持久：reload 后 v8/待复核/4 条不变（浏览器实测）。
- 第二视口一致：新桌面标签读到同一 v8 状态（rows-03 截图）。
- 服务重启恢复：kill PID 21152 → 重启 → GET 仍 v8/待复核/4 条（证据：curl 输出，中文经管道显示乱码为控制台编码、非数据问题）。
- 幂等/冲突/越权/畸形输入：HTTP 层由 VERIF 测试覆盖（运行窗口协调中，见下）。
- **锁竞争协调**：next dev（Turbopack dev）同样有 `<site>/.next/dev/lock` 单实例锁（Next 16.2.6 新事实，无 CLI 开关）。主控停止 3311 实例为 VERIF 让出 3399/3398 测试窗口，完成后重启演示实例。

## C3/C4（2026-09-12 凌晨）完成

- 三情景浏览器实测全过（截图 rows-04/05）；演示终态切回 approval v7。
- UX P1-2 修复复验：连续两条消息正常入账（v8→v10，无 REQUEST_MISMATCH）。
- **DEFECT-3 修复复证：VERIF 终局 14/14**（缺 actorRole→400、错值→403 正确区分；重启恢复/损坏不静默重置实证）。
- **全量 Gate 终验：647/647（exit 0）、typecheck 0、lint 0 error（仅 1 条既有 v4life warning）、build 0**。
- 测试基建竞态收口（isolation=none 下文件级 after() 推迟到 run 末尾导致实例泄漏）：主 Agent 对 VERIF 两测试文件实施单 writer 集成例外修正——killServer 按就绪时捕获的监听 PID 直接精确补杀（await）、显式文件末尾清理用例、env 等待 45s；修前机制取证见 gate-full-test-final.log 两轮失败记录。FE 收尾删除 1 个未用变量；VERIF 文件内 3 个未用变量由主 Agent 同一例外清理。
- 交付：REPORT.md、DEMO.md、OWNERSHIP.md、截图 6 张、evidence 全套。演示服务 3311（dev:node）重启后保持运行供验收。
- **停止：按任务书不扩展、不续跑；等用户/Codex 最终验收。**
