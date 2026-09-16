# D路 RESULT（V7 backend · 第一轮黑盒验收）

日期：2026-09-15 03:0x。执行：ZCode（GLM-5.3-Flash · max thinking）。写面仅 `V7/backend/D/**`；A/B/C 与 site/V6/home/**、3607/3467 只读；真实付费 API 0 次；无 commit/push/tag。

## 当前结论（07:4x 最终轮更新）

**CONTRACT v0.2 最终轮：recovery-round 独立复跑 24 ok/0 FAIL（thin+LangGraph 双恢复链，含 unknown 不自动重发/错凭据双门拒绝/B completed 不冒充 A 正式决定/凭据零落盘）；X 矩阵 60/60、thin 编排 18/18（v0.2 principal 门适配）、LangGraph 17/17 全部在钉版最终版本复测维持；manifest 23/23 匹配，发现覆盖缺口 D-11（B/src/deps.mjs + B/package.json + B/package-lock.json 未登记，精确清单已交 A）；D-10 凭据泄漏面确认（verifier 异常消息内嵌凭据传播至调用方错误，journal/snapshot/A 存储/响应/日志零持久化，owner B）。工程验收边界内全部完成；真实模型能力、生产身份源、site 集成、用户接受为未验证门（如实标注）。**

## 首轮总判定（历史）

**CONTRACT v0 黑盒验收第一轮：56 PASS / 4 FAIL。**
4 项真实缺陷（D-3～D-6，全部 owner=A，工程故障/合同缺口类）+ 1 项接口澄清（K-1）。详见 `defects/DEFECTS.md`（v2 终版，含初版误报撤回记录）。

| 严重度 | ID | 摘要 |
| --- | --- | --- |
| 高 | D-6 | 人工动作身份=自声明字段无认证：无凭据自称 human → 200 且状态翻转（X-8f） |
| 中 | D-4 | unknown 态可写入模型意见（"opinion 仅 pending→candidate_ready"门缺失） |
| 中 | D-5 | 伪造证据引用（不存在的 evidenceId）被接受入库，永不触发 stale |
| 低-中 | D-3 | resolved 终态后仍可追加人工动作（结合 formalOutcome 语义会改写正式结果） |
| 低 | K-1 | stale/formalOutcome 位于响应顶层非 run 对象内——合同措辞歧义（D 初版误报已撤回） |

## 通过面（工程主干成立）

双端同刻一致；requestId 幂等（重放/换载荷409/并发恰一次/回执 found:false 诚实）；SIGKILL 重启后事实+run+幂等表全恢复版本单调；supersede 链+EVIDENCE_SUPERSEDED+opinion 级 stale；计算缺参 400 不落库不补造；candidate 禁用键结构拒绝；错误语义统一（400/404/500 STORE_CORRUPT、ok:false、no-store、破损 JSON 体 400）；损坏注入失败关闭且不静默重置、恢复文件即恢复。

## 版本与证据

- 被测：A src 三文件（hash：`evidence/a-src-hashes-at-dtest.txt`）。
- 台账：`evidence/x-matrix.json`（56/4，含每项归类）；复现：`node V7/backend/D/runtime/x_matrix.mjs`（自包含 ~30s）。
- 设计：`TEST_DESIGN.md`（X/Y 矩阵+反模式边界）；过程：`STATUS.md` 心跳轮记录。

## 未验证/凭据阻断（如实）

1. 真实模型通道端到端（D 无凭据；由 B 的凭据阻断记录+C 的真实证据覆盖，B STATUS 已明确 0 次真实调用未伪称接通）。
2. 编排层（B）与工具本体（C）行为：待 assembly 组合产物（固定 hash）后扩测。
3. 干净目录安装/迁移（Y-2/Y-5）：待 A 发布最终 assembly 运行说明后执行。
4. 跨机器验证：本轮全部本机隔离复跑，如实标注；无第二台机器。
5. C 工具单位/口径语义（X-6 只覆盖 A 层校验；工具本体待 C 产物）。

## 下一步

1. A 修复 D-3～D-6 + K-1 合同澄清 → 同脚本复测（X-8f 判据按 A 对 D-6 身份边界裁决更新）。
2. A 发布 assembly（固定 hash）→ 组合验收 + Y-2/Y-3/Y-4/Y-5。
3. B/C 产物入组合 → 编排层 unknown/恢复/并发语义 + 工具单位/口径/案例预期扩展验收。


## 组合层验收（A assembly × C，2026-09-15 02:5x · 第二轮）

**15 PASS / 0 FAIL。** 台账：`evidence/assembly-tests.json`；复现：`node V7/backend/D/runtime/assembly_tests.mjs`。

- **A-1 组合复跑**：`integrated-round.mjs` 在 D 隔离数据目录独立复跑全绿（11 项检查 0 FAIL）。观察项 O-A1：A README 称"14/14"，实际为 11 项 expect——文档计数漂移（功能无缺）。
- **A-2 C 工具本体反证全过**：正常输入带 toolVersion/formulaVersion；同输入确定性（字节级一致）；缺月供/缺口径/非法币种/零月供全部结构化拒绝（MISSING/CALIBER/CURRENCY），**不补造数值**。
- **A-3 双层检验**：C 预校验层记录在案；**A HTTP 层伪造引用仍被接受（D-5 在组合层成立）**；**无凭据自称 human 仍生效（D-6 在组合层成立）**。
- **A-4 组合数据经标准 HTTP 可读**：state/opinions/calculation 在位，顶层投影 stale/formalOutcome 在。
- **Y-2 干净目录可移植性 ✅**：仅拷贝 A/src+A/assembly+C/src+C/rules（零 node_modules、零安装）到全新目录即运行成功——A/C 零依赖设计成立。
- **Y-5 数据迁移 ✅**：数据目录整拷至新路径后服务直读，run/opinions 完整。

### 更新后的缺陷面

- D-3/D-4/D-5/D-6 维持（组合层复核 D-5/D-6 成立）；K-1 维持；新增观察项 O-A1（README 计数漂移，owner=A，文档）。
- B 接入 assembly 后（下一组合轮）：编排层 unknown/恢复/幂等扩展验收。


## 复测轮（CONTRACT v0.1 · 2026-09-15 04:0x）—— 全部缺陷关闭

A 发布 v0.1（D-6 身份层：principalVerifier + token 允许列表 sha256 存储 + fail-closed）后，D 同套件复测：

- **X 矩阵 60/60 全过**（套件适配 v0.1 认证：测试服务器以 `--principal-tokens` 注入测试 token，合法人工动作携带 `principalCredential`；无凭据伪造断言反转为"必须 403"）。
- **D-3/D-4/D-5/D-6 全部关闭**（含 D-3 终态保护：resolved+有效凭据→409）。
- **b-round（A×B×C）全过**：B 编排completed/意见+计算落库/确定性回执/B 去重+A 幂等双层/无凭据失败关闭/principalId 留痕；D-7/D-8 关闭。
- **Y-2/Y-5 维持通过**（零依赖拷贝即运行/数据目录迁移）。

### 交付面状态

- Y-1 可复跑 E2E ✅（`runtime/x_matrix.mjs`+`runtime/assembly_tests.mjs`）
- Y-2 干净目录 ✅；Y-3 依赖清单 ✅；Y-4 凭据扫描 ✅（0 命中）
- Y-5 启动/恢复/迁移 ✅（重启恢复=X-3；迁移=A-4/Y-5）
- Y-6 跨机器：本机隔离复跑如实标注，未称跨机器
- 凭据阻断项维持：真实模型通道（B/C 同此阻断，0 次真实调用）
