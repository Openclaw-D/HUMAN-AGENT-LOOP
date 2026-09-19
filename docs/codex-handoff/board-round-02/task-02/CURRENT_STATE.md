# 任务02 · 当前状态（board-round-02）

日期：2026-09-19。HEAD 检查基线 8dcef63（多路 dirty，接续不覆盖）。执行者：ZCode 任务02 路。
所有权内改动：Back/Connectors/**、Back/C/src/parse/adapters.mjs、本路文档。

## 一、接续盘点（接手时实际进度）

接手时在制成果（本轮全部保留并跑通，未重写）：
- `src/processing/coordinator.mjs`：受控映射链三级解析（表→种子→A 权威同 ID 自动核验）、
  blocked_link / blocked_a_unavailable / blocked_unknown 可恢复等待态（游标保留、sweep 退避重入、
  不烧 attempts）、aRegistered/bridgeState 可见性、driverStatus（IR-04-2B）、
  registerCustomerLink 受控登记（归属证明/劫持拒绝/幂等重入）。
- `src/http/server.mjs`：upload 邀请↔客户一致性（IR-04-2A-1）、preview 归属对账+customerId 回显
  （IR-04-2A-2+2D）、`/customers/link`、`/processing/receipts/:requestId`（IR-T01-3）、/healthz processing 分项。
- `src/evidence/a_bridge.mjs`：getCustomer 权威读（A 客户核验）。
- `src/intake/service.mjs`：checkUploadScope 返回邀请归属 customer_id。
- `src/store/schema.sql`：a_customer_links 增加 legal_entity_ref / verified_via / linked_by_actor。
- 测试：goal02-link-chain（L1-L6）、goal02-blocked-recovery（R1-R3）在制未跑。

## 二、本轮补齐（在制代码上的闭合，全部有测试）

1. **人工动作资源归属（IR-04-2A-3 资源面）**：manual-entry 校验材料归属客户
   （`evidence/service.mjs` manualEntry）；correct-fact 校验被更正事实归属客户，customerId 缺省时
   以事实归属为准（`http/server.mjs`）。questions answer/verify 归属内建于客户作用域 WHERE。
2. **actor 可信来源（IR-04-2A-3 身份面，冻结语义=token→调用方绑定）**：`callerBindings`
   （token→{caller, mayDelegateActor}）；网关令牌方可代理人类 actor（actorSource=gateway_delegated）；
   非代理调用方自报人类 actor → 403 ACTOR_NOT_DELEGABLE；不自报则以 svc:<caller> 服务身份执行
   （审计可查）；显式绑定后未绑定令牌在门即拒（PRINCIPAL_UNTRUSTED，fail closed）。
   新增 header 存在性不构成信任；运行配置经 `callerBindings` 透传（示例配置已补）。
3. **L5 游标语义修正**：runTask 各段游标推进先于 hookAfterStage——"段后崩溃"=段完成且游标指向
   下一段，恢复从下一段续跑（解析结果已持久化，不重复解析）。
4. **correct-fact A 回写修复**：来源件取 `from_artifacts[0]`（fact_assertions 无 artifact_id 列，
   原在制代码 500）。
5. **CSV 声明表解析修复（Back/C，属本路所有权）**：`extractKvCsvFacts` 表头感知——首行
   key/value[/unit/caliber] 表头按列提取，值列不再吞并单位/口径列（`120000,元,权责发生` 字符串
   曾导致数值不可判读 → 压力覆盖率从不计算）；无表头回退旧行为。
6. **测试清单**：package.json test/test:processing 纳入 goal02-link-chain / blocked-recovery /
   actor-trust 三文件。

## 三、状态语义（已冻结，供 01/03/04 消费）

- `done` 恒以 A 登记成功为前提（`aRegistered=true`）；显式 localOnly 部署的 done=仅本地完成，
  页面必须按 `bridgeState='none'` 呈现。缺映射→`blocked_link`、A 不可达/缺凭据→`blocked_a_unavailable`、
  响应未知→`blocked_unknown`，均为可恢复等待态（保留游标，sweep 按退避自动重入，不烧失败预算）。
- 恢复续跑从原阶段游标继续，同 requestId 幂等（a_links 唯一），不换 ID 重发、不产生重复业务效果。

## 四、未完成 / NOT_RUN（诚实清单）

- 真实页面办理旅程：04 路装配与页面 journey 未在本轮重跑（其 JOURNEY_RECORD 步骤5 仍基于旧
  skipped(no_customer_link) 行为，需按新语义复跑）。
- 用户验收：全部成果为执行者自验，用户验收未发生。
- Back/A 侧测试与 011 迁移：03 路所有权，本轮未跑未改。

## 五、收口轮补记（2026-09-20）

- Back/C 适配器补强：XLSX key/value 声明表支持行级 unit/caliber 列（声明列优先，与 CSV
  extractKvCsvFacts 同口径）。
- 复跑全绿：Back/B 105/105、Back/C 101/101、Back/Connectors 88/88（link-chain 6/6、
  blocked-recovery 3/3、actor-trust 2/2 在内）。GLM 接入代码未改动。
- 合同位置四件交付已落 docs/v02-remediation/task-02/（CURRENT_STATE/NEXT_ACTION/TEST_RESULTS/
  INTERFACE_REQUESTS），本目录继续作为跨路登记与对齐的活页。
