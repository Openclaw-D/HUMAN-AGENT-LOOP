# 任务一（客户办理前端）· TEST_RESULTS

执行环境：Windows，node v22.23.1，Front/ 目录。基线 main@8dcef63 + 本任务 Front 改动（未 commit）。

## 1. 组件测试（用户行为级 · node --test，49/49 通过）

命令：`npm test`（Front/package.json test script）。结果：**51 tests / 51 pass / 0 fail / 0 cancelled**。

新增行为测试（jsdom + @testing-library/react，真实渲染/输入/点击，断言组件发出的网络载荷与页面文案；不是与实现同构的辅助函数测试）：

### directory.behavior.test.mjs（3 用例）
- 新建客户只打开一次：填名称+编号→点"建档并进入"→ `createCustomer` 调 1 次、`openCustomer` 调用序列恰为 `['cus_new_1']`、onOpen 未触发第二次。
- 搜索口径一致：placeholder="按客户名称/标识搜索（回车）"存在且标注匹配口径由服务端决定；"以标识打开"入口把标识经 onOpen 统一入口打开（`['cus_direct_9']`）。
- 最近访问按身份分区：alice 的 `cus_a1` 不出现在 bob 的目录页；alice 打开目录行记入 `jw-wb-recent:alice`，不产生 bob 桶。

### portal-upload.behavior.test.mjs（3 用例）
- 文案如实：材料显示"已登记（待处理）"；`/处理进度将在/` 不再出现。
- 重试不换号：第一次确认→uploadOriginal 收 requestId R1→抛 502 UPSTREAM_UNKNOWN→错误条"后台结果未知"+确认框保留+"用同一编号重试"→第二次确认→同一 R1→成功后对话框关闭。
- 载荷稳定：kind/file.name/dataBase64 随动作固定，customerId 正确。

### proposal-panel.behavior.test.mjs（4 用例）
- 技术字段系统关联：Gate 回执 `gate_r9`、来源"处理通道任务回执"、规则版本 `sim-pack@7` 自动显示；现行材料按业务对象呈现（银行流水·2026-07·cash_balance），已取代材料不进清单；旧手填输入框（Gate/runId/包/工件ID）全部不存在。
- 冻结依据包：勾选材料→确认框显示 Gate 引用与"信审域×1件"→确认→`freezePackage` 载荷 `gateReceiptId='gate_r9'`、`domainDeps[0]={domain:'credit',artifactIds:['art_a'],factKeys:['cash_balance'],rulePackVersion:'sim-pack@7'}`（系统组装）。
- 登记域意见：运行下拉来自通道回执（run_credit_1）；确认→`recordDomainResult` 载荷 `analysisRun.runId='run_credit_1'`、`packageId='pkg_base'`（当前依据包）、`opinion.authority='none'`、`deps.artifactIds=['art_a']`。
- 无真实回执如实阻断：通道读取失败→"处理通道回执读取失败"/"未读到真实 Gate 回执"/"该域暂无已完成的真实分析运行回执"如实显示；登记按钮 disabled。

### workbench-hook.behavior.test.mjs（2 用例，真实 useWorkbench hook + 可编程 fake fetch）
- 切客户迟到响应：先开慢客户（workspace 延迟 250ms）再开快客户；慢响应迟到后不覆盖当前客户——`openCustomer('cus_slow')` 返回 false、`customerId='cus_fast'`、快照仍为快客户（epoch 代际守卫，地图复用同一入口的安全底座）。
- 撤权（客户不可读）：workspace 404 → 终态清客户（customerId=null）、错误条"已不可读（可能已撤权或被删除）"、phase 离开 live，不伪装仍在线。

### wb-logic.test.mjs（既有 24 用例 + 2 新增，全部通过）
- 幂等编号断言更新为新契约：`buildConfirmPlan(...).requestId` 携带编号（确认对话框统一渲染对账块），lines 不再重复。
- 新增：`collectRunRefs` 每域全部已登记运行引用（顺序+去重）；`pickedFactKeys` 勾选材料事实键去重。

### 既有回归（role-mock-adapter / edge-logic，17 用例）
全部通过，未被本任务破坏。

## 2. typecheck：通过

`tsc --noEmit -p preview/tsconfig.json` 0 错误（含 tsx 严格模式 noUnusedLocals）。

## 3. build：通过，dist 已更新

`vite build`：dist/index.html + assets（js 404.6KB / css 27.3KB）。`Front/dist` 为用户要求的发布文件，已用最终代码重建（旧 hash 资产被替换属预期）。构建输出中的 INEFFECTIVE_DYNAMIC_IMPORT 提示为既有状况，非本任务引入。

## 4. 联调 / 页面（真实浏览器，Edge 127.0.0.1:17935）

- 落地页（vite preview 3617，生产 dist）：正常渲染，真实办理/训练演示两入口。
- 进入真实办理→登录页：正常渲染；受控身份目录未配置时如实降级为凭据登录（"受控身份目录未配置：请使用下方凭据登录"）。
- 无效凭据登录：经真实 Edge 返回"登录失败"错误条，无伪装成功。
- **完整旅程页面复测：BLOCKED**——Edge 存活但其 A 数据库 down（healthz/ready: kernel-a db ECONNREFUSED；48320 未响应）。目录/工作本/上传/方案页面旅程待任务04合流栈后复测（见 NEXT_ACTION.md）。

## 结论

六个已确认问题：代码完成 ✓，组件级用户行为测试 ✓；联调仅入口/登录/错误路径可达；页面验收 BLOCKED 于合流环境 A 数据库，不冒充通过。
