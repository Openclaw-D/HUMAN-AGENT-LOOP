# V0.4 单节点导航交付

日期：2026-09-21。HEAD：e298a789bc9d49eac23a17f9dfe75244f73ca64f。未提交。

## 已实施
- 右上上一步/下一步，每次定位现有决策画布的一个节点，同时定位横纵坐标并标记当前位置；不开办理抽屉。
- 顺序固定为材料/分析/核验/办结，每阶段按商机/政策/信审/商务/资产排列。只纳入已完成、处理中及各专业首个未完成节点。此为浏览顺序，不声称服务端历史总序，不新增未来分支。
- 保留节点锁及原因。首尾禁用；无授权客户快照时禁用并说明无节点。
- sessionStorage 仅保存稳定节点ID，以sessionId/principalId/customerId分区；切页保持，当前同会话刷新恢复，失效ID回起点。服务端新会话视为新作用域，不恢复旧会话位置。存储不可用时降级当前组件内存。
- 未修改Back、聊天/材料业务逻辑、既有测试断言或根文档。

## 验证
- node --experimental-strip-types --test Front/preview/test/behavior/node-navigation.behavior.test.mjs Front/preview/test/behavior/takeoff-board.behavior.test.mjs Front/preview/test/behavior/visual-workspace.behavior.test.mjs：退出0，34通过，0失败/跳过。
- 新测试覆盖稳定节点范围、失效ID、批量快速点击、客户/会话分区、卸载重挂模拟刷新恢复、空列表、首尾回退、跨页保持、同阶段精确纵向定位；模型/上传/审批/反馈等写调用为零。
- Front目录 npm run typecheck：退出0。
- Front目录 npm run build：退出0，Front/dist已更新。保留既有 edge-logic 静态/动态混合导入警告。
- 真实页面/用户视觉尚未验收：配置的127.0.0.1:3617无监听，本轮未启动或重启服务、未改变用户浏览器。

## 边界
统一事件同步与持久聊天回执不在本切片。业务测试为本地替身，不代表真实后端或模型验收。既有takeoff-board测试修改由前轮保留。
完成后停止；未向CTRL或其他任务发送消息。
