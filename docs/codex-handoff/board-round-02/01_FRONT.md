/goal
你负责下一轮任务01：复用真实工作本，交付业务视角横屏二维作业看板。
工作根：C:/Users/22673/Desktop/JW。先读取 AGENTS.md、docs/codex-handoff/NORTH_STAR.md、docs/codex-handoff/board-round-02/REVIEW.md，再读本路现有 docs/v02-remediation/task-01/ 记录。不要加载整个历史。
本地已是多路dirty工作区，HEAD当前检查为8dcef63；开始时重新确认，保留所有已有成果。每文件单writer，无worktree、reset/clean、commit/push、真实GLM/客户/付款/部署。不要删原型或测试资源。所有修改都在本JW目录。
最高产品范围已改：业务视角横屏二维作业看板，以卡片、节点、少量图标文字和顺畅展开交互呈现；非表格主界面，不做3D/地图/办公室/手柄/游戏化/贝叶斯概率。本轮不继续世界原型。
案例为喀什客户500万元邦德激光设备、申请融资500万元；只是案例参数，不等于政策批准。生命周期商机/尽调/政策/信审/商务/资产至结清，不强行把职责画成不可并行的流水线。
共用接口由03维护Back/CONTRACT.md，各路只在本路INTERFACE_REQUESTS.md提出请求，不交叉写入。独立部分可并行；接口确认、消费及最终装配必须按依赖串行。并发不足优先02、03、04，01随后接入，不因凑四路让02再次饿死。
本路产出放docs/codex-handoff/board-round-02/task-01/：CURRENT_STATE.md、NEXT_ACTION.md、TEST_RESULTS.md、INTERFACE_REQUESTS.md、EVIDENCE_INDEX.md。区分代码完成、组件测试、真实页面、执行者自验和用户验收；NOT_RUN/BLOCKED不能计PASS。

Ownership：Front/**及本路文档，独占Front/dist、package.json和lock。不可写Back/**和其他路文件。
先接续现有51项组件通过成果，保留客户隔离、稳定requestId、真实来源、错误恢复。不要从jianwei-world-prototype移植业务状态，不把训练模拟重新包装成真实办理。
已定位视觉参考：Front/site-mirror/app/v5-preview/home-overview.tsx及home-overview.module.css（上部业务信息/四域，下部沟通待办）；真实容器为app/workbench/customer-workbench.tsx（顶部、主区、右栏、底部）。只借布局/组件，不恢复旧模拟数据源。无法确认用户指的是哪版时，先给一张真实运行截图说明所选布局，不能声称已找到用户指定版本。
实现单一客户/项目上下文：顶部摘要；主要区域当前事项卡与简洁阶段概览；右侧按需显示选中事项的依据/版本/动作；沟通或待办可折叠，别固定吃掉半屏。默认业务身份，其他岗位表现为责任与意见，不要求业务切换五身份办理。保留受限客户门户。
图表不是此轮目标：不强行上复杂泳道编辑器，不铺满节点连线，不造概率。二维意味着清楚的空间分区和交互，不禁止详情中的必要字段。动画只用于展开/状态更新/焦点转换，支持减少动态效果，不使用定时假完成。
重点合流：按任务02方案R与04接口让客户一次提交原件，自动进入处理并回写A；去掉要求用户选A/Connectors、复制内部ID或重复上传的步骤。契约未交付时诚实阻断，不靠改文案当修复。消费blocked/unknown/aRegistered/bridgeState与稳定回执，提供同号对账恢复。
所有可执行动作由实际权限/状态支撑；浏览阶段和历史不改变业务状态。采购金额与融资金额分开，不能用客户授信额度冒充项目融资。后端没有的起租/租后/结清完整能力标未支持，不用本地状态编造。
验证：51项必要回归及新增真实用户行为测试、typecheck/build；在合流栈实际从业务目录打开客户，客户上传一次→业务看到处理→查看材料/补证→退出重进。截图核对常用横屏尺寸的可读性与滚动，无需改用户已有浏览器视口。最终更新dist。需要后端时记录依赖，独立UI部分先完成。
