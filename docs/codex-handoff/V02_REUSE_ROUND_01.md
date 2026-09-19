# V0.2 复用验收 · 第一轮

范围：客户目录→进入工作本。基线 HEAD=8dcef63，保留既有 dirty；未改产品代码，未调用 GLM。

## 结论

保留客户身份、授权目录、工作本加载与业务面板；地图作为同一 customerId 的新入口，不重建客户系统。布局及入口细节修复后复用；本轮不是整链 PASS。

| 项目 | 分类 | 证据与限制 |
|---|---|---|
| 授权客户目录、名称搜索、分页 | 复用既有实现 | A identity.ts:101 起按 tenant/grant 查 PostgreSQL；不是前端假清单。真实跨客户授权本轮未复测 |
| 登录身份、Edge 凭据代理 | 复用既有实现 | 本轮四项定向测试通过；上游为测试替身，不能代替真实数据库授权验收 |
| 按 customerId 打开工作本 | 修复后复用 | use-workbench.ts:256 清旧快照、关闭旧订阅、epoch 拒绝晚到响应；地图可调用同一入口 |
| 工作本业务面板 | 复用逻辑、调整容器布局 | customer-workbench.tsx 已拆面板，但整页含标题、侧栏、聊天；不能未经适配直接塞进地图右侧 |
| 大区/省店/坐标/指标 | 当前目录契约需扩展 | 已核对的目录响应仅客户基础字段；未声称全仓绝无其他相关代码，后续后台轮再确认 |

## 本轮发现的具体问题（代码确认，尚未页面回归）

1. customer-directory.tsx:78–79 新建后先 await openCustomer，再 onOpen；root-app.tsx 的 onOpen 再调用 openCustomer。一次建档触发两次加载/订阅切换，应只保留一个入口调用。
2. customer-directory.tsx:103 提示“按名称/标识搜索”，A identity.ts 实际仅 display_name ILIKE；按客户标识搜索与提示不符。
3. customer-directory.tsx:9 的最近访问 sessionStorage key 未按身份分区，退出也未清除此 key。换身份后可能显示上一个人的客户 ID；不等于后台授权被绕过。需身份隔离或退出清理。

## 验证

- 已执行：node --test --test-name-pattern="受控身份目录|未配置身份目录|只读透传|客户目录前向兼容" Back/Edge/test/g03c-workbench-surface.test.mjs
- 结果：4 tests / 4 pass / 0 fail / 0 skip。
- 本轮 GET http://127.0.0.1:48320/healthz/ready 连接失败，未重启栈、未重复页面验收。
- 同会话此前页面已实际完成登录→新建合成客户→工作本；处理通道报 PROXY_ROUTE_NOT_DECLARED。此为此前观察，不冒充本轮重测。

下一小片：先对本轮三个入口问题做有界修复任务（ZCode），再页面复测目录与切换身份；材料/核验/决定留下一轮。
