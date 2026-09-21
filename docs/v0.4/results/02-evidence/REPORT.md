# REPORT · V0.4-02 指定材料范围与证据完整性（证据选择模块）

- 日期：2026-09-21
- 任务书：docs/v0.4/ZCODE_PARALLEL_04.md 路02
- 契约：同目录 [CONTRACT.md](CONTRACT.md)；接线示例：[integration-example.md](integration-example.md)
- 结论：**新测试 18/18 通过（exit 0，两轮可重复）**；受影响既有回归 15/15 通过（exit 0）；无失败遗留。

## 1. 交付物与源码 hash

| 文件 | 状态 | sha256 |
|---|---|---|
| Back/Edge/src/assistant-evidence-scope.mjs | 新增（选择标准化+失败关闭校验） | `9da6362de1b6408e30078e35c7a419881debee531feaa20d3916b76e524a92e4` |
| Back/Edge/src/assistant-evidence-provider.mjs | 修改（接入 scope；旧路径零变化） | `f5b7b8bffc98ac23270179d0cc49c2765aace8b0f44298dd42ff0f1c3bc86e08`（改动前 `ce2c50e62083397dc4e6fb3a98474613825463e41707d3491fc3d6cf66213229`） |
| Back/Edge/test/v04-evidence-scope.test.mjs | 新增测试（5 项） | `3bb100b82c5956461dacfc699ed43ad944884f17f0f457e0218b2df982e0b562` |
| Back/Edge/test/v04-evidence-provider.test.mjs | 新增测试（13 项） | `8fbb085e8aaa535c3f64fc960bc879e9e3631d4178023a449fc3fc8ac5edf6b1` |
| Back/Edge/src/assistant-evidence.mjs | **未改动**（结论见 §5） | `b6d3b8d7b745d8a4bdd5acc97dc3c34db3521c31fa9d550dd79448997891bc72`（与开工前一致） |

只读依赖终态核验（与开工前一致，未被本路或本路所知范围内改动）：assistant-receipts.mjs `3177fb8d…`、Connectors processing/assistant-evidence.mjs `9ea5a189…`、assistant-model.mjs `41a7029d…`、server.mjs `1f7307b7…`（server 开工前未单独取基线，本路零写入该文件）。逐项开工前快照见 [sha256-inputs-before.txt](sha256-inputs-before.txt)。

## 2. 命令与退出码

```
node --test Back/Edge/test/v04-evidence-scope.test.mjs Back/Edge/test/v04-evidence-provider.test.mjs
  → exit 0（18 pass / 0 fail / 0 skip），另两轮重复 exit 0
node --test Back/Edge/test/assistant-evidence.test.mjs Back/Edge/test/assistant-evidence-http.test.mjs Back/Edge/test/decision-feedback.test.mjs
  → exit 0（15 pass / 0 fail）
```

日志：`.local/v04-02/v04-evidence-tests.log`、`.local/v04-02/regression-evidence.log`。

## 3. 必测矩阵 → 证据

| 必测项 | 断言出处 | 结果 |
|---|---|---|
| 单件 | provider·single：请求体仅含所选ID；包内片段全为该件；未选文本不在 `stable(pack)` | 通过 |
| 组合 | provider·combined：canonical 顺序 `['art-a','art-b']`；两件都进包；第三件不进包不进正文 | 通过 |
| 全量旧调用 | provider·legacy：请求体= snapshot 原顺序全集；包与直接 `prepareEvidence` **deepEqual**、无 selection 字段 | 通过 |
| 乱序/重复ID | provider·duplicate：`[b,a,b,a]`→`[a,b]`；与干净输入包 deepEqual、摘要相同 | 通过 |
| 空选择 | provider·empty：`EVIDENCE_SCOPE_EMPTY`，上游调用 0 次 | 通过 |
| 部分非法 | provider·partially illegal：`EVIDENCE_SCOPE_UNAUTHORIZED`（detail=['ghost']），0 次上游调用，无静默扩全 | 通过 |
| 跨客户/租户 | provider·cross：越权ID（不在本客户 snapshot）进入即拒 0 调用；上游回错 customerId/tenantId 材料→逐件 `EVIDENCE_NOT_AUTHORIZED` | 通过 |
| 材料取代 | provider·superseded：explicit 上游静默缺件→`EVIDENCE_SCOPE_INCOMPLETE`（detail=['art-b']）整次拒绝；legacy 同场景保持旧子集语义（对照证明差异是有意的） | 通过 |
| 上游多返 | provider·extra：请求1件回2件→`EVIDENCE_MAPPING_INVALID` | 通过 |
| 解析失败 | provider·upstream failure：HTTP 500→`EVIDENCE_UPSTREAM_UNAVAILABLE`；200+`{ok:false}`→`EVIDENCE_MAPPING_INVALID` | 通过 |
| 上下文截断 | provider·truncation + scope 单测：8 段×800 上限、`omitted=[{evidenceId,reason:'CONTEXT_LIMIT'}]`、片段 hash/locator/evidenceId/parserVersion 齐全且 `digest(片段内容)=片段id` 重算一致 | 通过 |
| 未选材料不进模型上下文 | single/combined：上游请求体断言 + `stable(pack)` 不含未选文本断言 | 通过 |
| 引用/定位/遗漏可追溯 | scope·traceable：locator 窗口/类型、hash 格式、omission 原因、validateCitations `SOURCE_BOUND`/`UNVERIFIED_REFERENCE` | 通过 |
| （补充）scope 形状非法/清单不可读 | scope 单测 + provider·malformed：字符串/数组/缺键/非字符串元素→`EVIDENCE_SCOPE_INVALID`；`artifactsReadable!==true` 两模式均失败关闭 | 通过 |

## 4. 验收对照

1. **显式范围不扩大**：请求正文只含所选 canonical ID（逐测试断言请求体）；未选材料文本不出现在证据包（即不出站模型上下文）。
2. **越权失败关闭**：空/越权/畸形选择在任何上游调用前整次拒绝（断言 `hits=0`）；上游静默省略（取代/解析缺失）在 explicit 模式整次拒绝；响应逐件重验 tenant/customer/hash/parser/current，不信任上游。
3. **旧调用兼容**：无 scope 时请求体顺序、返回包（deepEqual 直接 `prepareEvidence`）、错误语义与改动前一致；真实 Edge→Connectors→模型替身全链既有 HTTP 回归通过。

## 5. 「有限修复」结论：assistant-evidence.mjs 为何未改

逐件授权校验（tenant/customer/hash∈allowedHashes/parserVersion/current）、上下文截断与遗漏披露、引用绑定在现有 `prepareEvidence`/`validateCitations` 中已实现且被 v0.3 evidence-chain 92/92 验证；本路缺口全部在"选择集"层（上游静默省略、响应集合校验），已由新增 scope 模块 + provider 接线闭合。该文件 hash 与开工前一致，是有意保留而非遗漏。

## 6. 未测 / 未接线 / 不宣称

- **未重跑**：`Back/Edge/test/serial-remainder/full-chain.e2e.mjs`、`bench-30.e2e.mjs`——需真实 A+Connectors+独占 PG 独立栈；其 provider 调用为旧签名，旧路径兼容已由深比对测试与全链 HTTP 回归覆盖，按并行纪律只复验受影响面。
- **待串行集成**（本路未实施，不得宣称完成）：server 请求体解析 `materialScope` 并透传 scope；回执持久化的 `selection.summary` 专用字段（当前经 contextHash 间接进入 requestId）；assistant-model 重放缓存**未**按 scope 显式隔离（不同选择→不同 requestId 是 contextHash 的自然结果，不等于缓存隔离已验证）。
- **不适用**：真实模型出站（任务书要求本地替身，0 次真实出站）；用户页面组合分析入口（不存在，未宣称）。
- 本路无失败遗留；开发过程中修复的 4 处均为**测试自身缺陷**（stub 未设 statusCode、deepEqual 键剔除方式、取代场景断言范围、越权 detail 未捕获），产品代码未因此改动语义。

## 7. 资源与并行纪律

- 本路零容器、零共享端口占用；测试 HTTP 服务 `port:0` 且 `t.after` 关闭；仅写入 `.local/v04-02/`（本路登记目录）与 ownership 文件。
- 工作区中 `Back/Edge/src/customer-activity.mjs`（未跟踪）为并行路04 所建，本路未读写；`Front/preview` 与 `docs/V0.4_KANBAN.md` 的既有改动先于本路存在，本路未触碰。
- 未 commit/push/切分支；未改共享配置、依赖清单与共享 CONTRACT。
