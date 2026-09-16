# RESULT｜A 路共享状态与最终集成（首次完整交付）

日期：2026-09-14 深夜。Ownership：A = 本轮唯一产品源码 writer（jianwei-v3/site + 预览副本白名单 + 运行 3467）；未操作 Codex、未用 subagent、未碰 3311/3321/3399、未 Git commit/tag、真实模型调用 0 次、未装依赖。

## 一句话结论

**固定演示与远程尽调共享同一演示项目事实的闭环已实现并实测走通**：演示步（发起访谈/现场补充/补交/条款）产生真实证据取代链，演示纠正与尽调页人工纠正都写真实复核记录；受影响域/待办/消息确定性投影到首页；当前步以稳定游标记录（文案变化不再脱离路线）；重开仅清除当前专属演示（其他会话与记录保留）；B（首页）与 C（尽调页）候选均已实际集成、渲染与交互实测通过。

## 唯一入口与操作路径

- **http://127.0.0.1:3467/v5-preview**（运行副本 `jianwei-v3/se-preview-20260913/`，与源码 `diff -rq` 全量一致）。
- 路径：首页（B 版式：页头菜单/重开图标、五阶段、四域方格、演示条+共享尽调事实条、精简消息）→「远程尽调访谈」（C 版式：现场主体+右侧工具+下部进度/操作/聊天）→ 尽调页人工纠正/演示条纠正决定 → 首页四域/消息/事实条同步 → 刷新/返回一致 → 右上重开（确认框明示作用域：仅当前专属演示会话+主线，其他会话不动）。
- 演示状态：3467 现停起点 s00（v154），历史 10 会话完整；专属会话 rs-demo-run 空（首次进入/推进时懒建填充）。

## 精确变更列表

32 文件（后端 10 + 前端 19 + 测试 3），逐项见 `INTEGRATION_LOG.md`；接口契约 `INTERFACE.md` v1；写入前快照 `baseline/`。

## B/C 采用

均已集成（非"候选完成即结案"）：B 10 组件 + 3 处兼容修改；C 4 文件逐字节采用（hash 与其 RESULT 一致）+ page 重写为接线层。逐项映射与未采用清单见 `ADOPTION.md`。

## 验证（全部本人实测，可复跑）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 单测 7 套件 | **93/93 绿**（shared-facts 8 / story 11 / v5-preview 20 / remote 12 / rework1 11 / rework2 5 / v6fix 26） | `node --experimental-strip-types --test --experimental-test-isolation=none test/<file>`（逐文件单跑） |
| typecheck / lint / build | 0 错 / 改动文件 0 错（3 warning 见 §四）/ exit 0 | 本轮实测 |
| 全链 HTTP（隔离实例 3481，独立数据目录） | **32/32**：懒建→演示步建链/升版→尽调页人工纠正→四域/待办/消息投影→演示纠正写真复核→刷新返回一致→并发重复（重放/409）→重开隔离→版本单调 | `main/evidence/full_chain_3481_output.txt`（脚本 `full_chain_verify_3481.py`） |
| 中断恢复 | remote 写成功后 rows 丢失：同 requestId 原样重试自愈、确定性 ID 不重复、投影从 remote 重算重建；remote 损坏→诚实降级 | 套件「中断恢复」「降级」两项 |
| 浏览器实测（IAB，1280/375） | B 版首页、C 版尽调页、决定点交互（确认→落点 14/22·尽调）、共享事实条/消息/四域标记全部可见 | `main/evidence/integrated-home-b-1280.png`、`integrated-dd-c-1280.png`、`home-shared-facts-375.png`、`home-shared-facts-1280.png` |
| 3467 只读核对 | story s00 v154 保留（@1→@2 迁移无损）、home/DD 200、shared-state 正常、历史会话完整 | 本轮实测（curl） |

诚实备注：原 story 测试"notes 签名脱离→free"断言按本轮目标**有意变更**（COMMON：稳定标识、避免文案变化导致 free），已在测试头注释与本文件声明，非悄悄弱化。

## 模拟/真实状态（诚实声明）

全部数据合成（JW-2026-018/远山精密为虚构）；不执行正式审批；模型 authority=none；共享尽调消息一律标注「共享尽调」marks、来源 system/人工，不冒充真实模型；视频/语音未接入如实显示；真实模型 0 次调用（接线保留、入口诚实禁用，合成输入走同一后端）。

## 剩余 warning / 未验证项（如实）

1. lint warning ×3：`remote-service.ts` 2 条（**基线已有**，本轮前后对照核实）、`RemoteInterviewStagePage.tsx` 1 条（C 组件内部未用 props，保持 C hash 未改，留 R1 报 C）。
2. 独立缩放 80/100/125 组合未在集成后实页复测——以 B/C 候选自测证据为准（home/evidence/08、09；remote/evidence/zoom-390.json）。
3. 真实 provider 在线端到端未验证（凭据未配置；0 付费调用）。
4. 运行时键盘 Tab/`:focus-visible`（IAB 环境限制，与 B/C/D 同受限）；移动端真机未测。
5. B 路未交 RESULT/差异清单文档，其差异以 ADOPTION.md 代记；B 确认文案作用域由 A 修正（见 ADOPTION §三）。
6. 交互类（提交访谈记录/暂停/转人工/核算等）接线到与旧页相同的 runWrite 通道且 typecheck/单测覆盖，但未逐一浏览器点击走查。

## 边界（不自评替代）

**用户视觉接受未宣称；Codex 独立复验未做。** 按 COMMON：首轮交付后按批量缺陷清单最多 R1/R2；R2 后未闭环交 PARTIAL/FAILED。

## 恢复方法

1. 源码：`cp main/baseline/<path>.orig → site/<path>` 逐文件覆盖 + 删除 4 个新增文件（shared-facts.ts、demo/reset、demo/shared-state、shared-facts 测试）；B/C 组件删除即回退。
2. 预览副本：回退后重同步 `site/app|lib → se-preview-20260913/app|lib`（diff -rq 驱动）；3467 热更新无需重启。
3. 数据：`cp main/baseline/*.data-orig → V6/handoff/SE_REBUILD_20260913/runtime/data/`（3467 每次操作重读文件，无需重启）。
4. 验证：pre-hashes.sha256 比对 + `curl 3467/api/v5-preview/demo/story` 返回 s00。
