# V7-A RESULT｜业务运行底座（第一轮交付）

日期：2026-09-15 02:30 前后。执行：ZCode（GLM-5.3-Flash 最高 thinking）。写面：`V7/backend/A/**` + 独占 `V7/backend/CONTRACT.md`。无 commit/push/tag/worktree；site/V6/home/**/3607/3467 零写入；真实付费 API 0 次；未装任何依赖（Node 22 ESM 零依赖实现）。

## 一句话结论

**CONTRACT v0 已发布（B/C/D 已可对齐）；A 底座为可运行零依赖真实 HTTP API（16/16 单测 + 真实服务全链 14 步 PASS）；并完成第一版真实组合：A 事实源 × C 规则包/计算工具/候选校验 14/14 PASS（MANIFEST 固定 hash，登记 3 处接口分歧）；B 编排器接入待 ports 对账，最终 assembly 进行中。**

## 交付物

| 文件 | 内容 |
| --- | --- |
| `../CONTRACT.md` | 共享接口 v0：实体形状、命令/幂等语义、错误码表、HTTP+模块双面、存储选型评估、B/C/D 接口点、变更规则 |
| `src/store.mjs` | JSON 存储引擎：原子写（temp+rename）、失败关闭（STORE_CORRUPT 不静默重置）、幂等表（500 容量）、sha256 载荷哈希 |
| `src/service.mjs` | 命令层：createProject/attachEvidence/supersedeEvidence/publishRule/createRun/addOpinion/setCalculation/escalate/addHumanAction/getReceipt + 投影（证据链 current、opinion/run 按**输入版本**现算 stale、formalOutcome=最近人工动作） |
| `src/server.mjs` | node:http wire 层：15 端点字面量路由、1MB 有界体、统一错误出口、no-store |
| `test/v7-a-service.test.mjs` | 11 项：双客户端一致/取代链/规则单调/运行快照/意见失效/权威分离/升级状态机/重启恢复/并发版本门/损坏关闭+恢复 |
| `test/v7-a-http.test.mjs` | 5 项：真实 socket 全链/并发重复提交恰一次生效/409 族/403/400（连续 4 次运行稳定） |
| `scripts/demo.mjs` | 可复跑全链演示（幂等 requestId 带时间片，可重复运行） |
| `assembly/` | `README.md`（B/C 接入点与固定 hash 方法）+ `sim-round.mjs`（组合缝，已实测） |
| `STATUS.md` | 滚动状态 |
| `evidence/` | `test-service.txt`(11/11)、`test-http.txt`(5/5)、`demo-run-final.txt`(全链 PASS)、`demo-run-0219.txt`(真实失败留档：脚本版本参数错，已修)、`server-3601.log` |

## 关键设计决定（含理由）

1. **存储选型**：单进程 JSON 文件（V5/V6 验证过的模式）——零依赖、目录即迁移、失败关闭。否决 SQLite（原生依赖；当前单 writer 无跨进程并发证据）与重型平台（约束禁止）。升级路径写入 CONTRACT §1。
2. **权威分离用结构强制**：candidate 键白名单 + 禁用键正则（approv/decision/quota/price/rate/reject）→ 400；human action 仅 `actorRole:"human"` → 否则 403。不靠提示词或前端。
3. **失效按输入版本**：opinion 记 basedOnEvidence、run 记 factVersion 快照，读取时现算 stale；取代链历史永不删除（对齐 B0 三层分离思想的最小实现）。
4. **跨存储无事务**：命令只写所属 store（facts/runs 两文件独立幂等表），createRun 对 facts 只读校验——部分失败面=单文件原子写，恢复=原样重放。
5. **`unknown` 诚实落库**：升级通道接受 human_required/unknown/failed，不自动重试、不伪造成功。

## 真实命令与结果（全部可复跑）

```
node --test test/v7-a-service.test.mjs   → 11/11 pass（evidence/test-service.txt）
node --test test/v7-a-http.test.mjs      → 5/5 pass（evidence/test-http.txt；另手动连跑 3 次均绿）
node src/server.mjs --port 3601 --data-dir <dir>   → 真实监听（evidence/server-3601.log）
node scripts/demo.mjs http://127.0.0.1:3601        → 14 步全 PASS（evidence/demo-run-final.txt）
```

过程中真实失败（留档不隐藏）：① demo 脚本 supersede 用了错误 expectedVersion → 409（脚本错，服务端行为正确，已修）；② 并发 HTTP 测试初版断言响应顺序 → 偶发失败（顺序本不保证，改为集合断言后连续 4 次稳定）。

## 覆盖对照（LONG_RUN_GOALS §A）

- 可持久化事实源/人工动作/请求回执 ✓（实测）
- 双客户端一致 ✓（双实例同盘 + HTTP 另端 GET）
- 证据更新使旧分析失效 ✓（取代链 + stale 现算 + 历史保留）
- 重启恢复 ✓（重开存储 + 重放语义不变）
- 重复提交 ✓（重放 + REQUEST_MISMATCH + 回执查询）
- 并发与损坏失败关闭 ✓（版本门一方 409；损坏 500 且文件不重置）
- 模型意见与正式动作分离 ✓（结构强制 + 403）
- 轻量事务存储评估 ✓（CONTRACT §1，含升级路径）
- assembly 组合缝 ✓（预建+实测；B/C 产物接入待其交付）
- checkpoint 不替代事实源 ✓（CONTRACT §6 明文：B 恢复/幂等以本合同命令为准）

## 剩余项 / 下一步

1. **B 编排器接入（接线完成，阻于 B 一行缺陷）**：B 已交对账材料 `src/a-sync.mjs`（端点全对齐+确定性 requestId 同步，toACandidate 已解决分歧 1/2）；A `assembly/b-round.mjs` 全接线，B `ports.mjs atomicWriteJson` 的 `fs.promises` 错调致 start 即崩（精确缺陷单 `assembly/defects-to-B.md`，失败现场 `evidence/assembly-b-round-1.txt`）；B 修复后重跑即出证据。
2. **接口分歧对账**：分歧 1/2 已由 B 侧 toACandidate 解决；分歧 3（validateRulePack 返回 []）缝上适配维持；正式走 interface-change-request。
3. 真实模型通道验证：待凭据授权（B/C 同阻断）；simulation 同接口不冒充真实。
4. site 正式接线 diff proposal：等 assembly 终版 + 基线门（未开始）。

## 恢复方法

数据目录即完整状态（拷贝=迁移；损坏=换文件或删目录重 seed，服务绝不静默重置）；服务/测试/演示复跑命令见上节；CONTRACT 变更走版本号（v0.x 小步 / v1 破坏性+迁移说明）。


---

# 续轮（2026-09-15 03:5x · 心跳 0325 A 全节）

**CONTRACT v0.1 + D-3~D-6 修复 + A×B×C 组合 PASS，交 D 第二轮。**

- **D-6（高）**：正式动作身份改为可信 principal 边界——服务构造注入同步 `principalVerifier` + 命令携带 `principalCredential`；未配置身份源/凭据缺失/验证失败一律 403 `PRINCIPAL_UNTRUSTED`（默认失败关闭）；actorRole 字段仅第一层白名单；模块层与 HTTP 同界。服务端 token 允许列表参考实现（sha256，合成测试适配，非账户体系）。不读取真实密钥、不引入账户平台；**若环境始终无可信身份源，正式动作保持阻断——如实声明为能力边界**。
- **D-4**：opinion 仅 pending/candidate_ready 可写；升级态 409 `RUN_ESCALATED`（正反例测试）。
- **D-5**：basedOnEvidence 与 candidate.evidenceRefs 引用失败关闭（不存在/版本不符/伪造 → 400 不入库；正反例测试）。
- **D-3**：resolved 终态——追加人工动作 409 `RUN_RESOLVED`；重新处理=新建运行（不发明业务重开制度）。
- **D-8**：`assembly/b-round.mjs` 幂等验证改读回执（`GET /receipts/:requestId`）；finally 自清（关服务器+删自有临时目录；不触碰未知进程）。
- **CONTRACT v0.1**：ICR-1/2（candidate 枚举四值+省略=无建议；evidenceRefs=id@vN 字符串）、ICR-3（runId 服务端生成，requestReceipt 关联）、ICR-4 裁决（escalate 维持严格幂等）、C 观察 #3/#4/#5、K-1 投影位置——全部明示。
- **A×B×C 组合 PASS**：`assembly/b-round.mjs`（B thin 编排 + a-sync + C 计算/规则；D-6 正反例、确定性回执、B dedup+A 幂等、principalId 留痕）+ `integrated-round.mjs`（A×C）PASS；单测 17/17；demo PASS。组合固定 hash：`assembly/MANIFEST.md` + `manifest-hashes.sha256`（17 文件）。**交 D 第二轮。**
- 旧等待项作废：B DEFECT-B1 已由 B 修复（fs.writeFile/rename），B RESULT/HANDOFF-A/COMPARE/langgraph/real-http 均已在盘。
- 真实模型通道：凭据未授权，0 付费调用（simulation 同接口）；无可信身份源环境正式动作保持阻断（能力边界，如实声明）。


---

# 续轮（2026-09-15 05:5x · 心跳 0425 A 节）

**CONTRACT v0.2 + LangGraph 实际 assembly 对比 PASS + 组合 hash 22 文件交 D 扩展验收 + RUNBOOK/site 提案交付。**

- **C v3 #4 码位修复**：resolved 意见 409 `RUN_RESOLVED`（原实现误用 RUN_ESCALATED；消费方按码分支影响已随合同 v0.2 通知 B/C/D）。**C v3 #7**：校验顺序（状态门先于引用校验）入合同。单测 18/18（新增码位测试）。
- **LangGraph 实际 assembly 对比**（`assembly/lg-round.mjs`，PASS）：同事件双候选（thin/LangGraph）× 同 sink 语义 × 同 A 服务 → A 投影一致（opinions/calculation/state/stale）；FileCheckpointSaver 落盘断言；不凭 B 自报。
- **组合交 D 扩展验收**：`manifest-hashes.sha256` 22 文件（含 LangGraph orchestrator/file-checkpointer、B resume-core/codes）。
- **RUNBOOK.md**：启动/健康检查/三组复跑/恢复（重启、损坏、编排中断、迁移）/LangGraph 依赖路径/身份边界。
- **site-diff-proposal.md**：17 新增 route + 2 窄注册，双实现形态（独立进程 / 进程内 route），安全默认（无 token = 正式动作失败关闭），验收门含用户基线授权。未接线未部署。
- 旧等待项状态：B DEFECT-B1 已修且 b-round PASS（上一轮）；本轮无新增阻断。
- 真实模型 0 付费调用；生产身份源接入与 site 基线均为需用户新授权的门，如实列为阻断/等待。


---

# 续轮（2026-09-15 07:5x · 心跳 0725 A 节）

**D-9 恢复链双候选实际组合验证 PASS（23/23）+ 组合 hash 23 文件交 D 最终验收。**

- **真实暂停→可信恢复→正式收口**（thin 与 LangGraph 双候选各全链）：模型步首调 unknown（发送后不可知）→ A 升级投影 state=unknown、不自动重发（调用计数断言）→ 错凭据 resume 被两候选身份门拒绝（PRINCIPAL_UNTRUSTED，无 A 副作用）→ A 门匿名正式动作 403（无副作用）→ 可信 retry_step（人工核实后，新 attempt/新 requestId 非盲发）→ B 内部 completed **而 A 保持 unknown**（不冒充正式审批；D-4 门持住重试候选未入库）→ A 正式人工动作（可信凭据）→ resolved + principalId 留痕。LangGraph 附加凭据零落盘（checkpoint 全文扫描）。
- **合成身份声明**：assembly 注入的 verifier/授权策略为测试适配；非生产认证，不发明生产岗位规则；无可信身份源环境正式动作保持失败关闭。
- **组合 hash 23 文件**（B D-9 变更：thin/langgraph 编排器、resume-core、codes）交 D 最终验收；RUNBOOK 已含恢复命令与复跑入口。
- 过程留档：`evidence/assembly-recovery-round-1.txt`（两处测试断言错误：principalId 前缀、LangGraph 身份门拒绝方式——均为测试侧修正，非产品缺陷）。
- 真实模型 0 付费调用；生产身份源与 site 基线门保持等待，如实声明。
