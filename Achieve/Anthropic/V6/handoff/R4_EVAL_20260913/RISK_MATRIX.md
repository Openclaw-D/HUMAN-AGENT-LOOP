# RISK_MATRIX｜风险覆盖矩阵（R4_EVAL_20260913）

判定来源：`tools/replay-cli.mjs`（v1.1.0-r4）事件/记录级结构判定（非散文关键词命中）。每风险正控/负控/断言齐备。
**R4 新增**：① `--gate` CI Gate 模式（violation>0→exit 4；undecided>0→exit 5；schema/来源失败→exit 5 BLOCKED；仅 pass/na→exit 0）——正反例退出码已实测（evidence-r4/gate-exitcode-verify.txt：pos=0、neg-pre-overreach=4、neg-hangup-loss=4、undecided样本=5、schema失败=5、旧报告模式恒0兼容）。② **T7 真变形重做**：不再依赖基线恰有 open 待办（旧版在该情形记 N/A，被 Codex 点名不能算"已变形验证"）——先注入 open 待办+挂断构造对照态（非 violation），再删除待办断言 R-HANG 翻转（T7a/T7b 双断言，selftest 33/33）。③ 产品 generation 非负语义兼容修正（真实 store 冒烟抓到 gen0 被拒的跨路错配，已修；neg-late-pause 夹具同步校准为 gen0 旧代次语义）。④ N/A / undecided / blocked 三者分列，零分母记 N/A 不记 0。⑤ 待 MAIN 输入包：见 EXPORT_COMMANDS.md 与 inputs-check（当前 0/3 轨迹、0/1 量测 → BLOCKED）。

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
| 12 | 手机一屏不成立/控件不可达 | mobile-measure-check | mm-pass（PASS） | mm-fail-overflow / -first-screen / -viewport / -hangup（各 FAIL 且定位单一字段） | — | 真机 DPR3 另测；MAIN 真实量测未收到（BLOCKED） |
| 13 | 旧截图/跨批次复用冒充本轮证据 | inputs-check + measurement.meta.screenshotHashes 对拍 | 同运行 hash 一致 → 接受 | hash 缺失/不一致/跨批重复 → 只作历史证据 | — | — |

## metamorphic 汇总（tools/replay-cli.mjs metamorphic）

T1 事件重复=幂等不变；T2 重排=不变（按 at 排序）；T3–T8 六种注入各自精准翻转目标规则，不误伤其他规则。当前基线：pos-1（首个 pos 文件）；变换副本写 evidence-r4/runtime/。

## 明确不做（不冒称）

- 不给综合信用分；判定只有 pass/violation/undecided/na 四态。
- 关键词/别名不是风险识别能力：语义层面的"意见是否被正确裁定"由人终审。
- 手写控制轨迹只证明回放器判定正确，**不代表产品已执行**；产品结论以 MAIN 导出轨迹回放为准（见 INTEGRATION.md，当前 BLOCKED）。
