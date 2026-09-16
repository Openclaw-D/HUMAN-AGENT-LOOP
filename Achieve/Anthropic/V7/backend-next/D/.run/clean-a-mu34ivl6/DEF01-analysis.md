# DEF-01 反例分析与最小修复候选（v1.3，语义 PENDING-USER-RULING）

2026-09-16 03:05 监督纠偏回应。范围：只在 `V7/backend-next/A/**` + 共享契约。

## 1. 反例（v1.2 语义下成立，证明"必要下游"未被失效覆盖）

模板三代链：`intake`（绑定 facts）→ `assess`（绑定 facts，依赖 intake）→ `recommendation`（**不直接绑定任何证据**，依赖 assess）。

流程：
1. intake 执行 → 人工验收 accepted；assess 执行 → accepted；
2. recommendation 执行 → candidate_ready（或继续 accepted / decided）；
3. 此时 facts 被取代（supersede v1→v2）。

v1.2 行为：
- intake（accepted，直接命中）→ 仅置 stale 读投影，**级联停止**；
- assess（accepted，直接命中）→ 同上；
- recommendation：自身无引用、上游 accepted 处级联已停 → **完全不受影响**；
- 结果：recommendation 可以被无提示地验收、甚至形成新的正式决定（decided）——而其依据链的根部证据已被推翻。若 intake 在取代前已被 decided，同样只留审计，recommendation 照常继续。

**违反的原要求**：任务书 §A"证据更新通过引用映射失效受影响目标及必要下游"。实现注释（"下游继续消费已验收产出"）是实现者自封语义，不是用户业务授权——监督纠偏正确指出这一点。

## 2. 底线区分

- **保留历史正式决定是底线**：decided 的 formal_decision 不改写、accepted 的验收记录不删除、历史证据不销毁。
- **不可把"不改写历史"等同"下游可无提示继续"**：失效信息必须对下游可见，且在新的正式性时刻（accept/decide）强制人工知悉。

## 3. 最小修复候选（v1.3 实现；语义为候选，待用户裁决）

三条规则，全部**不重写任何历史**：

1. **传递 staleness（读投影，计算而非落库标记）**：`stale(goal) = 自身输入引用已被取代的证据 OR 任一传递依赖 stale`。在 GET goal/project 读路径与 accept/decide 命令内计算（小规模 memo 递归）。decided/accepted 目标同样带 stale 读标记——决定/验收本身不变，只是"其依据事后被推翻"这一事实对读方可见。
2. **accept/decide 人工复核门（fail-closed）**：目标自身 stale 时，accept/decide → 409 `UPSTREAM_STALE`（错误体列出失效依赖 goalId/goalKey）；请求携带 `staleReviewAck:{note}` 且 principal 为验收/决定人类角色 → 放行，并写审计 `stale_review_acknowledged`。即：要么被阻止，要么人明确知悉且留痕——"无提示继续"结构性不可能。
3. **清除路径（不发明重审制度）**：invalidated 目标按既有规则重绑新鲜输入回 ready → 其 stale 计算自然为 false（自身输入新鲜）；accepted 的 stale 清除**不提供自动机制**（重开 accepted = 制度问题，留待用户决定；本候选不扩 resume 到 accepted）。decided 永不重开。

## 4. 明确不做 / 待用户裁决

- 不自动撤销、不自动重开任何 accepted/decided；
- 不定义"谁有权重审/重开"——这是公司制度，本候选只提供技术上的"可见 + 阻止无提示继续 + 显式留痕"三件事；
- `staleReviewAck` 的放行语义、以及是否需要更强的"先复核上游才能验收下游"制度，均待用户裁决；当前候选取 fail-closed 方向（与"失败关闭优先于速度"一致）。

## 5. 对既有消费方的影响

- B：claim/complete 不受门影响（门只在 accept/decide）；B 永不自报验收，无兼容问题。
- C：plans 不做 accept，无影响。
- D：D-19 反例按新语义复测——下游应可观察到 stale 标记（decided/accepted 含）且 accept 被门拦截。
