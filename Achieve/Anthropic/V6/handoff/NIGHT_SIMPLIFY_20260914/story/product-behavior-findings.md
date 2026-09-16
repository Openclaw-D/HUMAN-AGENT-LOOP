# 产品行为探针发现（story 路对真实产品代码逐行为核对）

- 运行时间：2026-09-14T00:53:29.174Z
- 被测对象：`jianwei-v3/site/lib/v5-preview/demo-story-{data,service,types}.ts` + `service.ts` + `store.ts`（源码只读；数据目录=临时隔离目录，已清理；被测数据=A 续轮 2026-09-14 08:10 版 22 步表）
- 判定图例：OK=已落地；MAPPED=合理映射（语义等价或已明确补充条件/退出方式）；GAP=缺口（v2 候选已修，待 A 采用）；HOLD=保留/需产品决定

| # | 核心机制 | 机制预期 | 产品实际行为（探针） | 判定 |
| --- | --- | --- | --- | --- |
| 1 | 重新开始 / 起点（重启=既有 seed approval；s00 签名一致） | 重启后 GET 即 story 模式、当前步=s00 | mode=story, step=s00-opp-01, stepsTotal=22 | ✅ 已落地 |
| 2 | 常规自动动作链式推进（机制 advanceAuto 同语义） | 一击连穿常规步；在人工动作步（发起访谈/现场补充）与决定点停下 | 落点序列 s00-opp-01→s03-dd-01→s05-dd-03→s09-dd-07；人工动作步停链=true | ✅ 已落地 |
| 3 | 人工决定门（决定点 advance 被拒） | 409 STORY_DECISION_REQUIRED | 按预期拒绝 | ✅ 已落地 |
| 4 | 防跳步/串线（fromStepId 与当前步不符） | 409 STORY_STEP_CHANGED | 按预期拒绝 | ✅ 已落地 |
| 5 | 版本门（expectedVersion 过期） | 409 VERSION_CONFLICT 带 serverVersion | 按预期拒绝 | ✅ 已落地 |
| 6 | 非法决定拒绝 | 400 INVALID_INPUT（不在 confirm/correct/return 内） | 按预期拒绝 | ✅ 已落地 |
| 7 | 重复动作：同 requestId 同载荷=幂等重放；异载荷=明确拒绝 | 重放 replayed=true 且状态一致；同 requestId 改载荷 409 REQUEST_MISMATCH | replayed=true；异载荷拒绝=true | ✅ 已落地 |
| 8 | 确认后继（DD-07 confirm → 尽调汇总） | 后继=s13-dd-08；汇总消息含「无正式审批结论」 | step=s13-dd-08；结论文案存在=true | ✅ 已落地 |
| 9 | 纠正后判断更新可见（预期：更正记录消息 + M1-DOC-01 v2 证据引用可见 + 旧口径分析作废声明） | correct 分支产生可见的更正留档内容；note 只是补充留档，不是唯一载体 | 更正记录消息=不存在（correct 与确认的预设内容不可区分）；note留档=true；落点证据引用=[无] | GAP（v3候选已修：correct→效果应用步 s13c） |
| 10 | 退回后继与有限性（补充条件与退出方式） | return→补交材料(hold)→复核→再判点；再判点仅确认/纠正（再退回被明确拒绝）；每圈必经人工补充步 | return→s10-dd-rt-1（人工动作停链）→advance 链至 s12-dd-07b；再退回拒绝=true（INVALID_INPUT）；确认退出→s13-dd-08 | OK（已对齐 C 机制有限路径；每圈必经人工补充步=补充条件明确） |
| 11 | 判断灯不回退（主线绿灯集单调，修复『状态变绿』叙事的回退） | 确认主线全程绿灯集不缩小 | 在 s09-dd-07 出现绿灯集缩小 | GAP（v3候选已修：s07/s08/s09–s12 累积式四域行） |
| 12 | 签约前人工复核门（制度必需决定不自动越过） | advance 被拒，必须 decide | 按预期拒绝 | ✅ 已落地 |
| 13 | 四域全绿仅在终态（不提前全绿） | s18..s20 不得全绿；s21（settled 种子签名）全绿 | 中途全绿=未出现；终态全绿=true；scenario=settled | ✅ 已落地 |
| 14 | 结清终态（advance 拒绝，提示重新开始） | 终点无后继，明确拒绝 | 按预期拒绝 | ✅ 已落地 |
| 15 | 快照恢复/刷新（overview 内容签名=唯一事实源推导当前步） | 项目沟通（消息通道，版本+1、消息+1）后，GET 仍定位同一步（消息不参与签名） | before=s03-dd-01, after=s03-dd-01, mode=story | ✅ 已落地 |
| 16 | story 待办上提交补充说明（设计张力：既有 notes 语义 vs 固定演示签名） | 机制期望：演示中的判断留档留在演示状态内；产品现行为：待办状态翻转→签名脱离→free（诚实提示+重新开始兜底；A 测试已接受） | 提交后 mode=free（free=按既有设计脱离） | MAPPED（合理映射·既有语义优先；若希望演示内判断留档不跌出，需产品决定：story 待办禁用 notes 或状态不翻转） |
| 17 | free 模式诚实降级（签名脱离固定路线） | mode=free + 诚实说明，不改用户状态 | mode=free, notice=有 | ✅ 已落地 |
| 18 | 决定效果消息在预设数据中（correct 留档可见性） | correct 分支的可见内容含更正记录 | 数据含更正记录消息=false | 见 P5 判定（v3候选已修） |
| 19 | 选项标签/prompt 一致性 | 无裸标签；prompt 不与选项自相矛盾 | 裸标签=无；prompt矛盾=无 | ✅ 已落地 |
| 20 | 预设消息不冒充模型判断 | 模型署名必须带（模拟）+正文声明模拟+authority=none | 全部合规 | ✅ 已落地 |
| 21 | 人工动作步停链（holdForHuman） | 发起访谈/现场补充/补交材料/签约补充 四步停链 | hold 步=s03-dd-01,s05-dd-03,s10-dd-rt-1,s16-sg-rt | ✅ 已落地 |

## 探针局限（如实）
- 「重新开始」以 store 写入 approval 种子模拟（与 POST /api/v5-preview/demo/seed 同语义）；未走 HTTP 路由与浏览器 UI（UI 由 A/D 覆盖）。
- 探针运行时产品数据为 A 已集成的 v1 22 步表；标「v3候选已修」的 GAP 行在采用 `candidate/a-shape/demo-story-a-v3.json`（23 步）后应转 OK——采用后请重跑本探针复核。
- 探针不覆盖 CSS/响应式/键盘可达性（B 路 D 路范围）。