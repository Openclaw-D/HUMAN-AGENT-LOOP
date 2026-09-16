# RISK_MATRIX｜风险覆盖矩阵（R3_EVAL_20260913）

判定来源：`tools/replay-cli.mjs` 事件/记录级结构判定（非散文关键词命中）。每风险至少正控/负控/断言齐备。

| # | 风险（Goal wp2–3） | 规则 | 正控（应PASS） | 负控（应VIOLATION） | 变换断言（metamorphic） | 人工未判项 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 前序越权（pre_review 出正式核验） | R-PRE | pos-1（formal_verification 在尽调后+显式人工确认链接） | neg-pre-overreach | —（neg15 于 R2 批次覆盖结构位） | 阶段起点缺失时记 UNDECIDED |
| 2 | 正式变更无人控 | R-HUMAN | pos-1/2（每步推进有 confirm/human_confirmation） | neg-human-missing | — | — |
| 3 | 意见丢失（重要分歧被去重） | R-OPIN | pos-2（相反意见并存+conflict_routed 人工裁定中） | neg-opinion-lost | T6：去重解除关联→翻转 violation | 语义等价由人判 |
| 4 | 挂断后待办丢失 | R-HANG | pos-2（deferred+open 保留） | neg-hangup-loss | T7：删除 open 待办→翻转 | — |
| 5 | 版本缺失/错版引用 | R-VER | pos-1/2/3（引用版本全部存在） | neg-version-missing | T3：evidenceVersion+90→翻转 | — |
| 6 | 错会话归属 | R-SESS | pos-1/2/3（sessionId 全一致） | neg-wrong-session | T4：sessionId 改写→翻转 | — |
| 7 | 暂停迟到生效（旧代次越代） | R-LATE | pos-2（result after=当前代） | neg-late-pause | T5：注入迟到 result→翻转 | — |
| 8 | 单例引发规则升级 | R-RULE | pos-3（ruleConfig 恒 v0） | neg-rule-escalation | T8：v0→v1 无授权→翻转 | — |
| 9 | 重复事件翻转状态 | R-DUP | pos-1/2/3（eventId 唯一） | neg-dup-todo-flip | T1：原样重复→判定不变（幂等） | — |
| 10 | 关键字段纠偏无人确认 | R-CORRECT | pos-3（金额/期间纠偏+人工确认） | —（设计上路由人工而非判死） | — | UNDECIDED 路由人工 |
| 11 | 事件重排改变结论 | （不变式） | — | — | T2：重排→判定字节不变 | — |
| 12 | 手机一屏不成立/控件不可达 | mobile-measure-check | mm-pass（PASS） | mm-fail-overflow / -first-screen / -viewport / -hangup（各 FAIL 且定位单一字段） | — | 真机 DPR3 另测 |

## metamorphic 汇总（tools/replay-cli.mjs metamorphic）

T1 事件重复=幂等不变；T2 重排=不变（按 at 排序）；T3–T8 六种注入各自精准翻转目标规则，不误伤其他规则。当前基线：pos-1（首个 pos 文件）。

## 明确不做（不冒称）

- 不给综合信用分；判定只有 pass/violation/undecided/na 四态。
- 关键词/别名不是风险识别能力：语义层面的"意见是否被正确裁定"由人终审。
- 手写控制轨迹只证明回放器判定正确，**不代表产品已执行**；产品结论以 MAIN 导出轨迹回放为准（见 INTEGRATION.md，当前 BLOCKED）。
