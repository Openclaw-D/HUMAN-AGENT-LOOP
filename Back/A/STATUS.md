# A 路 STATUS（2026-09-16 夜间长程）

更新时间：2026-09-16 06:45（北京时间，收口）。本文件只保留当前概要，历史过程见 evidence/。

## 05:00 监督落实（A 侧动作，05:20 完成）

1. **B 预算修复新版已重新组合**：B 于 05:07/05:09 连续更新 `src/transport/glm.mjs`（缺陷版 1CA128BE… → 修复版 84e20cc6…，逐文件哈希已入清单）。`assembly/final-compose.mjs` 对新版 B 重跑 **7/7 全过**，并新增**传递消费清单** `assembly/final-compose-manifest.json`（B/src 全树逐文件 sha256 + C mock 树 + A 生成配置；glm.mjs 单列以便与监督记录的缺陷哈希 1CA128BE… 对照）。
2. **--watch 自动重锁**：final-compose 带 `--watch` 常驻（05:15→07:00，每 5 分钟比对 B/src 树哈希），B 变更即自动重跑组合重锁清单——满足"旧 hash 通过不可代替新版"。当前组合锁定于 glm=84e20cc6…
3. A 未触碰 B 写面；预算/账本缺陷的修复与测试归 B，反证归 D。

## 04:10 D final-full-0400 中 A-owned 项裁决

- **D-19c（fail）判据过时**：该用例断言"middle 不级联（v1.2 实现一致性，逐字节）"——v1.3 已把传递 staleness 设为需求可见性（middle/leaf 读投影 stale=true，状态与版本不变）。请 D 按 CONTRACT v1.3 更新判据：`goal.stale===true`（middle/leaf）、`goal.version` 不变、`goal.status` 不变；逐字节比较应排除 stale 字段或改为断言 stale=true。
- **D-19d（"原需求反例·待用户裁决"）部分更新**：v1.3 落地后"无任何标记"已不成立——leaf 读投影 `stale=true` 且 accept（到 candidate 后）被 409 `UPSTREAM_STALE` 拦截、需 `staleReviewAck`；claim/complete 仍放行是**候选设计**（正式性时刻才设门）。"标记+门是否足够、是否需要更强制阻断"正是 PENDING-USER-RULING 项（`A/DEF01-analysis.md` §4），等待用户裁决，不预设结论。
- **D-27b / D-27p / D-25**：owner=B，A 无动作。
- D 的 SUT 若从 A src 拉起（同代码），请确认其运行时间在 03:58 v1.3 常驻重启之后或以自身拉取的 A src 为准（manifest hash 见 `A/assembly/manifest.json`，v1.3 后已刷新）。

## 03:05 监督纠偏落实（全部完成，04:00）

1. **DEF-01 不再仅以契约文字关闭**：
   - 反例分析落盘 `A/DEF01-analysis.md`（三代链反例：recommendation 不直接绑定证据时，v1.2 下可被无提示验收/决定，依据链根部已被推翻而下游不可见）。
   - 实现最小候选（**CONTRACT v1.3，新增部分标注 CANDIDATE / PENDING-USER-RULING**）：
     a) staleness 改为**读时计算的传递投影**（staleness.ts；accepted/decided 也携带 stale 可见性，决定/验收记录不改写）；
     b) **accept/decide 人工复核门（fail-closed）**：stale 目标 → 409 `UPSTREAM_STALE`（响应列 staleRoots）；携带 `staleReviewAck:{note}`（人类验收/决定角色）→ 放行 + 审计 `stale_review_acknowledged`；
     c) 清除路径：invalidated 重绑新鲜输入回 ready 后 stale 自然为 false；accepted 的重开机制**不提供**（制度问题留用户）；decided 永不重开。
   - 保留历史正式决定的底线不动；"下游可继续用失效依据"的实现注释已删除（recompute.ts 改为可见性传播说明）。
2. **最终组合改用真实 B 执行器（不再以 A 脚本客户端冒充）**：`assembly/final-compose.mjs` 消费 `B/src/cli.mjs worker`（只读 B 代码，配置由 A 生成于 assembly/.b-final-config.json）+ C mock（3735 真实 socket）+ A 内核（真实 PG/HTTP）。
   **7/7 全过**（`evidence/final-compose-result.json`）：4 目标/2 角色；B worker claim→LangGraph→complete（provider=simulation，C mock 供数）；人工暂停 mitigations → assess 链照常被 B 执行（无关目标不冻结）；恢复后 B 重新执行；证据取代 → recommendation 验收被 UPSTREAM_STALE 拦截 → 显式 ack 放行 → intake 正式决定（ack）→ decided。
3. **过程中发现并修复真实互操作缺陷**：B worker 周期化 requestId（~70 字符）超 A 契约 64 上限 → 全部 complete 被拒。A 放宽 requestId 上限至 **128**（v1.3 变更 6，非破坏性放宽；幂等表 text 键无成本）。
4. 全量回归 **23/23**；E2E 10/10；C 8 计划全过；干净目录启动自验 PASS；manifest 40 源文件+lockfile 已锁定；48080 常驻实例已用 v1.3 代码重启。

## 当前状态

- CONTRACT **v1.3**（v1.2 及之前 FROZEN；v1.3 新增候选语义 PENDING-USER-RULING：`UPSTREAM_STALE`/`staleReviewAck`/传递 stale 投影/requestId≤128）。
- 三路集成实测全通：A 内核 × B worker（真实执行器）× C mock/模板/plans。
- 待用户裁决：DEF-01 候选语义（复核门 + ack 的制度含义）；Celery spike（B 路已给出证据，列待裁决）。

## 收口（06:45 终验全绿）

- 23/23 测试 + E2E 10/10 + final-compose 7/7（B glm=95caaf4c，预算修复版）+ C 8 计划 + D-29 自验 PASS；manifest 39 文件零漂移；48080 健康（v1.3 代码）。
- B glm.mjs 迭代 84e20cc6→95caaf4c 均被 --watch 捕获并自动重跑组合重锁清单（watch 曾因缺 spawnSync 导入崩溃，05:59 修复重启）；D 完成 d25/def03/d29 系列复测（D-29 D 侧 pass、D-27b r4 pass、D-19c 按 v1.3 pass）。A 侧无新缺陷。

## 值守计划（04:00–07:00）

1. D 后续轮次（r6/r7 已出，D-09 复测 pass）按缺陷报告继续响应。
2. B/C 有新 interface-change-request 或缺陷即响应。
3. 定期健康检查；07:00 如实汇总。

## 02:00–04:00 加固轮（全部由测试/B 观察/D 反证/监督纠偏抓到并修复）

pg Pool idle error 未处理致 DB 重启崩溃；证据命令缺项目 inputVersion 原子门；listHumanRequests 蛇形列名泄漏；goal 投影缺 projectId；requestId 64 上限卡 B worker；测试套件并行与 docker restart 互扰（改串行）；DEF-01 语义候选实现（staleness.ts + 复核门 + ack 审计）。