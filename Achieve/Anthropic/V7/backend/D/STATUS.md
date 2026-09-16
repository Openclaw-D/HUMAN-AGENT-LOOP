# D路 STATUS（V7 backend · 独立反证/故障测试/可迁移交付）

更新：2026-09-15 03:00 前后。

## 当前状态：**最终隔离交付验收完成（07:47 更新轮）**——recovery-round 独立复跑 24 ok/0 FAIL；X 60/60、thin 18/18、lg 17/17 全部在钉版最终版本复测维持；manifest 23/23 匹配但存在覆盖缺口 **D-11**（deps.mjs/package 文件未登记，清单已交 A）；**D-10** 凭据泄漏面确认（异常消息传播、零持久化，owner B）；Y-2D 干净目录（含 B 依赖）通过。工程验收边界内无未竟动作；生产验收门独立保留。

## 已完成

1. `TEST_DESIGN.md` Day-1（风险 R-1~R-12 + 矩阵 X/Y + 边界）。
2. CONTRACT v0 发布后：黑盒映射完成（无需求改设计结构，端点/错误码与设计一一对应）。
3. `runtime/harness.mjs`：有界 runner + 故障注入助手（自测通过）。
4. `runtime/x_matrix.mjs`：**自包含可复跑 E2E**（自起隔离实例 3491+/自建数据目录/自清理，全程 ~30s，全部用例有界超时）。首轮台账：`evidence/x-matrix.json`（54/6）。
5. **X 矩阵执行结果**：
   - 通过面：双端共享事实（X-1）、幂等/换载荷409/并发恰好一次/回执查询（X-2）、重启恢复+幂等表持久（X-3）、计算缺参400不落库（X-6）、禁用键结构拒绝（X-7c）、actorRole=model 403（X-8a-c）、错误语义统一（X-9）、损坏失败关闭且不静默重置（X-10）。
   - **缺陷 D-1～D-6**（详见 `defects/DEFECTS.md`，均 owner=A，工程故障类）：
     - D-1 run 顶层 stale 投影缺失（opinion 级 stale 正常）
     - D-2 formalOutcome 恒 null（读时投影未实现）
     - D-3 resolved 后可追加人工动作（结合 D-2 将改写正式结果语义）
     - D-4 unknown 态可写 opinion（"opinion 仅 pending→candidate_ready"状态机门缺失）
     - D-5 伪造证据引用（不存在的 evidenceId）被接受入库
     - D-6 **高**：人工动作身份=自声明字段无认证（心跳反证补充 X-8f：无凭据自称 human → 200 且状态翻转；X-8a 的 403 只是字段白名单，不构成权限控制）
6. D 测试脚本自身 3 处适配修正（响应形状/枚举值/replay同载荷），非产品断言修改；产品判据未迎合实现。

## 下一步

1. 等 A 修 D-1～D-6 → `node runtime/x_matrix.mjs` 复测（X-8f 判据按 A 对身份边界的合同裁决更新）。
2. A/assembly 发布后（已知 assembly/ 有 sim-round.mjs+README）：按实际产物做组合验收 + Y-2 干净目录安装 + Y-5 启动/恢复/迁移 + Y-3/Y-4 依赖与凭据扫描。
3. B/C 产物接入 assembly 后扩 X 到编排层（B 的 unknown 重放语义、C 工具单位/口径行为）。
4. 心跳：每小时读四路 STATUS/RESULT/diff；不重复无变化测试。

## 心跳轮记录

- 02:3x 第一轮执行：54/6（含 2 误报）。
- 02:5x 心跳反证采纳：补 X-8f（无凭据自称 human → 200 且状态翻转=身份即字段）；核对源码发现 getRun→runView 实际返回响应顶层 stale/formalOutcome → 撤回初版 D-1/D-2，降级 K-1 澄清项；修正断言路径后终版 **56/4**，台账 `evidence/x-matrix.json`。
- A/assembly 现状：sim-round.mjs（simulation 占位）+README；B 33/33 自测+凭据阻断记录；待 A 发布 assembly 固定 hash 产物后做组合验收 + Y-2/Y-5。

## 心跳轮记录（续）

- 02:5x 组合层（A×C）：`runtime/assembly_tests.mjs` 15/0。C 工具反证（缺参/口径/币种/确定性）全过；D-5/D-6 在组合层复核成立；Y-2 干净目录（零 node_modules）与 Y-5 数据迁移实测通过。观察项 O-A1：A assembly README"14/14"实为 11 项检查（文档计数漂移）。
- 下一组合轮触发：A 修 D-3~D-6 / B thin 编排器接入 assembly。

- 03:1x **A src 漂移复测**：D-3/D-4/D-5 仍 FAIL（变更内容为 b-round 适配而非缺陷修复），X 维持 56/4；**新增 D-7（高，owner=B）**：deps.mjs fs 封装（fsp as fs）缺 promises API → b-round 组合崩溃（`node A/assembly/b-round.mjs` 在 B thin start 时 TypeError），已清理孤儿 server（PID 38520）并留证据 `evidence/b-round-d-run.txt`；连带观察：b-round 无 try/finally 清理（owner=A，低）。
- 03:2x **Y-3/Y-4 完成**：依赖清单（A/C 零依赖，B=langgraph 0.2.62+core 0.3.68 精确锁版，Node v22.23.1）`evidence/y3-dependency-inventory.md`；凭据扫描 68 文件 0 命中 `evidence/y4-credential-scan.txt`。
- B 侧阻断（D-7）修复后：b-round 层扩展验收（checkpoint 落盘/resume/kill-recover）。

- 03:2x watch v2 两次误报根因：基线哈希了证据文件字节而非实时公式输出——已修正（基线=启动时同公式）；A 02:44 STATUS 独立定档 B 同款缺陷（assembly/defects-to-B.md，与 D-7 根因逐行一致=互证），B 未修，D-3~D-6 亦未动。当前等：B 修 D-7 / A 修 D-3~D-6。

- 03:4x **B RESULT 落盘（43/43）+ D-7 关闭复核**：B 修 ports.mjs:137 调用点（fs.writeFile）；b-round 重跑编排全链跑通（B thin 意见/计算经 a-sync 确定性 requestId 落 A，runVersion 2/3，"B 编排跑至 completed"过）。**新增 D-8（低-中，owner=A）**：b-round.mjs:114 读 opinion 记录不存在的 requestId 字段 → TypeError，后半验证未执行。等 A 修 D-3/D-4/D-5/D-8。

- 03:5x b-round.mjs 漂移复核：:114 未改，D-8 仍开；watch2 bResult 条件已消费移除（持续误报根因），仅保留 aDrift+manifestDrift。

- 03:3x **A 开始实现 D-6 修复（中间态，未复测定论）**：service.mjs 漂移后 X 复测 54/6——新增 403 PRINCIPAL_UNTRUSTED（"需在服务构造时注入 principalVerifier 并提供凭据"）= fail-closed 身份验证落地方向正确（正合 D-6 建议）；但中间态下合法人工动作同样被拒（X-4e/X-8c/X-8d/X-8e/X-8f 全 403），且 X-4d 出现语义不对的 500 STORE_UNAVAILABLE（状态门应为 409 族）。**按"不测改到一半"原则挂起复测**，等 hash 稳定（连续 2 次）后重跑。

- 04:0x **复测全过**：套件适配 v0.1 认证（测试 token 注入+principalCredential），X 60/60；D-3/D-4/D-5/D-6 关闭；b-round 全过（D-7/D-8 关闭）；K-1 随 v0.1 关闭。详见 DEFECTS.md 复测关闭记录。

- 05:3x **编排级反证轮（HEARTBEAT_0425 §D）**：`runtime/orch_tests.mjs`+`runtime/orch_runner.mjs` 19/19——unknown 不自动重发（O-1）、SIGKILL 中断后 journal 重放恢复且 intent-无回执判 unknown 零重发（O-2）、重入去重+幂等 sink（O-3）、resume 三重校验（O-4）；**D-9 入册**（身份作用域无项目绑定：A token 全局/B actor 自声明——合成 token≠生产认证，威胁面已报 A+B 裁决）；**Y-2B**：干净目录含 B 实际依赖（node_modules+lock）b-round 全链通过（`runtime/y2b_clean_with_b.mjs`），此前仅 A/C 的结论不再外推。

- 06:3x **LangGraph 反证轮**：`runtime/lg_orch_tests.mjs`+`lg_runner.mjs` 17/17；D-9 B 部分验证关闭（LG-5 三层+gateStamp）；Y-2C `runtime/y2c_clean_lg.mjs` 通过（lg-round 9 ok/0 FAIL，含 B node_modules）。A 部分 token 边界=测试适配，生产身份待用户确认（不暗设制度）。

- 04:5x **最终轮执行**（UPDATE_20260915_0747）：钉版 `evidence/final-pinned-hashes.txt`（44 文件）；X 60/60（service d2035d2c/server 3e36a518 当前版）；thin 18/18（O-4 适 配 v0.2 principal 门：无凭据/错凭据 fail-closed、漂移 VERSION_CHANGED、重锚定接受）；lg 17/17 维持；recovery-round 独立复跑 24 ok/0 FAIL（`evidence/recovery-round-d-run.txt`）；manifest 审计 23/23 匹配+D-11 缺口；凭据泄漏反证 L-1a~e（D-10）；Y-2D 通过（复制 node_modules ≠ 干净安装 ≠ 跨机器，如实标注）。
- harness 修正：SUITE-COMPLETED 检查（套件中途异常不再可能宣告通过）。

## 阻断

- 无硬阻断。真实模型通道用例维持凭据阻断标注（D 不持有凭据，由 B/C 的真实证据覆盖）。

## 恢复方法

- 复跑验收：`node V7/backend/D/runtime/x_matrix.mjs`（自包含；`--keep` 保留实例检查）。台账/缺陷/设计见 qa 同级文件；A 被测版本 hash 在 `evidence/a-src-hashes-at-dtest.txt`。
