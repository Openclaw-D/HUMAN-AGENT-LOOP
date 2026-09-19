# 任务一（客户办理前端）· CURRENT_STATE

基线 main@8dcef63。范围：仅 Front/** 与本文档目录；Front/dist 由本任务独占构建。未 commit/push/切分支。
Codex 基线确认：Git 根 C:/Users/22673/Desktop/JW，HEAD=8dcef63 与任务书一致；既有 dirty（根文档、docs/codex-handoff、Back 部分文件属其他任务）未回退、未触碰。

## 已完成（六个已确认问题全部修复，均"代码完成+组件级用户行为测试通过"）

| # | 问题 | 修复 | 使能的用户动作 | 文件 |
|---|---|---|---|---|
| 1 | createCustomer 先 wb.openCustomer 再 onOpen（root-app 又 openCustomer），一次建档两次加载/订阅 | createCustomer 只走一次 `wb.openCustomer`（统一入口），不再调 onOpen；目录行/最近访问/标识直开均汇入同一入口 | 新建客户后一次性、干净地进入工作本 | customer-directory.tsx |
| 2 | 搜索框宣称名称/标识，A 目录实际只按 display_name | 与任务03对齐：后端已改同词匹配 名称+customer_id+legal_entity_ref（其 working tree 注释明确与任务一对齐）；前端提示恢复"按客户名称/标识搜索"并标注"匹配口径由服务端目录决定"；另加"以标识打开"直开入口（openCustomer 服务端裁决，404=无权或不存在），也是未来地图传入 customerId 的同一入口 | 目录找不到时，持标识者仍可进入正确客户；不被误导 | customer-directory.tsx |
| 3 | 最近访问 sessionStorage key 未分身份，退出不清理 | 新建 recent-store：key=`jw-wb-recent:{principalId}` 按身份分区；logout 清理当前身份桶；页面标注"打开仍由服务端裁决，不是授权" | 换身份/退出后不再看到他人客户 ID；授权仍由后台裁决 | recent-store.ts（新）、customer-directory.tsx、use-workbench.ts |
| 4 | 客户门户上传只进 A 档案却宣称"处理进度将可见" | 确认文案改为如实：上传=登记入档案，处理是否推进由后台能力决定，未接入时显示"已登记（待处理）"，不伪装 OCR/自动分析；originals-panel 上传确认同步加"登记≠处理"说明；门户仍只有单一业务入口（无 A/Connectors 选择、无令牌/映射要求） | 客户对上传后的真实状态有正确预期 | customer-portal.tsx、originals-panel.tsx |
| 5 | proposal-panel 要求手填 runId/packageId/规则版本/工件ID | 引用系统关联：Gate 回执、各域运行引用、规则版本从处理通道真实回执自动读取并显示来源；工件依赖改为从现行材料清单勾选（业务对象+期间+事实键+核验等级）；目标包/提案绑定固定为当前依据包；手工引用仅保留为显式折叠的例外路径；无真实回执时如实显示并禁用登记（不生成 Gate/运行/批准状态） | 普通业务人员不复制内部 ID 即可冻结依据包、登记域意见、提交提案 | proposal-panel.tsx、wb-logic.ts（collectRunRefs/pickedFactKeys 新增） |
| 6 | useAction 失败确认框保留但部分回调每次执行重新生成 requestId（客户上传等），未知结果后重试变新请求 | useAction 确认态固定 requestId 并在对话框展示"对账编号"块；失败/未知保留确认框、按钮转"用同一编号重试"；502/UPSTREAM_UNKNOWN 明确提示对账路径（A 动作→结果页；通道动作→材料页通道任务回执），不换号盲重；portal/originals/verify/result 各面板 requestId 全部提前到打开确认框时固定；verifyItem 补二次确认 | 提交成功但响应丢失时，用户可安全重试与对账，不产生重复请求 | wb-parts.tsx、customer-portal.tsx、originals-panel.tsx、verify-panel.tsx、result-panel.tsx |

## 统一打开入口与地图复用

- 唯一入口=use-workbench 的 `openCustomer(customerId)`：epoch 代际守卫已内置（切客户清快照/游标/去重集，迟到响应不覆盖当前客户；404/401/403 终态处置）。
- 目录页所有进入路径（目录行、最近访问、以标识打开、新建后进入）都汇入该入口。地图未来只需以已授权 customerId 调用同一路径（root-app 的 onOpen 接线即参考实现）。
- 工作本容器未改动（customer-workbench.tsx 布局保持），未新增第二套状态机，无无关重构。

## 验证状态（区分层级）

- 代码完成：上述全部。
- 组件测试（用户行为级，jsdom+RTL 真实渲染/点击/断言网络载荷；含真实 useWorkbench hook 的迟到响应/撤权用例）：51/51 通过，见 TEST_RESULTS.md。
- 联调（真实 Edge 17935，页面）：落地页/登录页渲染正常；无效凭据经真实 Edge 返回"登录失败"诚实错误条；dist 生产构建在真实浏览器正常启动。
- 页面验收（合流环境完整旅程）：**BLOCKED**——本机 Edge 存活但其 A 数据库 down（kernel-a: db ECONNREFUSED），登录后的目录/工作本旅程无法在页面复测；属任务04合流环境范畴。未伪造任何通过。

## 改动文件清单（全部在本任务 writer 范围内）

- Front/site-mirror/app/workbench/：customer-directory.tsx、customer-portal.tsx、proposal-panel.tsx、originals-panel.tsx、verify-panel.tsx、result-panel.tsx、wb-parts.tsx
- Front/site-mirror/lib/workbench/：recent-store.ts（新增）、use-workbench.ts、wb-logic.ts
- Front/preview/test/behavior/：tsx-loader.mjs、harness.mjs、directory/portal-upload/proposal-panel/workbench-hook 四个行为测试（新增）
- Front/preview/test/wb-logic.test.mjs：幂等编号断言更新为新契约；新增 collectRunRefs/pickedFactKeys 用例
- Front/package.json + package-lock.json：新增 devDeps jsdom/@testing-library/react/@testing-library/dom（测试设施）；test script 增补行为测试
- Front/dist/：由本任务重新构建（用户要求的发布文件）
