# 验收清单

- [ ] 顶层只有政策、信审、商务、资产，顺序正确。
- [ ] 每个板块只显示五个集中配置的候选流程；切换板块不会同时平铺二十项。
- [ ] 矩阵/关系图谱读取同一 `FinancingLeasingCase` Projection。
- [ ] Chatbox 成功返回 `caseId/messageId/status/answer/evidenceRefs`。
- [ ] 空态、加载、错误、禁用态均可触发。
- [ ] P2 后 Chatbox 请求实际经过本地 HTTP route。
- [ ] 1920×1080 与窄屏无意外横向溢出；控制台无 error。
- [ ] 自动测试、build、HTTP smoke 均通过。
- [ ] 无真实模型/API/业务数据/密钥访问，无项目外写入，无残留服务。
- [ ] 60fps 只在实测后报告；否则保留为待验证目标。
