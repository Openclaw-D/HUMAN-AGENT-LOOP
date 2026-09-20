# backend-qa-r2 · 包03 证据链（evidence-chain）REPORT

- 生成时间：2026-09-20T18:57:33.189Z
- 任务书：docs/v0.3/backend-qa-r2/03_EVIDENCE_CHAIN.md
- 运行命令：`node docs/v0.3/backend-qa-r2/results/evidence-chain/run-evidence-chain.mjs`
- 退出码语义：0=全部通过；1=存在失败；2=阻点未执行。本次退出码：**0**
- 汇总：通过 92/92（失败 0）× 2轮；致命异常：无
- 输入漂移：无（执行期间输入源码/材料哈希零漂移）

## 边界声明

- **真实**：A 内核真实进程（每轮独占 PG 容器独占库）；Connectors 真实 compose（邀请/上传/异步解析/处理驱动/A桥）；Edge live kernel-store + observe/decisions 面 + live 凭据核实器（过 A 探针）。
- **替身**：模型=本地 HTTP mock（显式 simulated 语义，source.mode=mock）；企微传输=FakeWecomTransport。**本包不构成真实模型质量验收**；实际 HTTP 指真实后端进程＋本地模型替身。
- **引用绑定证明与结论正确性分开**：所有"引用绑定/可追溯"断言只证明出站引用与获准证据包片段的来源绑定（哈希/解析版本/文本定位），**不证明替身结论内容正确**（替身输出为合成文本）。
- **未执行**正式审批/额度/资金动作（未调用任何 approve/confirm/放款类端点）——按任务书边界列为不适用。
- 测试代码仅落本目录；运行时暂存：每轮系统临时目录 runDir 与 Connectors 夹具对象存储（dispose 自清理），未修改任何共享配置/默认测试入口。
- 复用既有机制：Back/Connectors/test/processing-helpers.mjs、Back/D/harness/pgctl.mjs、Back/Edge/test/serial-remainder/full-chain.e2e.mjs 模式；未重跑既有全套测试（无变化不重跑）。

## 必测映射

| 必测项 | 断言 | R1 | R2 |
|---|---|---|---|
| 最小链：登记→处理→获准证据包→分析→引用读回 | T01, T02, T03, T04, T05, T09, T11, T12 | 通过 | 通过 |
| 同hash/解析版本/位置可追溯 | T06, T07, T10 | 通过 | 通过 |
| 补入新材料后旧结果失效 | T15, T16, T17, T18 | 通过 | 通过 |
| 重复材料不虚增独立证据 | T19, T20, T21 | 通过 | 通过 |
| 反例：伪造引用 | T08, T24, T25 | 通过 | 通过 |
| 反例：跨客户原件 | T26, T30 | 通过 | 通过 |
| 反例：撤权 | T31, T32, T33, T34 | 通过 | 通过 |
| 反例：冲突 | T27, T28, T29 | 通过 | 通过 |
| 反例：缺证 | T22, T23 | 通过 | 通过 |
| select/undo本人隔离与刷新读回 | T35, T36, T37, T38, T39, T40, T41, T42 | 通过 | 通过 |
| 连续两轮相同操作顺序但独立测试状态 | R-IND-01, R-ENV-01, R-ENV-02, R-ENV-03 | 通过 | 通过 |

## 明细（按轮）

### 轮次 R1

- 环境：A容器=v7d-pg-45ca19c357:49284 A库=jw_qa_ec_r1_a A端口=60837；Connectors库=cnext_test_mua6gb9v_34jg 端口=60847；Edge端口=60848
- 模型替身命中=12；出站brief=12；回执文件=36；反馈库文件=2；HTTP调用记录=62
- 清理：容器=v7d-pg-45ca19c357 runDir已删=true

| 断言 | 名称 | 结果 | 明细 |
|---|---|---|---|
| R-IND-01 | 轮独立·替身捕获/命中计数从零开始 | 通过 | hits=0 |
| R-ENV-01 | 真实A内核就绪（独占PG独占库） | 通过 | db=jw_qa_ec_r1_a container=v7d-pg-45ca19c357 |
| R-ENV-02 | 真实Connectors就绪（独占库，A桥指向真实A） | 通过 | db=cnext_test_mua6gb9v_34jg |
| R-ENV-03 | Edge就绪·双业务人受控登录（live凭据核实器过A探针） | 通过 | sid1=true sid2=true |
| T01 | 真实A登记·客户建档（POST /api/v2/customers） | 通过 | customerId=cust-mua6gdbd-6f34b784fa79 |
| T02 | 真实上传入口·两件原件（邀请→上传→异步解析→处理链） | 通过 | d01:ev_8abcbe23126c401299e8,d02:ev_eb2aa8b6bc4b4e709c39 |
| T03 | 真实A登记·材料经A桥登记（a_links registered，零手工插表） | 通过 | material/ev_8abcbe2/art-mua6gdgw-782b11fcd64d/registered \| material/ev_eb2aa8b/art-mua6ge0n-404a63715ec7/registered |
| T04 | A侧工件清单可见（GET artifacts，含 a_ref 全集） | 通过 | aArtifacts=4 |
| T05 | 观察·200/current/sent/六节点图（prepare_evidence→…→output_receipt） | 通过 | {"status":200,"model":{"status":"simulated","sent":true,"requestId":"amq:cust-mua6gdbd-6f34b784fa79:v2-7ee6e65f58d6062f9f0b67044c5b83ffd32c5bbba92524bfc6f90f88d98a0fb9::obs:credit: |
| T06 | 引用读回·有效引用绑定本次证据包片段（source_bound + 片段哈希/定位在场） | 通过 | obs={"text":"替身观察：证据中可见申请金额与合同要素","evidenceRefIds":["448238748e9f0a07dbc065ef1696b5e7b60d0ff492a7072e4de1928cb8cc4fe8"],"citationStatus":"source_bound"} refHash=0e7a568e locator={" |
| T07 | 片段id↔内容绑定·digest(片段内容)重算等于id（防手拼/篡改包） | 通过 | evidenceRefs=1 |
| T08 | 伪造引用反例·不进入有效观察并降级为带标识待核验（逐条校验记录留档） | 通过 | checks=[{"valid":true,"evidenceRefIds":["448238748e9f0a07dbc065ef1696b5e7b60d0ff492a7072e4de1928cb8cc4fe8"],"reason":"SOURCE_BOUND"},{"valid":false,"evidenceRefIds":["forged-ref"], |
| T09 | 获准证据包·出站仅获准证据（authority=none、客户匹配、客户端注入事实不出站） | 通过 | snippets=2 authority=none customerId匹配=true |
| T10 | 同hash/解析版本/位置可追溯·每片段可在 parse_results 复算（哈希→解析版本→文本切片） | 通过 | 片段数=1 |
| T11 | 决策·候选置信度降序且全部绑定获准片段（authority=none） | 通过 | {"status":200,"candidates":["option_1/0.8","option_2/0.5"],"model":{"status":"simulated","source":{"mode":"mock","endpointOrigin":"http://127.0.0.1:49283","model":"c-mock","simulat |
| T12 | 决策·GET刷新读回一致（set/revision/候选/反馈空） | 通过 | revision=2/2 |
| T13 | 决策·同operationId重放零新增模型调用（事件级回执） | 通过 | hits=2（应为2） |
| T14 | 决策回执持久化·TERMINAL回执落盘且含requestId与完整identity | 通过 | receiptFiles=4 terminalRequestId匹配=true |
| T15 | 补证D09·上传+处理+A登记（registered 3条） | 通过 | d09Evidence=ev_7e5296b417e448ae9a52 |
| T16 | 旧结果失效·上下文变化后 GET current=false、候选与引用清空、旧记录保留（不删除） | 通过 | current=false candidates=0 |
| T17 | 补证后·新上下文触发新发送、新requestId、新决策current（刷新读回） | 通过 | hits=3 req不变=false |
| T18 | 旧回执仍在（历史不改写，持久记录完整） | 通过 | amq:cust-mua6gdbd-6f34b784fa79:v2-0cae8f570f1450c2de789315f39d7983ac1382255d634c2bd5d012a7f7ed21ad::obs:credit:ff436bc3b1d9::a1 |
| T19 | 重复材料·登记判定 duplicate_of=首次evidenceId（same_source） | 通过 | dup=ev_f336585f434f422c9c87 duplicate_of=ev_8abcbe23126c401299e8 flag=same_source |
| T20 | 重复材料·A侧不重复登记（无新 a_link；处理段 skipped duplicate_of_local） | 通过 | links= stages=register_material/skipped,unzip/skipped,parse/skipped_duplicate |
| T21 | 重复材料·证据包不虚增（D01哈希仍只对应1个evidenceId，包内材料=3件不增） | 通过 | 材料数=3 d01EvidenceIds=["ev_8abcbe23126c401299e8"] |
| T22 | 缺证反例·观察面422 EVIDENCE_UNAVAILABLE 且未发送 | 通过 | {"status":422,"body":{"ok":false,"error":"EVIDENCE_UNAVAILABLE","sent":false,"note":"获准原件、登记映射或现行解析不可用，模型未发送"}} |
| T23 | 缺证反例·决策面非2xx显式阻断、零模型调用（观察面0命中保持） | 通过 | dec=503/DECISION_UNAVAILABLE get=503 hits=4（应4） |
| T24 | 伪造引用候选·整批拒绝（valid=false、candidates空、INVALID_DECISION_OUTPUT） | 通过 | error=INVALID_DECISION_OUTPUT candidates=0 |
| T25 | 伪造集反馈·409 DECISION_STALE（无效集不可反馈） | 通过 | {"status":409,"body":{"ok":false,"error":"DECISION_STALE"}} |
| T26 | 跨客户/跨租户原件·内部证据面返回空集（不猜测不跨户） | 通过 | unknown=0 跨户=0 跨租户=0 |
| T27 | 冲突轮·被更正方原文在包（149.0769 可见，矛盾不自行消除） | 通过 | has149=true |
| T28 | 更正轮·本地superseded_by落库 + A侧工件取代链（S02登记且supersedes=C01 a_ref） | 通过 | superseded=[{"evidence_id":"ev_af2f60b588f149d4aad1","superseded_by":"ev_4a083ca8ecd64c6d90cd"}] s02Art=true supersedes匹配=true |
| T29 | 更正生效·被取代件不再出站（149.0769消失），更正声明与新增件同包 | 通过 | has149=false has139=true hasD11=true |
| T30 | 跨客户证据隔离·injection 包不含 laser 任何原件哈希 | 通过 | injSnippets=2 |
| T31 | 撤权中·返回后授权复核失败→403（候选/观察不泄露） | 通过 | {"status":403,"body":{"ok":false,"error":"FORBIDDEN"}} |
| T32 | 撤权期·后续请求入口即403且零新增模型调用 | 通过 | hits=8（应8） |
| T33 | 撤权恢复·同operationId从持久回执恢复（200、零新增模型调用、如实保持not-current） | 通过 | hits=8（应8） current=false valid=false |
| T34 | 新决策·当前有效集可用（恢复撤权中断后重新分析，current=true） | 通过 | hits=9（应9） candidates=2 |
| T35 | select·本人反馈生效（action/candidateId/label 写回 latest） | 通过 | {"action":"select","candidateId":"option_1","label":"核对销售合同未付余额","reason":"业务本人选择","eventId":"feedback:r1-op-sel","at":"2026-09-20T18:56:34.763Z"} |
| T36 | select·刷新读回持久一致（文件型反馈库） | 通过 | revision=11 |
| T37 | undo·本人撤销清空反馈且刷新读回一致 | 通过 | undo=200 feedback=null |
| T38 | undo后纠偏回路·新同问题分析上下文反馈如实为null（不带入已撤销反馈） | 通过 | 行=[此前本人反馈·仅限同客户同问题与相同证据，不是审批或事实] null feedbackUsed=null |
| T39 | 反馈纠偏回路·本人反馈进入下一轮同问题分析上下文（此前反馈行含候选+feedbackUsed） | 通过 | 行=[此前本人反馈·仅限同客户同问题与相同证据，不是审批或事实] {"action":"select","at":"2026-09-20T18:56:36.865Z","candidateId":"option_1","eventId":"feedback:r1-op-sel2"," feedbackUsed匹配=true |
| T40 | 本人隔离·biz2 同客户同助手读不到 biz1 的候选与反馈（独立scope revision=0） | 通过 | {"revision":0,"latest":null} |
| T41 | 本人隔离·biz2 独立分析+反馈成功，且不影响 biz1 的revision与状态 | 通过 | biz2fb=option_1 biz1rev不变=true |
| T42 | 反馈非法输入·错候选400/错set 409 STALE/错revision 409 VERSION_CONFLICT | 通过 | cand=400/INVALID_CANDIDATE set=409/DECISION_STALE rev=409/VERSION_CONFLICT |

### 轮次 R2

- 环境：A容器=v7d-pg-5dfb87d7db:52367 A库=jw_qa_ec_r2_a A端口=56557；Connectors库=cnext_test_mua6h8pp_3054 端口=56566；Edge端口=56567
- 模型替身命中=12；出站brief=12；回执文件=36；反馈库文件=2；HTTP调用记录=62
- 清理：容器=v7d-pg-5dfb87d7db runDir已删=true

| 断言 | 名称 | 结果 | 明细 |
|---|---|---|---|
| R-IND-01 | 轮独立·替身捕获/命中计数从零开始 | 通过 | hits=0 |
| R-ENV-01 | 真实A内核就绪（独占PG独占库） | 通过 | db=jw_qa_ec_r2_a container=v7d-pg-5dfb87d7db |
| R-ENV-02 | 真实Connectors就绪（独占库，A桥指向真实A） | 通过 | db=cnext_test_mua6h8pp_3054 |
| R-ENV-03 | Edge就绪·双业务人受控登录（live凭据核实器过A探针） | 通过 | sid1=true sid2=true |
| T01 | 真实A登记·客户建档（POST /api/v2/customers） | 通过 | customerId=cust-mua6hadm-11a36a7e9eb9 |
| T02 | 真实上传入口·两件原件（邀请→上传→异步解析→处理链） | 通过 | d01:ev_943e6c81ca4a408bb894,d02:ev_38ee789d5f9b42ef9581 |
| T03 | 真实A登记·材料经A桥登记（a_links registered，零手工插表） | 通过 | material/ev_38ee789/art-mua6hb0d-b46cde6842ad/registered \| material/ev_943e6c8/art-mua6hajj-6ada4dac88de/registered |
| T04 | A侧工件清单可见（GET artifacts，含 a_ref 全集） | 通过 | aArtifacts=4 |
| T05 | 观察·200/current/sent/六节点图（prepare_evidence→…→output_receipt） | 通过 | {"status":200,"model":{"status":"simulated","sent":true,"requestId":"amq:cust-mua6hadm-11a36a7e9eb9:v2-eb8e17862427daf7a6fa1f34c1ffa6c01f912e7adec6a5fa8bfaad69acbe31e5::obs:credit: |
| T06 | 引用读回·有效引用绑定本次证据包片段（source_bound + 片段哈希/定位在场） | 通过 | obs={"text":"替身观察：证据中可见申请金额与合同要素","evidenceRefIds":["c290964ae5b69aaae136f5d631eb6c73caa8d9234466cd4a547f5c3497bce46c"],"citationStatus":"source_bound"} refHash=8eb9eafe locator={" |
| T07 | 片段id↔内容绑定·digest(片段内容)重算等于id（防手拼/篡改包） | 通过 | evidenceRefs=1 |
| T08 | 伪造引用反例·不进入有效观察并降级为带标识待核验（逐条校验记录留档） | 通过 | checks=[{"valid":true,"evidenceRefIds":["c290964ae5b69aaae136f5d631eb6c73caa8d9234466cd4a547f5c3497bce46c"],"reason":"SOURCE_BOUND"},{"valid":false,"evidenceRefIds":["forged-ref"], |
| T09 | 获准证据包·出站仅获准证据（authority=none、客户匹配、客户端注入事实不出站） | 通过 | snippets=2 authority=none customerId匹配=true |
| T10 | 同hash/解析版本/位置可追溯·每片段可在 parse_results 复算（哈希→解析版本→文本切片） | 通过 | 片段数=1 |
| T11 | 决策·候选置信度降序且全部绑定获准片段（authority=none） | 通过 | {"status":200,"candidates":["option_1/0.8","option_2/0.5"],"model":{"status":"simulated","source":{"mode":"mock","endpointOrigin":"http://127.0.0.1:49283","model":"c-mock","simulat |
| T12 | 决策·GET刷新读回一致（set/revision/候选/反馈空） | 通过 | revision=2/2 |
| T13 | 决策·同operationId重放零新增模型调用（事件级回执） | 通过 | hits=2（应为2） |
| T14 | 决策回执持久化·TERMINAL回执落盘且含requestId与完整identity | 通过 | receiptFiles=4 terminalRequestId匹配=true |
| T15 | 补证D09·上传+处理+A登记（registered 3条） | 通过 | d09Evidence=ev_e76f8fe6fde949918e4c |
| T16 | 旧结果失效·上下文变化后 GET current=false、候选与引用清空、旧记录保留（不删除） | 通过 | current=false candidates=0 |
| T17 | 补证后·新上下文触发新发送、新requestId、新决策current（刷新读回） | 通过 | hits=3 req不变=false |
| T18 | 旧回执仍在（历史不改写，持久记录完整） | 通过 | amq:cust-mua6hadm-11a36a7e9eb9:v2-1ab41eda2a95829ed593d47830a83ffe21c75d2b72b3495623a22fee455674cc::obs:credit:ff436bc3b1d9::a1 |
| T19 | 重复材料·登记判定 duplicate_of=首次evidenceId（same_source） | 通过 | dup=ev_42d180e6194e41c6a24a duplicate_of=ev_943e6c81ca4a408bb894 flag=same_source |
| T20 | 重复材料·A侧不重复登记（无新 a_link；处理段 skipped duplicate_of_local） | 通过 | links= stages=register_material/skipped,unzip/skipped,parse/skipped_duplicate |
| T21 | 重复材料·证据包不虚增（D01哈希仍只对应1个evidenceId，包内材料=3件不增） | 通过 | 材料数=3 d01EvidenceIds=["ev_943e6c81ca4a408bb894"] |
| T22 | 缺证反例·观察面422 EVIDENCE_UNAVAILABLE 且未发送 | 通过 | {"status":422,"body":{"ok":false,"error":"EVIDENCE_UNAVAILABLE","sent":false,"note":"获准原件、登记映射或现行解析不可用，模型未发送"}} |
| T23 | 缺证反例·决策面非2xx显式阻断、零模型调用（观察面0命中保持） | 通过 | dec=503/DECISION_UNAVAILABLE get=503 hits=4（应4） |
| T24 | 伪造引用候选·整批拒绝（valid=false、candidates空、INVALID_DECISION_OUTPUT） | 通过 | error=INVALID_DECISION_OUTPUT candidates=0 |
| T25 | 伪造集反馈·409 DECISION_STALE（无效集不可反馈） | 通过 | {"status":409,"body":{"ok":false,"error":"DECISION_STALE"}} |
| T26 | 跨客户/跨租户原件·内部证据面返回空集（不猜测不跨户） | 通过 | unknown=0 跨户=0 跨租户=0 |
| T27 | 冲突轮·被更正方原文在包（149.0769 可见，矛盾不自行消除） | 通过 | has149=true |
| T28 | 更正轮·本地superseded_by落库 + A侧工件取代链（S02登记且supersedes=C01 a_ref） | 通过 | superseded=[{"evidence_id":"ev_25dddaa29661494a890e","superseded_by":"ev_e06e4aee6d8a4e5bbca3"}] s02Art=true supersedes匹配=true |
| T29 | 更正生效·被取代件不再出站（149.0769消失），更正声明与新增件同包 | 通过 | has149=false has139=true hasD11=true |
| T30 | 跨客户证据隔离·injection 包不含 laser 任何原件哈希 | 通过 | injSnippets=2 |
| T31 | 撤权中·返回后授权复核失败→403（候选/观察不泄露） | 通过 | {"status":403,"body":{"ok":false,"error":"FORBIDDEN"}} |
| T32 | 撤权期·后续请求入口即403且零新增模型调用 | 通过 | hits=8（应8） |
| T33 | 撤权恢复·同operationId从持久回执恢复（200、零新增模型调用、如实保持not-current） | 通过 | hits=8（应8） current=false valid=false |
| T34 | 新决策·当前有效集可用（恢复撤权中断后重新分析，current=true） | 通过 | hits=9（应9） candidates=2 |
| T35 | select·本人反馈生效（action/candidateId/label 写回 latest） | 通过 | {"action":"select","candidateId":"option_1","label":"核对销售合同未付余额","reason":"业务本人选择","eventId":"feedback:r2-op-sel","at":"2026-09-20T18:57:20.747Z"} |
| T36 | select·刷新读回持久一致（文件型反馈库） | 通过 | revision=11 |
| T37 | undo·本人撤销清空反馈且刷新读回一致 | 通过 | undo=200 feedback=null |
| T38 | undo后纠偏回路·新同问题分析上下文反馈如实为null（不带入已撤销反馈） | 通过 | 行=[此前本人反馈·仅限同客户同问题与相同证据，不是审批或事实] null feedbackUsed=null |
| T39 | 反馈纠偏回路·本人反馈进入下一轮同问题分析上下文（此前反馈行含候选+feedbackUsed） | 通过 | 行=[此前本人反馈·仅限同客户同问题与相同证据，不是审批或事实] {"action":"select","at":"2026-09-20T18:57:23.751Z","candidateId":"option_1","eventId":"feedback:r2-op-sel2"," feedbackUsed匹配=true |
| T40 | 本人隔离·biz2 同客户同助手读不到 biz1 的候选与反馈（独立scope revision=0） | 通过 | {"revision":0,"latest":null} |
| T41 | 本人隔离·biz2 独立分析+反馈成功，且不影响 biz1 的revision与状态 | 通过 | biz2fb=option_1 biz1rev不变=true |
| T42 | 反馈非法输入·错候选400/错set 409 STALE/错revision 409 VERSION_CONFLICT | 通过 | cand=400/INVALID_CANDIDATE set=409/DECISION_STALE rev=409/VERSION_CONFLICT |

## 分类口径

- **通过**：上表"通过"项；两轮同序号语义一致。
- **失败**：上表"失败"项（产品缺陷以最小复现陈述，不改产品实现、不弱化断言）。
- **未测**：无（本包必测项全部执行；若环境阻点发生，此处会逐项列出并使 runner 返回非零）。
- **不适用**：正式审批/资金动作（按任务书不执行）；真实模型质量（模型为本地替身，明确不适用）。

## 持久证据

- evidence-round-1.json / evidence-round-2.json：逐断言结果、HTTP 调用面记录、出站 brief 全文、回执/反馈文件清单。
- sha256-inputs-before.json / sha256-inputs-after-diff.json：输入源码与合成材料台账（30 项）。
