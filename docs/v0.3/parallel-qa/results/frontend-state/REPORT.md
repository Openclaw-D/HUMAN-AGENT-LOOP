# V0.3-Z4 前端状态独立回归 · REPORT（ZCODE 并行QA 路04）

- 执行者：ZCODE（独立回归；不修改产品代码，不放宽断言）
- 日期：2026-09-21（本地 00:29–00:58 +0800）
- 任务书：`docs/v0.3/parallel-qa/04_FRONTEND_STATE_QA.md`
- 结论：**四场景 21/21 全部通过（exit 0）**，无产品缺陷发现；证据对应当前源码版本（见 §5 漂移记录）。

## 1. 交付物与写入范围

| 类型 | 路径 |
| --- | --- |
| 测试（唯一代码写入） | `Front/preview/test/zcode-v03-state/s1-state-discipline.state.test.mjs` |
|  | `Front/preview/test/zcode-v03-state/s2-snapshot-candidate.state.test.mjs` |
|  | `Front/preview/test/zcode-v03-state/s3-boundary-switch.state.test.mjs` |
|  | `Front/preview/test/zcode-v03-state/s4-action-gating.state.test.mjs` |
| 报告与证据（唯一报告写入） | 本目录：REPORT.md、4 份场景日志、合并日志、hash 前后快照、报告时点 pin、write-scope git status |

未触碰：`Front/site-mirror/**`、`Front/dist/**`、`Front/package.json`（hash 复核为产品侧 writer 所改，非本路；见 §5）。未运行 build，未安装依赖，未 commit。

## 2. 运行命令与退出码（每条独立可运行）

```bash
cd C:/Users/22673/Desktop/JW/Front
node --test preview/test/zcode-v03-state/s1-state-discipline.state.test.mjs   # exit=0  9/9
node --test preview/test/zcode-v03-state/s2-snapshot-candidate.state.test.mjs # exit=0  4/4
node --test preview/test/zcode-v03-state/s3-boundary-switch.state.test.mjs    # exit=0  6/6
node --test preview/test/zcode-v03-state/s4-action-gating.state.test.mjs      # exit=0  2/2
node --test preview/test/zcode-v03-state/s1-state-discipline.state.test.mjs preview/test/zcode-v03-state/s2-snapshot-candidate.state.test.mjs preview/test/zcode-v03-state/s3-boundary-switch.state.test.mjs preview/test/zcode-v03-state/s4-action-gating.state.test.mjs  # 合并 exit=0 21/21（5.05s）
```

日志（同目录）：`s1-run.log`、`s2-run.log`、`s3-run.log`、`s4-run.log`、`all-zcode-v03-state-run.log`。
环境：沿用既有 jsdom 设施（复用 `preview/test/behavior/harness.mjs` 与 `tsx-loader.mjs`，零新依赖）；Node v22.23.1。测试前环境验跑：既有 `takeoff-board.behavior.test.mjs` 16/16 通过。

## 3. 场景 → 具体断言

### 场景1（s1，9 测试）未开始/缺前置不是running；计时器/开锁动画不推进业务；红叉绿勾纪律
- `cellStatus` 纯函数：无事项无产出 → lock/灰「尚未开始」；前序行被阻断时即使 `running=true` 也 lock「先完成前序事项」；本格冻结/红项/黄项卡点压过 running 标志；无阻断的真实 running 才 wrench/蓝「正在处理」。
- 红叉：仅 gate 红项 → cross/红；stale（黄）、结论未登记（灰）、无分析产出（灰）均非 cross。绿勾：仅 `completed=true` → check/绿；`displayBucket=100` 但未完成不绿；有未解红项不绿；gate 失败不被 completed 掩盖（cand 红项除外，负面候选不吞完成态）。
- 组件层（`TakeoffCell`）：扳手旋转的唯一 DOM 判据 `.tk-status-object.wrench` 只在实际 running 格出现；lock/check/cross 格均无；aria-label 如实（尚未开始/正在处理/已完成/准入检查未通过/待复核后继续）。
- 计时器纪律（`t.mock.timers`，探针已验证可驱动 jsdom 定时器）：三格同屏 tick 5000ms 后 aria 与 data-state 不变（计时器不能把未开始推成开始、把处理中推成完成）；`StatusObject`：unlock 过渡含钥匙、走完停在 wrench 不出现 check；旧解锁计时器不能覆盖 cross；finish 走完停在 check；卸载重挂不重播动画。

### 场景2（s2，4 测试）首次快照异步到达；过期候选不复活
- 快照为空时不发起候选读取、不渲染候选；快照到达（anchor 变化）后自动读取，合法 `current=true` 候选最终读回：2 张卡、首选 aria-pressed、置信度 72% 且页面含「置信度为模型估计，尚未校准」说明、按钮可点。
- anchor 变化（候选版本 2→3）后重读在途窗口：旧候选立即不可渲染/不可选（「旧候选不可选择」状态可见），反馈/分析 POST 零发出；服务端按新 anchor 返回新集合后新候选恢复可选、旧标签不回归；纯重渲染不重发读取、旧候选不复活。
- 服务端 `latest.current=false` 的集合不渲染候选卡片。
- 迟到响应被核对拒绝：在途 anchor 变化后返回的旧集合不覆盖当前展示（`checked()`+代际守卫），零反馈发出。

### 场景3（s3，6 测试）切角色/客户边界；退出/撤权无残留
- hook 级（fetch 网络替身）：慢客户 workspace（含候选投影+材料载荷）迟到返回不覆盖快客户上下文（代际守卫，迟到方返回 false）。
- 退出登录：会话/客户/快照清空、phase=off；最近访问按身份整桶清理（`biz-1` 清空、`biz-2` 桶保留）；退出后 openCustomer 返回 false 且报「请先登录」，无可操作旧状态。
- 撤权（workspace 401）：会话终止、客户/快照/版本清零、`client` 置空（组件拿不到可操作入口）、phase=off、如实报错。
- 材料清单：同实例换客户后 A 客户在途响应不写回 B 视图（`alive` 守卫）；按屏内 `key=sessionId:customerId` 换挂载后 A 材料零残留。
- 上传绑定：有 done（completed）任务但无绑定 → 上传按钮锁定、点击零请求；`intake/accept` 建立绑定后解锁并成功走一次 `evidence/upload`（正对照，仅 cus_a 1 次）；换客户换挂载回到「通道未绑定」、旧绑定不可串用、cus_b 零上传请求。

### 场景4（s4，2 测试）授权门与导航纪律
- 无绑定 + 通道回执含 done 任务：上传按钮 `disabled=true`（completed 任务不解锁）、「通道未绑定（上传暂不可用）」可见；disabled 点击不派发（本地硬阻断），`channelAction`/`action` 零调用。
- 导航「下一步」全程（格子详情下一步区→材料页→顶栏四页往返→待办回原格子→需求登记/方案面板→结束对话框→撤回确认框打开后取消）：审批（confirm-preassessment）、通用动作（decide/facility 类）、消息发送、通道动作（含上传）、模型观察、模型分析 POST、反馈 POST **七项计数恒为零**；候选只读 GET 计数在纯导航段前后不变（点选格子聚焦助手引起的一次合法重读单独记账）。

## 4. 测试失败的最小复现与归属（过程记录，最终全绿）

本轮调试期 4 次失败**均为测试自身问题，无产品缺陷，未修改产品代码、未放宽断言**（修正对象是错误预期/替身，不是产品行为判据）：

1. s1 `Found multiple elements with role button`：三格同屏后 `getByRole` 撞名 → 改容器内 `querySelector`（替身查询问题）。
2. s2 候选不出现：替身 `workspace` 未随新快照更新，被产品 `checked()` 核对逻辑**正确**中性化 → 修替身时序（这反而是对过期核对逻辑的一次正向验证）。
3. s3/s4 上传确认框不出现：**jsdom 的 `File` 没有 `arrayBuffer()`**（探针证实 `typeof f.arrayBuffer === 'undefined'`），统一提交链读字节的 `f.arrayBuffer()` 在替身上不可用 → 换 Node 原生 `File`。浏览器环境不受影响，属测试环境缺口，非产品缺陷。
4. s4 两处断言文案错：回原格子抽屉标题实为「信审 · 核验」；`asset` 域 currency=changed 时工作台入口文案为「方案待复核 ↗」（产品按状态如实换文案，属正确行为）→ 修正测试预期。

## 5. 源码 hash 基线与漂移（FRONT 中途修改处理）

- 测试前基线：`source-hashes-before.txt`（00:29:25，覆盖 site-mirror takeoff/workbench/lib、preview/test、package.json、vite.config、tsconfig、UI_STATE_PATH_AUTHORITY.md）。
- 测试后复核：`source-hashes-after.txt`（00:56）。差异仅两处：
  1. 本路新建的 4 个测试文件（自身写入范围，预期内）；
  2. `Front/site-mirror/app/takeoff/ui-icons.tsx` 于 **00:37:40** 被 FRONT writer 修改——早于全部证据日志（s1 00:44、s2 00:46、s3 00:51、s4 00:54、合并 00:55:57），**最终绿记录即对应该新版本，无「旧版本通过算新版本通过」情形，无需追跑**。
- 报告时点 pin（`source-hashes-report-pin.txt`，00:58）：8 个关键源文件（ui-icons/takeoff-screen/materials-desk/use-workbench/channel-card/decision-feedback-panel/cell-status/status-object）与证据时点完全一致——本报告结论对当前版本成立。若 FRONT 在本报告交回后继续改源码，按任务书纪律以本 pin 为基准另约复验，本路不循环追跑。

## 6. 边界与声明

- 请求替身仅用于 UI 单测：s2/s4 为 client 层内存替身（fetch 不出进程）；s3 hook 用例整进程替换 `globalThis.fetch`（出网路径严格封死）；s1 无网络。**全程零真实网络**：未访问 48214/Edge 真实栈、未调用真实模型、未操作用户浏览器、未改 viewport、未安装依赖。
- 未修改 `Front/site-mirror/**`、`Front/dist/**`、`Front/package.json`；未运行 build；未 commit/push。git 状态见 `write-scope-git-status.txt`（仅本路两个 `??` 目录为新增；site-mirror/dist 的 M 项为 FRONT writer 在途工作，本路零写入）。
- **本交付为 jsdom 单元/行为级回归，不冒充浏览器视觉验收**：状态图像质感、动画观感、布局满铺等仍以 FRONT 的页面视觉验收为准；真实登录/服务端门（48214）行为不在本路范围。
- 集中交回一次：以上即本路全部产出。
