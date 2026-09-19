# 任务一（客户办理前端）· NEXT_ACTION

## 下一小片（按顺序）

1. **合流环境页面复测**（依赖任务04：A 数据库 up、固定快照栈起）：
   - 登录（受控身份）→ 客户目录 → 新建客户（断言：网络面板 openCustomer 仅一次）→ 工作本。
   - 换身份最近访问、撤权（onAuth 终态回登录）、以标识打开无权 ID（404 诚实显示）。
   - 客户门户上传：确认框对账编号；结果页 requestId 回执查询；材料"已登记（待处理）"。
   - 方案页：Gate/运行/规则版本自动读取；勾选材料冻结；域意见登记（运行下拉）。
2. **与任务03合流后复测目录搜索**：同词按名称与标识各搜一次，确认 A 目录服务端匹配与提示文案一致。
3. **与任务02/04对齐统一上传链**（见 INTERFACE_REQUESTS.md IR-T01-1）：后台就绪后把门户上传确认文案与"我的材料"状态展示接到真实处理进度，去掉"已登记（待处理）"默认态描述中的未接入措辞。

## 遗留与边界

- 训练演示（v5-preview 本地模拟）未动，符合任务边界。
- customer-workbench 整页容器（标题/侧栏/聊天）未改造嵌入地图布局——按任务书"适度分离"，本轮只保证 openCustomer 入口统一与代际守卫，容器改造留到地图接入轮。
- logout 清理最近访问桶的接线（use-workbench.ts 调 clearRecent）为代码审查+typecheck 验证；行为测试覆盖了按身份分区与 recent-store 单元，真实 hook 级 logout 用例待合流环境页面复测覆盖。
- 本任务新增 devDeps（jsdom/@testing-library/*）仅测试用；node_modules 不进 Git，package.json/lock 变更随本任务交付。

## 交接状态

- 四份文档（CURRENT_STATE/NEXT_ACTION/TEST_RESULTS/INTERFACE_REQUESTS）随代码同步维护。
- 未 commit：等待合流/验收后由用户或授权流程统一处理。
