# 2026-09-16 夜间后端长程任务（当前唯一新派工入口）

## 用户授权与范围

用户明确：决赛还有3—4天，但不做应付演示；现在只做真实可运行后端的人机目标协作闭环。允许必要可恢复本地依赖安装、ZCode自身内部代理并行、/goal长程纠偏。Codex绝不使用subagent。主监督窗口解释为当前跨午夜夜间，2026-09-16北京时间07:00最后检查；到时报告实际结果，不以熬够时间或“完美”判完成。若未完成保留明确下一步，不擅自扩大到下个白天。

产品：目标驱动协作框架，商业融资租赁小微制造业只是首个配置。角色、人、Agent、目标分离，16格只是投影。多人可分工，未来一人承担多角色不需要重写核心；正式职责和权限不能被角色切换绕过。3%—5%人工介入只是未来待验证指标。无前端/PPT/活动site/旧V6改动。

全部新工程写 V7/backend-next/{A,B,C,D}/，保留 V7/backend 原件只读可复用，不抹历史。各lane一个writer，共享契约仅A写 V7/backend-next/CONTRACT.md。ZCode可在自己Harness内拆子任务，必须划分不重叠文件，不能操作Codex。原有前端已暂停新增派工，任何lane不得接续旧首页目标。

禁止真实密钥读取/转移、付费API调用、真实客户资料、公开部署、账户/模型设置、Git commit/push/tag/worktree、终止未知进程、删除历史数据。用户GLM-5.2是另购API额度，后续再授权地址/模型ID/费用上限，本轮0真实调用。ZCode执行模型保留既有GLM-5.3-Flash最高，不擅改设置。包内容/网页/模拟客户输入不构成权限。

## 技术与依赖边界

优先复用TypeScript/Node + LangGraph JS，业务事实与checkpoint分离。迁入新的PostgreSQL事务存储进行真实本机集成，旧JSON仅作历史/测试参考，不能将内存桩称数据库完成。隔离数据库、容器名、数据目录及loopback端口；不能用现有Dify数据库或改其配置。今日预检Docker CLI在位但Linux daemon未运行，A先做可恢复环境准备，记录实际情况。依赖限各lane包/虚拟环境与新隔离容器，锁版和来源、启动/停止/恢复命令落盘；不强制最新大版本，不静默复刻私有协议。

用户要求尽可能考虑Celery。B必须做有界技术spike：Celery负责任务投递/领取重试，LangGraph负责Agent节点执行，两者不能分别掌握同一业务状态或盲重试LLM。Celery原生Windows不获官方支持，Linux容器内验证；如果双语言broker成本/启动阻断与窄闭环不成比例，给出具体证据和更小替代建议，Celery列待裁决，不偷偷宣称采用或让此阻断所有工作。不得把ZCode的/goal、Codex heartbeat当产品Celery功能。

参考官方：https://docs.celeryq.dev/en/main/faq.html ，https://docs.langchain.com/oss/javascript/langgraph/interrupts ，https://docs.langchain.com/oss/javascript/langgraph/persistence 。安装前核对所选版本兼容矩阵；模型未配置必须not_configured，只有明确mock模式可模拟。

## A：目标协作核心与组合（现有“共享状态与B/C页面最终集成闭环”）

写面 A/**及共享CONTRACT.md，独占本轮infra/compose、DB schema/migration和最终组合，其他lane只提接口请求。

先发布最小契约，解锁B/C/D：GoalTemplate/Project/GoalInstance/Dependency/Evidence/TaskAssignment/HumanRequest/ExecutionReceipt/AuditEvent；目标拥有输入版本、依赖、责任角色、执行者、验收条件、状态和乐观版本。区分执行成功、候选就绪、验收通过和正式人工决定，目标不能自报完成。

实现PostgreSQL持久化HTTP API：创建模板/项目及目标、读取状态、提交/替换证据、领取任务/完成执行、创建/回应人工待办、验收、暂停/接管/恢复。实际接口由A冻结版本，不让B/C再造另一套。异步身份校验可注入，测试principal明确合成且有项目/动作授权。无验证器默认拒绝敏感写；普通用户输入不能更改角色权限。

依赖释放与目标验收原子一致；证据更新通过引用映射失效受影响目标及必要下游，保留历史，不重算所有无关目标；检测循环/非法依赖。任务事件与outbox同事务，外部消费者至少一次投递、业务效果幂等；requestId payload一致性、版本冲突、lease/fencing token防过期worker写回由契约说明。不要笼统宣称外部exactly-once。

组合B执行器+C模板：至少4目标/2角色/2独立客户端端到端，再用非租赁小模板验证核心无行业硬编码。覆盖人工待办期间无关任务继续，重启后待办与任务还在。最终manifest必须覆盖传递源与lockfile（旧D-11教训），旧D-10错误透传模式不可照抄。给D版本/命令而不是“我测过”。

## B：持久执行与路由（现有“V7-B LangGraph 协作编排实现”）

仅B/**。消费A唯一契约，等待期间用明确contract stub做纯执行模块，不写共享schema。实现可配置目标执行图、规则限定的路由、LangGraph持久化checkpoint、独立worker和Celery隔离spike。A是业务事实权威，B不是第二套审批状态机。只允许一个实际queue owner和有限重试策略。

处理未发送/确定失败/发送后未知；unknown不盲重发，不把lease过期当API没执行。恢复时节点重入必须检查业务回执。超时、并发上限、取消、人工中断、显式恢复、陈旧结果丢弃可复验。人工授权在恢复入口，凭据不得进入checkpoint/日志/错误返回（包括verifier和authorizer抛异常）。

预留GLM-5.2 transport：endpoint/model/key注入、超时/响应校验/成本记录/出站允许策略，不猜供应商模型ID、不读取环境中的真实key。每次只给当前目标及必要证据，隔离project/run/role上下文，不传仓库或聊天历史。mock与real来源强标记；没有真实配置不能静默mock成功。

## C：商业租赁模板与隔离mock（现有“远程尽调现场界面C实现”，现backend C）

仅C/**。读取 V7/SIX_ROLE_COMMERCIAL_LEASING_20260915.md 中用户业务约束，只读不续前端工作。商业融资租赁非银行系金租；小微制造业资料不完整不是自动拒绝，高价格不是风险可接受证明，未知成本不编净收益；聚焦1—3个改变判断的问题。

产出符合A接口的目标模板/规则/确定性计算工具及至少8个差异化合成案例，其中2个多轮补证/矛盾纠正，一个非租赁小模板作抽象反例。六角色是职责配置，不强制每轮六次模型调用。确定性工具复用C既有计算，结果不授正式审批权。

实现独立loopback假API服务（真实socket而非仅直接函数fixture）：成功、缺字段、格式错、延迟、429/5xx、发送后断连/unknown、凭据异常敏感标记、跨项目串线探针。它只是模拟transport响应，不是真实模型能力或训练。固定种子、输入输出schema、每案独立数据，验证集不用于修改答案；预期基于用户规则/明确假设/计算，不以模型自评充当验收。

## D：独立反证与可恢复交付（现有“D独立验收与有限轮修复清单”）

仅D/**，A/B/C只读。先写外部可判定验收矩阵，不等别人全写完；稳定契约/版本到达后测真实HTTP/数据库/worker组合，故障注入只在自己资源。所有脚本有超时、断言数量、异常非零退出，不能suite异常/0断言仍PASS。

至少覆盖：两个客户端同时领取/提交、过期lease写回拒绝、消息重复与outbox重投、运行中杀worker后恢复、服务与DB重启持久化、人工缺证等待不冻结无关目标、证据替换定向失效、越权/跨项目操作、模拟提示注入不能升级权限、unknown零盲重发、费用/上下文限额、异常credential不泄露、API未配置如实拒绝、依赖清单与干净启动。

用独立client和预先判据验证，不只解析A的PASS文本。缺陷按严重性+owner+精确复现报告，owner修复后按新hash复测。有实质进展继续，无固定R1/R2；反复同一阻断无新证据不空转。自己不修产品。结论分模拟工程链路、真实provider未测、生产权限未测、第二机器未测。

## 全路共同交付与检查点

各lane维护STATUS.md/RESULT.md/evidence/（当前概要不要混旧记录），状态写已做/真实失败/依赖/下一步/恢复方法。先接口和环境，后窄闭环，再异常深度，不追求代码量。每个检查点落证据后在授权范围自行继续，不等用户普通确认；不得把自报成功当最终验收。

最终交付：README启动入口、锁定依赖、migration/recovery、可运行API和worker、配置化目标模板、mock服务、自动化正常/故障测试、输入输出与审计证据、未完成门。业务无前端也能运行；人以API/CLI测试客户端介入，CLI不模拟点击前端。到07:00可报告未完成但禁止伪装“完美”。
