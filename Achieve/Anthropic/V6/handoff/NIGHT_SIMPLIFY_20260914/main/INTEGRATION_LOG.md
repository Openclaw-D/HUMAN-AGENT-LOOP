# INTEGRATION_LOG｜任务A（NIGHT_SIMPLIFY_20260914/main）

A 独占维护。记录产品写入、B/C 采用与未采用项、版本 hash。所有变更均为源码 `jianwei-v3/site` 写入后白名单同步至预览副本 `jianwei-v3/se-preview-20260913/`（`diff -rq app lib` 一致，04:30 复核）。

## 一、产品变更清单（相对 01:33 接手基线）

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `lib/v5-preview/demo-story-types.ts` | NEW | 演示主线最小形状（CONTRACT §3）：DemoStoryStep/DemoStoryStep 签名函数/overviewSignature；含 nextStepId（03:05 增补） |
| `lib/v5-preview/demo-story-data.ts` | NEW | 固定步骤表。**采用 C 路 `candidate/a-shape/demo-story-a.json`（04:05 替换 A 过渡版 12 步表）**：22 步、4 个人工决定点（恰 3 分支）、五阶段全覆盖。§4 映射补丁：①去 origStepId；②s01 政策域对齐 s02（消除相对 s00 的判断倒退）；③终点步 scenario='settled'+判断灯文案/摘要对齐 settled 种子（保证终点与既有已结清情景签名一致） |
| `lib/v5-preview/demo-story-service.ts` | NEW | 签名推导 GET 投影 / advance·decide 命令：requestId 幂等（复用 rows-store 幂等表）+ expectedVersion 版本门 + fromStepId 步骤门（防双击跳步/串线）+ 决定点 STORY_DECISION_REQUIRED；advance 目标=显式 nextStepId 优先、缺省数组下一项 |
| `app/api/v5-preview/demo/story/route.ts` | NEW | GET/POST 演示主线（演示控制·非业务操作） |
| `app/v5-preview/demo-story-panel.tsx` | NEW | 演示条组件（进度/推进/人工决定三分支卡/重新开始/free 诚实降级） |
| `app/v5-preview/page.tsx` | M | story GET/POST 接线（经 api-client）；演示条渲染；重新开始确认卡（范围说明含「远程尽调会话数据不受影响」）；RowsView storyStage 传递 |
| `app/v5-preview/api-client.ts` | M | 新冻结端点 `'/api/v5-preview/demo/story'` + fetchStoryState/postStoryCommand（保持「只有 api-client 允许 fetch」契约） |
| `app/v5-preview/rows-view.tsx` | M | 可选 storyStage props → lifecyclePositionFromStory（free 模式行为不变） |
| `app/v5-preview/rows-logic.ts` | M | 新增纯函数 lifecyclePositionFromStory |
| `app/v5-preview/se-overview.module.css` | M | 演示条样式（storyStrip/storyChip/storyDecide 等 12 类；追加，未改既有类） |
| `app/v5-preview/remote-session/page.tsx` | M | **D-01 修复**（runWrite resolve 键=注册表条目键）；**D-02 修复**（ask 流去 runWrite 返回值解引用+错误可见）；**D-04 修复**（关键字段持久化）；B 方式1 窄改集成（视图门控/四域提示/全屏入口前移）；风险提示仅业务视图 |
| `app/v5-preview/remote-session/se-interview.module.css` | M | 视图切换/隔离标注/四域提示样式（6 类，追加） |
| `test/v5-preview-demo-story.test.mjs` | NEW | 演示主线测试 9 项（04:25 起按 C 22 步表断言） |
| `test/v5-preview.test.mjs` | M | ①新增 demo-story-panel/se-icons/se-overview.module.css 入文件清单；②端点白名单 +demo/story；③四处 SE_REBUILD 前陈旧断言纠偏（详见 CONTRACT §8）；④palette 扫描范围收回到 preview.module.css |
| 远程 store 数据（非源码） | 数据修店 | M1 会话去重 12 条重复模拟回复 + 去除问题测试后缀（F-D3；清理前快照 `baseline/remote-store.pre-cleanup.json`） |

**零改动确认**：`lib/v5-preview/service.ts`、`store.ts`、`remote-service.ts`、`remote-store.ts`、`remote-types.ts`、`shared-types.ts`、`remote-request-registry.ts`、全部既有 API 路由（demo/seed 除外的新增外）、`chat-panel/todo-card/domain-row/camera-panel` —— 均未写入（diff 与 hash 复核）。

## 二、C 路采用记录（§4 映射）

| C 交付物 | 采用 | 说明 |
| --- | --- | --- |
| `candidate/a-shape/demo-story-a.json` | **采用**（hash 以 C RESULT 为准：`1f57b62f23e6ee55…`） | 落地为 demo-story-data.ts；三处映射补丁见上；落地版 hash 见本文末 |
| `candidate/demo-state.mjs` + `.d.ts`（机制版状态机） | 未接入（记录为验收对照实现） | A 的 service 已实现线性表+显式后继语义，与机制版行为在四条分支路径上等价（A 测试+浏览器走查覆盖 confirm/correct/return×2 组）；C 的 29 项机制测试保留在其目录可随时对照 |
| `test/story-data.test.mjs` 等 29 项 | 采信（C 自测通过），A 侧另建 9 项产品集成断言 | 双层验证 |
| 开放差异①DD-07B 二次退回 | 按 A 形状（允许补证循环） | return 链 s12→s10 可循环，confirm/correct 出圈 |
| 开放差异②纠正升版深度 | 按 A 形状（文案+note 留档） | 服务端不模拟证据升版（与 remote-store 解耦原则） |
| 开放差异③机制版作对照 | 采纳其「对照」定位，不接入产品 | 同左 |

**C 数据补丁明细（A 裁量，依据 §4 映射权）**：s01-pre-01 的 policy 行 ← s02-pre-02（原数据相对 s00 呈现政策判断倒退「已确认→未开始」，破坏状态变绿叙事；补丁后政策绿不回退）；终点步 s21-pr-03 加 `scenario:'settled'` + 四域 judgmentText/summary ← settled 种子（原「已结清（演示）」四域同文案，导致终点签名 ≠ settled 种子、与既有已结清情景视觉不一致）。补丁后不变量全部恢复：签名唯一 22/22、s00==approval、终点==settled。

## 三、B 路采用记录（方式1 窄改）

- 详见 `../ui/feedback-from-a.md`：viewMode 门控（等效实现）、四域提示（简化 chip 行，数据直读 /project）、全屏入口前移 = 采用；PendingBar 合并、17 回调整组件化、riv- 整文件 = 未采用（原因在案）。
- B 的 SIMPLIFICATION 建议处置：入口精简（CP1 已核实唯一）；**建议#4 已采纳（05:15）**——分析按钮 title 去除 `JIANWEI_MODEL_*` 环境变量名与预算数字（诚实短提示 + 指向「演示设置」），明细保留在演示抽屉内（满足「收进次级区域」且不移除诚实提示）；死代码 preview.module.css 删除 = 未做（留白天授权处理）；其余在反馈文件逐条记录。

## 四、D 路缺陷处置

- D-01/D-02/D-03(F-D1)/D-04 全部修复；F-D2 断言完成；F-D3 数据清理完成。处置明细与 D 复测口径见 `feedback-to-d.md`。**D 复测未开始（D 待复测，A 不代报通过）。**

## 五、当前版本 hash（sha256，2026-09-14 04:45 采集）

见 `main/final-hashes.sha256`（本目录）。关键项：demo-story-data/service/types、story route、demo-story-panel、page.tsx（首页/尽调）、api-client、rows-view/rows-logic、两 CSS、两个 test 文件。

## 六、遗留与未做（如实）

1. D 的四项缺陷复测未跑（D 在 3469 复测，A 不代报）。
2. B 的候选组件化重构（方式2）与移动端四域收起修复未采用——后续工作项。
3. `preview.module.css` 死代码删除未做。
4. 网络错误路径（story 推进 NETWORK 提示可重试）为代码审查+既有幂等设计推证，未做断网实测。
5. C 机制版模块作为对照实现的逐行为 diff 未跑（双方测试各自全绿，路径覆盖人工浏览器走查补足）。

---

# 续轮记录（2026-09-14 上午，截止取消·统一产品轮）

用户指示：以当前范围内完整交付为终点，重点是统一产品而非叠功能。逐项处置如下。

## 七、B 建议逐项复核（对照 SIMPLIFICATION.md 五项 + 层级方案）

| B 建议 | 本轮处置 | 说明 |
| --- | --- | --- |
| #1 路由/三态骨架保留 | 维持 | 无变更需求 |
| #2 现场画面区升为页内主体 | **已采用** | `sivStage`（16:9 画面区：诚实徽章「视频未接入·不申请摄像头/麦克风」或「模拟会议视图·非真实画面」+ 合成头像位 + 当前问题浮层）置为第一层；与已接受方向「业务端以视频为主体」一致。原「视频与连接状态」行移除（信息并入画面区徽章与控制条） |
| #3 挂断/拍照同名异义合并 | **已采用** | 画面区控制条 = 模拟画面开关 · 放大（转写演示）· 拍照/选图（受控展开证据面板，直达既有 CameraPanel 入口，不新增拍照实现）；全屏覆盖层「挂断」改名「退出」（仅关视图），删除全屏「拍照」重复按钮；「挂断（释放资源）」语义仅保留在 CameraPanel 原位 |
| #4 技术/演示配置收敛 | **已采用（收尾）** | 05:15 已做按钮 title 去泄漏；本轮删除死代码 `preview.module.css`（637 行，全 app 零引用；删除前快照+hash：`main/baseline/preview.module.css.deleted`，sha256 `0a483a92…80adf`），对应两个仅针对该文件的灰度纪律测试一并退役 |
| #5 PendingBar/反馈行组件化 | **已采用（PendingBar）** | 未知请求恢复条统一为 `PendingBar` 单渲染点（empty/ready 双实现消除，文案统一）；paused/notice/writeError 反馈行本就单点，维持 |
| 手机四域折叠（candidate 移动端修复） | **不采用（有具体理由）** | 该修复针对 B 候选的「画面区+右栏」布局在 375px 下侧栏挤压画面（254px→47px）；本产品移动端采用**横向 chip 行**（`sivTipsInline`，无侧栏），不存在该挤压路径——375 实测画面区完整 16:9、无挤压。桌面右栏（≥900px）与手机 chip 行并存，两者数据同源 |
| 桌面侧栏层级（CP2 目标布局） | **部分采用** | 采用「四域提示右侧栏 + 层级原则（画面→问题→四域→记录→内部→演示抽屉）」；未采用 tabs 化记录层/半开内部交流（涉及 FAQ 折叠交互重排，属更大视觉改版，本轮以「统一」为界不扩）——理由：现有 details 折叠已分层清晰，tabs 重排收益不抵回归风险 |

## 八、C 机制对齐核验（对照 demo-state.mjs / BRANCHES.md）

| C 机制 | 产品表达 | 处置 |
| --- | --- | --- |
| 常规自动推进（advanceAuto） | **已补齐**：advance 改为自动推进链——连续应用常规自动步，遇人工动作步（`holdForHuman`：s03 发起尽调/s05 现场补充/s10 补交挂接/s16 签约退回补充）或人工决定步应用后停止；一次推进版本按应用步数递增，链上各步预设消息全部入流；决定路径不自动链（人动作保持独立点击边界） | 复用现有实现（状态逻辑仅此一套）；C 机制版模块维持「对照实现」不接入 |
| 部分并行（parallelGroups DD-03..06） | **已表达**：并行组经自动链一次推进完成，汇合步 s09 消息「四项并行补充已完成…自动推进在此暂停」如实入流（浏览器实测断言） | 同上 |
| 人工决定（4 节点 MUST_DECIDE） | 原已表达（STORY_DECISION_REQUIRED+决定卡）；本轮新增**三分支结果提示**：确认=「按当前意见继续推进（人工判断已留档）」、纠正=「纠正意见已更新并入档…」、退回=「等待按退回意见补充材料…」，storyNotice 单行呈现 | 同上 |
| 纠正后证据与意见更新 | **核验通过（按 §3.2 既定裁量）**：correct 选项文案载明更正内容（年→月产值），落地步 s13 消息双口径表述（「若经纠正：已按『月产值』口径更正，基于『年产值』的产能-能耗分析不再采用」）+ decide note 留档。机制版的 store 级证据升版/supersede 按主线-DD 解耦约定不在产品内执行（CONTRACT §2 冻结） | 维持 A 形状表达 |
| 退回仅一次（D-03 残留） | **已对齐**：再判断点 s12/s17 去除 return 选项（数据级，无状态层改动）——退回只允许一次，再入仅确认/纠正；同 C BRANCHES「有限路径」 | 同上 |

状态逻辑并存核验：产品内仅 demo-story-service 一套状态逻辑（签名定位+显式后继+自动链）；C 机制版模块只在 story/ 目录作对照，未接入产品。

## 九、本轮其余变更

- `test/v5-preview.test.mjs`：移除 preview.module.css 清单项与两个随之退役的样式纪律测试；决定分支断言改为按节点（首判断点 3 分支/再判断点 2 分支）。
- `test/v5-preview-demo-story.test.mjs`：9 项全部改写为自动推进链语义（链落点、版本步数、链上消息、退回仅一次、双击防护、幂等）。
- 测试结果：v5-preview 全家 71/71 绿；typecheck/eslint（改动文件）0 问题；build exit 0（`main/build-night-r2.log`）。
- 浏览器实测（3467）：起点一次推进→落 s03（消息含预审步）；s03→s05；s05→s09（含「四项并行」消息）；确认→s13+「已确认」提示；客户视图泄漏断言 6 项全过；拍照/选图→证据面板受控展开 ✓；375 画面区完整、手机四域 chip 行在位；桌面侧栏四域与主线一致。
- 新增截图：`home-confirm-notice-1280.png`、`dd-desktop-stage-sidebar-1280.png`、`dd-375-stage.png`。

## 十、D 二轮复测（08:05–08:30）与新缺陷处置（D-06/D-07/O-1/O-2/O-3）

D 在运行版本 d3c8aa6c（本轮变更前）做了第二轮独立再验收：精简损失盘点（无操作/反馈/状态丢失）、四路径全走查、真实 NETWORK 失败重试全链路、双视口 409 静默对齐、375 新 DD 页+客户视图——全部通过；同时发现 D-06/D-07（再判断点提示与实际选项自相矛盾）与观察项 O-1/O-2/O-3。处置：

| 项 | 处置 | 落点 |
| --- | --- | --- |
| D-06 s12 提示称「不再提供退回」但实际提供退回 | **已修复**：本轮「退回仅一次」数据补丁使 s12 选项=[confirm,correct]，与提示文本一致（浏览器实测：s12 仅两按钮，提示与选项同屏一致） | `demo-story-data.ts` ⑤ |
| D-07 s17 提示称「仅提供确认」但提供纠正+退回 | **已修复**：s17 选项=[confirm]（对齐 C 机制 SG-02B 仅确认），与提示一致（浏览器实测：仅确认按钮） | `demo-story-data.ts` ⑤ |
| O-1 s15「纠正」为裸按钮且与「退回」同落 s16 | **已修复**：纠正标签具体化「纠正：按人工意见修订条款（转商务补充后重新复核）」；s16 标题/消息中性化（同时承载纠正/退回来路，不再使用单方「退回」品牌话术），hint 同步 | `demo-story-data.ts` ⑥ |
| O-2 s13 汇总消息条件式措辞（「若经纠正」在已纠正后读作假设） | **已修复**：改为中性表述「如人工已更正记录口径，以更正后口径为准…（见上方决定留档）」（纠正细节由 decide note 留档承载） | `demo-story-data.ts` ⑥ |
| O-3 部分并行线性化（s05–s08 四次推进） | **已缓解**：本轮自动推进链使 s06–s08 与汇合点 s09 一次推进完成（s05 现场补充保留独立人工点击）；「任意顺序」语义仍仅 C 模块可交互——如实记录，不再被静默丢失 | service 链 + 本记录 |

- CONTRACT §3 同步修订：决定选项由「恰 3 类」改为「⊆ {confirm,correct,return} 的确定性集合（首判断点 3 类；再判断点按 C 机制裁剪）」。
- 本轮数据补丁改为**从 C 上游 demo-story-a.json 单脚本全量重建**（补丁①–⑥全部脚本化，见 `demo-story-data.ts` 头注），消除多轮就地补丁的脆弱性。
- 数据落地版 hash：`demo-story-data.ts` = `b0647d2d…2e549f`（全量见 `main/final-hashes.sha256`，06:40 采集）。
