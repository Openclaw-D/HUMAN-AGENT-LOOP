# goal-01 · CHANGELOG

日期：2026-09-17。基线 `1ec0ee4`（main）。writer：本任务唯一执行上下文（Back/A/**、Back/CONTRACT.md、迁移 008）。
**未 commit/push**（按边界等待用户验收）；工作区同时含其他并行会话在 Back/B、Back/C、Back/Connectors、Back/D 的在途修改，与本任务无关、未触碰。

## A1 · 证据可信性：设备对象锚定匹配（缺口 G2）

不变量 4："设备 B 的照片不能满足设备 A 的核验"。此前三处匹配仅按 kind+客户。

- `src/domain/errors.ts`：新增 409 `EVIDENCE_OBJECT_MISMATCH`。
- `src/domain/inspection.ts`：
  - `currentArtifactKinds` → `currentArtifactIndex`（kind 集合 + 对象锚定→kind 映射）+ `artifactObjectId` 助手；
  - `refreshItems`：锚定项（object_ref≠null）的**自动核实**（requires_human_verification=false → verified）只认对象匹配材料；人工核验路径（to_verify）与未锚定项行为不变；
  - `answerQuestion`：答案引用显式锚定到其他对象的材料 → 409 `EVIDENCE_OBJECT_MISMATCH`（事务内零写入）；
  - `addLateEvidence`：晚到材料只重开对象匹配的锚定项（未锚定/异对象不重开）；
  - `getNextActions`：锚定项缺口按对象匹配口径展示（与状态推导一致）。
- `test/evidence-object-match.test.mjs`：新增 G2-1..G2-5（5 项）。
- `test/inspection-utils.mjs`：registerArtifact 助手支持可选 objectRef。

## A2 · 可信依据：豁免登记制（缺口 G1）

不变量 2："豁免必须引用真实、有效且有权批准的记录，不能接受请求自报 approvedBy"。此前 `createPackage.exemptions[].approvedBy` 与 `finding.resolve` 的 `waiverRef.policyApproved/approvedBy/validUntil` 均为自报字符串即可生效。

- `migrations/008_domain_exemptions.sql`：新表 `domain_exemptions`（domain/scope/reason/policy_version/approved_by/approved_by_roles/valid_until/status valid|revoked；只新增对象，回退=保留对象停用入口）。
- `src/domain/analysis.ts`：新增 `registerDomainExemption`（人类 + permission_matrix 动作 `domain-exemption.grant`，未配置 → POLICY_PENDING fail-closed；approved_by 从凭据解析，载荷无该字段）、`revokeDomainExemption`（即刻生效，只阻断新引用）、`listDomainExemptions`。
- `src/domain/package.ts`：`parseFreezeInput` 豁免改引用制——只接受 `{exemptionId, note?}`；服务端校验 valid/未过期/政策版本匹配/租户客户匹配后把批准人、角色、有效期、政策版本冻结进包；自报 domain/approvedBy/scope → 400。域 `required=false` 仅当存在有效豁免引用。createPackage 与 revisePackage 共用此路径。
- `src/domain/review.ts`：`resolveFinding` not_applicable 的 `waiverRef` 只接受 `{exemptionId}`（登记 scope 须覆盖差异类型/规则ID/'any'）；自报字段 → 400；resolution 冻结服务端批准人（原自报字段不再落库）。
- `src/http/server.ts`：新路由 `POST/GET /api/v2/customers/:customerId/domain-exemptions`、`DELETE /api/v2/domain-exemptions/:exemptionId`；DELETE 请求与 POST 一样解析 JSON body（原仅 POST；存量无 HTTP DELETE 消费方）。
- `test/domain-exemptions.test.mjs`：新增 X1..X7（7 项）。
- `Back/CONTRACT.md`：新增 §10（v2.3 增量契约登记）。
- `test/customer-credit.test.mjs`：A22 迁移清单断言更新（001–008；计数 8）。

## A3 · 并发台账/提额核对 + 定向性能优化

台账与提额机制（不变量 5/6/7）经核对与既有 K12–K18 覆盖确认无语义缺口，本轮未改其语义；仅做读合并与重复消除（门序、锁序、事务边界、失败语义不变）：

- `src/domain/credit.ts`：
  - **P1** `getCustomerExposure`：per-facility facilityView 循环（N+1）→ 批量桶聚合（`GROUP BY facility_id`）+ 批量依据状态（`ANY($1)`）；新增纯函数 `buildFacilityView`/`buildBucketView` 与写路径共用同一算术；
  - **P2** reserve：门内 facilityView 经 `assertFrUseGates(viewOverride)` 复用，响应/事件桶由快照+本笔增量推导（含安全整数守卫），消除同事务 3 次重复聚合；附带修正：`USE_READINESS_CHANGED` 事件的 exposure 由预写桶改为提交后桶（与响应一致；原实现两者不一致）；
  - **P3** `reverifyBasis`：快照工件逐件 FOR SHARE → 一次 `ANY($1) FOR SHARE`（锁语义不变）；提额 `createLimitIncreaseRequest` 证据逐件校验 → 批量查询后逐条判定（口径不变）。
- 性能结果见 `PERF_BEFORE_AFTER.md`（8/10 目标达标，2 项如实列为未关闭）。

## 修复的既有缺陷（本轮发现）

1. 豁免自报批准人可绕过必需域政策（G1，不变量 2）。
2. 错设备材料可满足设备核验推导（G2，不变量 4）——含自动核实路径与晚到材料重开路径。
3. `USE_READINESS_CHANGED` 事件 exposure 与命令响应不一致（预写 vs 提交后）——统一为提交后。
4. 测试端口随机碰撞本机常驻服务（Edge@48200）导致偶发套件失败——startKernel 自动换口重试。

## 接口变更（详见 Back/CONTRACT.md §10）

- 新增：domain-exemptions 三路由；409 `EVIDENCE_OBJECT_MISMATCH`。
- 破坏性收紧（v2 域内）：decision-packages exemptions 引用制；findings not_applicable waiver 引用制。
- 消费方影响：B/C/D/Edge 无既有 exemptions/waiverRef 调用（已审阅各目录 interface-change-request：本轮无新增请求）；检查会话读面不变。

## 回退

- 代码按 A1/A2/A3 文件集独立还原（清单见 HANDOFF §1）；迁移 008 回退=保留对象停用入口，无破坏性 DDL。
