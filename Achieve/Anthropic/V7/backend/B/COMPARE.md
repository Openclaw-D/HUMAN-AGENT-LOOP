# COMPARE｜LangGraph JS vs 直接薄编排（同一用例，2026-09-15）

实验口径:两候选实现**同一张用例图**(src/graph-def.mjs 冻结):业务事件→按需选角色
(六角色不强制全跑)→模型+可验证计算工具→补证等待/人工中断→恢复。共享同一 adapter
(V6 契约 v1)、同一回执/事实端口、同一 resume 校验核心(src/resume-core.mjs)。
等价性测试(test/equivalence.test.mjs)断言两候选在七条路径上终态、步状态、authority、
工具 inputHash 完全一致。

## 结论(先说裁决依据)

**两个候选都能满足本轮全部硬性语义**(真实落盘、崩溃恢复、副作用幂等、人工身份/版本
校验、未发送/失败/未知三分)。差异在工程面:

| 维度 | 直接薄编排(thin) | LangGraph JS 0.2.62 |
| --- | --- | --- |
| 编排核心代码量 | ~410 行(含 journal 折叠) | 图定义+节点 ~330 行 + 自研文件 checkpointer ~230 行 |
| 运行时依赖 | **0**(纯 node:内置) | 34 个包(langgraph+core+transitive,含一个 deprecated uuid@9 警告) |
| checkpoint 落盘 | 自研 journal.jsonl+snapshot(~90 行) | **必须自研 checkpointer**(官方只有内存/SQLite/Postgres,文件版要自己写 ~230 行并镜像 MemorySaver 语义) |
| 崩溃恢复语义 | journal 重放=intent无回执判unknown(直白) | 引擎重跑节点+回执端口兜底(两套机制叠加,需理解 superstep 才能推断行为) |
| 人工中断 | 显式终态+resume API(普通函数) | 原生 `interrupt()`/`Command(resume)`——**这是 LangGraph 真正的增量**:暂停点由框架持久化,恢复值定位到确切语句 |
| 拒绝语义 | resume() 抛错(调用方 catch) | 拒绝=再次 interrupt(pauseNotice 状态化)——更贴合"人工门"交互 |
| 并发表达 | 手写 Promise.all 轮次循环(~20 行) | 静态图扇出免费获得(superstep 并发) |
| 动态步集合 | 天然支持(数据驱动) | 静态图+动态激活模式:6 角色各建静态节点,未选中即 no-op;**新增角色/事件类型要改图结构** |
| 节点名限制 | 无 | **不允许 ':'**(步 id `model:credit:risk_review` 必须转义注册名) |
| 调试/审查 | journal 是人可读事件流,tail 即审 | channel_values 序列化二进制(base64),审计要写工具读 checkpointer |
| 可迁移性 | 拷目录即迁(零依赖) | 需锁 34 包版本+Node≥20;但图定义/状态/channel 是标准 LangGraph 资产,换平台(如 LangGraph Server)可平滑 |
| 上手成本(低代码同事) | 读懂 journal+async 函数即可 | 需理解 Annotation/channel/reducer/superstep/checkpoint 协议 |

## 判断(供 A/用户裁决,非决定)

1. **本轮语义要求下,thin 已够**:我们需要的"可恢复"是业务级(journal+回执),LangGraph
   的 checkpoint 只覆盖状态快照,**副作用幂等仍要自己建回执层**——这正是合同 §6
   "checkpoint 不替代业务事实源"的实证:两候选最终共用同一 receipts 端口,LangGraph
   并没有替掉这部分工作。
2. **LangGraph 的真实价值**在 interrupt/Command 人工门与未来图结构演进(多分支、
   子图、人工审批节点化)。若后续编排图复杂度上升(>10 节点、动态分支、并行人工门),
   其状态管理优势才开始兑现;当前 4 类事件×≤3 步的规模,静态图+动态激活反而引入
   "注册名转义、图循环轮次"两类纯框架性复杂度。
3. **维护风险点(LangGraph 候选)**:0.2.x 处于快速演进期,`WRITES_IDX_MAP`/`TASKS` 等
   协议常量未从公开入口稳定导出(我们复刻了常量并标注来源,升级依赖必须复核);
   文件 checkpointer 官方缺位意味着这部分永远是自维护代码。
4. **建议方向**:A assembly 集成以 **thin 为默认候选**(零依赖、审计直读、语义直白),
   LangGraph 候选连同其文件 checkpointer 保留为 B 目录内平行实现与比较基线;当编排图
   需要真正的动态分支时再议切换。两候选共享 graph-def/resume-core/bridge/ports,
   切换成本=只换编排壳。

## 证据

- 等价性:pass 7/7(equivalence 段,evidence/test-run-all-20260915.txt)
- thin 恢复矩阵:pass 11/11;LangGraph 恢复矩阵:pass 10/10
- 依赖清单:package.json 精确锁版(@langchain/langgraph 0.2.62 / @langchain/core 0.3.68)
