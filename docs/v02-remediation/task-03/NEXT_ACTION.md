# 任务03 · NEXT_ACTION

更新：2026-09-19（本轮收口时点）。

## 立即（本任务 writer 范围内）

1. ~~全量回归结果回填 TEST_RESULTS.md~~ 已完成：**149 项 → 148 pass / 0 fail / 1 skip**（skip=容器重启用例按边界守卫；A22 迁移清单断言按惯例适配 001–011）。typecheck 0 error。
2. 维护 CONTRACT §12 作为其他三路的唯一接口事实源；收到 `interface-change-request.md` 后按小版本/破坏性规则裁量升版。

## 交其他任务（接口已备，等待消费）

1. **任务03/Edge（goal-03 路）**：工作台快照的 assessments / financingRequests 引用切换到 `GET /api/v2/customers/:id/assessments|financing-requests`（分页+授权语义见 CONTRACT §12.1），切换后移除 `refsSource='event_buffer'/refsExhaustive=false` 标注并回归（IR-03-A ①② 可关闭）。
2. **任务02/Connectors**：处理链继续走 §11.1 service 身份三口 + §12.3 清单/处理引用；新客户归属校验=租户绑定服务身份 + `lockCustomer(tenant)` 既有门（无需逐客 SQL 配置，契约表述见 POLICY_PENDING.md §3）。
3. **任务04**：验收清单可引用 `test/risk-recheck-task03.test.mjs` 的 R1–R5 作为办理链信任边界的独立实测证据。

## 待用户/Codex 裁决后才能动（不可单方实施）

- P-03a Gate 回执输入绑定是否收紧（需与 C 路规则引擎形状协调）。
- P-03b 豁免撤销是否追溯阻断既有冻结包的提交点。
- P-03c disburse 当前性门边界（不改政策，仅裁决；清单见 POLICY_PENDING.md §1）。
- P-03d 客户身份对其余 v2 读面是否统一收紧。
- IR-03-A ③ 根修（提交时分配 seq）如需推进，另立性能/语义轮次。

## 边界重申

未 commit/push、未切分支、未建 worktree；未动 Front/B/C/D/Connectors/Edge；未用 `--allow-legacy-basis` 证明新办理链（测试全部走新权威门）；未用 SQL 伪造案例业务状态（白盒仅用于权限矩阵/必需域政策这类"明确标注的一次性合成政策初始化"）。
