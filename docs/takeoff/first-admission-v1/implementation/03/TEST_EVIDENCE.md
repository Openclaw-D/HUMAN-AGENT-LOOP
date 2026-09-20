# 03路定向测试证据与结果 · 2026-09-20

writer：ZCode 03路。快照：本路工作树修改后（未 commit；git HEAD 仍 8c6d3b0）。
基线：开工时 C=101、B=105、Connectors=88 全绿（先测后改）；收口全量回归见 `evidence-*-final.txt`。

## 结果总览（本机 Node 22.23.1 / win32 / 独立合成资源）

| 套件 | 命令 | 结果 | 证据 |
|---|---|---|---|
| C 全量（含新五域 12 项） | `node test/run-all.mjs`（Back/C） | **113/113 PASS** | evidence-c-final.txt |
| B 全量 | `npm test`（Back/B） | **105/105 PASS**（79s） | evidence-b-final.txt |
| Connectors 全量（含新链 5 项） | `npm test`（Back/Connectors，隔离 PG 15443） | **93/93 PASS** | evidence-connectors-final.txt |

新增强化测试：
- `Back/C/test/takeoff-five-domain.test.mjs`（12 项）
- `Back/Connectors/test/takeoff-chain.test.mjs`（5 项，真实 PG+HTTP+04夹具真实字节）

## T02–T08/T11/T12/T14 对照（03路范围项）

| 项 | 断言 | 结果 | 证据（测试名/文件） |
|---|---|---|---|
| T02 单次上传与来源 | 04夹具真实字节（N3/N2 CSV）经统一上传链→任务 done→语义事实落库（Σ净值880/年度收入3050/时点4020）→五域分析→收口读面可回溯 artifactRefs | **PASS** | takeoff-chain「T02 真实字节链…」 |
| T03 部分并行 | 仅设备/权属材料就绪→资产域完整评估完成；commerce/credit 缺输入=各自 unknown 不锁资产；单请求资产域可独立推进（skipped 显式） | **PASS** | takeoff-five-domain「T03 资产并行…」 |
| T04 有利/不利证据 | 可增：现金流 78→130 → max 648→2520 tendency=increase；可减：净值纠正 880→792万（wan 归一）→ 资产约束 7,040,000→6,336,000 tendency=decrease；不可评估只报 gaps 不凑数 | **PASS** | takeoff-five-domain「T04 候选可增/可减…」；takeoff-chain「T04 可减（真实夹具 C1）…」（真实链 7,040,000→6,336,000） |
| T05 重复/相关证据 | 同字节同元数据重复件→skipped_duplicate；事实零重复断言；收口数不变（重复不增加独立证明力） | **PASS** | takeoff-chain「T05 重复不增加证明力…」；既有 parse/analyze 判重套件（goal02-parsing 等 88 项内） |
| T06 冲突与冻结 | 未决诉讼声明（declared）→SIM-LITIGATION-PENDING-01 hit→Gate HARD_BLOCK+blockedActions 含 confirm_preassessment→候选 frozen=true（frozenReasons 含规则ID）；解除证据核验→新收口解冻（无一键解除）；聊天指令不改变硬门 | **PASS** | takeoff-five-domain「T06 未决诉讼…」「T06 恶意材料指令…」 |
| T07 技术失败 | A 登记 unknown→blocked_unknown→回执对账续跑不换 ID；A 不可达=blocked_a_unavailable 等待；解析失败→needs_followup 转人工；无自动拒绝/清零 | **PASS**（既有套件） | goal02-blocked-recovery、goal02-link-chain L5、processing.e2e（93 项内全绿） |
| T08 新旧版本竞争 | C1 取代 N3 后：旧签名域分析行独立留存（snapshot_hash 不同、历史不改写）；最新域结果=新收口水位；读面返回最新收口；迟到不回退 | **PASS** | takeoff-chain「T08 旧结果迟到不覆盖新版…」；B 矩阵 C10 缓存拒低代次回写/C11（105 项内） |
| T11 重复提交与恢复 | 同 requestId 同载荷单效果（a_links 幂等、重入零新写）；异载荷冲突；重启续跑 | **PASS**（既有套件） | defects-g04n N1（重入零新写+requestId 纪律）、goal02-link-chain L5（崩溃注入恢复） |
| T12 越权与不可信输入 | 跨客户读面 404 NO_FINALIZATION；材料内指令文本=数据：embedded_instruction_detected 旗标、零事实产生、authority=none 不变、Gate 不变 | **PASS** | takeoff-chain「T14/T12 侧…」；takeoff-five-domain 指令注入项；C13/C13 类既有反例（105/113 项内） |
| T14 辅助页与模型预算 | 预算不足=BUDGET_EXCEEDED 失败关闭（9 项）；客户窗口预算排队（P12）；suggest_only 默认零外发（P01 断言）；出站安全（i21-i25）；人工路线 verified 唯一来源（M1-M3） | **PASS**（既有套件） | B budget.test+matrix、Connectors P12/P01/i21-i25/goal02-manual |

## 输入样本说明

04路验收夹具（`Back/Edge/test/fixtures/takeoff/materials/`，确定性字节，SHA256SUMS 随附）经真实上传链消费：
- N3/N2/C1 CSV：全链可用，语义事实（Σ净值 880→792、年度收入 3050、时点资产 4020）确定性落库（T02/T04/T05/T08 的输入）。
- N4/D1 PNG：FORMAT_UNSUPPORTED→转人工（如实不支持，不 OCR）——T14 侧断言。
- N1/P1/A1 PDF：**04路夹具生成器缺陷**（见 DEFECTS_REPORT.md）：中文文本层在生成时被 binary 编码损毁，当前字节不可语义解析（任务照常 done，垃圾键事实为 declared 级无害数据）。03路已修复解析器侧 latin1→UTF-8 还原并验证（Back/C/evidence/takeoff-probe-pdf.mjs 探针：utf8 编码 PDF→中文文本、订单/涉诉事实、指令旗标全部正确）。**04路修复生成器（'binary'→'utf8' 一处）重新生成夹具后无需改 03路任何代码**。

T04 增方向语义边界（对04路的协议澄清）：P1 订单合同驱动**商机域**意见（business assessor knownFacts/actions），不直接驱动金额候选（金额候选只由现金流/负债（source_supported 级）与资产净值（声明级+LTV 上限）确定性推导——避免"材料越多额度必涨"反模式）。04路 T04 可增断言应使用现金流类改善证据或以商机域意见变化为对象。

## 运行依赖

- Node ≥22；隔离 PG `jw-connectors-pg@15443`（既有登记资源，本轮零新建容器/零停进程）。
- Connectors npm test 的 A 桥用例需 A 管理库 15444（jw-cc-kernel-pg，已在运行）；不可达时显式 SKIP 不计 PASS。
- TAKEOFF 五域启用方式（部署/04路装配）：`processing.rulePackPath` 指向 `Back/C/rules/takeoff-first-admission-rule-pack-v1.json`；`aRegisterDomains` 数组在 01路扩展 A 枚举后加入 'business'。
- 本路未调用真实模型 API、未读取/输出任何 Key、未 commit/push/切分支、未停止任何进程。
