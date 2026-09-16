# 见微 V4 P0 / P1 验收契约

状态：`FROZEN`

本文件只定义可证明的验收 Gate。任务创建、代码存在、测试文件存在或页面看起来合理都不等于完成。

## A. Contract Gate

- `V4-C-01`：用户可见内容只使用“直租、存回、新回”，不出现展开全称；
- `V4-C-02`：V4 domain 与 API 位于独立 namespace，不修改 V3 domain/runtime；
- `V4-C-03`：首个活细胞固定为直租信审例外 Case；
- `V4-C-04`：智能并行准备，正式权威线性；
- `V4-C-05`：政策是贯穿 Case 的规则、例外和版本服务，不是逐案必经人工审批。

## A2. Sandbox Execution Gate

- `V4-X-01`：受限 Windows sandbox 的 Node acceptance 直接使用 `node --test --experimental-test-isolation=none`，不经 package-manager test wrapper；
- `V4-X-02`：checkpoint manifest preflight 在 provider 调用前拒绝缺少 in-process isolation 的 Node test command；
- `V4-X-03`：任何 `spawn EPERM` 都是 execution failure，不能用 transport completion、代码 diff 或后续本地测试追溯接受；
- `V4-X-04`：`danger-full-access` 只允许当前 checkpoint 的显式 trusted child-process authorization，不能作为 V4 默认测试模式。

## A3. Compute Scarcity Gate

- `V4-K-01`：没有新增 Evidence、Context 或相关 CapabilityVersion 变化时，模型调用数为零；
- `V4-K-02`：相同 `Case/Attempt/Context + Evidence hash + CapabilityVersion` 精确 replay，不产生重复推理或重复 Compute Receipt；
- `V4-K-03`：新增 Evidence 只失效有明确依赖关系的派生产物，不默认重跑完整 Case；
- `V4-K-04`：执行顺序可证明为 deterministic validation/rule/retrieval/cache first，模型仅在未解决且有业务价值的不确定性上获得 admission；
- `V4-K-05`：Routing 选择满足质量边界的最小 eligible capability；升级必须记录原因、预算与未解决的不确定性；
- `V4-K-06`：budget exhausted、queue full、timeout、resource unknown 和 provider failure 均排队、转人工或 fail closed，不静默 retry、不乐观成功；
- `V4-K-07`：禁止空转 heartbeat、无界 Agent loop 和未配置上限的 inference concurrency；
- `V4-K-08`：每次真实模型执行产生独立 `ComputeReceipt`，绑定调用原因、Case/Attempt/Context、Evidence hash、Capability/Model version、cache hit、输入输出用量、GPU/wall time、outcome 与 fallback；
- `V4-K-09`：业务 Receipt 与 Compute Receipt 分离；模型/Agent/Harness 即使节省算力也始终 `authority=none`；
- `V4-K-10`：任何 H20 容量、吞吐、能耗、并发或 SLA 数值必须来自真实资源清单与可复现 benchmark，未知即标记 unknown。

## B. Domain Gate

- `V4-D-01`：业务线、来源、审核路径、尽调方式是四个独立字段；
- `V4-D-02`：标准路径与例外路径不由业务线枚举直接推导；
- `V4-D-03`：新回支持业务与信审共同现场尽调约束；
- `V4-D-04`：信审、商务、资产、起租是四个独立状态；
- `V4-D-05`：`approved_by_rule` 与 `approved_by_human` 都不会自动推进起租；
- `V4-D-06`：退回非终止、驳回终止当前 attempt、否决终局；
- `V4-D-07`：新 attempt 有新 `attemptId`，同时保留原 Case lineage。

## C. Authority Gate

- `V4-A-01`：model/Agent candidate 永远 `authority=none`；
- `V4-A-02`：规则只有在版本、范围、批准和回滚信息完整时才可成为 `authorized_rule`；
- `V4-A-03`：正式人工决定必须有具名 Actor、权限 policy、Context Version、rationale 和 Evidence Receipt；
- `V4-A-04`：UI click 不直接产生成功状态；动作成功必须有 Receipt；
- `V4-A-05`：失败、超时、unknown 和 stale Context 失败关闭；
- `V4-A-06`：未经组织确认的岗位到动作权限不被硬编码。

## D. Runtime Gate

- `V4-R-01`：Evidence/Event append-only，Projection 可删除重建；
- `V4-R-02`：同一 idempotency key + 同一规范化 payload 精确重放；
- `V4-R-03`：同键异 payload 返回稳定冲突且零写入；
- `V4-R-04`：oversize、invalid JSON、unknown Case、invalid action 均有 stable error；
- `V4-R-05`：reset 使用独立 V4 epoch，不读取或修改 V3 SQLite；
- `V4-R-06`：并发相同命令只生成一次 canonical Receipt；
- `V4-R-07`：业务线与审核路径的组合测试覆盖至少 3×2 矩阵。

## E. Frontend Gate

- `V4-F-01`：保留当前宏观骨架和视觉语言，主要改变内容与关系；
- `V4-F-02`：右侧三个区域不是机械均分，具有清晰间隔和独立边界；
- `V4-F-03`：总览区分作业面、管理面、演进面；
- `V4-F-04`：总览区分人员、系统部门、智能部门、系统资产和智能资产；
- `V4-F-05`：价值从第一可见层隐藏但未从 domain 删除；
- `V4-F-06`：信审工作面明确显示规则覆盖失败、Evidence、Candidate、Human Gate、Receipt 和下一 handoff；
- `V4-F-07`：自动信审通过文案明确“待商务/资产”，不出现自动起租；
- `V4-F-08`：退回、驳回、否决的文案、确认和结果状态不同；
- `V4-F-09`：loading、empty、error、success、disabled、retry、stale Context 可见；
- `V4-F-10`：1920×1080 无页面级横向/纵向溢出，核心信息无需滚动即可理解，console 无 error/warn。
- `V4-F-11`：`/`、`/work`、`/evolve` 三个页面均存在，并共享“管理总览、事项作业、体系改进”三个入口；
- `V4-F-12`：管理总览以多个事项、组织范围、异常、延误、返工和责任为主，不再以单个事项流程为主图；
- `V4-F-13`：事项作业只回答一个事项的事实、建议、人工确认、结果凭证与后续承接；体系改进只回答跨事项问题如何成为可回退版本；
- `V4-F-14`：第一可见层中文优先，必要技术缩写之外不存在装饰性英文标题，关键边界无需先翻译英文才能理解。
- `V4-F-15`：三个页面形成“管理总览讲架构 → 事项作业讲流程 → 体系改进讲系统改造”的可复述路径；每个首屏只回答一个主问题。
- `V4-F-16`：管理总览先显示组织、事项、专业流程、系统部门和智能部门的关系，再显示管理指标；体系改进明确现状问题、本轮改造对象和目标状态，不把生命周期卡片当成系统改造本身。

## F. Integration Gate

- `V4-I-01`：frontend 只消费 V4 server DTO，不在浏览器生成 Authority、Context 或 Receipt；
- `V4-I-02`：同一 Case/attempt/context identity 在 API、工作面、管理面一致；
- `V4-I-03`：动作后由 Receipt 驱动 Projection 刷新；
- `V4-I-04`：V3 tag `v3.0.0-archive` 保持不变；
- `V4-I-05`：V4 tests、typecheck、lint、build、HTTP Gate 与 real-browser Gate 全部通过；
- `V4-I-06`：README 和状态文档只描述真实已实现能力。
- `V4-I-07`：管理总览或体系改进中标记可下钻的事项，必须进入同一身份的事项作业页；未接入的背景事项不得伪装成可用链接。

## G. P0 完成条件

P0 只有在以下证据同时存在时完成：

1. `V4_CONTRACT.md` 与本验收契约已冻结；
2. V4 domain types 与 state transition tests 通过；
3. V4 管理总览候选在真实浏览器中可见；
4. V4-BACK 审计报告明确 V3 可复用资产、必须隔离资产和 P1 implementation slice；
5. Control 完成 cross-review 并确认 frontend/backend 没有各自发明契约。

## H. P1 完成条件

P1 只有在一个直租信审例外 Case 能真实演示以下闭环时完成：

```text
Evidence accepted
  → rule cannot cover
  → candidate prepared (authority none)
  → named human decision
  → return/resubmit or final credit result
  → canonical Receipt
  → handoff to commercial
  → commencement still not_started
```

页面、API、Event、Receipt 和测试必须对同一条事实链给出一致答案。
