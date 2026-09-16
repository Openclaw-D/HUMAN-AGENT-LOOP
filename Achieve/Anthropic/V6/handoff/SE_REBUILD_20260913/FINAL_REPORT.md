# SE_REBUILD_20260913 · FINAL_REPORT

- 交付时间：2026-09-13 19:50（接手 18:46，耗时约 124 分钟内含全部验证；按时间盒 120 分钟目标提前完成主要验证后收尾）

> **visual_accepted = false**（页面视觉与最终接受留给用户与 Codex 独立验收；本报告所有结论均附实测证据与未测边界）

## 1. 唯一预览 URL

**http://127.0.0.1:3467/v5-preview**（总览） · http://127.0.0.1:3467/v5-preview/remote-session（访谈）

- 运行副本：`jianwei-v3/se-preview-20260913`（白名单同步，非 worktree；node_modules 以 junction 复用 site 已装依赖，`turbopack.root` 指向 jianwei-v3 修复 junction 越根报错——仅预览副本的 next.config.ts 有此差异）
- 启动命令：`node node_modules/next/dist/bin/next dev -p 3467 -H 127.0.0.1`，环境变量 `V5_PREVIEW_DATA_DIR=C:/Users/22673/Desktop/Anthropic/V6/handoff/SE_REBUILD_20260913/runtime/data`（合成种子，与 3311/3321/3399 的数据完全隔离）
- 源/运行一致性：`qa/source-runtime-check.mjs` 白名单 22/22 文件 SHA256 一致（见 qa/SOURCE_RUNTIME_MAP.json，最终复核于 19:49）
- 服务器保留运行供用户查看；3311/3321/3399 及其数据全程只读未动

## 2. 本轮改了什么（10 文件，详见 CHANGED_FILES.json；baseline/ 可按 manifest 逐文件恢复）

| Owner | 文件 | 改动 |
| --- | --- | --- |
| A | app/v5-preview/page.tsx | 仅重组 JSX（100dvh flex 根/紧凑横幅/demo控制收进二级）；恢复通道/版本门/轮询/情景确认等全部 hooks 逐字保留 |
| A | rows-view.tsx | 客户单行42px + 生命周期38px（名称右功能图标）+ 矩阵列头/四行；删旧进度条与页脚 |
| A | domain-row.tsx | 44px 网格行（域名+域图标+状态徽章在文字左侧 / 四步格与列头同模板对齐），整行 button 展开 |
| A | chat-panel.tsx | flex:1 常驻 + 工具行含尽调入口 + 消息内部滚动 + 输入常驻；**顺带修复既有缺陷**：draft:chat 键此前只读不写（刷新即丢），现已真正持久化 |
| A | todo-card.tsx | 52px 两行紧凑（右时间如实"未设置/暂无估计"——TodoItem 无时间字段，不伪造）；PendingNoteRow 折叠区外 |
| A+MAIN | se-icons.tsx（新） | 18 个细线 SVG：四域复用 V5 快照原形（尺子/盾牌/合同/钻石）+生命周期4+管线4+状态4+Chevron/Video |
| A | se-overview.module.css（新，~630行） | .seOverviewRoot 作用域；连续面板/4px分隔带/359px与700px与600px断点/reduced-motion |
| B | remote-session/page.tsx | 同视觉语言重构（紧凑顶部48px/连续面板/dock常驻）；逻辑块逐行保留；新增"转人工"按钮（escalate_human 确在服务端 REVIEW_ACTIONS 白名单，走既有 runWrite('reviews') 不可变路径）；删三处死代码 |
| B | camera-panel.tsx | 仅类名替换（逻辑零改动） |
| B | se-interview.module.css（新，~630行） | .seInterviewRoot 作用域 |

未改：preview.module.css（保留——既有测试对其做字面断言，全过；其旧类已无人引用，清理留待后续）、api-client.ts、rows-logic.ts、lib/**、app/api/**、test/**、package/lockfile。

## 3. 三项关键使用动作（全部实际执行过）

1. **看懂总览**：375×667 下一屏同时出现客户/生命周期/四域矩阵/待办/沟通+输入；四域行逐行实测与视口交集非空（不是只测外框）。
2. **往返访谈**：总览写草稿→展开信审行→收起→经沟通工具行进入访谈→发起关键问题→暂停（"已暂停"+服务端阻断说明）→恢复（"进行中"）→返回总览，**草稿完整保留**、消息发送后刷新读回一致。
3. **诚实状态**：待办右侧显示"未设置/暂无估计"（无时间字段来源）；视频"未接入/未配置"如实展示；暂停/失败不显示成功。

## 4. 真实通过（证据见 qa/capture/ 与 runtime/）

- **布局合同**：375×667 待办底 354px（目标350-370）/沟通含输入 300px（目标290-310）/四尺寸无横向溢出（375/391/430/352）/四行全可见/展开 hit 44px。
- **交互性能**：30次展开/收起 p95=0.2ms（同步 dispatch+强制布局代理指标，目标≤100ms）；首载到内容 493ms（before 646ms，同实例同数据）；60秒静置 12请求/44.3秒=精确4秒轮询，**无新增空闲请求/无持续动画/无 backdrop-filter**。
- **行为回归**：qa/behavior-regression.mjs 最终 8/8（116断言，幂等/409/NOT_FOUND/NO_OPEN_TODO/终态复位）；既有源码断言测试 55/55（重构前后一致，未删测未放宽）；tsc exit 0；限定 UI 文件 lint 0 错误；`npm run build` exit 0（两路由均产出）。
- **访谈页实测**：空态/会话建立/发起问题/暂停/恢复/相机面板动作全在线；375×667 无溢出、dock 常驻。

## 5. 失败/未测/偏差（如实）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 既有13文件150个HTTP测试 | **环境阻塞** | 测试harness硬编码起服务端口3399且拒绝外来实例（受保护PID 17620占用）；属环境约束非产品回归；其中不需服务的4文件55/55过 |
| 真320×568浏览器实测 | **NOT TESTED** | IAB注册下限320物理=352CSS（DPR锁0.909）；以352×626近似通过（触发总览359px降级分支：溢出0/四行可见/输入+发送+尽调入口可达）；访谈页340px分支未触发 |
| 阅读位置/域行展开态跨路由保留 | **部分** | 草稿跨往返完整保留（已修复持久化）；消息滚动位置与域行展开态在路由往返后重置（当前2-3条演示消息全量可见，不丢内容；如需保留需新增存储键，留待后续） |
| after 冷载传输字节 | **不可测** | 浏览器进程共享HTTP缓存，新标签也命中；仅报增量（js 5.7KB/css 0.6KB）与before冷载（js 945KB dev） |
| C的rect-measure.js全脚本 | **方法替换** | 在IAB内卡于rAF不产帧（页面visible但窗格不连续绘制）；改用MAIN等价直接测量（同步布局强制/资源条目/node侧双点采样），数据在 runtime/after-capture/ |
| 软键盘/Safari/真机 | NOT TESTED | 按包边界不投入专项工程 |
| 玻璃效果 | 未做（P2按合同"可用可不用"明确省略） | 全页无 backdrop-filter |
| before四尺寸full采集 | 跳过（偏差已记录） | 旧代码segToggle≤480px隐藏，采样必跳过；已采375×667核心before指标 |

## 6. 遗留问题与恢复范围

- **恢复**：对10个改动文件按 BASELINE.json manifest 核对后从 baseline/ 逐文件覆盖即可（恢复前先保护当时diff）；2个新CSS+se-icons可直接删除；预览副本整目录可删（不影响site）；junction 删除用 rmdir 不递归。
- **已知架构遗留**（本轮不扩）：sessions[0] 选会话、rows-store/remote-store 分离、后端 P1/P2——见下节。
- **演示数据状态**：rows-store 已复位 approval 种子（v28/待补充/2消息）；remote-store 留有一个含开放问题的合成访谈会话（供演示，均为合成数据）。

## 7. 主任务截图审查结论

375×667 总览与访谈页均经视觉核验：连续面板/窄分隔/名称右图标/状态左彩色徽章/列头带图标/待办双行如实时间/沟通完整可见，无溢出/重叠/异常截断。与第三版效果图意图一致；细节接受度（配色/密度/字重）**visual_accepted=false** 留给用户与Codex。

## 8. BACKEND_NEXT（一页；不继续开发后台）

- **实际路径**：普通聊天 = UI→api-client→/api/v5-preview/messages→service.postMessage→rows-store.json（只追加人工消息，不接模型）；访谈模拟追问 = UI→annotations/simulate→remote-service.simulateFollowUps→createBridgedModelAdapter()→默认模拟transport→remote-store.json。两者均为模拟，不冒充真实API。
- **真实模型最小接入所缺**（资源未确认前只做准备，不猜账户不读凭据）：①真实 provider/model/密钥交接（JIANWEI_MODEL_API_KEY，非coding runner键）；②小批量验证预算执行条件（已有每批≤50万tokens授权上限）；③http-json/dify-workflow 候选的实际配置验证。最小验证=一个合成问题的真实回复+引用+人工纠正+保存再读。
- **R4 CR 现状**（源码结构核查）：CR-1 产品桥 productAction 仍取 primaryStatus、partial 只复制 replies 不消费 failureReason、stateProbe/gate 未接；CR-2/CR-3 对应结构仍在。本轮前端重构未触碰。
- **建议的下一个 checkpoint（唯一）**：真实模型小批量验证（上述最小验证闭环），其余后台事项不扩。

---
*成果认定对照：可复现行为（qa/脚本+截图）、可见改进（before/after对照）、回归未破坏（55/55+8/8+build/tsc/lint）、诚实边界（第5节）。*
