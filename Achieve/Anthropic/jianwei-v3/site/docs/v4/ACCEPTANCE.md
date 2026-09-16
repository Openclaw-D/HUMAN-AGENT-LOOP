# V4工程验收｜当前记录

归属：V4。状态：`FUNCTIONAL CANDIDATE ACCEPTED / PRODUCT ACCEPTANCE OPEN / PRODUCTION NOT READY`。

## 最新裁定：2026-09-05 ENG01-R1 / USER PAUSED

- Ctrl独立全量612/612、0失败；typecheck、lint、vinext build退出码均0。lint有test/v4life-verification-recovery.test.mjs:175未使用变量name警告1条，无error；暂停时不追加修复。
- 实际存储helper独立验证原载荷恢复、绑定commandId清除、严格字段、原始reason长度及坏JSON失败关闭，通过。
- 真实浏览器响应丢失→刷新恢复原commandId→错身份禁用→原身份人工重试replayed通过，rev/事件未重复增加；版本竞争显示VERSION_CONFLICT。桌面域标签键盘切换通过。
- 最终发送态检查观察到演示reset禁用；用户要求暂停后正常释放已受理响应、清空Fetch拦截并恢复视口。未继续完整手机恢复矩阵；真实浏览器存储异常未验证（工具不支持注入，未改变存储）。不是完整E2E或生产接受。
- 下方ENG01“React状态刷新丢命令”为R1前历史缺陷，已由sessionStorage同标签页恢复修复；不保证关窗、跨标签页或生产事务exactly-once。
- ZCode报告明确停写；localhost:3101/work保留合成异常/否决测试状态供检查。五色/六维、商务资产专业骨架及产品接受仍待后续，不自动推进。

## 当前增量独立验收：2026-09-05 ENG01

- G1/G2通过：新增26/26，全量600/600；typecheck、lint、vinext build均exit0。既有v4life回归169/169及HTTP quality进程内27/27通过。
- Ctrl使用隔离dev服务localhost:3101（::1监听，无共享持久化目录）；桌面真实业务自核验遭ROLE_MISMATCH拒绝，政策演示身份核验受理并刷新rev/事件6→7；390×844手机事项页核验已矛盾成功，桌面刷新仍显示服务端状态。错误console读取为空，手机无横向页面溢出。原3100保持不动。
- G3部分通过，不是完整E2E：网络中断/未决重试/版本冲突浏览器场景、完整键盘焦点尚未验证。首次交互预览等待用户接受。
- 未决命令刷新恢复不完整：React状态刷新会丢失commandId；服务器journal只对相同commandId去重，不保证新ID不重复业务操作。不能把它称为完整断线恢复。
- 变更：契约内六个源码/测试文件；既有基线源码只WorkShell.tsx修改，engine/types/runtime/seed/package保持不变。执行报告[ENG01_REPORT](ENG01_REPORT.md)。

### Ctrl真实端口异常/依赖复验（2026-09-05，R1执行期间后端未变）

隔离localhost:3101合成案例从rev8开始：政策/信审/资产同时in_progress；WI-C3硬等待提交409；业务提交政策事项403；旧expectedRev返回VERSION_CONFLICT；资产准备工作完成后政策提交→returned，Receipt仍0且WI-P1回in_progress；相同退回命令replay且rev不增加。重提后政策rejected，WI-C3变stopped_dependency、WI-C1仍in_progress、WI-A1保持completed且retainedAfterVeto=true；最终rev21、1Receipt、3贡献。再对已决Gate发新命令返回GATE_ALREADY_DECIDED，rev/Receipt不增加。

测试脚本初次把真实枚举stopped_dependency误写为stopped，后半断言exit1；只读核实types.ts后以正确枚举完成尾段复验exit0，未为测试改实现。未重复声称首次整段全绿，未覆盖跨进程事务或浏览器断网。当前预览保留此合成否决终态，不是成功起租案例。

### R1过程证据：浏览器真实响应丢失→刷新→同ID重试

Ctrl对localhost:3101合成核验Fetch响应实施临时故障注入：观察原请求expectedRev21、服务端201后，用Fetch.failRequest丢弃响应；页面呈现NETWORK_ERROR/结果未知，新提交停用。清空拦截patterns后刷新，同标签页恢复原命令`3d77d111-3e6e-4745-9509-f161fb75a8a3`及原case/actor/expectedRev，默认业务身份下进入绑定不符待确认态且未自动发送。切回政策演示身份，显式重试真实请求沿用相同七字段载荷，响应200且页面“幂等重放（此前已受理）”；版本/事件仍22，没有重复增加。

以上证明R1当前刷新恢复happy path，不证明其他存储异常或乱序响应；R1仍在原owner处理Ctrl补充纠偏，修改后需回归。临时Fetch拦截已用空patterns清除；未修改真实客户或生产网络。

补充只读交互检查：1920×1080桌面，四域tab由政策ArrowRight切至信审，aria-selected与真实焦点一致；End切至资产成功，页面scrollWidth=1920无横向溢出。临时viewport已恢复。这仅覆盖四域tab键盘路径，不等于全页面accessibility验收。

浏览器版本竞争：暂停一个expectedRev22的真实核验请求；独立合成政策命令先受理到rev23，再恢复旧请求。页面收到VERSION_CONFLICT，显示已刷新/须确认/不自动重提，材料保持最新已矛盾状态。暂停请求时当前演示身份为业务，版本冲突先于角色处理；此例只证明过期反馈，不能替代政策身份成功/业务拒绝两项既有证据。临时拦截已清除。

## 最近独立验收：2026-09-04 22:00

- P1 focused：31/31；全量测试：574/574；HTTP quality：27/27。
- typecheck、lint、build通过；当时canonical API、/work、/work/screen均HTTP200。
- 默认隔离未确认P1语义，demo显式opt-in；Agent/模型保持authority=none。

## 仍未完成

- P1核验已有候选隔离HTTP/交互面；Context窗口命令尚无完整HTTP/交互面。角色、风险内容、stale阈值、自动封存/重开和正式核验Receipt仍待产品确认。
- 五色风险与六维事实尚缺当前/work明确结构化呈现；不能以本次核验闭环宣称全部四域框架完成。
- 浏览器异常流程、完整双端、键盘/焦点/console验收未闭合。
- 当前canonical候选是确定性规则，不是已经接入真实模型的AI系统。
- 文件event log与command journal不是原子事务；不能承诺exactly-once或跨所有故障恢复原响应。无生产级认证/租户隔离与部署验收。

## 原始证据

[9月4日完整验收原文](../../../../V4/archive/工程验收/ACCEPTANCE.md)；[工程报告](../../../../V4/archive/工程验收/BACKEND_PROGRESS.md)；[执行记录](../../../../V4/archive/工程验收/ZCODE_RUN_STATUS.md)。

新代码变更后必须重做受影响Gate，不能沿用上述数字。用户接受、工程通过、完整E2E和生产可用分别判断。
