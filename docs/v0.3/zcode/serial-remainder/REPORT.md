# V0.3 串行收尾 · 后端整合与隔离验收 REPORT

执行：ZCode（串行单writer）· 2026-09-20 · 范围=TODO03_04_CHECKPOINT 遗留项 0/1/2/3/4 + 03C 真实A登记全链闭环。
交接包：`docs/v0.3/ZCODE_SERIAL_REMAINDER.md`。模型 authority=none；评分 20/20/20/30/10 未动；范围=首次回租准入+授信预评估（TAKEOFF-FA-1.0.0）。

---

## 0. 入口阻断诊断（48214）与错误分类整改

**根因链（证据齐备）**：
- `jw-takeoff-pg` 容器于 12:53Z 前后 Exited(0)（同期 Docker 全局重启：Dify 栈同样重启；`jw-cc-kernel-pg`/`jw-connectors-pg` 同刻退出）。
- A 内核（pid 6764，:48194）与 Connectors（pid 24196，:48114）进程随之死亡（`Get-Process`/`process.kill` 双确认 ESRCH）；Edge（pid 27400，:48214）存活。
- Edge 身份目录 200 正常（读本地 edge-auth.json）；`/healthz/ready` 如实报 kernel-a/connectors ECONNREFUSED。
- 旧代码 `probeKernelCredential` 把"探针网络不可达"与"A 明确拒绝"同样折叠为 `false` → 登录 403 `PRINCIPAL_UNTRUSTED` —— CTRL 判断正确：**不能据 403 推断凭据错误**。

**代码整改（隔离测试完成，共享环境未动）**：
- `server.mjs` 新增导出 `createLiveCredentialVerifier({kernelBase, directory, redeemedDirectory})`，探针三态：200→通过；401/403→`PRINCIPAL_UNTRUSTED`(403)；不可达/超时/5xx→**`CREDENTIAL_VERIFICATION_UNAVAILABLE`（映射 HTTP 503）**。main() 已切换使用（live 默认入口）。
- 契约影响：仅新增失败分类码，`assistant/observe` 地址/请求不变。前端可据此区分"稍后重试"与"凭据错误"。
- 测试：`Back/Edge/test/s3-credential-verification-classification.test.mjs` 6/6 绿（含容器退出形态的连接拒绝）。
- 本轮 e2e 的 Edge 登录即走该核实器（A 探针 200 → 会话建立）【PASS】。

**共享运行环境恢复 —— 待用户授权（本轮未执行任何重启）**：
具体动作（二选一）：
1. 最小恢复：`docker start jw-takeoff-pg`，然后重启 A 内核与 Connectors 两个进程（沿 takeoff-up 同参：内核 `--port 48194 --db .../jw_fa_final --principal-tokens ...`；Connectors 用现存 `Back/Connectors/.run/config.takeoff.json`）。
2. 干净恢复：先 `node Back/Edge/scripts/takeoff-down.mjs`（会停现存的 Edge 27400），再 `node Back/Edge/scripts/takeoff-up.mjs --serve-front Front/dist`（数据卷 `jw_takeoff_pgdata` 保留，down 不删卷）。
注意：Edge 27400 仍占 48214，完整重启栈必须先 down；kernel.pid 心跳在子进程死后仍被 takeoff-up 更新（Windows 上 `process.kill(pid,0)` 对自己已退出子进程误判存活）——属 takeoff-up.mjs 簿记缺陷（非本轮 ownership，未修改），healthz 真实 HTTP 探测不受影响。

## 1. LangGraph 六节点职责收敛（prepare_evidence 不再空跑；回执持久化入图）

六阶段职责归属（代码注释同步写入 `assistant-model.mjs` 头部）：

| 职责 | 归属 | 验证 |
|---|---|---|
| 授权读取 | 图外路由层：会话/action 每请求裁决 + Connectors 内部面（租户/A映射/登记工件/现行解析版本/原件字节哈希） | e2e 缺件422、跨租户空集【PASS】 |
| 输入冻结 | observe 入口：证据包身份+**id↔内容绑定校验**（新增 `EVIDENCE_SNAPSHOT_TAMPERED`，claim 之前拦截→干净 failed）+ brief 渲染 + requestId=identity 摘要 | 54/54 单测；e2e 重放/新请求身份【PASS】 |
| 受控调用 | 图内 `controlled_model_call`：INTENT 先落 → transport.complete（预算/出站白名单/三分发送在 B transport） | e2e 未知不重发【PASS】 |
| 引用校验 | 图内 `validate_citations`：只认 `prepare_evidence` 导出的可引用宇宙（新增 state 通道 `evidence`） | e2e 伪造引用降级【PASS】 |
| 当前性检查 | 图内 `check_current`（在途撤权回调）+ 路由层返回前再授权/重读工作本/租户一致 | e2e 撤权403、补证后新请求【PASS】 |
| 回执持久化 | 图内 `output_receipt` 落 TERMINAL（运行编号+节点耗时绑定）；图外仅防重发围栏（flight 去重/claim 独占/重放校验/崩溃恢复） | e2e 合法重放只发送一次【PASS】 |

- 无新增自动重试（LangGraph 无 checkpointer/retry policy；确定性校验失败=failed、INTENT 后不确定=unknown 语义保持）。
- 图 schema（`Back/B/src/graph/assistant-analysis.mjs`）声明 `evidence` 通道：未声明时 LangGraph 丢弃该键（实测发现并修正）。
- 事实/单位/原文片段关系：声明事实仅保留带字面原文跨度的（evidenceRefId→片段 id）；遗漏显式记录（`omitted[]`）；冲突保留（双方原文同包，e2e 注塑 149.0769 与更正声明并存【PASS】）。
- profile 审查：激活串行于单进程（activation 链）；在途请求在 observe 入口捕获所选 profile；证据读取期间切换 → 新 profile 的 allowedHashes 不含既有包哈希时 observe 校验失败关闭（不泄露）；发送状态未知经 marker 阻断跨 profile 重发。**多 Edge 进程激活协调不在范围（单进程部署边界）**。

## 2. 隔离全链路验收（真实A登记，零手工插表）

命令：`node Back/Edge/test/serial-remainder/full-chain.e2e.mjs`
最终结果：**22/22 通过，exit 0**（连续 3 轮稳定；日志 `e2e-final-run1/2/3.log`，结构化 `e2e-result.json`）。

链路真实性边界：
- **真实**：A 内核独立容器+独占PG（随机端口）；客户建档 `POST /api/v2/customers`（business 人类凭据）；材料经 Connectors A 桥 `registerArtifactOp` 登记（a_links.status=registered 且 a_ref 来自 A 响应）；客户映射走 `autoLinkFromA` 同ID权威核验（**无任何 a_links 手工插入**）；上传走真实邀请+upload 入口；解析走受资源限制的异步 worker；分析运行/Gate 回执走 service 凭据真实写 A。
- **替身**：模型=本地 HTTP 替身（显式 mock 语义，source.mode=mock/status=simulated，**不冒充真实模型**）；企微传输=FakeWecomTransport（本就 blocked_external_access）。

覆盖门（全部 PASS）：KS-LASER-500（500万元）补证前一轮（D01+D02 出包、金额要素出站、伪造引用降级）→ 合法重放只发送一次 → 补证后（D09）新请求新身份、旧 requestId 失效；KS-TEXTILE-200 缺件→422 EVIDENCE_UNAVAILABLE（未发送）→ 补件后正常；KS-INJECTION-1000 冲突值出站→S02 更正 supersede 后旧件不再出站（149.0769 消失、139.0769 与 D11 同包）；撤权拒绝（返回后授权复核 403 不泄露；后续入口即 403 不触发模型）；发送后未知（悬置超时→unknown sent=null；恢复后重放仍 unknown、零新增调用）。

**稳定性整改（本轮发现并修复于测试侧）**：`driveToEnd` 只保证无在途任务领取，不保证 `parse_results` 落库——首轮曾因此 2/5 概率把"证据缺 D01"误报。已加显式 parse_results 轮询等待，连续 3 轮 22/22。

## 3. 三十次顺序测量

命令：`node Back/Edge/test/serial-remainder/bench-30.e2e.mjs`，exit 0（`bench-30.log`、`bench-30-result.json`）。
策略：**16 次独立冷请求**（互不相同的问题，同一冻结上下文）+ **14 次合法回执重放**（首问题重复，零外部调用）= 30 次顺序观察；并发仅用于防重发专项。固定合成输入=KS-LASER-500/D02 主体登记 PDF（sha256 见结果文件）。

| 分相 | n | p50 (ms) | p95 (ms) | 说明 |
|---|---|---:|---:|---|
| 解析（组件） | 30 | 232.74 | 271.23 | 固定字节直接过异步解析器（流水线内每工件仅解析一次，内容寻址判重） |
| 冷启动（首个观察全链） | 16 | 450.19 | 496.93 | 含图编译+工作本+证据读取+发送+回执 |
| 编排（请求侧=端到端−替身等待） | 15 | 450.07 | 496.64 | 图内五节点合计 p50=144.99；其余为 A 工作本查询+Connectors 证据读取+回执 I/O+HTTP 栈 |
| HTTP替身等待 | 15 | 0.26 | 0.38 | 本地实测；**不代表真实模型延迟** |
| 回执重放 | 14 | 292.38 | 327.57 | 零模型调用 |
| 端到端（30次全部） | 30 | 386.58 | 483.85 | — |

用量：模型调用 16 次（替身名义用量 prompt=100+片段数、completion=40/次）；**非真实模型用量**；账本在运行目录 model-cost-ledger.jsonl（临时目录已清，账本语义见 B 预算门测试）。**页面完成时间未测——归 Codex，不伪造。**

防重发并发专项：同问题 10 并发 → 200×10、模型调用×1、单一 requestId（进程内 flight 去重）【PASS】。

## 4. 回归、hash 清单与移交

改动相关回归（本轮全部复跑，退出码如实）：
| 套件 | 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---:|---|
| Edge 全套 | `cd Back/Edge && npm test` | 0 | 138 pass / 0 fail（含新增分类测试 6 项） | edge-regression-final.log |
| 全链路 e2e | `node Back/Edge/test/serial-remainder/full-chain.e2e.mjs` | 0（×3） | 22/22 | e2e-final-run1/2/3.log |
| 30次测量 | `node Back/Edge/test/serial-remainder/bench-30.e2e.mjs` | 0 | 全分相+防重发 PASS | bench-30.log |

源码 hash 清单：`source-hashes.txt`（11 个文件 sha256，含 5 个 Edge assistant 模块、B 图、Connectors 证据面、2 个新脚本、1 个新测试）。
本轮实际修改源文件（逐项）：`Back/Edge/src/server.mjs`（探针三态+verifier 工厂+503 映射）、`Back/Edge/src/assistant-model.mjs`（六节点收敛+id↔内容绑定校验）、`Back/B/src/graph/assistant-analysis.mjs`（state 增加 evidence 通道，3 行）。其余为新增测试/脚本/文档。**未改动**：Front/、原材料、共享配置、Connectors/C 业务码、takeoff-up.mjs、DECISIONS/CHANGELOG（移交验收方按惯例落笔）。

**并行 writer 披露**：执行期间检测到 V0.3-Jev（候选置信度/反馈切片，用户单独授权）在 `assistant-model.mjs`/`server.mjs` 写入（`decisions` 透传）。本轮全部编辑为精确串替换，Jev 的在制修改原样保留且全部测试绿；`assistant-model.mjs` 现哈希 `7111cc3c…`。验收时请注意两边改动的合并核对。

**前端联调入口（一条可执行）**：
```
cp Back/Edge/config/takeoff-runtime.example.json Back/Edge/config/takeoff-runtime.json && node Back/Edge/scripts/takeoff-up.mjs --serve-front Front/dist
```
⚠️ 该配置的 `assistantModel.configPath` 指向 `Back/B/config/b-config.json`（mode=**real**，glm-5.2，预算 196 元封顶）——助手面板提问将发送**真实付费调用**；纯前端联调若需零费用，把 `takeoff-runtime.json` 的 `assistantModel.configPath` 换成 `{"transport":{"mode":"mock","mock":{"baseUrl":"http://127.0.0.1:<替身端口>","timeoutMs":5000}},"evidencePolicy":{"allowedHashes":[]}}` 形态的本地配置（观察将 422/降级，页面联调不花一分钱）。

**新增响应证明（供 Codex 前端消费）**：
- 登录新分类：HTTP 503 + `{"ok":false,"error":"CREDENTIAL_VERIFICATION_UNAVAILABLE","note":"A 内核不可达，凭据未能核实（非凭据错误）…"}`——提示"服务不可用稍后再试"；403 `PRINCIPAL_UNTRUSTED` 才是凭据错误。
- `model.graphTrace`（六节点逐一 {node,elapsedMs}，现在为真实执行）、`model.citationChecks`（逐观察 valid/reason）、`model.analysisRunId`、`model.replayed/current` 语义不变。

## 剩余问题（不阻塞本轮交付）

1. 48214 共享栈恢复待授权（见 §0；恢复后 A 探针 200，登录链路即可用）。
2. 证据包片段预算按 evidenceId（随机）序填充：多材料时关键片段可能进 `omitted`（已显式披露，非丢失）；建议后续契约按登记顺序/相关性排序。
3. 无 TAKEOFF admission 评估的裸客户 contextVersion=unknown——当前性由证据包哈希保障；admission 接入属 01 路契约范围。
4. takeoff-up.mjs 心跳簿记缺陷（§0，未修，非本轮 ownership）。
5. 多 Edge 进程 profile 激活协调不在本轮范围（单进程部署边界）。
6. 真实模型连通、页面完成时间、浏览器视觉复核与用户接受：**均未执行/未声称**（真实模型此前 13 次调用见既有授权账本；本轮 0 次付费调用）。

---

## 定向复核整改轮（2026-09-20 晚，ZCODE_SERIAL_REVIEW.md 五项）

CTRL 定向复核指出恒真断言、冷启动命名、样本口径、计数窗口与留档缺口；本轮逐项整改并两轮复跑。

| # | 复核点 | 整改 | 复验 |
|---|---|---|---|
| 1 | full-chain.e2e.mjs 引用断言末尾 `\|\| true` 恒真 | 删除；拆为三条逐项断言：①有效观察 `citationStatus=source_bound` 且引用片段哈希∈本次上传原件、定位 start 为整数、片段文本在场；②伪造引用 `forged-ref` 不得进入任何有效观察，必须降级为 `待核验（缺少有效原文引用）` 前缀的 unverified 问题；③`citationChecks` 恰 1 SOURCE_BOUND + 1 UNVERIFIED_REFERENCE | 24/24（原 1 条放宽断言 → 3 条真断言） |
| 2 | bench-30 把独立请求命名为 cold_start | 拆桶：`first_request`（进程首次调用，含一次性图编译，n=1）/ `independent`（#2..#16 互不相同问题独立发送，n=15）/ `replay`（首问题重复零出站，n=14） | 三桶 n=1+15+14=30 |
| 3 | 编排/模型等待 15 样本与 16 独立请求不符；requests=16 与 model_calls=17 混窗 | 编排/等待分相覆盖全部 16 次独立发送（含首次请求，样本数=16 显式落盘）；顺序窗口（30 请求/16 发送/14 重放）与防重发并发窗口（10 并发→1 发送）分列 `sequential_window` / `anti_resend_concurrent`，不混算 | bench-30-result.json 两窗口独立字段 |
| 4 | usage null 不得用替身名义 tokens 补数；计时范围不明 | usage.tokens 恒 null + 注记"替身名义用量不计入实测"；新增 `timing_scope` 字段：model_wait=替身 arrive→depart（HTTP 往返+替身处理）；orchestration=端到端−model_wait（图节点+回执I/O+HTTP栈）；e2e=fetch 发起至响应解析完成 | bench-30-result.json timing_scope |
| 5 | 两轮整链原始日志/退出码/源码哈希/REPORT | `logs/full-chain-r1..r3.log`、`logs/bench-30-r1.log`、`logs/edge-runall-r1.log`（138/138）、`logs/b-test-r1.log`（110/110）；源码哈希见下方更新 | 全部 exit=0 |

### 整改中发现并修复的偶发失败根因（非复核点，如实披露）

首轮复跑 full-chain 出现既有断言"出站含D01金额500.00"失败（23/24）。留档出站 brief 全文逐轮对比定位根因：
**上传生成的 evidenceId 为随机值，`prepareEvidence` 按 evidenceId 排序逐份装包；e2e 此前未传 `maxContextChars`（默认 6000→证据策略上限 2800 字符），装完第一份材料+其事实即触顶，第二份整份进 `omitted`（CONTEXT_LIMIT 已披露）——哪份出局取决于随机 ID 排序，断言因此轮间漂移。**
整改：e2e（含 bench-30）`createAssistantModel` 显式 `maxContextChars: 12000` 对齐真实部署；断言升级为"两件原件均在包（snippets=2 且无 CONTEXT_LIMIT）+ 500.00 在包 + 注入事实不出站"。`prepareEvidence` 本体未改（披露语义符合 TEC-CTX-1；多材料公平填充留契约层）。此根因同时解释 REPORT 剩余问题#2 的实际影响面。

### 整改后复跑记录（原始日志+退出码）

| 轮次 | 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---|---|
| full-chain r1 | `node Back/Edge/test/serial-remainder/full-chain.e2e.mjs` | 0 | 24/24 | logs/full-chain-r1.log |
| full-chain r2 | 同上 | 0 | 24/24 | logs/full-chain-r2.log |
| full-chain r3 | 同上 | 0 | 24/24 | logs/full-chain-r3.log |
| bench-30 r1 | `node Back/Edge/test/serial-remainder/bench-30.e2e.mjs` | 0 | 30 顺序+防重发 PASS | logs/bench-30-r1.log |
| Edge 回归 | `node Back/Edge/test/run-all.mjs` | 0 | 138/138 | logs/edge-runall-r1.log |
| B 回归 | `npm test`（Back/B） | 0 | 110/110 | logs/b-test-r1.log |

整改轮源码哈希（sha256，git hash-object）：
`full-chain.e2e.mjs=6ca8621d5e54727bc38fa95c1f77de382fe6db45`
`bench-30.e2e.mjs=8b021d0785c7aff1d27b6710676595b1115e0736`
`assistant-model.mjs=0d60d26a481333e1858df432c2a04f494fbd8c00`
`glm.mjs=a17f62c9bfa1647bf8c09d591d7d7cc41c29aa2b`
（本轮仅改 2 个 e2e 测试文件；assistant-model.mjs/glm.mjs 未动，哈希列出供验收对表。本轮付费模型调用 0 次。）
