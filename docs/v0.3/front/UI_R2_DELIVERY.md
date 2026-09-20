# UI-R2：1080P 工作台交互改版

2026-09-20。当前为实施检查点，未宣告真实办理链路或用户视觉接受通过。

## 已接入

- 固定 1920×1080 逻辑画布，按可用窗口等比适配；五个角色独立图标，角色入口保留服务端真实身份与权限。
- 玻璃导航层、清晰材料阅读层；主导航收为工作台、材料清单、角色流程、时间轴。
- 材料清单读取服务端 artifacts，支持搜索、现行/历史筛选；卡片指针拖动、清单拖入画布、40%–180% 缩放、平移、适合窗口、撤销和整理。布局按客户端会话与客户隔离，不改变业务记录。
- 原件弹层读取 artifactContent，支持现有文本、图片、PDF及下载；无原件时明确显示结构化记录，错误不冒充空清单。
- 五专业横向并行流程，20个节点进入现有真实办理详情；纵向时间轴读取服务端分页事件，支持搜索、类别筛选和定位最新，不伪造历史。
- 去掉未接线“更多”菜单；操作文案改成补充材料、核验材料等业务动作，减少重复说明。详情抽屉支持 Esc、焦点进入、Tab 限定与关闭恢复焦点。

## 验证证据

- `npm run typecheck`：通过（共享候选反馈组件与本轮全部修改整合后的源码）。
- `node --experimental-strip-types --test preview/test/behavior/visual-workspace.behavior.test.mjs preview/test/behavior/takeoff-board.behavior.test.mjs`：22/22，通过。日志 `ui-r2-interaction-tests.log`。
- 最终 `npm test`：120/120，通过，日志 `ui-r2-tests.log`；包括新增视觉工作区、价格单位、画布居中及Jev候选反馈测试。
- 最终 `npm run build`：通过，更新 `Front/dist`（index-DHCKrjCE.js / index-DSOTg7m7.css）；56模块。保留既有无效动态导入拆包警告，无构建错误。前一构建已向用户既有48214标签发送reload并得到成功返回；新截图仍超时，最新构建未作浏览器视觉验收。
- CUA 浏览器在合成夹具中独立验证：1080 完整五路流程、节点进入详情、材料拖动位置变化、撤销、110%缩放、原件弹层、时间轴搜索与分类。夹具明确标识合成数据，不能替代真实服务验收。
- 用户原预览标签与1080视口保留。独立夹具使用本路启动的3620开发服务，不改变共享后端端口。

## 当前阻点与接续

1. 真实48214角色按钮已发出 session 请求，返回403 `PRINCIPAL_UNTRUSTED`。CTRL独立定位 A/Connectors ECONNREFUSED，live verifier把探测失败统一为身份拒绝；2026-09-20T13:20:47Z 续验 healthz/ready，A、DB、Connectors、channel均ECONNREFUSED，已通知CTRL。未绕过身份校验、未填造业务数据。
2. Jev任务已交回前端文件，FRONT已串行完成package测试入口、完整回归、typecheck与dist。新候选面板收为可折叠“下一步建议”；置信度边界仍可展开查看。离线fixture补充真实形状的空候选读面，分析/反馈明确拒绝，不冒充模型输出或业务保存。
3. 浏览器验证后段出现现有两个标签点击/截图CDP超时，AX仍可读。暂不重置用户浏览器或改变布局；恢复后继续真实角色→客户→各入口验收。
4. 未进行真实模型付费调用、正式预评估确认、commit、push或部署；未新增任务或subagent。用户视觉验收尚未取得。

主代码：`Front/site-mirror/app/takeoff/{desktop-frame,ui-icons,role-entry,takeoff-screen,materials-desk,role-flow,work-timeline}.tsx` 与 `glass.css`。旧需求登记与模型观察覆盖见 DELIVERY.md 的先前检查点。

续验修复：价格单位“元/年”等与金额自带货币单位重复，统一为“金额 / 年”，设备等其他分母保留；窗口改变但缩放比例不变时，画布仍重新居中。两项有新增回归验证。

目标状态：blocked。连续三轮相同运行阻点复验，A/DB/Connectors/channel仍ECONNREFUSED，既有真实预览Page.captureScreenshot仍超时。前端代码与构建已交付，完整目标未完成。恢复条件：总控负责的既有办理服务恢复可达，浏览器控制恢复；随后直接续验真实角色→客户→四主入口、材料原件与最终1080视觉，不重复重做已通过回归。
