# goal-03 · TEST_RESULTS（Edge 与工作台数据）

- 日期：2026-09-17；执行者 ZCode（goal-03 路）
- 栈：PG@15442（容器 jw-v01-pg）+ A 内核@48180（含 `--allow-legacy-basis` 兼容核与 grant 模式测试
  主体 tok-lim1，全部公开合成演示令牌）+ Edge@48200 `--live --serve-front Front/dist`
- 原始证据：场景/性能 JSON 与测量脚本在 `C:/Users/22673/AppData/Local/Temp/jw-goal03/`（不入库）；
  浏览器截图在本目录 `evidence/`。

## 1｜仓库测试（可重复）

| 套件 | 结果 | 说明 |
|---|---|---|
| `Back/Edge: node test/run-all.mjs` | **34/34 pass** | 既有 27（版本封存/健康/SSE 语义/代理/受众/审计/harness/CSRF）+ 新增 7（g03-c1 ×5、g03-c3 ×2） |
| `Front: npm test` | **19/19 pass** | SSE 解析（含 CRLF/多行）、状态机、会话动作（服务端优先）、等待原因、额度行、金额、徽标、requestId |
| `Front: npm run typecheck` | 0 错 | tsc --noEmit 25 文件 |
| `Front: npm run build` | 通过 | dist 重建，最终 bundle `assets/index-C4ixqN64.js`（P1-1 根因修复后构建） |

## 2｜协议层场景（真实栈 Node 客户端；scenarios.mjs）

| # | 场景 | 结果 | 关键断言 |
|---|---|---|---|
| S1 | 登录与拒绝 | **PASS** | 好凭据交换 200；坏凭据 403 PRINCIPAL_UNTRUSTED；无会话读 workspace 403 SESSION_REQUIRED；未授权客户 404（不泄露存在性） |
| S2 | 甲撤权乙继续拉取 | **PASS** | lim1（grant 模式）获授权后可读、双方都收实时事件；admin 撤销 → 甲 SSE 收 `auth{code:CUSTOMER_ACCESS_REVOKED}` 后终止、workspace 404；乙流不中断、workspace 200 |
| S3 | Edge 重启窗口 + 旧游标 | **PASS** | Edge 停机期间对 A 写 5 条 → 重启后带旧游标重连**回补 5/5、seq 连续无丢失**；未知游标 → 显式 `resync`（不静默续播） |
| S4 | 慢客户端 | **PASS** | 1500 事件高速写入、接收端停读 → 服务端 writableLength 超限 → `resync` 后断开该流；同客户正常订阅者全程不受影响 |
| S5 | 双会话并行写同客户 | **PASS** | 60/60 写接受；两读者各收 60 条、seq 严格递增、无重复 |
| S6 | 后台重启 | **PASS** | A 进程终止确认 → 期间会话交换 403 fail-closed；A 恢复后 workspace 200 且快照版本不低于重启前（历史不丢） |

## 3｜真实浏览器回归（IAB Chromium；同源入口 http://127.0.0.1:48200/）

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| B1 | 页面加载 + off 态如实标注 | PASS | "本地合成演示"徽标 + "客户目录接口未提供：范围不完整"提示；训练模式六角色 UI 原样 |
| B2 | 真实登录连接 | PASS | tok-biz1 → "Live · 真实后台" + 快照版本/事件窗/能力位 chips/readiness 逐项/freshness 逐组件（截图 evidence/browser-live-main.png） |
| B3 | 真实写（live 消息） | PASS | 受众=内部发送 → 消息渲染 "本会话（真实后台）+ 已送达（服务端回执）"；无本地假成功 |
| B4 | 服务端 availableActions | PASS | 会话操作条仅渲染服务端动作（preparing → [开始会话]；plan/scene 无工作台路径不渲染）+ 等待原因 |
| B5 | 错误凭据拒绝 | PASS | alert "连接失败：PRINCIPAL_UNTRUSTED（会话建立失败）"，回 off 态 |
| B6 | 切换客户 | PASS | 断开→连第二客户：快照版本/事件窗原子更新；无会话客户的会话操作条正确消失；切回主客户全部恢复 |
| B7 | 刷新保持 | PASS | F5 → 重新连接 → Live 态与快照一致（会话内存消息清空属预期：刷新后为全新客户端会话） |
| B8 | 撤权断流显示 | PASS | 第二标签页 lim1 连接 → admin 撤销 → 页面显示 "真实后台订阅已终止（CUSTOMER_ACCESS_REVOKED）：权限变更或凭据失效…请重新认证" 并回 off 态 |
| B9 | P1-1 展开/收起 | PASS | 根因修复后：折叠显示"原文"→展开"收起"仍在→收起回"原文"，两轮循环稳定（截图 evidence/browser-live-todo-panels.png 为 Live 面板态） |
| B10 | 四域矩阵 live 投影 | PASS | 无依据包客户矩阵全灰（未开始/未知），不借训练情景灯色；会话生命周期来自服务端 runStatus |
| T6 | 连接→Live 渲染 | PASS（单样本） | 994ms（目标 ≤2500ms；单样本非分布口径，如实标注） |

## 4｜NOT_RUN（无环境/归他人域；不冒充）

| 项 | 原因 |
|---|---|
| 三物理终端现场验收（ACCEPTANCE_CHECKLIST 全流程） | 需要三台物理设备与人工操作员；本轮以 2 浏览器标签 + 协议层多身份覆盖其核心断言，现场清单仍待人工走查 |
| 2 小时浸泡 / D19/D21/D22 30 轮稳定性 | 时长与归口：稳定性轮次归 goal-04（E1/交付/扫描/性能脚本）；本轮 120s 浸泡仅作回归 |
| E1 真实集成用例（e1-*） | 冻结门未过（契约仍 v1.3 登记制，v2 未发布）；e1 归 goal-04，本轮不代跑不代写 |
| SSE 心跳 15s 会话过期断流 | 逻辑在 server.mjs 已有；需 ≥15s 真实等待 + 会话 TTL 操纵的长测，未在本轮执行（goal-04 U 系列表） |
| 真实模型调用 / 真实视频 / 三维场区 | E2 授权门（用户授权/账号/费用）未开；D27-S BLOCKED（如实标注） |
| 客户列表选择器 | A 无列表端点（IR-03-A① OPEN）；等待期 UI 如实显示范围不完整 |

## 5｜已知非阻塞问题（如实，不掩盖）

1. **（合成）文案**：聊天工具条计数注记已按模式区分（live=真实后台回执）；聊天输入 aria-label
   "发送项目沟通（合成演示）"在 live 模式仍带"（合成演示）"字样——属可访问名文案级 P3，
   未在本轮清理（记录于 HANDOFF）。
2. IAB 自动化中高层 Playwright click 对个别按钮命中不稳定（连接/发送按钮），经元素级点击与坐标点击
   完成回归——是自动化工具行为，非被测页面缺陷（真实 Chromium 手工点击路径一致）。
3. 事件窗"缺号补查中"标注在 S4/S5 大批量写后出现过 gap 标注并自动清除（重查窗口自愈）——设计内
   行为；A 侧提交序根修仍是 IR-03-A③ 的最终解。
