# Front：事件推进与三例终态切片

已按 `EVENT_ADVANCE_R1.md`、`THREE_CASE_ENDINGS.md` 处理 Front 职责。入口页五图标随实际 CSS 宽度收缩，当前预览 1333×750 下完整可见；加低幅装饰动效，`prefers-reduced-motion` 关闭。顶部导航收回同排，材料区恢复高度。

原“下一步节点”右箭头已改为“推进下一业务轮次（暂未接通）”，禁用。当前 Edge/A 未找到 `advanceRound`、`caseTerminal`、持久 `roundCount` 读写契约，因此未接业务命令，也未按点击数制造进度。左箭头仍为历史浏览，不撤销业务。

全屏收尾组件和严格判定已准备：好例服务端 4 轮办结且归档显示大钻石；中例 5 轮办结且归档显示大钻石；差例有服务端拒绝与归档记录时显示大红叉。要求客户 ID、record ID、时间、轮数、归档及场景全部相符；返回工作台/查看记录不写业务。当前快照没有 `caseTerminal`，所以真实页面不会显示收尾，必须等 Back 最小推进契约及持久投影接线。合成案例 fixture 尚未证明真实四轮/五轮/拒绝路径。

验证：`npm --prefix Front run typecheck`、`npm --prefix Front run build`；`node --experimental-strip-types --test Front/preview/test/behavior/visual-workspace.behavior.test.mjs` 14/14；`node --experimental-strip-types --test Front/preview/test/behavior/case-ending.behavior.test.mjs` 2/2。浏览器当前 1333×750 截图验入口完整；尚未取得 1920×1080、100% 的运行验收。无真实模型调用、业务写、服务重启或新增后台资源。

SHA256：`glass.css` 581D2922E318D93D055BDFF795A34EFC108A7B34264CDF96059ADFC4829C6BB1；`compact-workspace.css` 3DFB81A7D4918302CC6C0C9C3A6D766727F1EAA5AC304F96928598AD28C13487；`takeoff-screen.tsx` 5B636C247C79F7FED6D4E73493B6F0C3A6F5CA0CEF15E269806316315ACA16BD；`case-ending.tsx` ED160D083E8B2FFB0203CB5D9231E7CF27421B50ACF92D46602731672E51A46C。
