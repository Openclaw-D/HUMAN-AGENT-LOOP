# 任务01（board-round-02）· TEST_RESULTS

执行环境：Windows，node v22.23.1，Front/ 目录。基线 main@8dcef63 + 本轮 Front 改动（未 commit）。
状态标记：PASS=实际执行通过；NOT_RUN=未执行；BLOCKED=受阻。**NOT_RUN/BLOCKED 不计 PASS。**

## 1. 组件测试（用户行为级 · node --test）：67/67 PASS，0 skip

命令：`npm test`（package.json test script）。

| 文件 | 用例 | 说明 |
|---|---|---|
| role-mock-adapter / edge-logic（既有回归） | 19 | 全部通过，未被本轮破坏 |
| wb-logic.test.mjs | 24 | 既有 21 + 本轮新增 3（见下） |
| directory.behavior.test.mjs（既有） | 3 | 新建只打开一次/搜索口径/最近访问分身份——保留通过 |
| proposal-panel.behavior.test.mjs（既有） | 4 | 技术字段系统关联/冻结依据包/域意见/无回执阻断——保留通过 |
| workbench-hook.behavior.test.mjs（既有） | 2 | 切客户迟到响应代际守卫/撤权终态——保留通过 |
| portal-upload.behavior.test.mjs（**按方案R契约更新**） | 5 | 材料阶段如实显示；无绑定诚实阻断（禁用+引导，不降级）；一次性绑定（intake/accept 载荷）；502 同号重试；载荷稳定（invitationId/kind/字节） |
| originals-unified-upload.behavior.test.mjs（**新增**） | 3 | A 直传表单移除+未绑定诚实阻断；绑定→一次上传（invitationId 随载荷）+A 清单自动刷新；502 同号重试 |
| board.behavior.test.mjs（**新增**） | 4 | 看板默认=事项卡+阶段条（结清未支持）+金额分列（不用授信额度冒充采购）+blocked 摘要；点卡进面板/右栏切换/返回；沟通默认收起可展开；customer-only 仍进受限门户 |
| result-reconcile.behavior.test.mjs（**新增**） | 3 | A 回执 found/未命中；通道对账 found/未命中指引；404/503 对账口不可用如实显示 |

wb-logic 新增投影用例：
- 通道任务 `blocked_link` 等待态文案与 `A_CUSTOMER_NOT_IN_A` 失败码业务语言；`aRegistered/bridgeState` 逐任务映射。
- **诚实性核心：status=done 且未回写 A → 「本地完成（未回写 A：不等于全链完成）」**，不呈现全链完成；字段缺失=未知灰。
- `deriveLifecycleStages`：空快照七段+结清 unsupported；服务端字段驱动（policy current→done、credit stale→active、设施候选≠批准等）。
- `deriveBoardSummary`：融资申请/授信额度分列；采购金额标注"不用授信额度冒充"。

与既有 51 项的关系：既有 51 项中除门户上传 3 例因方案R契约变更而按新契约重写（用户行为纪律——文案如实/同号重试/载荷稳定——全部保留并加严）外，其余 48 项原样保持通过；新增 19 项（门户 2 + originals 3 + board 4 + reconcile 3 + wb-logic 3 + 门户重写后净增……合计净增 16）。总计 51−3+3+16 = 67。

## 2. typecheck：PASS

`tsc --noEmit -p preview/tsconfig.json` 0 错误（tsx 严格模式 noUnusedLocals）。

## 3. build：PASS，dist 已更新

`vite build`：dist/index.html + assets（js 418.79KB / css 29.51KB，hash index-CzoX5TJs.js）。Front/dist 为用户要求的发布文件，已用最终代码重建；构建输出 INEFFECTIVE_DYNAMIC_IMPORT 提示为既有状况。Edge 同源托管验证新资源 200（/assets/index-BuM6uaqT.js→后重建为 CzoX5TJs 均验证）。

## 4. 真实页面（合流栈旅程 · 执行者自验）：PASS（用户验收未做）

栈：`delivery-up --config config/delivery-runtime.acceptance.json`（全部合成值；Edge@48210 同源托管 dist、A@48190、Connectors@48110、PG jw-v01-pg@15442）。
**重启说明**：原运行实例（2026-09-19 19:55 启动）早于任务02 的 Connectors 交付（coordinator.mjs mtime 22:54，状态接口无 aRegistered/bridgeState、无自动接通，任务 note="A 客户映射未配置"）。经官方 `delivery-down`（三证复核，库/对象存储/消息库原样保留）→ `delivery-up`（同端口+验收配置）重启，加载当前 working tree 后端。未修改任何 Back/** 文件、未读私有配置。

旅程步骤（biz1 业务身份 + 受邀客户联系人身份，IAB 1440×900）：

| # | 步骤 | 结果 | 证据 |
|---|---|---|---|
| 1 | 登录→目录→新建客户（openCustomer 一次）→看板渲染 | PASS | j01 截图 |
| 2 | 看板：阶段条七段（结清「未支持」）/金额三行分列/事项卡摘要/右栏待办+四域/沟通收起栏 | PASS | j01 |
| 3 | 材料·处理面板：统一链卡（A 直传已移除）+未绑定诚实阻断+右栏事项依据 | PASS | 旅程快照 |
| 4 | 发起通道邀请（对账编号固定）+受限邀请（code 一次性显示） | PASS | 令牌/码留痕 |
| 5 | 客户兑换→门户→绑定（intake/accept）→**一次提交**（requestId 固定 wb-cup:…570157） | PASS | 确认框快照 |
| 6 | 处理链推进：解析 4 事实→四域分析→aBridge 回写 A：任务 aRegistered=true/bridgeState=registered；A 自动出现 material.bank_statement+parse_extraction（unverified 如实） | PASS | API 核对+j03 |
| 7 | 门户「我的材料」：material.bank_statement=分析完成（A G3 权威投影）；派生件=已登记（待处理） | PASS | j04 |
| 8 | 同字节重复提交→skipped_duplicate（诚实判重） | PASS | 任务表 |
| 9 | 任务表三态：本地完成（未回写 A）/重复件已跳过/已回写 A 档案；任务回执阶段留痕+aOps 对账编号（run/gate 登记 skipped 原因 partial_unlinked_artifacts 如实） | PASS | j03 |
| 10 | 结果面板两路对账：A 回执口+通道对账口（IR-T01-3 页面面）；ptx-…-mat 查询 found:true 渲染 a_links 收据 | PASS | j05 |
| 11 | biz1 退出重进（以标识打开）：看板/材料/任务从服务端恢复一致 | PASS | 快照 |
| 12 | 截图核对横屏可读性（1440×900）：顶部/阶段条/卡片/右栏/底部栏均可读，面板内滚动正常，未改动用户既有浏览器视口 | PASS | j01–j05 |

 journey 中的诚实缺陷/语义（非页面伪装，均如实呈现并留痕）：
- 旧实例产生的 evidence（ev_e95b2271…）未链接 A，导致新任务的 run/gate 登记段 skipped（partial_unlinked_artifacts）；material/derived/gate 已登记。逐动作留痕见任务回执。
- 会话失效后门户需重新绑定（令牌一次性）；页面诚实阻断并引导，见 INTERFACE_REQUESTS.md IR-T01-6。

## 5. 未覆盖（如实声明）

- **用户验收**：未做（本轮全部为执行者自验）。
- **Codex 独立验收**：未做。
- 真实 GLM/真实模型/外部渠道：未调用（范围外）。
- Edge/A/Connectors 套件（67/13/… 等）：本轮未重跑（多路 writer 各自负责）；本路仅以页面旅程与 API 核对消费。
