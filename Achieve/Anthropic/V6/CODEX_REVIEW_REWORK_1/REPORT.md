# rework-1独立验收：有实质改善，尚未最终通过

日期：2026-09-12，约20:46–20:51。对象：`handoff/STABLE_DEMO_BATCH_2/rework-1/REPORT.md`（20:03交付）。本报告区分真实复现、代码审查与执行者自报。

## 结论

接受已验证的修复分支，保留现有成果；最终稳定性Gate不放行。仍有一个真实浏览器复现的P1草稿丢失分支，以及请求/情景归属检查接线缺口。下一任务仅闭合请求归属，不扩客户目录、目标看板、AI或中台。

## 独立验证

- 59/59测试通过：`node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview.test.mjs test/v5-preview-v6fix.test.mjs test/v5-preview-rework1.test.mjs`，exit 0。
- `npm.cmd run typecheck` exit 0；`npm.cmd run lint -- --ignore-pattern .v6-runtime/` exit 0，0 error、1条既有v4life unused变量warning。
- page、rows-logic、todo、chat、CSS、service、store这7个活动文件与`.v6-runtime`源码SHA256一致。活动目录含既有未跟踪代码，本轮不整理、不提交。
- 3321监听PID28460，3399监听PID14964。浏览器实测在3399的隔离生产模式；实际页面不含Open Next.js Dev Tools。没有重启/停止任何服务，没有改产品代码。
- 使用Computer Use浏览器能力和CDP，仅临时包装当前测试标签页fetch做发送前失败、真实回执丢失或延迟；未伪造服务端成功，未改React内部状态。以下为实际工具输出的整理，不冒称完整自动化日志。

## 已通过的代表性路径

| 路径 | 独立观察 |
| --- | --- |
| 消息已落账但回执丢失→刷新→确认 | 3399 v9发送，原记录包含requestId=1c4c24cf-b0a1-42c3-b25b-1fd289ab2c30、expectedVersion=9和完整文本；刷新后v10、6条消息；确认后仍v10、6条，恢复行消失、存储记录为null。 |
| 说明未达服务器→刷新→确认 | 起租后v11，POST前抛错；刷新后仍待补充、2条消息、确认说明入口可达；点击后v12、4条消息、资产待复核，恢复记录为null。 |
| 普通A在途→编辑B→释放A | v12发送A，回执扣住；编辑B再释放，v13、5条消息，B保留且出现“输入框保留的是发送之后的新内容”。 |
| 生产演示路径 | 3399实际完成消息和说明交互，无开发工具按钮；不是只读build日志判断。 |
| 390×844首屏 | 实测innerWidth=390、innerHeight=844，起租后默认待补充按钮top=773.78125、bottom=817.78125，首屏完整可见；截图已目视查看。 |
| 360/1920宽度 | 360×844的scrollWidth=345；1920×1080的scrollWidth=1920，无横向溢出。均桌面模拟，不是真机。 |

## F1 / P1：被阻断的B覆盖草稿关联，确认旧A仍会清掉B

定位：`app/v5-preview/chat-panel.tsx:90`及`:70`；`todo-card.tsx:113`及`:71`同类实现。

真实复现（3399）：

1. 审批v8、4条消息，发送“Codex RW1 A 原请求（合成）”；服务器成功返回后注入回执丢失，形成A未知记录。
2. 输入“Codex RW1 B 新草稿必须保留”，点击发送。
3. 页面正确阻断B，提示“本次未发送；内容已保留”。POST计数仍为1，证明B没有发送；服务器v9、5条消息。
4. 点击“确认消息结果”，A幂等确认成功，恢复行消失，**B输入同时被清空**。页面却仍保留“内容已保留”的旧错误文字。

根因：提交按钮处理器在获知此次是新发送/重放/阻断之前，已无条件把submittedRevisionRef改为B的修订号。恢复A时handleResolveSuccess读取的是这个“最近一次点击”的修订号，误将B当作A草稿。修订号防止了普通晚回执，但还没有与requestId绑定。说明通道源码同类问题，本轮未对说明的该分支作浏览器复现，不标已实测。

要求：清理资格属于确定请求及其原始草稿修订；阻断的新提交不得修改旧请求关联。确认A永远不能用B的修订号授权清空。两通道都补真实组件回归，不仅测试shouldClearDraftAfterConfirmation纯函数。

## F2 / P2：情景归属检查比较错对象，回执副作用未完整受所有权约束

代码审查定位：`page.tsx:237`调用`shouldApplyWriteResponse(next.scenario, sentScenario)`；辅助函数第二参数语义是currentScenario。正常旧回执的next.scenario与sentScenario本来相同，即使页面已切到另一个情景，这个检查仍放行。它没有比较`overviewRef.current.scenario`。版本门仍存在，所以**本轮不声称已复现情景翻回**；ZCode所称“同版本碰撞已由情景门解决”不能由当前接线支持。

同时：`:320/:367`先调用会设置冲突横幅的writeOutcome，随后才判断owner；`:396/:412/:418`恢复路径对notice/resolving的修改没有完整请求所有权保护。旧回执可能改变新操作的提示/忙碌状态。这里属于已确认的代码防护缺口，完整交错UI后果待专项行为测试。

要求：请求ID、草稿修订及情景切换生命周期先关联，再在success/catch/finally产生任何UI副作用前判断。不能只比较情景字符串（A→B→A），也不能靠更高版本通常会拦住来证明全部副作用安全。后端全局单调版本不允许放松；ZCode报告的seed版本碰撞需保留原始HTTP/进程/数据目录证据，区分实际服务端与注入产生的值。

## 证据与未验证项

- 新增11项测试仍主要是纯函数和源码接线断言；59/59不覆盖F1的真实交互组合。
- ZCode报告的实际396/429/2112视口不能标成精确390/360/1920通过。本轮已独立补精确宽度检查；真机键盘仍未测。
- 本轮未重跑build、完整HTTP损坏/重启矩阵，也未覆盖两类请求所有组合，执行者证据不能自动晋升独立验收。已有P1足以不放行，不重复构建掩盖缺陷。
- 控制台error/warn查询为空，仅限本次捕获。

## 现场

用户原3321标签页未改，3311未动；新测试标签页使用3399，初始审批v8，最终起租后v13、5条消息，保留带Codex标识的合成测试记录。通过UI确认切换时重置了此前3399演示记录，未改写ZCode旧证据。

临时fetch注入已撤除、页面reload、临时视口已reset；测试中的新草稿仅为合成内容。未部署、安装、改数据库、修改产品代码或代发ZCode。下一任务见`V6/ZCODE_REQUEST_OWNERSHIP_CLOSEOUT.md`。
