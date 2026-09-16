# SE 前端接管：独立核查与首个检查点

日期：2026-09-13。Owner：Codex / V6-DEEP。状态：诊断与文件保全完成，产品代码尚未修改。

## 最新授权

用户明确“用你自己的浏览器”“右侧！内置！se尺寸响应式”，随后要求“可以根据不同机型适配，你现在接管前端重构工作”。本轮前端 writer 改为 Codex；覆盖此前 ZCode 独占全部产品代码的前端部分。后台、API、模型、相机控制器不因此转交。没有给 ZCode 发送指令、新 Goal 或创建子代理。

右侧内置浏览器已显示现有产品，实测 innerWidth/clientWidth=375、innerHeight/clientHeight=667、DPR≈1。这是 SE 尺寸的 Chromium 响应式预览，不是真机 Safari。结束保持尺寸。此前读取了用户 Chrome 页面，未点击/刷新/改尺寸；用户纠正后停止读取该 Chrome 页。

## 当前已证实事实

1. SE 总览首屏仅政策行完整可见，其余三域在主区内部滚动。整页 scrollHeight=667 不等于关键内容都可见。当前待办“补充说明”按钮 y≈726，超出首屏。聊天输入 y≈605、高44，首屏可见。
2. 顶部仍有演示情景选择器、重复演示标记与项目说明。小屏样式把 `.segToggle` 设为 display:none，四域展开入口不可用。见 app/v5-preview/preview.module.css:573–640、domain-row.tsx。
3. SE 访谈入口先进入问题/文字表单，当前显示“本轮已暂停”；视频未接入。全屏另有入口；源码的“挂断”只 setFullscreen(false)，不会返回总览或调用服务端暂停，也不直接调用相机 dispose。见 remote-session/page.tsx:647–696。此项是源码确认，未通过操作现有会话验证。
4. 项目沟通 UI → api-client → /api/v5-preview/messages → service.postMessage → rows-store.json，只追加人工消息，不调用模型。见 service.ts:399–445。
5. 远程追问 UI → annotations/simulate route → remote-service.simulateFollowUps → createBridgedModelAdapter() → 默认 createSimulatedTransport → 四角色回复 → remote-store.json。不是实际模型推理；普通聊天和访谈回复是两套存储。会话入口选择 sessions[0]，不是基于当前项目ID选择。见 remote-session/page.tsx:164–174。
6. 产品桥 CR-1 现状仍在：productAction 取 primaryStatus；service 对 partial 只复制 replies，不消费 failureReason。调用点仍未传 stateProbe，桥 options 未提供 gate。A 报告的待修项不能因其测试通过而标完成。
7. 真实视频 provider=none/state=not_configured；ASR 未接入；相机本地预览与视频多人连接是不同能力。当前没有把本地照片送真实视觉模型的已验收链路。模型 http-json / dify-workflow 候选文件存在，不证明配置或接入成功。
8. 监听核对：3311 PID4060、3321 PID31860、3399 PID17620；本轮未停止、重启或修改数据。现有页面 chunk 使用 `_v6-runtime` 路径，活动 app 与运行副本需分别识别；不能直接拿新源码的测试替代旧运行页验收。

## ZCode 四路最新文件判断

| 路 | 文件自报 | 本轮核查结论 |
| --- | --- | --- |
| MAIN | STATUS 内容标17:05，81回归、build/typecheck过，A/C CLOSED | 有实质接线成果；“六项闭环完成”超出独立证据。lint1043错误归属仅为执行者自报，未独立复验其基线归因 |
| MODEL | 16:52 READY_FOR_REVIEW，222测试，P1/两项P2待MAIN | 当前源码仍保留 CR-1/2/3 对应结构。真实模型调用0；未重跑全部222测试 |
| CAMERA | 16:32 READY_FOR_REVIEW，产品副本105测试过；运行时BLOCKED | 控制器单测与实际页面资源释放不可合并宣称通过；本轮未开启真实设备或重跑105测试 |
| EVAL | 16:06工具冻结，MAIN输入0/3、量测0/1 | 文件状态滞后。当前输入包实际为3轨迹+1量测+2图；独立运行 inputs-check exit0但三条回执均BLOCKED。main-export副本回放各4 PASS、6 N/A，exit0 |

独立回放未执行的六类：R-PRE、R-HUMAN、R-HANG、R-LATE、R-DUP、R-CORRECT。无 timeline 导致多项 N/A，不能声称挂断、迟到、纠偏完整闭环通过。inputs-check 的 exit0只反映文件数量足够，不反映逐轨迹接受。

## 首个可见检查点（待基线门解决）

单一目标：SE 总览同时看懂客户、生命周期、四域状态，并可直接沟通与进入尽调。先交这个实际页面由用户验收，再推进访谈页重构。

- 第一行左客户名称、右项目编号。合成标记精简保留；演示切换收进二级，不出现在主操作行。
- 生命周期一条四段，区分已完成/当前/未到达，不作为任选阶段按钮。
- 政策/信审/商务/资产各一条紧凑可展开横行，四步接收/处理/协同/核验；解释与当前待办按需展开，保留现有数据语义。
- 沟通使用剩余空间、消息内部滚动、输入可见；尽调入口放在沟通附近。基于 flex/grid、可用高度与窄屏断点适配，不靠缩放字体伪造一屏。
- 本检查点拟写：app/v5-preview/page.tsx、rows-view.tsx、domain-row.tsx、chat-panel.tsx、preview.module.css；必要时 todo-card.tsx 的呈现部分。API client、rows-logic 的请求/版本逻辑保留。
- 本检查点不写后台、schema、模型或相机控制器；不宣称真实模型、视频、iOS通过。
- 检验：现有相关回归、类型检查、限定文件lint、可运行预览；SE 375×667与较大手机尺寸测量，展开/收起、输入与阅读位置/草稿验证。返回右侧375×667保持。产品视觉接受由用户决定。

## 恢复基线与硬门

HEAD=63c41c3（V3归档）。当前V6 app/api/lib/test大量未跟踪，dirty状态包含用户和历史修改。没有当前V6的精确 Git commit/tag 基线；不能静默提交全部脏树。

本目录 baseline/ 保存71个相关源文件、测试及配置；BASELINE_MANIFEST.json 逐文件SHA256复制前后核对一致。GIT_STATUS_BEFORE.txt记录开始状态。未包含凭据、node_modules、构建缓存或运行数据库；它是范围内文件恢复快照，不是完整部署备份，也不是 Git baseline。

回滚方法：仅对本轮实际修改文件先保护当前diff，再按manifest核对并从baseline逐文件恢复。此文不授权自动覆盖未来其他writer修改或删除文件。

项目用户指令要求“大改版在 baseline commit/tag 前是 hard Gate”，文件快照不等于Git基线。本次前端重构动代码前需用户明确：允许本轮以该已核验文件快照替代commit/tag门，或另行授权精确Git基线。尚未代作该决定。

## 真实能力后续验证边界

真实模型：接入方向与每批最多50万tokens已有文档授权，但服务入口仍固定模拟。实际provider/model/密钥交接和预算可执行条件未确认；本轮未读密钥、不调用。最小后续验证为一个合成问题的真实回复、引用、人工纠正、保存与再读，先判质量再扩六角色。

视频/多人：未见已接通供应商、信令与媒体链路；需要核清服务账户、费用和参与设备。最小验证为两台明确设备主动加入/退出同一房间，不以参与人列表替代实际连线。

ASR与视觉：分别核对可用服务和费用；文字输入、合成字幕、本地相机预览不等于识别通过。仅授权素材才可发送，失败不形成业务事实。

iOS/HTTPS：当前只验Chromium 375×667；没有真机Safari、安全来源、键盘遮挡或网络切换证据。后续需用户可访问的获授权HTTPS地址与设备；部署授权尚无，不先部署。停止条件为缺账户/费用/地址/设备或不可用时明确保留未测。
