# BASELINE_GATE｜A 路产品写入前基线报告（2026-09-14 晚）

按 COMMON §大版本baseline硬门：本报告列出精确 baseline 范围、差异归属、恢复方法与可恢复候选快照。
**快照是文件副本，不是 Git commit/tag；Git 层操作（commit/tag）仍待用户确认，本轮不执行。**

## 一、仓库现状（实测 2026-09-14 晚）

- 唯一活动仓库：`jianwei-v3/site/.git`（Anthropic 根与 jianwei-v3 根均不是仓库）。
- 最近提交：`63c41c3 "archive: preserve Jianwei V3 snapshot"`（2026-08-31 02:59 +0800，旧归档，与当前产品无关）。
- 工作区差异：`git status --porcelain` 共 **99 条**（M/D/?? 混合），覆盖 V2/V3 历史删除、V4/V5/V6 新增目录（`app/api/v4|v4life|v5-preview`、`lib/v3-*|v4*|v5-preview` 等均未跟踪）、文档增删。**这些差异是 V4→V6 多轮历史累积，不是本轮 A 造成的，本轮也不处理、不提交、不忽略它们。**
- 运行实例：3467 = `next dev`（目录 `jianwei-v3/se-preview-20260913/`），`app/`、`lib/` 与源码 `site/` 当前 `diff -rq` 全量一致（本轮动手前复核）。3467 数据目录 `V6/handoff/SE_REBUILD_20260913/runtime/data/`（rows-store.json v154 @story s00；remote-store.json v94，含历史测试会话）。3311/3321/3399 不触碰。

## 二、本轮 A 预计写入的精确范围（唯一写面）

源码 `jianwei-v3/site/`（仅下列文件；其余只读）：

| # | 文件 | 动作 | 目的 |
| --- | --- | --- | --- |
| 1 | `lib/v5-preview/store.ts` | 修改 | rows-store schema @1→@2：新增可选 `storyCursor`（稳定步标识）与 `sharedDemo`（专属演示会话指针）；@1 旧文件读取兼容 |
| 2 | `lib/v5-preview/demo-story-service.ts` | 修改 | 当前步改稳定游标定位（签名仅作 @1 迁移回退）；纠正决定→真实复核记录；共享投影接入 |
| 3 | `lib/v5-preview/service.ts` | 修改 | notes/messages/seed/GET project 接入共享事实同步（投影不递增业务版本） |
| 4 | `lib/v5-preview/remote-service.ts` | 修改 | 新增演示会话数据清除助手（供重开用；既有命令语义零改动） |
| 5 | `lib/v5-preview/shared-facts.ts` | 新增 | 共享事实投影：remote 证据/复核 → 首页域/待办/消息标记；专属会话懒建；崩溃后重算自愈 |
| 6 | `app/api/v5-preview/demo/reset/route.ts` | 新增 | 重开=仅重置当前专属演示（主线+专属会话），保留其他会话 |
| 7 | `app/api/v5-preview/demo/shared-state/route.ts` | 新增 | 共享事实只读出口（首页/尽调页共用） |
| 8 | `app/v5-preview/api-client.ts` | 修改 | 新端点客户端 + 类型 |
| 9 | `app/v5-preview/demo-story-panel.tsx` | 修改 | 共享事实条展示；重开按钮接新命令 |
| 10 | `app/v5-preview/page.tsx` | 修改 | 重开确认文案改精确作用域；共享事实展示接线 |
| 11 | `app/v5-preview/remote-session/page.tsx` | 修改 | 会话选择优先专属演示会话（最小改） |
| 12 | `test/v5-preview-demo-story.test.mjs` | 修改 | free 断言按新契约更新（签名变化不再脱离路线）；新增游标用例 |
| 13 | `test/v5-preview-shared-facts.test.mjs` | 新增 | 共享链路：证据→纠正→待复核→四域同步→重开隔离；并发重复；中断恢复 |

非 Git 演示数据（3467 实例数据，写入前快照）：
- `V6/handoff/SE_REBUILD_20260913/runtime/data/rows-store.json`
- `V6/handoff/SE_REBUILD_20260913/runtime/data/remote-store.json`

预览副本：`jianwei-v3/se-preview-20260913/{app,lib}`（部署时从源码同步，diff -rq 验证为零差异）。

## 三、差异归属

- 上述 #1–#13 之外的任何源码差异 = 历史 V4–V6 累积或他路工作，**不属于本轮 A**，A 不回退、不代管。
- B 只写 `REPAIR_20260914_EVENING/home/**`、C 只写 `remote/**`、D 只写 `qa/**`：其候选被 A 实际采用时，由 A 合入上表范围并逐文件记录于 INTEGRATION_LOG。
- 本轮不安装依赖、不建新平台、不换栈、不部署新服务、不 commit/tag/push。

## 四、可恢复候选快照（已执行）

- 位置：`V6/REPAIR_20260914_EVENING/main/baseline/`
- 内容：上表 12 个既有文件的写入前副本（`.orig` 后缀，含目录结构）+ 3467 两个数据文件副本（`.data-orig` 后缀）+ `pre-hashes.sha256`（全部快照文件 sha256）。
- 快照性质声明：**文件级候选快照，供恢复用；不等同也不冒充 Git commit/tag 基线。** Git 层 baseline 操作（如提交归档点）留待用户明确授权，授权前 Git 工作区保持原样（含全部 99 条历史差异）。

## 五、恢复方法（逐条可执行）

1. **源码回退**：`cp main/baseline/lib/v5-preview/<name>.orig → site/lib/v5-preview/<name>`（逐文件覆盖）；删除新增文件 `shared-facts.ts`、`demo/reset/route.ts`、`demo/shared-state/route.ts`、`test/v5-preview-shared-facts.test.mjs`。
2. **前端回退**：同法覆盖 `api-client.ts`、`demo-story-panel.tsx`、`page.tsx`（v5-preview）、`remote-session/page.tsx`；测试回退 `test/v5-preview-demo-story.test.mjs`。
3. **预览副本回退**：源码回退后 `robocopy /MIR site/app se-preview-20260913/app` 同法 lib（或 `diff -rq` 驱动逐文件拷贝）；3467 dev 热更新，无需重启。
4. **数据回退**：`cp main/baseline/rows-store.json.data-orig → runtime/data/rows-store.json`；remote-store 同法。3467 无需重启（每次操作重读文件）。
5. **验证回退成功**：`sha256sum` 对比 baseline/pre-hashes.sha256；`curl 3467/api/v5-preview/demo/story` 返回 `mode:"story", stepIndex:0`。

## 六、硬门声明

- 本轮不执行 `git add/commit/tag/push`、不忽略脏差异、不改 `.gitignore` 排除规则、不动 3311/3321/3399、真实模型调用 0 次、不调用付费 API。
- 用户若批准 Git 层基线操作，建议形态：单独 `git add` 上表 13 文件做一次 scoped commit，或先全量归档分支；**未经明确授权不执行**。
