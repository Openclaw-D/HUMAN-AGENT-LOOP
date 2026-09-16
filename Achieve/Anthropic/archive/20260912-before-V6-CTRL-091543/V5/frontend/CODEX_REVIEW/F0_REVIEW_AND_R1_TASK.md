# F0 Codex 独立审查与 F0-R1 任务

日期：2026-09-08。裁定：F0合成预览已交付，工程检查通过；产品语义与交互可靠性未通过。下一步限定F0-R1，不放行真实审批、B1或生产集成。

## 独立证据

读取实际10个前端文件中的状态、路由、详情、聊天、两端总览及CSS，审查17项现有测试；独立全量629/629、typecheck exit0、lint无error/1既有warning、build完成。日志见本目录tests.log/lint.log/build.log；纯逻辑复现命令：在Anthropic根部执行 node --experimental-strip-types V5/frontend/CODEX_REVIEW/probes.mjs，输出见probes.log。

原交付URL localhost:3311/v5-preview 当前拒绝连接，本轮未启动服务、未完成实时浏览器验收。不能把ZCode历史截图/自报视为本轮重验。原报告中DOM evaluate click不是物理命中/键盘可用性的充分证据，innerWidth=2112不能称精确1920验证；R1应重新测量并修正声明。

## 必修项（路径相对site）

1. [P1 产品纠偏] preview-state.tsx:136、146等仍是事实引用/材料互证等各域独立标签；未实现用户最新明确的材料合规→模型校验→人工复核→正式通过。固定共同stageId，专业细项下沉详情。保留跨域正式依赖，不能仅换四个文字而没有前置状态。正式通过仍禁用；允许合成只读情景表达，不伪造正式回执。
2. [P1 行为] preview-state.tsx:224、240 无角色守卫；detail-workspace.tsx:104等仅判断阶段。复现：初始role=business直接发补充要求，消息fromName却是张信审；business还可接续信审至credit-continued。页面和reducer都按角色限制本域动作；跨域可查看但不能代办。模拟视角不是生产认证，R1只修预览行为一致性。
3. [P1 数据丢失] detail-workspace.tsx:166、179、218，draft初始空字符串，textarea回显持久旧值但saveDraft写局部空值。保存A→返回总览→重进信审→不编辑点保存，将可见A写成空；清空输入又会回显旧值。建立单一编辑源，明确未初始化与有意清空，保存当前显示内容。覆盖返回/刷新/清空/接续后再保存场景。
4. [P1 恢复] preview-state.tsx:342仅浅校验。probes已证实{version:1,domains:{},loop:{},messages:[],nextId:0}被接受，下游读取domains.credit.status抛错。验证全部必要嵌套字段、枚举、ID/数字范围及阶段组合；非法缓存安全回退并给明确提示，不称浅校验为失败关闭。不用新增依赖也可实现。
5. [P2 一致性] continue-credit只更新域status/blocker与50→60，blocks仍停留退回/进行/待处理。probes已证实。域摘要、格子、详情及待办由同一阶段对象派生。保留进度示例标记，不把固定+10或16格平均晋升真实项目算法。
6. [P2 重置] preview-state.tsx:407模拟回复timer仅卸载清理，reset不取消。在700ms内重置演示，旧回复可能进入新演示。重置取消pending并使用演示generation守卫；补回归。本项为代码路径确认，尚未浏览器重现。
7. [P2 导航] overview-landscape.tsx:72各格仅传domain，page.tsx View没有stage。R1单元格携带域/阶段进入对应详情，URL/返回保持上下文；不能四行都进入同一无定位页面。小屏亦可定位。

## F0-R1 checkpoint（交给ZCode执行的完整边界）

Objective：在隔离/v5-preview内修复以上问题并交付一个可观察的四阶段工作预览，证明用户知道当前步骤、阻塞和自己能做的动作。一次checkpoint后停止。

先读：工作区AGENTS、V5/DECISIONS、ZCODE_FRONTEND_TASK及本审查；保留F0/REPORT作为历史自报，不覆盖原证据。用户最新四步定义优先于F0旧标签。手机统一四列四行仍是待观察候选，可在既有布局预览选择器中加入候选矩阵供用户比较，不能擅自宣称已替代原手机决定；不重建第二套状态。

Allowed writes：site/app/v5-preview/**、site/test/v5-preview*.test.mjs、V5/frontend/F0-R1/**。开始时记录HEAD/status和本轮将修改的F0文件，制作本轮文件副本与SHA256清单以保护现有交付；文件快照不冒充Git baseline。你不是唯一writer，不回滚其他修改。CODEX_REVIEW目录与产品authority归Codex。

Forbidden：既有非预览页面、共享CSS/layout、lib、API、schema、依赖/lockfile、B0/B1、历史V4、生产/部署、Git提交/tag/分支/worktree、双方Harness/Memory/设置、真实模型或业务API。若必须越界停止并报告。当前只窄修已授权隔离预览，不自动替换现有前端。

Interfaces：同一合成项目+四域+四阶段稳定ID；role约束动作但不改变项目事实；浏览/聊天不产生正式Decision/Receipt；进度与项目结束分别表达，正式通过仍受权限未定的禁用边界。

DoD：
- 上述7项逐项给修复文件与行为证据。针对错误角色、错误前置、缓存缺字段/非法枚举、保存后返回再保存/清空、重置后延迟回复、格子与详情同步加入有效回归测试；不能只断言源码含某个词。
- 至少一个材料待补充情景和一条信审—业务回应接续流程，正确显示后续等待；模型校验完成可含问题，不能自动正式通过。各域完成不自动结束项目。
- 复用原依赖，按需启动已安装dev工具前检查端口，不杀未知进程，不自启；报告实际URL/PID/服务状态。
- 浏览器实测innerWidth/innerHeight分别390×844、1920×1080、1024×768；实际指针/键盘操作并检查console。若只能DOM脚本触发，单独标记，不能称等价用户验收。长文本/空输入/等待/错误/返回/刷新均检查。
- 跑test/typecheck/lint/build，记录准确退出码，既有失败单列不越界修复。
- 交付V5/frontend/F0-R1/REPORT.md、截图/日志/变更清单、未验证项；完成预览立即停止等待用户/Codex验收，不自动F1/B1。

派发状态：本轮已准备可转交任务，未操作ZCode发送；不声称R1已经启动。
