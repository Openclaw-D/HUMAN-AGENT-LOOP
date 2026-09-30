# 02-back DELIVERY（2026-09-30 收尾轮：十案例材料/真实检查点与后端权威闭环）

状态：**执行者自测完成，后端发布门自评满足**（00_SCOPE"全部后端发布门"逐项对照见 §4；最终 Codex 独立验收另记）。基线=9/29 三案例轮冻结工作树（本轮在其上增量，未覆盖他人修改）。

## 1. 结论摘要

- **A 正式案例目录上线（DEF-03-01 关闭）**：`/api/v2/arrow-cases` 无条件可用（`arrow-case-directory-v1`），案例登记表 ∩ 授权过滤，检查点/下一动作/助手投影全部**读时从真实执行状态推导**（不落库、不硬编码结论）；Edge fallback 清单可退役。
- **十案例材料驱动闭环**：十套不同业务名/事实/缺件/冲突（21 个 CSV 常见格式文件+SHA256 MANIFEST+独立期望），从差到好 displayOrder 1–10；十例检查点与手工独立期望逐一相符（T1）——案例标签不进执行面（fixtures 无结论字段，评估器输入零标签）。
- **检查点全部真实执行得出**：种子器只走既有授权命令（advance/adopt/reject/supersede/核验登记/评估链/周期序列），requestId 幂等+审计+事件留痕；"checkpoint 展示批次"与"fresh 从头体验批次"都有实测（T10）。
- **全部测试绿**：本轮验收 `ten-cases.test.mjs` 11/11；旧回归 4 套件 43/43（advance-round 10、column-step 1、parallel-arrows 14、execution-chain 18）；`tsc --noEmit` 通过。
- **DEF-03-02 语义确认 + DEF-03-05 动作契约交付**（CONTRACT_DELTA §2/§3）；09/10 周期全生命周期边界实测（T7/T8）。

## 2. 交付物（`docs/integration/2026-09-30-final/02-back/`）

| 文件 | 内容 |
|---|---|
| `CONTRACT_DELTA.md` | arrow-cases 权威面契约（字段一次定死）、检查点词表、核验动作契约、预评估收口序列、周期操作序列、诚实性边界 |
| `CASE_RECIPES.md` | 十例准备/重演配方（API 动作、依赖、预期检查点、角色、补件文件、负例配方、03 接线要点） |
| `DELIVERY.md` | 本报告 |
| `results/ten-cases.out` | 验收套件实测输出（11/11，EXIT=0） |
| `results/regression-arrows.out` | 旧回归 4 套件（43/43） |
| `../../materials/` | 十套材料：`case-01..10/*.csv`（21 文件）+ `MANIFEST.json`（SHA256）+ `EXPECTED.json`（独立期望）+ `README.md` |

## 3. 测试命令与环境（可复跑）

环境：本轮隔离库 `jw-integ-back2-pg`（postgres:16-alpine，127.0.0.1:25501，arrow_test，与 9/29 轮共用容器但每 run 全新客户/流程，案例登记表每次种子前重置）；node=kimi-desktop runtime；**plain node 直跑（勿 --test，execArgv 污染 worker）**。

```bash
export ARROW_TEST_DB_URL='postgres://arrow_test:arrow_test_only@127.0.0.1:25501/arrow_test'
export PATH="/c/Users/22673/AppData/Local/Programs/kimi-desktop/resources/resources/runtime:$PATH"
cd Back/A
node scripts/generate-ten-case-materials.mjs   # 材料+MANIFEST 再生成（确定性）
npx tsc --noEmit                               # TSC=0
node test/ten-cases.test.mjs                   # 11/11（含 checkpoint+fresh 双批次种子）
node test/advance-round-http.test.mjs          # 10/10 回归
node test/column-step-http.test.mjs            # 1/1 回归
node test/parallel-arrows-http.test.mjs        # 14/14 回归
node test/execution-chain-02.test.mjs          # 18/18 回归
node scripts/ten-case-runtime.mjs --db $ARROW_TEST_DB_URL --batch checkpoint --port 0  # 常驻演示栈（JSON 输出 url/cases）
```

## 4. 00_SCOPE 后端发布门 → 证据对照

| 发布门 | 证据 |
|---|---|
| 十案例从差到好、检查点各不相同、已走路径有真实历史 | T1：displayOrder 1–10、分类 差×3中×4好×3、checkpoint.type 与 EXPECTED.json 逐例相符；每例 checkpoint.evidence 指向真实 jobId/processId/cycleId/assessmentId |
| 检查点与从头体验都可理解、可重演 | checkpoint/fresh 双批次实测（T10）；fresh=材料就绪/红线读取阻断，重演用新 run（新批次），零清库重置（arrow_case_registry 重置仅为种子配置，业务历史不动） |
| 单事件触发多步骤有服务端作业时间/依据/回执证明 | T9：case-05 首轮五区 5 个独立 worker threadId+时间重叠；`arrow_jobs.result.execution` 留线程级时间戳（S1 口径延续） |
| 补件仅影响相关步骤 | T4：case-04 补件后 affectedDomains=['credit','policy']、analysis_runs 恰 +2、其余区 roundId/selection 逐字节不变；T5：核验登记 affectedDomains=['asset','business','policy']（DEF-03-02 确认） |
| 同事件重放单效果 | T8 周期返单重演幂等（9/29 S10/S17 口径延续：同 ID 200 reused 零执行、异载荷 409） |
| 权限/跨客户隔离 | T2：跨租户清单空、客户身份 403（A 层）、detail 越权 404、grant 语义沿用 |
| 旧版本 | T9：case-07 补证后旧候选确认 → 409 VERSION_CONFLICT 且零写入 |
| 差例不可无依据刷绿 | case-01 红线 409 不可推进（T3 前态）；case-02 HARD_BLOCK 不可被 adopt/置信度覆盖（T9，409 留痕）；case-03 拒绝走有权信审正式 reject（规则计算 suspicion 在先） |
| 09/10 全生命周期边界 | T7：未确认回执 settle 409 → SIM 前缀 manual-attestation 回执 → settle 200；T8：返单新周期独立（cycleNo=2、新 sourceProcessId）、提前 reorder 409、第 1 期历史不改写可查 |
| 不冒充 | 助手投影 `source='案例说明'/modelInvolved:false`（T1 断言）；候选 rule_rank 无 confidence；模拟回执 SIM- 前缀+manual-attestation；规则包标注演示规则非集团制度；unknown 不补零 |
| 材料关键值变更改变判断 | T3：case-01 收入 supersede 到 48,000,000 后 blocked_redline→ready_to_analyze、advance-plan available |

## 5. 十案例检查点实测（与 EXPECTED.json 逐例一致；详见 results/ten-cases.out T1）

| # | 案例 | checkpoint.type | 关键判据（独立算术/规则） |
|---|---|---|---|
| 01 | 喀什河谷新材料加工厂 | blocked_redline | 56,000,000 > 50,000,000 |
| 02 | 天山南麓农机装备公司 | blocked_hard | 核验 false（confirmed）→ SIM-ASSET-OWNERSHIP-01 |
| 03 | 准噶尔包装制品厂 | risk_decision | 55,000/100,000 = 0.55 < 1.0 |
| 04 | 伊犁河谷食品加工合作社 | awaiting_evidence | cash unverified → unknown |
| 05 | 阿克苏果业冷链公司 | conflict_review | 2,980,000 vs 3,350,000 同级冲突 |
| 06 | 吐鲁番纺织印染厂 | verification_pending | 三键 source_supported |
| 07 | 塔城农机维修连锁 | stale_review | 采用早于 supersede |
| 08 | 昌吉精密模具制造 | preassessment_review | 五区采用+Gate CLEAR+awaiting_human_review |
| 09 | 克拉玛依建材租赁 | awaiting_external | fulfill 后如实停 |
| 10 | 博乐葡萄酒庄设备回租 | closed_reorderable | 完整周期 closed |

## 6. 冻结源码清单（交 03；03 不接管代码，内核缺陷回本路修）

**本轮新增**：
- `Back/A/migrations/018_arrow_case_registry.sql`
- `Back/A/src/domain/case-directory.ts`（登记/授权过滤/检查点推导/下一动作/助手投影）
- `Back/A/scripts/ten-cases-fixtures.mjs`、`generate-ten-case-materials.mjs`、`seed-ten-cases.mjs`、`ten-case-runtime.mjs`
- `Back/A/test/ten-cases.test.mjs`
- `docs/integration/2026-09-30-final/materials/**`、`02-back/**`

**本轮修改**（兼容加法，全部回归验证）：
- `Back/A/src/http/server.ts`：`/arrow-cases` 无条件注册（options.cases 注入时优先，旧三例契约不变）+ `/arrow-cases/:caseId` + `/arrow-case-registry`
- `Back/A/scripts/parallel-arrows-runtime.mjs`：新增 `casesOverride` 参数（'directory'=不传旧 closure；默认行为零变化）

**继承基态**（9/29 冻结，本轮未再修改）：advance-round.ts、cycles.ts、zone-semantic.ts、column-runner.mjs、column-dependencies.mjs、zone-manifest.mjs、zone-candidates.mjs、017 迁移等（以 git 工作树为准）。

## 7. 遗留与边界

1. **Edge 读代理白名单无 `/arrow-cases/:caseId`**（detail 单例路由）——Edge 归 03 ownership；03 补白名单或 01 直连 A。列表 `/arrow-cases` 经 Edge 已可用（DEF-03-01 复验路径不变）。
2. **06/08 人工动作 UI**（核验登记抽屉、预评估确认按钮）归 01；接口样例/权限/版本门已给（CONTRACT_DELTA §2/§3），动作契约与 9/29 DEF-03-05 表格一致并升级为正式契约。
3. **客户身份经 Edge session 访问清单**未在浏览器链验证（A 层 403 已验，T2）；Edge session 对客户凭据的目录过滤归 01/03 联调。
4. **rule_pack_versions 不存包内容摘要**（DEF-03-03 遗留建议）未做——同版本号不同内容无法校验区分，建议后续轮登记 digest。
5. 边界确认：无真实支付/外部系统对接（模拟回执 SIM- 前缀+manual-attestation）；预评估与正式批准边界未放松（T6 零额度机器断言）；未 commit/push/tag；未动 48430；材料全部合成、零真实客户数据。
