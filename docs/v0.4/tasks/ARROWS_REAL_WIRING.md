# 左右按钮真实接线：从契约转入实施

用户再次明确要求修好左右操作，前后端共同作用。主协调已核对当前源码：takeoff-screen右键disabled，左键只开timeline；wb-client/server未有advance接线。不得继续把文档、样式或禁用按钮当功能交付。

语义：右键明确执行下一专业整列，已有有效结果则复用，不重复付费或写入；左键读取上一专业整列的持久结果，不回滚业务、不重发原动作。两者更新当前列的结果与四页关联状态，页面/路由/滚动/缩放保持。用户若继续指定左键也执行新业务动作，再按新动作定义修改；本轮不猜测逆向撤销。

## Back：实际后端实施
本轮由现有Back可见任务单一writer直接处理此特定前后端联动阻点，沿用户此前“复杂问题自己改”的本轮授权；不扩大为其他后端工作，不派工/subagent。先读取 event-advance-contract/CONTRACT.md、IMPLEMENTATION_MAP.md、FOUR_PAGE_SYNC.md、THREE_CASES.md 并核对当前源码。这些文档列的功能未实现，不能作存在事实。
第一闭环仅当前合成客户一个专业列的真实动作→持久round/result→GET恢复→后列实际任务状态，不一口吞所有生命周期。实现真实能力后逐列复用同一机制，不让前端fake进度。合法命令不足、service委托不存在、需要新业务政策时如实阻断具体动作，禁止伪造结果或借用凭据。
ownership：可新增 Back/A/src/domain/advance-round.ts 及独立测试、Back/Edge/src/advance-round.mjs及测试、Back/B/src/worker/column-runner.mjs及对应测试；报告 docs/v0.4/results/arrow-wiring-back/。共享A kernel/http注册、Edge server/proxy/readproxy及必要持久迁移按IMPLEMENTATION_MAP所列最小范围串行完成；编辑前核对当前diff与R2交付情况，若相关writer未明确释放，不改共享入口，先交独立模块。禁止改正在由R2写的messages/store/model/decisions/upload适配模块及Front。
持久表新增仅限本地可撤销schema增量与隔离测试库，不对共享运行数据库自动迁移，不改身份/服务委托/核心配置。真实运行装配如依赖这些变更，精确报告对象与命令，不能暗中实施。不得真实GLM调用。
必须有GET当前计划/当前及历史列结果和POST推进的实际HTTP测试；幂等并发、unknown不重发、版本/权限、拒绝停止与后列调度皆按契约验证。最终输出精确已实现接口/命令/限制及运行实例是否已接通；测试实例成功不能声称用户页面已可用。完成后仅本任务交付。

## Front：左结果回看与右推进接线
本轮独占相关Front/测试/dist，保护用户UI。左键不再开通用历史抽屉，显示上一整列的已登记结果；右键接真实POST，并以GET/事件恢复当前列及后列状态。可以使用Back已交付的接口文件作为读取输入，但不读取其他任务或发消息。接口未存在前可先完成客户端与隔离测试，明确未接通，禁止计时器/假绿。
按钮正在处理要有清楚反馈和防重入；错误/等待/无权/缺前置要在按钮附近说明原因，不留只会点却无响应的入口。左无历史/右已终态有准确边界提示。刷新、客户切换、未知恢复和同ID终态更新必须验证。后端仍无可用运行入口时单列阻点，不宣称修好。
相关测试、typecheck/build、页面验收用自有隔离预览，禁止操作用户当前标签/viewport。不要把UI模拟测试称真实前后联调。完成报告 docs/v0.4/results/arrow-wiring-front/。

只允许上述单一后端writer和Front并行各自文件；所有执行任务禁止控制其他对话，不向主协调发消息。不得worktree/commit/push/真实数据出站/共享服务重启。不要自行等待轮询其他任务或运行整夜；无法装配时把实际完成与阻点清楚留在本任务，停止。
