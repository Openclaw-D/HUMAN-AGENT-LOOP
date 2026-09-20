> 最新前端修订与真实页面验证：[UI_R3_DELIVERY.md](UI_R3_DELIVERY.md)。以下为此前各阶段记录。

# V0.3-FRONT 交付入口（实施中，非最终验收）

2026-09-20 更新：用户已恢复前端工作，并明确授权 Codex 直接实施 iOS 风格、1920×1080 横屏交互改版。当前进展与真实阻点见 [UI_R2_DELIVERY.md](UI_R2_DELIVERY.md)。以下为此前暂停时的历史检查点，其中“未构建/未视觉验收”等状态不代表当前 UI-R2 状态。

## 先前暂停检查点

2026-09-20。按 CTRL 转达的用户最新暂停指令，在已运行的离线测试结束后停止；无后台工作。只写 Front/** 与本目录，未改后端或公共文件，未新增任务/subagent/worktree，未 commit/push/部署，零真实模型调用、未操作共享服务。

## 已实现源码，待完整验收

- `Front/site-mirror/app/takeoff/admission-request-panel.tsx`：顶部需求抽屉；读取真实 assessment；业务/信审角色可提交 admission-request；assessmentVersion 乐观锁、元/分精确转换、未填字段 null、版本冲突保留草稿、无权限/终态/读面失败、提交未知锁及服务端读回核对。无评估时引导既有方案·评估页面。
- `Front/site-mirror/app/takeoff/assistant-observation.tsx`：六助手选择下显式触发同源 observe；基于工作台摘要，未读取原材料；非流式等待、服务端超时/网络中断未知不重发、预算门/未配置/权限拒绝、客户与会话隔离；需求/候选/依据变化隐藏旧输出；模拟/模型/规则分别标识；authority=none。后端当前缺少完整上下文标识，历史 replay 暂不展示为当前观察。
- `Front/site-mirror/lib/workbench/takeoff-actions.ts`：请求/响应类型、金额/读回核对和上下文展示锚点。
- `Front/site-mirror/lib/workbench/wb-client.ts`：需求命令与模型 HTTP 客户端，复用会话，75 秒浏览器等待上限，零自动重试；无 provider 配置、密钥或固定模型名称。
- `Front/site-mirror/app/takeoff/takeoff-screen.tsx`：需求入口、抽屉、客户/会话 key 与源读取代际守卫，保留五区四行。
- `Front/site-mirror/app/takeoff/takeoff-assistants.tsx`、`takeoff.css`：复用助手消息栏和黑白灰样式。
- `Front/preview/test/behavior/takeoff-actions.behavior.test.mjs`：随机 loopback 端口的 HTTP 替身，与真实 WbClient/React 组件联测，零外部出站。

## 已执行验证

在 `C:/Users/22673/Desktop/JW/Front`：

```powershell
node --experimental-strip-types --test preview/test/behavior/takeoff-actions.behavior.test.mjs
```

PASS 19/19（2026-09-20 当前源码）：登记保存/读回、精度/空字段、409/403/终态、未知关闭重开防重发、只读/无评估/读取失败；六助手显式调用/会话/同问复用；等待与切客户；预算/未配置/401/403/404/上下文失败；超时/断网/归属异常；需求候选变化/历史回执隐藏；主屏入口。

`npm run typecheck` 曾在页面初步接线完成时 PASS；此后新增源读取代际守卫和行为测试，最终快照 typecheck **未跑**。未以旧结果代替最终结果。

## 未完成与恢复顺序

1. 阅读本检查点及 CTRL 最新接口决定，核对 TEC 后端是否已增加 contextHash/profile；按最终契约协调回执展示。不要自行扩大到新阶段。
2. 复核当前组件边界：异步关闭/重开、刷新与失效、未知结果的安全恢复；处理发现的问题。当前 unknown 防重发锁只保存在本会话客户端内存，整页刷新/重新登录后的幂等及未知保护仍由服务端负责。
3. 将新套件加入 `Front/package.json` 的 `npm test`，执行完整前端回归及最终 typecheck；保存实际日志。
4. 获得继续指令后运行 `npm run build` 更新用户要求的 `Front/dist`。当前 dist **未更新，页面运行版本仍是旧构建**。
5. 视觉验收未执行，截图未取得；需先读 computer-use skill，保持用户现有 viewport/缩放/预览。真实 API 页面旅程、用户视觉接受也未验收；本轮离线 HTTP 替身通过不等于真实模型/数据库闭环通过。

后端缺口见 [INTERFACE_GAPS.md](INTERFACE_GAPS.md)。当前为在制检查点，不可宣告 V0.3-FRONT 完成或决赛全周期完成。
