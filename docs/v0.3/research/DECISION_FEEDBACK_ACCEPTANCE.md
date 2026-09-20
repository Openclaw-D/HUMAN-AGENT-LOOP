# 候选置信度与点选反馈：实施验收

日期：2026-09-20。用户明确授权特殊交付阶段本任务直接完成前后端并协调；未改变后续任务默认分工。产品方向沿用固定北极星 V0.3-NORTH-STAR-1.4 的 AGI 定位。

## 已完成闭环

- 现有六助手观察入口增加候选面板，优先3–5个有证据候选，最多5个；不足如实展示，分数缺失显示未知。
- 服务端校验候选ID、概率范围、原文引用，降序排序，默认首项仅为展示建议，不写成人工反馈。
- 点选、均不合适、撤销写服务端；读回后才显示已记录。网络结果未知先读回，不自动重复提交。
- 反馈按租户、客户、本人、助手隔离，绑定问题与证据版本；同问题且证据不变时下一轮真实调用上下文带入本人反馈。该实现是上下文适应，不是模型权重训练、全局概率校准或正式审批。
- 材料变化隐藏旧候选；模型发送未知保留原操作身份，材料变化后仍可查询原回执，禁止借重试重复付费。
- 存储在既有模型回执目录的 decision-feedback 子目录；原子快照保留完整事件、原候选与分数、操作者及选择历史，CAS防并发覆盖。IO不确定保留锁，需核实恢复；单范围2000事件到限明确失败，不静默裁剪。

## 接口与文件

- GET `/api/jw/v2/customers/:customerId/assistant/decisions?assistant=credit`
- POST `/api/jw/v2/actions/customers/:customerId/assistant/decisions`
- POST `/api/jw/v2/actions/customers/:customerId/assistant/decisions/feedback`
- 路由与持久化：`Back/Edge/src/assistant-decisions.mjs`、`decision-feedback-store.mjs`；接线：`server.mjs`。
- 模型契约：`Back/Edge/src/assistant-model.mjs`、`Back/B/src/transport/glm.mjs`，保留旧观察接口。
- 页面：`Front/site-mirror/app/takeoff/decision-feedback-panel.tsx`、`decision-feedback.css`、`assistant-observation.tsx`；客户端：`lib/workbench/decision-feedback.ts`、`wb-client.ts`。
- 修改前精确备份：`.local/decision-feedback-before/`。不自动覆盖恢复，避免抹除其他任务后续修改。

## 本任务实测

|检查|结果|范围|
|---|---|---|
|`node --test Back/Edge/test/decision-feedback.test.mjs`|5/5|本地HTTP模型替身、实际Edge/transport/回执/持久化；排序、反馈下轮带入、幂等、撤销、身份、CSRF、过期、并发、未知及中途撤权|
|assistant-cache/evidence/evidence-http/model/profiles五个测试文件|48/48|既有模型预算、证据、缓存与profile回归|
|新`decision-feedback.behavior.test.mjs`|3/3|实际WbClient+本地HTTP+DOM；默认零写、保存/重开/撤销、丢回包读回、证据变化和归属校验|
|既有`takeoff-actions.behavior.test.mjs`|21/21|观察与需求既有交互|
|Front `npm run typecheck`|通过|前端类型|

新测试最初因等待过程中对DOM对象执行assert.equal导致Node深度格式化耗尽内存，改为相同语义的布尔断言后3/3通过，未放宽行为预期。

## 交接与边界

前端文件已全部交回现有FRONT任务，包含原预约三文件及新组件/类型/CSS。本路不再写前端。FRONT已报告完成默认测试入口、侧栏整理、离线fixture适配及build/dist；整合后118/118测试与typecheck通过，详情见 `../front/UI_R2_DELIVERY.md`。候选面板默认展开且可折叠，置信度说明折叠保留；本任务核对构建文件与测试入口存在，未重复跑已通过的全套。浏览器点击/截图CDP超时，视觉验收仍未通过。

后端文件已释放给CTRL协调。现有共享Edge的A/Connectors依赖连接失败由CTRL协调服务owner处理；未停止未知进程、修改凭据或绕过身份。新功能需原有持久化模型回执配置；缺配置明确报错，不伪造候选。

本记录中的模型为本地合成测试替身，未调用外部付费模型，未读取真实客户原件；不代表真实模型质量、生产服务联通或用户视觉验收通过。TypeSafe/Jev思想研究与27条来源见同目录 `typesafe-jev-2026-09-20.md`，未接入Jev账户。
