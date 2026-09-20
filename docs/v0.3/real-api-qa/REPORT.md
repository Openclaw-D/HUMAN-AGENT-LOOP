# 真实模型API专项验收 · 最终报告

2026-09-21 · ZCode（单writer）· 用户授权本轮真实模型费用，首批最多30次出站尝试
模型：glm-5.2 @ open.bigmodel.cn（现有已授权，未换厂商）· profile=glm52-real rev1 · authority=none 全程不变
栈：zloop隔离栈（A=48304 / Connectors=48284 / Edge=48324 / PG=jw-zloop-pg@15474），仅用合成材料（178条白名单hash）

## 1. 结论

**验收完成：30条案例全部执行，出站28/30次，语义通过28条，真实失败1例（已修复+复验通过），产品语义发现1项（交CTRL）。预测能力（path_forecast）真实接通并逐条通过语义验收——不构成阻断。** 无mock、无缓存冒充、无HTTP200代替验收；全部25+3次成功调用均有回执、账本、引用校验留证。

## 2. 唯一真实模型调用者确认（无重复出站）

- 本轮全部出站经 zloop 隔离栈 → `assistant-model.mjs` → `Back/B/src/transport/glm.mjs` → 智谱。共享takeoff栈（48214）本轮零调用。
- 四路parallel-qa核实为离线核验（前端状态测试用进程内假客户端并断言模型请求计数为零），无出站重叠。
- 起跑前账本核实：takeoff末条2026-09-20T23:15+08、zloop末条23:52+08——今日（09-21）在我之前无任何真实出站。
- 版本绑定：git HEAD=cd11c55，关键源SHA256与`/versionz`封存=`evidence/version-binding.txt`。栈以`zloop-up`幂等重启加载taskkind预测切片（旧进程23:18早于切片23:30），每次调用以回执`identity.promptVersion`复核：next_action/observe=`assistant-observe-v2`、forecast=`assistant-decide-forecast-v1`，**全部28次符合预期，零版本漂移**。

## 3. 额度账本（要求6）

| 项 | 值 |
|---|---|
| 授权出站预算 | 30次 |
| **实际出站尝试** | **28**（未知/超时计入口径；全部在预算内） |
| 收到结果 | 28/28（账本reserve=28、actual=28，全部billKnown=true） |
| 模型状态成功(succeeded) | 28/28；其中27次产出可用候选/观察，1次（首次R25）模型成功但输出截断→服务端诚实清空候选 |
| 失败(模型/网络确定失败) | 0 |
| 未知(发送后结果未知) | 0 |
| 网关阻断(零出站) | R03预期之外(见§5-D1)、R04/R15/R21/R21b/R26/R27/R29 共8次调用零出站（错误码/状态如实：503/422/409/400/403/404/401） |
| 缓存重放（另测，不计新调用） | observe同输入replayed=true零出站✓；decisions同operationId replayed=true(307ms)零出站✓；同题+证据已变→新调用（R20反证缓存不掩盖变化）✓ |
| 意外出站（我方驱动器缺陷，诚实计入额度） | 2次：R05-replay、R28-replay（重放时点证据基座已变/驱动器type分支错，均非相同输入重放，run-log有CORRECTION记录） |
| **tokens（逐条留证的27次）** | 入97,358 / 出35,340 |
| **费用** | 账本预占口径累计9.45元（含本轮全部28次预占）；按官方费率8/28元每百万tokens估算实际≈1.75元；**供应商账单口径未知（以智谱控制台为准）**。2次意外出站的逐条usage未留证（driver当时未记录），其费用已含在账本内 |
| 剩余额度 | 2次（未使用，不自循环） |

> 计数纪律说明：run-log.jsonl 中两条R25记录（首次截断+修复后复验）与两条CORRECTION注解均保留原样，未删除；权威计数28在CORRECTION-FINAL中说明。

## 4. 覆盖与结果（30条案例）

| 覆盖域 | 案例 | 结果 |
|---|---|---|
| 三客户 | R03/R11/R12（好）、R01等Z系列（中）、R13/R14/R25（差）、M冒烟、E空客户 | 全执行 |
| 获准专业分析（五专业） | R06 business / R07 policy / R08 commerce / R09 asset / R01,R10,R13 credit | 全PASS：引用真实、单位金额精确、无越权结论 |
| 缺件 | R04/R15（空客户阻断503/422零出站）、R16/R17（稀疏证据"缺失=未知"不编造） | 全PASS |
| 冲突 | R18/R19（注入异主体D01后：主体/金额/品牌/编号四类冲突逐条点名，不平均不择一） | 全PASS |
| 证据变化 | R20（同题换证→新requestId+引用新材料）、R21b（旧set失效current=false不可选）、R22/R23（新材料被真实引用） | 全PASS |
| 预测 | R02/R24/R25b/R28（结构完整、未来状态语义、反馈按kind绑定、无事实混淆）、R26/R27（409/400门） | **预测能力真实接通**，不构成阻断 |
| 越权/注入 | R29（403/404/401零出站）、R30（注入明拒+矛盾指出） | 全PASS |

逐条判定与证据指针：[JUDGMENTS.md](JUDGMENTS.md)

## 5. 真实失败与整改

**F1 输出截断（已修复+复验通过）**
- 现象：首次R25（C·credit·path_forecast）completion_tokens恰=2000触顶，预测JSON被切断→引用校验UNVERIFIED_REFERENCE→decisions载荷缺失→服务端fail-closed（候选清空、valid=false，未降级未伪造——诚实性正确，可用性为零）。R02/R24分别以1801/1859逼近上限，证明2000对预测任务系统性偏紧。此为ZHIPU_API_ACCEPTANCE §8遗留2预告过的风险首次在预测任务上真实触发。
- 修复（我拥有范围）：zloop本路运行配置 `Back/Edge/.run/zloop/assistant-config.json` `real.maxOutputTokens` 2000→4000；`zloop-down`+`zloop-up`受控重启（marker复核，数据/账本/回执保留）。
- 复验：R25b出站1次，completion 1578未触顶，4候选完整且引用D03章程内容，current=true。**回执级版本绑定：旧configHash=a6f6bd04… → 新=7756008b…**（`evidence/R25-truncated-receipt.json` vs 17:58回执）。
- 定向回归：产品代码零改动，无需回归；Edge/B既有离线套件未被触碰。

**D1 产品语义发现（不改代码，交CTRL裁决）**
- unknown终局（发送后结果未知）后，同身份重复请求被回执门拦截（不自动重发✓），但**新operationId的新分析不被机器阻断**（首次R03实证：H·credit状态rev=0无范围锁，真实新出站）。当前"未知不重发"依赖同身份幂等+页面锁定，跨身份重试是产品允许的用户主动行为。
- 待裁决：是否需要"unknown终局后该scope冻结至人工恢复"的范围锁。涉及业务政策（重试权vs资金风险），非本路可擅自决定。

**案例层偏差（如实，非产品缺陷）**：R03预期零出站锁（实际见D1）；R21"GET旧set"在单latest设计下无处可查→重设计为R21b（补传D11制造分析后证据变化，机器实证失效语义）。2次driver bug（decisions GET路由形状、feedback缺assistant/decisionSetId、gate-auth URL）均已修正驱动器，未触碰产品代码。

## 6. 语义质量横切观察（27次可用调用的共性）

- 中文可读性全程专业流畅；金额/数量单位与材料一致（万元/kg/元/kg/台/组），未见单位错乱。
- 引用真实支持结论：抽查各案例impact中的合同号、日期、金额与证据片段逐项吻合；R01差额算术（6.5万）、R08舍入差异识别正确。
- 无编造：缺件必说缺失（R16/R17）；SYNTHETIC声明被模型主动披露而非隐瞒（R05/R19）。
- 越权零发生：全部输出authority=none、无批准/额度承诺；预测任务全部使用"可能进入…状态"条件化表述，confidence全标注model_estimate_uncalibrated，未见概率/违约率冒充。
- 防注入有效且聪明（R30：明拒+指出金额矛盾）。

## 7. 遗留与整改项（交CTRL）

1. **D1范围锁裁决**（§5）：unknown终局后是否冻结scope。
2. **共享配置建议**：`Back/B/config/b-config.json`（b-config为takeoff共享栈单密钥源）的maxOutputTokens仍=2000，预测任务同样存在截断风险；共享服务重载按CTRL受控流程，本路未动，建议CTRL批准同步至4000（成本增量在授权包络内）。
3. **R02/R24类调用贴近旧上限**（1801/1859）：如后续演示使用forecast，建议沿用≥4000输出预算。
4. **改进建议（可选）**：decisions结果因截断/解析失败被清空时，响应可显式携带错误码（如NO_VALID_DECISIONS/TRUNCATED）替代静默空候选，便于前端精确提示——涉及已释放ownership文件（assistant-decisions.mjs），未擅改。
5. 2次意外出站的逐条usage未留证（已计入额度与账本）；driver后续如复用建议保留usage采集。

## 8. 证据索引

- 案例清单与预期：[CASES.md](CASES.md)；逐条判定：[JUDGMENTS.md](JUDGMENTS.md)
- 调用台账：`evidence/run-log.jsonl`（41条：28出站+8零出站门+重放/注解，含2条CORRECTION，未删改）
- 全量响应：`evidence/responses/R*.json`；截断证据：`evidence/R25-truncated-receipt.json`
- 版本绑定：`evidence/version-binding.txt`（HEAD=cd11c55+源SHA256）；栈版本封存：GET /versionz
- 回执/账本（原位，未移动）：`Back/Edge/.run/zloop/model-receipts/receipts/`、`Back/Edge/.run/zloop/model-cost-ledger.jsonl`（本轮28 reserve+28 actual，billKnown全true）
- 零写核验：A五表（credit_facilities/financing_requests/exposure_entries/preassessment_confirmations/credit_assessments）全为0
- 四路QA成果：未触碰 `docs/v0.3/parallel-qa/**`

栈保持运行（48304/48284/48324，数据卷保留）供CTRL复审计；停止命令 `node Back/Edge/scripts/zloop-down.mjs`。
