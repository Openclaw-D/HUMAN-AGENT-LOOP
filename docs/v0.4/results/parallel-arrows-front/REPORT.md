# 前端真实箭头接线交回报告

日期：2026-09-21。本报告替代旧的“未接 Back”进展。前端本轮已停止写入，交回串行协调；整体目标仍有下述未完成项，不宣称产品最终通过。

## 实现与运行范围

仅修改 Front 源码、相关测试、dist 与本目录；未修改 Back，未重启共享 48214。实际联调使用 Back 交付的隔离实例 http://127.0.0.1:62032 和隔离五专业审核员，全部 synthetic 确定性测试，无真实模型调用。

首页以 arrow-cases 的稳定 caseId 绑定真实 customerId。右箭头在等待人工时明确显示“采用本列意见并继续”，提交 requiredDecision 的真实 resultId、expectedVersion 和幂等 requestId；拒绝另有明确操作。未知结果持久阻止重复命令，仅恢复读取，直到 selection 的 candidateId/decision/eventId 匹配。左右回看与并行读回不改变材料画布位置。

五视图使用同一历史快照，校验 customer/process/round/domain/version/current/serverUpdatedAt/basisVersion；材料按确切 artifactId 引用，决策显示真实 candidate/selection，流程按真实 event.domain/jobId/version/actor 展示，不能拿角色名冒充操作者。补材料面板新增合成现金流核验更正，显式金额、依据及人工勾选后才登记 confirmed，保留 supersedes 原件链。修复隔离 session 无 tenantId 时从匹配客户工作区取 tenantId 的问题。终态只使用真实 caseOutcome。

顶部四入口已收为单行紧凑导航，保留更多材料区空间。1920×1080、deviceScaleFactor=1、visualViewport.scale=1 下导航实测约 280×51.33px，内容起点 y=112.67；第一次采用前后看板边界和 scroll[0,0] 不变。未改用户原有浏览器缩放与标签。

## 三例真实执行与点击

| 案例 | 真实结果 | 核心操作 |
| --- | --- | --- |
| 好 | process-muaei0ww-b6d17764da77，v27，五列 completed，钻石 | 1 次启动右箭头 + 5 次明确采用右箭头，共 6 次 |
| 中 | process-muaemrh3-fd6bda073f2c，v65，三轮共15回执，最新五列 completed，钻石 | 调试实跑 3 次分析 + 9 次采用 + 4 次左回看 =16 次，另有重载后的6次只读右导航，共22次箭头 |
| 差 | process-muaez2hz-3d63fbd6a991，v23，rejected/rejection，已归档 | 1 次启动 + 2 次采用 + 1 次显式拒绝，共4次核心操作 |

中例另有1次 HTTP 准备补证，以及3次页面提交尝试（1次403、1次本地缺租户提示、修复后1次实际成功）。不能把这轮说成纯页面单次补证无故障通过。实际页面核验成功后完成重评和终态；旧件与三轮历史均保留。按当前所有材料关联全部五列的依赖设计，干净路径预计需11次箭头，尚未满足5–6次目标，需 Back 精化依赖后再串行验收。

终态事件：好 b197f409-d5fa-45e5-8074-8ef5a3a2dda1；中 d6c5a481-aaa4-459c-8604-6f4bb69f9f45；差 4a202ed7-f59a-4f7d-9c86-f0ce1cdac37e，archive-muaezu9g-0b7453897cf5。

## 独立验证与证据

- targeted-tests.txt：定向28项通过；之后增加的真实拒绝/停止投影用例单独通过。最新 typecheck、dist build 通过。未重复整套；不宣称历史全套测试通过（既有两项聊天断言失败未纳入本轮修复）。
- final-three-cases.json：三例持久结果；verified-associations.json：用实际 Front parser 验证25条回执、五视图上下文、selection事件关联；三例真实 worker 起止区间均有重叠，不是前端假并行。
- 好例浏览器核对平台、材料18份v27、真实选择与操作者的决策页、服务端时间流程页；差例同样核对四页v23，browser-view-evidence.json 留存其材料/决策/归档流程文本。中例实际核对等待补证、页面核验、重评决策、平台与最终钻石；尚未补做其v65最终材料/流程的单独浏览器遍历，不冒充三例全四页均完整验收。
- good-terminal.png、medium-terminal.png、bad-terminal.png 已在持久终态重新截取并视觉核对；这些普通截图实际1707×807，不标作1920。bad-board-1920.png 使用 CDP 原始截图，PNG尺寸确为1920×1080，信审核验/办结红叉，商务/资产停止锁，顶部紧凑单行。
- 重载后重新登录可读回真实持久终态；不宣称登录态无缝保持。未知命令恢复、并发回看与串客户隔离为定向模拟测试，不冒充真实网络断连测试。

## 明确保留问题

1. Back 仍把真实拒绝的 credit domain.state 记作 stopped；前端仅在真实 reject selection+eventId 与 rejected caseOutcome 共同成立时展示信审红叉，其余停止列保持锁。不能声称后端拒绝状态已修正。
2. 补证目前使五列全部失效重评，点击预算未达标；等串行 Back 整改。
3. 材料/决策页展示当前轮，历史事件与回执保留，但尚无旧 attempt 选择器。材料卡按不可变ID匹配工作区元数据，未做完整历史轮嵌入内容浏览器验收。
4. 新增补证登记UI可用；隔离实例通用文件上传未打通。补证请求的同ID重试保留于组件内，刷新后的补证未知请求恢复尚未持久化；箭头/人工决策请求恢复已持久化。
5. 决策详情仍偏技术化；本轮不是最终视觉验收，也未将共享48214当前页面作为实链通过证据。

## 停止与进程归属

已关闭本任务创建的 IAB tab5（integrationTab）和 Chrome tab357787873（chromeIntegration）；用户原有标签与预览设置保持不动。早前状态翻片临时预览服务已停止。62032及A55996属于 Back 交付实例，本任务未启动/停止它们，继续保留交回协调。无本任务测试/构建后台继续运行，无后续写入或其他任务控制；未commit/push。后续依赖整改和验收由协调串行接续。
