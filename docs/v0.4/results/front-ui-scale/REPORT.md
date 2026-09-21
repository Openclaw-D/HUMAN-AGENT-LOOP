# UI 比例切片
固定验收契约：1920×1080、100% zoom，CSS 响应式，不整页二次缩放。
已修改 desktop-frame.tsx、compact-workspace.css、takeoff-screen.tsx、takeoff-assistants.tsx、assistant-observation.tsx；更新 Front/dist。
验证：npm --prefix Front run typecheck / build 通过；visual-workspace.behavior.test.mjs 14/14；chat-toolbar.behavior.test.mjs 2/2。未调用真实模型或发送真实聊天。
浏览器限制：viewport.set 与 Emulation.setDeviceMetricsOverride 已请求 1920×1080，但 Page.getLayoutMetrics 仍报告 CSS 1333×750、zoom 1.440000057；画布 matrix(1,0,0,1,0,0)。Control+0 未生效。运行视觉验收未通过，需预览宿主将页面 zoom 调回 100%。
功能遗留：语音、电话、扫码禁用；Agent 自动转交未接通。长按 @ 与消息 UI 已实现，但未验证真实模型回复。普通消息仅发送内部线程，未完成历史线程加载。
后续 DEMO_12_CLICKS.md 已读取：三客户四步共十二次展示推进、约五分钟。当前 UI 比例切片未验收，尚未进行展示步骤适配；不冒充已经完成。
没有启动或停止服务，没有委派/操作其他任务，无 commit/push。
