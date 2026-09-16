# D路 → A 反馈（NIGHT_SIMPLIFY_20260914）

给A的可执行短反馈。逐条给位置、风险、建议；D 不改产品代码。关联审查记录：qa/REVIEW_NOTES.md。

> **02:25 增补（高优先）**：3469 UI 实测发现两个远程尽调页状态可靠性缺陷，直接落在 A 的 CP3 改造范围内：
> **D-01（高）** 每次 UI 成功写入都留下"结果未知"幽灵条目（runWrite 的 resolve 键用 payload UUID，注册表条目键是 `req-*`，永不匹配；堆积到16条触发背压会中断演示）；**D-02（高）** 新会话「发起关键问题」首次点击静默失败（`runWrite` 返回 undefined，`(attached).evidence` TypeError 被吞；固定演示首路径第一步）。复现、根因、证据、建议方向见 `qa/DEFECTS.md` D-01/D-02。A 重构该页时请一并处理，修复后 D 复测。

## F-D1（较高）过渡步骤表的线性顺序使纠正/退回分支语义混排，且 hint 承诺未兑现

- 位置：`lib/v5-preview/demo-story-data.ts`（s02/s02c/s01r 与 s04/s04c/s03r 两组）+ `demo-story-service.ts` `runStoryCommand` advance 分支（严格 `DEMO_STORY_STEPS[idx+1]`）。
- 现象（按当前数据推演）：
  1. **纠正路径踩到退回品牌步骤**：s02 选「纠正」→ s02c（纠正意见处理中）；再「推进」按线性落到 s01r，其标题/消息是「**已退回远程尽调**：补充检修记录现场确认…按退回意见」——纠正用户看到退回话术。签约组同理（s04c → s03r「已退回商务」）。
  2. **退回后不重新进入人工判断**：s02 选「退回」→ s01r；再「推进」直接到 s03（签约准备）——跳过再判断。而 s02c/s01r 的 hint 都写着「纠正后**重新进入人工判断**」「补充后重新汇总，**再次进入人工判断**」，数据没有兑现。C 的状态图（story/demo-story.json）里退回路径是 DD-RT-1→DD-RT-2→**DD-07B（再决定点，仅确认/纠正）**，纠正路径同样回 DD-07B；按 §4 映射时当前服务端模型表达不了这个收敛。
- 风险：CP2 验收项「确认/纠正/退回后状态符合C」会失败；演示中人工选择纠正却被展示为"已退回"，语义误导。
- 建议（任选，D 无偏好）：
  a. 服务端 advance 不用线性 idx+1，改为每步显式 `advanceTarget`（或 decide 后记录路线）；数据为 C 的分支各配后继；或
  b. 分支共用一个**中性品牌**的"补充/纠正材料已更新"步骤 + 一个再决定点（该步 judgmentText/标题不写"退回/纠正"任一方话术），线性序排布为 决定点→纠正步→补充步→再决定点→汇合。此方案零服务端改动。
- 时效：请在集成 C 数据（§4 映射）时一并处理，避免二改。

## F-D2（中）数据不变量请加自动断言：签名唯一 + s00==approval 种子

- 位置：`demo-story-types.ts` 签名字段（scenario/todoId/todoStatus/progressLabel/4域 segments+judgment+judgmentText；**不含 summary/scenarioLabel/消息**）。
- 风险：任两步签名相同 → `findStepByOverview` 永远命中前者，后者不可达且步骤门误判；s00 与 `createSeedOverview('approval')` 签名不一致 → 「重新开始」后 GET story 变 `mode=free`，演示入口失效（签名含 judgmentText，逐字差异即破坏）。
- 建议：A 的测试里加两条断言（全表签名互异；s00 签名 == approval 种子签名）。D 在 story 可测后也会独立复验（含 settled 终点签名碰撞检查：s07 与 settled 种子若同签名属可接受，但需 A 知晓）。

## F-D3（中，演示内容卫生）共享 M1 会话含昨夜测试残留，建议交付前清理或重置内容

- 现象（02:15 只读目验 3467）：
  1. 远程尽调页历史问答两条标注各带 **4 组完全重复**的模拟回复（「【模拟】针对证据…示例发现/请补充说明…取得方式」×4，疑为昨夜验证期多轮追加残留）；
  2. 当前关键问题标题带测试字样「（**闭环验证**）」；
  3. 首页项目沟通有 00:36 的「**你在吗**」消息（业务·演示身份）。
- 风险：演示观感；不涉状态可靠性。归属：rs-mtzpo3q1-j33xtuqj 内容由 A 决定如何处理（A 已声明本路不创建/不重置/不删除远程会话——若决定保留，请在 RESULT 说明理由）。

## F-D4（低，记录在案）错误状态码映射

- `demo-story-service.ts` `demoStoryErrorResponse`：非 DemoStoryError 的 V5PreviewServiceError（如 STORE_CORRUPT）经 `ERROR_STATUSES[code] ?? 400` 落成 400。失败关闭成立，仅语义上存储损坏更像 5xx。不阻断，A 自行取舍。

## 无问题确认（供 A 省心）

- 幂等查找先于版本门、同 requestId 换载荷 409、replay 不重复追加消息（id 含 requestId 后缀）✓；
- 版本门/步骤门/决定门顺序与 CONTRACT §5 一致，错误码与状态码齐备 ✓；
- 消息不参与签名（用户随时聊天不中断演示）的设计与「签名不匹配 → free 不覆写」方向正确 ✓；
- 服务层同步无 await 穿插，`applyStepAndRespond` 记录幂等与落盘同块原子 ✓。

---

## [D 增补 02:55] D-05（中）：离开固定路线后演示条陈旧

复现：story 模式 s00 → 演示控制切情景到「起租后资产管理」→ 演示条仍显示「第 1/12 步」，≥2 个轮询周期不自愈；刷新后才显示「未在固定路线」诚实提示。服务端 GET story 即刻正确（mode=free）。建议：overview 轮询/seed 响应路径上同步重推导 story 状态（或演示条由 overview 版本变化触发 re-GET）。详见 DEFECTS.md D-05。

## [D 增补 02:50] F-D1 复测结果：基本修复确认

你已实现显式 `current.nextStepId` 优先后继。HTTP+UI 复测：退回→s01r→s02 再判断 ✓、纠正 note 留档 ✓、退回后非全绿 ✓。残留（低）：退回无次数限制（同签名步骤无法区分首末次；C 语义是再入节点仅剩确认/纠正）——A 裁量，D 不作为本轮阻断。
