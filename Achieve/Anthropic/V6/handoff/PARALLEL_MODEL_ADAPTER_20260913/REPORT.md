# REPORT｜并行任务 A:可替换模型适配器与故障验证(2026-09-13)

任务书:`V6/ZCODE_PARALLEL_A_MODEL_20260913.md`;分工边界:`V6/ZCODE_PARALLEL_20260913.md`。本批交付已完成并冻结,状态见 `STATUS.md`(READY_FOR_REVIEW)。

## 1. 交付了什么

一个**隔离、可运行、零新增依赖**(Node 22 原生 ESM + node:test)的模型适配模块,供主任务从"固定问句 stub"升级为可接真实模型的结构化调用边界:

- `src/adapter.mjs`:`createModelAdapter({transport, clock, ledger, roles, timeoutMs, ...})` → `analyze(request, context)`;七状态生命周期、取消/超时/暂停语义、实例内去重;另含 `createProviderTransport` 便捷组装(适配器自身从不发网络请求,fetch 由业务层注入)。
- `src/validate-request.mjs`:接口 v1 最小请求校验 + 六角色配置表(可整体替换;无逐事件轮转六角色的任何内置逻辑,单一 provider 实例服务所有角色)。
- `src/validate-response.mjs`:输出守门——结构校验、证据引用三元组精确核查(拒绝悬空引用/无来源事实)、越权批准拦截(保留字段 + 决定性表述词表,启发式)。
- `src/ledger.mjs`:独立成本账本(预留/结算/unknown 保留/释放;预算上限含并发;非法迁移接口层拒绝)。
- `src/dedupe.mjs`:实例内去重/变载荷冲突(规范化 JSON SHA256)。
- `src/clock.mjs`:系统时钟 + 手动时钟(确定性超时测试)。
- `src/simulated.mjs`:显式 SIMULATED 通道(状态=simulated,带显著中文声明;同样通过输出守门)。
- `src/providers/http-json.mjs`、`src/providers/dify-workflow.mjs`:两种 provider 纯映射(通用 HTTP/OpenAI Chat Completions 形状、Dify Workflow blocking)。
- `src/fixtures/provider-fixtures.mjs`:脱敏响应 fixture(合成尽调内容)。
- `test/`:91 项测试,一次命令运行;`test/contract-assertions.mjs` 是可对任意实现运行的协议断言套件。
- `evidence/`:原始测试输出、对抗结果 JSON、刻意注入的坏实现(mutant)源文件。

## 2. 测试结果(实测)

命令:`node test/run-all.mjs`(环境:Node v22.23.1,Windows;零端口、零网络、零真实模型调用)。**91/91 通过**(原始输出:`evidence/test-run-full.txt`)。

任务书要求的故障类用例覆盖(每类均有独立可运行用例):

| # | 故障类 | 用例位置 | 结果 |
| --- | --- | --- | --- |
| 1 | 正常结构 | 01(succeeded/simulated 结构+usage 结算+中文) | 绿 |
| 2 | 缺字段/空输出 | 02(16 组请求校验)、03(EMPTY_OUTPUT/MALFORMED) | 绿 |
| 3 | 非法角色 | 02(UNKNOWN_ROLE/大小写/PURPOSE_NOT_ALLOWED) | 绿 |
| 4 | 悬空引用 | 03(EVIDENCE_DANGLING/hash 不匹配/无来源事实) | 绿 |
| 5 | 重复请求 | 04(顺序缓存+并发 in-flight 共享,transport 恰好 1 次) | 绿 |
| 6 | 同ID变载荷 | 04/03(REQUEST_MISMATCH:text/evidenceRefs/generation) | 绿 |
| 7 | 超时前取消 | 05(预先 abort→cancelled;sent:false→cancelled) | 绿 |
| 8 | 送出后 unknown | 05(abort/timeout/indeterminate→unknown,预留保留) | 绿 |
| 9 | 暂停后返回 | 06(实例登记+context.snapshot→stale) | 绿 |
| 10 | 版本过期 | 06(generation/contextVersion 变化→stale) | 绿 |
| 11 | 部分失败 | 03(一条悬空→整体 failed 不留部分成功)、08(Dify partial-succeeded→failed) | 绿 |
| 12 | usage 缺失 | 03/07(succeeded 但 usageUnknown=true,unknown_hold 保留,不记0不释放;后续请求被预算拦住) | 绿 |
| 13 | 预算不足 | 07(BUDGET_EXCEEDED 零调用;并发 3×4k/10k 只有 2 个送出;失败路径) | 绿 |

额外覆盖:not_configured 零调用、超时(手动时钟)与迟到结果不采信、transport 异常/证明未发送、错误体带 usage 的结算、账本非法迁移、provider 映射 build/parse 与 fake-fetch 端到端、凭据不落载荷断言。

## 3. 对抗验证:测试能抓住刻意注入的坏实现

`test/unit/09-adversarial.test.mjs` 注入 6 类坏实现(2 类为**源码变异**:把 `validate-response` 的守门分支改为直通,与 adapter 组装为可运行坏实现存于 `evidence/mutants/`;4 类为行为包装),对每类运行协议断言套件:

| 注入缺陷 | 被抓场景 |
| --- | --- |
| mutant-A 删除悬空引用检查 | S3(悬空引用必须 failed) |
| mutant-B 放行越权批准输出 | S4(UNAUTHORIZED_OUTPUT) |
| wrapper-C 失败伪装成功 | S2(空输出必须 failed) |
| wrapper-D stale 冒充现行 | S8 |
| wrapper-E unknown 自动重试 | S9(transport 调用被放大到 6 次) |
| wrapper-F 缺 usage 记 0 并释放 | S10 |

好实现对同一套件**零违规**(套件不误伤)。结果 JSON:`evidence/adversarial-results.json`。

## 4. 关键设计决定(与任务书逐条对应)

1. **无新增依赖 ES 模块**;`analyze(request, context)`;transport 注入;角色可配置但**无强制六角色轮转**(§1,契约已冻结)。
2. 请求字段与七状态齐全,显式区分,状态机见 ADAPTER_CONTRACT §3。
3. 输出中文、协议标识英文;验证失败一律 failed,不伪装成功(任务书 2/3 条)。
4. AbortSignal/时钟/transport 全部可注入;**无法证明未送达即 unknown,不声称取消等于未计费;unknown 零自动重试**(任务书 4 条,有专门测试)。
5. 同实例同载荷去重、变载荷 REQUEST_MISMATCH;**持久化幂等与跨进程恰好一次明确不在本模块范围**,由业务层持久记录(任务书 5 条,契约 §8 声明)。
6. ledger 预留/结算/未知保留;缺 usage 不记 0 不释放;上限+并发+失败路径已测;**本轮真实模型请求数=0**(全部 transport 为受控假件/模拟件)。
7. provider 映射恰两种:通用 HTTP(OpenAI Chat Completions 形状)、Dify Workflow;纯映射函数+脱敏 fixture;官方文档来源与检索日期已记录(OpenAI OpenAPI spec v2.3.0;docs.dify.ai Run Workflow,均 2026-09-13 检索);**缺真实服务,不声明实际兼容通过**。未增加通用 Agent 平台。

## 5. NOT TESTED 与边界声明

- 真实模型推理质量、回答正确性、金融/风险判断准确率:**NOT TESTED**(本模块只管协议与边界;quality 评估归主任务与并行 C 工具组合)。
- 真实 OpenAI 形状网关、真实 Dify 1.13.2 实例端到端兼容:**NOT TESTED**(仅官方文档格式映射+fixture;接通前须小流量实测)。
- 真实凭证/内网权限:未获取、未使用、未从 ZCode/Codex/Dify 配置读取任何凭据;fixtures/测试仅用 DUMMY 占位。
- 物理设备、真实客户数据:未涉及;测试数据全部合成。
- 越权批准词表为启发式护栏,存在已知局限,最终防线是产品层 `authority=none`。
- 未运行共享 next build,未触碰 3321/3399/3311,未操作 Dify/Git/Codex;未写本目录以外任何文件。

## 6. 给主任务的映射与缺口

接入步骤、状态→UI 动作映射、重试语义、缺口清单见 `INTEGRATION.md`。一句话:**后端服务层约一个服务文件+一张状态映射表即可接入,前端调用方式不变;明确不承诺零代码替换。**
