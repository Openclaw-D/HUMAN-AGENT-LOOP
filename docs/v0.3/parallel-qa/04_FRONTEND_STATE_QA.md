/goal

任务：V0.3-Z4 前端状态独立回归。工作区 C:/Users/22673/Desktop/JW。

输入只读：Front/site-mirror/app/takeoff/、app/workbench/、lib/workbench/，Front/preview/test/既有行为测试，docs/v0.3/UI_STATE_PATH_AUTHORITY.md。
唯一代码写入范围：C:/Users/22673/Desktop/JW/Front/preview/test/zcode-v03-state/（新建独立测试）。唯一报告范围：C:/Users/22673/Desktop/JW/docs/v0.3/parallel-qa/results/frontend-state/。FRONT独占前端产品源码/dist/package.json，不修改它们，也不运行build覆盖dist。其他writer修改保留。

沿用已有jsdom测试环境，只补四个有判别力的场景：
1. 未开始/缺前置不是running；计时器及开锁动画不能自行推进业务，只有实际running扳手旋转，明确失败才红叉，真实完成才绿勾。
2. 首次snapshot异步到达，合法当前候选最终能读回；过期候选不因重新渲染变有效。
3. 切角色/客户后旧候选、材料和上传绑定不可串用；退出/撤权不能残留可操作旧状态。
4. 没有有效上传授权时按钮不能因已有completed任务而解锁；导航“下一步”不能偷偷发审批、上传或模型请求。

请求替身仅用于UI单测，严格拦截外网；不得访问48214、不调用真实模型、不操作用户浏览器、不改viewport、不安装依赖。测试前后记录相关源码hash；若FRONT中途修改，标该项待在新版本复验，不循环追跑、不把旧版本通过算新版本通过。
验收：每项具体断言、独立可运行测试命令、日志/退出码、REPORT.md；测试失败报告最小复现，由FRONT修复，不能修改产品代码或放宽断言。单测不冒充浏览器/视觉验收。集中交回一次。
