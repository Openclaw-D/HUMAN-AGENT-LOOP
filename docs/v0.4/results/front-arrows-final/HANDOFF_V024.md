# V0.24-FIX 串行交接

2026-09-21，按最新转交决定立即停止。未继续差例、未重复测试、未操作其他任务。

## 本轮已改（Front 唯一 writer 已释放）

- Front/site-mirror/lib/workbench/advance-client.ts：增加 affectedDomains、needsReselection、dependencyChange 类型，保留逐列 basisVersion 独立校验。
- Front/site-mirror/app/takeoff/column-advance.tsx：nextRequired 根据服务端 needsReselection 与真实 waiting_evidence 回执定位下一待办；采用后回到政策重评项而不要求用户左绕；补证事件刷新并定位影响域。不实现联合采用，不自动采用新候选。
- Front/site-mirror/app/takeoff/round-supplement.tsx：按钮“登记补件并重评”；登记成功后调用真实 credit plan/advance，定位 plan.affectedDomains 首项。localStorage jw:round-supplement:<cid> 在提交前存整个合成补证body、原件ID、requestId和阶段registering/registered/advancing；显式继续恢复保留同ID同内容，登记成功不重登，推进未知仅按原ID读取。存储不含凭据。推进还写既有 jw:column-advance:pending:<cid>，由主箭头恢复读回。
- Front/site-mirror/app/takeoff/materials-desk.tsx：回执明确引用的材料即便不在最新清单仍显示，使用冻结content预览；不会用新原件内容替代旧引用。
- 相关测试：Front/preview/test/behavior/{column-advance,round-supplement,round-views}.behavior.test.mjs。
- Front/dist 已构建，当前 index-C2F0yLVb.js / index-D6okZ2dJ.css。最后构建后只追加一个测试，无代码变动。

## 已验证

- typecheck、build通过（既有dynamic-import警告）。相关18项通过；另加“最新清单缺失仍预览冻结材料”1项单独通过。未跑全套。
- 新组 dependency-v1-20260921，入口62032，隔离五专业审核员；全程页面办理，没有HTTP补件、没有重置种子或真实模型调用。
- 好例：1启动+业务/政策/信审/商务/资产5次明确采用=6核心右箭头，真实钻石终态v27。之后1次只读左回商务，四页核对：材料5份v27、决策含arrow-reviewer、流程含arrow-local-service。没有追加业务执行。
- 中例：1启动、2采用业务、3采用原政策，进入信审waiting_evidence。打开补材料，输入200000、合成核验说明、勾选确认，点击1次“登记补件并重评”；真实重评政策/信审并自动定位政策。4采用新政策、5采用新信审、6采用商务、7采用资产。7次核心右箭头，0次办理绕回，另有补件开/勾选/提交/关闭4次控件操作及2项文本输入。比好例多一次新政策明确采用，未用联合选择压次数。
- 中例最终v36，terminalEventId=8cce1a08-6fa8-499b-860b-a0e7178375ce，at=2026-09-20T23:28:50.246Z，第2轮，真实钻石。末次已只读左回两次至信审，平台/材料/决策/流程全部核对：材料4份v36，决策真实arrow-reviewer，流程真实arrow-local-service。浏览器证据最后一个medium对象为有效最终四页。
- 中例第一次四页尝试未成功（内置浏览器缩放使鼠标落点不准、终态弹层仍在），已改用定位器键盘Enter完成实际四页，不把失败尝试当通过；原始证据保留。

## 未完成 / V0.24 接续注意

- 新差例尚未进入与执行；需干净页面拒绝/归档及四页核对、刷新和迟到结果。
- 本轮补证未知请求刷新恢复有remount定向测试，未做真实网络丢包/刷新实测；中例正常路径无失败。未完成全部客户切换/真实刷新/位置不变复核。
- 中例7次不是5–6次；多出的明确新政策采用有真实依据，联合选择尚未实现。下一执行者不得把7次虚称6次或抹去旧选择。
- nextRequired 待办定位已正常跑通好/中；终态右箭头、未采纳/失败与其他导航组合仍需针对性审查。恢复补证遇确定4xx目前保留原body，用户只能继续核对，未做编辑/取消UI。
- 未新增旧attempt选择器。冻结材料ref缺少文件元数据时展示结构化content，尚未完整测试带文件字节/connector引用的回执原件。
- Chrome工具连接报native pipe closed，listBrowsers仅IAB可用。本轮用自建IAB tab6；其继承缩放1.44。CDP设置1920x1080后实际CSS1333x750，不能声称本轮1920/100%通过。随后已clearDeviceMetricsOverride。
- good-terminal.png是CDP缩放异常截屏（钻石被放大裁切），不能作为合格1920布局证据；medium-terminal.png为普通IAB截图889x500，可见真实办结文字和钻石，非1920证据。browser-evidence.json留存DOM和操作状态；首次medium四页对象无效，最后medium四页对象有效。
- 未生成最终REPORT，因为用户要求立即移交；本文件为本轮实际状态，不等于最终验收。

## 归属与释放

临时IAB tab6已关闭。旧本任务Chrome357787873和IAB5在上一轮已关闭。未操作原48214预览或原用户标签。Back所属62032/A实例继续运行，未停止/重启；本轮未创建后台测试或服务进程，所有测试/build命令已结束。无其他任务操作、无commit/push/worktree/subagent。证据保存后停止所有代码与文档写入，交给V0.24-FIX接续。

RELEASED_FOR_V024
