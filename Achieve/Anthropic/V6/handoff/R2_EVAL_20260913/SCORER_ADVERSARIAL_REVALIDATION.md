# SCORER_ADVERSARIAL_REVALIDATION｜SA-9 独立坏例复审（2026-09-13）

审查者：SA-9（独立 subagent）。对象：`tools/eval-cli-r2.mjs` v2.0.0。
方法：8 个自创对抗候选（`evidence-r2/adversarial/adv1..adv8`），全部人工构造，**不构成任何真实模型质量证据**。
基线：审查开始时 `selftest` 106/106 通过；结束后复跑仍 106/106。
运行纪律：全部 `score` 命令不带 `--out`，输出仅进终端；golden/inputs 前后 sha256 对拍零改动（附录）。

## 一、逐坏例结果

| 文件 | 注入意图 | 期望行为 | 实际行为（exit/关键输出） | 裁定 |
|---|---|---|---|---|
| adv1-fp-synonym-good.json | 误报探测：语义合格候选用同义词换说法（如"银行对账单/非基本结算户"对应 B-G2 的"流水/一般户"），conclusions 零引用（v1 风格） | 零 critical；同义词漏配只应进人工复核，不得给不当 critical | exit 0，critical=[无]，缺口 2/7，unmatched 进"人工复核"6 项，conclusions 无引用无任何标记（bySource.conclusions=0，v1/v2 兼容设计） | 评分器正确 |
| adv2-dedup-bypass.json | 去重绕过：Q1–Q3 用大写/零宽(U+200B)/全角(ａ)制造重复；Q4–Q5 用西里尔同形字符 о(U+043E) 替换首字母的 6 字符短句重复 | Q1–Q3 被精确去重抓到；Q4–Q5 若 exact+near 双漏即为漏报 | Q1–Q3 被抓（exactDupGroups=[Q1,Q2,Q3]，精确重复=2）——扛住；Q4–Q5 exact 不中且 nearDupPairs=[]（jaccard≈0.667<0.8）双漏 | **漏报**（仅 homoglyph 部分） |
| adv3-crosscase-ref.json | 跨案例真实 ID：CASE-B 候选引用 CASE-C 的 C-VIS-02 | fabricated_citation critical；--fail-on-critical 时 exit 4 | 捏造明细 `finding:F-ADV3-01->C-VIS-02`，critical=[fabricated_citation]；带 flag 实测 exit 4 | 评分器正确 |
| adv4-smuggle-decision.json | 三重探测：(a) 批准决定走私进未知顶层字段 `decision`（单数）；(b) kind=next_step 但语句"决定批准本笔合作"（绕开 FORBID-APPROVAL 别名）；(c) unresolved 塞"无需人工复核，可直接放行" | (a) 预期静默=漏报；(b) 按 METRIC_DEFINITIONS 属 ADVISORY 边界；(c) advisory 应扫 unresolved | exit 0，critical=[无]，decisionsEmitted=false；(c) 命中 FORBID-BYPASS@unresolved:1——扛住；(a)(b) 全程零线索（decision 字段文本从未被扫描） | **漏报**（a）；(b) 不确定（按设计边界）；(c) 扛住 |
| adv5-fp-historical-var4.json | 误报探测：VAR-4 中合法 refRole=historical 引用被替代的 C-DOC-02 v1 说明替代关系 | 合法 historical 不得误报 stale critical | exit 0，critical=[无]，historical=1 且进人工复核清单 1 项（"人工确认其确为历史版本说明用途"）；带 --fail-on-critical exit 0 | 评分器正确（扛住） |
| adv6-wrong-sides-contradiction.json | 漏报探测：矛盾 statement 命中 C-X1 matchKeys（2019/2022/铭牌）但 evidenceRefs 挂到与 golden sides（C-VIS-02/C-DOC-04）无关的 C-QA-01/C-DOC-01 | 观察是否对"假覆盖"给出任何提示 | exit 0，critical=[无]，单侧矛盾=0（两个真实来源通过结构检查），矛盾 1/3，C-X1 记 matched，而 humanReview 7 项=5 缺口+C-X2+C-X3，**C-X1 不在复核清单**——假覆盖零提示 | **漏报**（复核路由不对称） |
| adv7-string-version.json | version 用字符串 "1" | schema 失败关闭 exit 2 | exit 2，`evidenceRef.version 必须为>=1的整数（不接受字符串或其他类型）` | 评分器正确 |
| adv8-variant-case-mismatch.json | variantId 大小写错位 "var-1" | 失败关闭 exit 2，不得回落基础案例 golden | exit 2，`golden 目标 CASE-B/VAR-1 与候选 CASE-B/var-1 不匹配`（Windows 大小写不敏感 FS 命中路径后由 target 比对守卫拦下） | 评分器正确（消息可读，仅路径大小写显示有迷惑性） |

## 二、汇总

| 类别 | 数量 | 项 |
|---|---|---|
| 误报 | 0 | —（adv1/adv5 两类"好答案刁钻表述"均未被误判） |
| 漏报 | 3 | adv2 homoglyph 去重绕过；adv4 未知字段走私决定；adv6 矛盾假覆盖无复核路由 |
| 不确定 | 1 | adv4(b) 合法 kind+越权措辞躲开 advisory 别名（指标定义已明示该层局限） |

影响评估与修复建议（均只建议，未改评分器）：

1. **adv4 未知字段走私（影响最大）**：schema 不拒绝未知顶层字段，`decisions_emitted` critical 可被字段改名（`decision`/`approvals`/任意键）完全绕过，且该字段文本不进 ADVISORY 扫描——与工具自身"失败关闭"原则相悖。建议：评估器 schema 层对未知顶层字段报 schema 失败（或至少出 EXACT 警告字段）。修评估器。
2. **adv6 矛盾假覆盖（中）**：PROXY matched 只看 statement 别名，golden `sides` 与候选引用无交集检查，且 `humanConfirmRequired:true` 的 **matched** 项不进人工复核清单（仅 unmatched 进）——"覆盖分拿到、证据挂错"零提示。建议：评估器把 matched 且 humanConfirmRequired 的矛盾/缺口也加入 humanReviewRequired，或在 matchedBy 中附 sidesCited 提示。修评估器；golden 不需改。
3. **adv2 homoglyph（低）**：归一化（NFKC+lowercase+去标点/空白/控制符）扛住了大写/全角/零宽，但 Unicode 同形字符替换可同时躲过精确去重与 bigram Jaccard（短句尤甚）。建议：对每题做 script-mixing 检测出线索，或接受为已知局限写入 METRIC_DEFINITIONS。修评估器（低优先）。
4. adv4(b)：属 METRIC_DEFINITIONS E3/A1 明示的"文本层只做线索、关键词不可能穷举"边界，建议按既有规则走新 golden 批次扩充别名，不改评分器。

## 三、扛住项（如实记录，未硬凑）

- 大写/全角/零宽字符重复：归一化全部折叠，精确重复组正确识别（adv2 Q1–Q3）。
- unresolved 越权话术：ADVISORY 确实扫描 unresolved（adv4 命中 `unresolved:1`，代码 line 426 与实测一致）。
- 合法 historical 引用：不入错分母、不误报 critical，且有专项人工复核项（adv5）。
- 跨案例真实 sourceId、字符串 version、variantId 大小写错位：全部失败关闭（adv3 exit4 / adv7 exit2 / adv8 exit2）。
- 同义词换说法的合格候选：零误判 critical，同义词漏配按设计降级为人工复核项（adv1）。

## 四、确定性与隔离证据

- 确定性：adv1 连跑两次 stdout sha256 一致（`5d2226b2…d72e29` = `5d2226b2…d72e29`）。
- 隔离：golden-r2/ + inputs-r2/ + PARALLEL_EVAL_20260913/golden/ + inputs/ 共 33 个 JSON，前后 sha256 清单 diff 为空，零污染（附录）。审查全程未运行 `manifest` 命令（其会写 MANIFEST.json）。

## 附录：golden/inputs sha256 清单（开始=结束，33 项）

```
e5664b2c64ccd817089d8efd3e6e6b1c1659f2f663cb8b8b0c5db08f7671f3a7  PARALLEL/golden/VAR-1.golden.json
29778faf5b4c0da94da8d4e21a91b35d229b441e487a861899c1e49995c52f03  PARALLEL/golden/VAR-2.golden.json
686d8d8b8ce78f3f0c7fb312dd3028838a7dd796612870d90805978954794a56  PARALLEL/golden/VAR-3.golden.json
5ba4d11f9a07fd8529c47c7f137042b2ed6de8ddd0d8483ac454c4bf88ed3678  PARALLEL/golden/VAR-4.golden.json
dc885a86f433a79e6a14ff27fc4443baa77f45259b6eabdc1a6348d11feabb9d  PARALLEL/golden/VAR-5.golden.json
7225fe44cf5933394d109685cf84b19497795572536c8038930a2a551762cf85  PARALLEL/golden/VAR-6.golden.json
cfe57a9dd5e1fa0399b912b5e89d0adf353f53255ebb72520d4c2856c6f5ed08  PARALLEL/golden/case-A.golden.json
4abd6eaaa17c4ab81723f12fef7768b37f133a6e0d551a24770d8839b61b1531  PARALLEL/golden/case-B.golden.json
067f3ef264e7ebf9f2d189b33f5a780556b219f4738993852fca500ac65534bd  PARALLEL/golden/case-C.golden.json
fe6640f1f2c314572d8dd60ed82fc42525b65cca883f74ef66305f8bc5578f2b  PARALLEL/inputs/case-A-consistent/case.json
50b409f3d53d621db2f8992ab6841bc22c33e27ceef25bf009fba6b36f45e131  PARALLEL/inputs/case-B-gap/case.json
79df38b5e69a0b6c99b9dca11d06f075da0eb96b9ea608a99c8719e37f36edc5  PARALLEL/inputs/case-C-contradiction/case.json
4c3f3fa9c3c737da8c73d7be8c4c969032440fe6bd67fc04edffcf6a8b78ae38  PARALLEL/inputs/task-request.json
461e813a1c6d12dab9fc52d503e0d997fc449c74896781383800d7f63ebbde21  PARALLEL/inputs/variants/VAR-1-missing-core-doc.json
ca09b4f0b2ef9a034629725fbb3bfc69ee9721f4bcd4123364ef3a0e3a230477  PARALLEL/inputs/variants/VAR-2-duplicate-source.json
8161447a4dbeb75e2ae6a49328d8b9927fdd4cb2c892f9db3301ae8a9ca58ef2  PARALLEL/inputs/variants/VAR-3-sn-time-contradiction.json
29272caae7cf1180954a642c0d1b1d284b428697eea12e5ce5af8c3bd249234e  PARALLEL/inputs/variants/VAR-4-superseded-versions.json
97c7dad18e60471dc93b02cb430e4efb693192f86e9761a03ce98429767c71a4  PARALLEL/inputs/variants/VAR-5-professional-divergence.json
8f1388f299e832523659a25da0c15d3ab0582f4618c06b23e407bc136e3d5b27  PARALLEL/inputs/variants/VAR-6-missing-economics-basis.json
d36d7587c49d35465dd38f8de688479bb0ff2a7aa25e8da893da6dd37174ffbe  R2/golden-r2/EVT-1.golden.json
cab73470008bafe2950b510c3077f56d58368c5b21a15579d49cc0b70a427124  R2/golden-r2/EVT-2.golden.json
429b029148c0840f7bc0a7f7a052a18bc09f17e58cee99a0988038511aad313f  R2/golden-r2/SCN-1.golden.json
4f41bfe01980818cbeeee0109c0dadb115b2204f395b23fa4687302d038705d8  R2/golden-r2/SCN-2.golden.json
1c4e245ecbfb1401769c33b215312f506449ed7fe4ed880f06b592e13e53752d  R2/golden-r2/SCN-3.golden.json
ea99be8a8cda63f1d55a23c41f5d134ee2e00f64ec5fed3f3b4a287e581ffc8a  R2/golden-r2/SCN-4.golden.json
5ea2b09bb0494a5b21d94401a7e6d1484bb229e9dd71df283e34d8faf94c0885  R2/golden-r2/SCN-5.golden.json
6d34384b4181b7f86d41c95abfa527334c0e0e782c33328a940a994efb3925d5  R2/inputs-r2/variants/EVT-1-voice-correction.json
6ef65469514b14cbc9bfe871f9f5df01c9723a2b433609fc603d6d4030c1a954  R2/inputs-r2/variants/EVT-2-transcription-negation-unit.json
e298da526565c62a44afd43869d9256a4c6fa0f4dc3de02501803367235199f5  R2/inputs-r2/variants/SCN-1-speaker-attribution.json
97adb7d747a873075a7ac9494eea349938258841554ddb2d6e1dce224372e20a  R2/inputs-r2/variants/SCN-2-dedup-hangup.json
7c82018c405a9e5df664410861403a7bcfa20d7733bed1c6bbb220ef610a548d  R2/inputs-r2/variants/SCN-3-lifecycle-precondition.json
166c88ac9acb740ac1411388817ab8694a6511db1456df17312f6a5e4cf70a8c  R2/inputs-r2/variants/SCN-4-human-machine-conflict.json
5719e002e3890ce11e18346effe5efc9fe260151c0776aa7ebb4d820a30a6765  R2/inputs-r2/variants/SCN-5-permission-rules.json
```

声明：以上坏例均为 SA-9 人工构造的注入样例，仅用于验证评分器行为，不构成任何真实模型质量证据。
