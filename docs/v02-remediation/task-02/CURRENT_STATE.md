# 任务02 · CURRENT_STATE（原始材料→权威后台持续处理链整改）

更新：2026-09-20（复核收口轮）。基线 main@8dcef63 未变，未 commit/push/部署。
所有权内改动：Back/Connectors/**、Back/C/src/parse/adapters.mjs、本目录与
docs/codex-handoff/board-round-02/task-02/（本轮登记与对齐的延续目录）文档。

## 结论

任务书 §二 五项确认问题全部闭合（均有真实 PG/HTTP/真实 A 内核测试钉住）：

1. **映射种子依赖** → 受控映射三级解析：`a_customer_links` 表（权威）→ 配置种子（仅 bootstrap）
   → A 权威同 ID 自动核验（`GET /api/v2/customers/:id`，存在+租户归属一致才落库，
   `linked_by='auto_authoritative_same_id'`）。新客户零配置接通；名称/前缀/同名推断不存在于代码。
2. **skipped 静默推进 / done≠桥接成功** → register_material/register_results 缺桥/缺映射改为
   可恢复等待态（`blocked_a_unavailable`/`blocked_link`），游标保留、sweep 按退避自动重入、
   不烧失败预算；严格模式下 `status='done'` 恒 `aRegistered=true`（显式 localOnly 部署除外，
   bridgeState=none 如实呈现）。
3. **透传修复≠任意新建客户接通** → L1（真实 A 内核）证明零配置首传自动接通并到达 A；
   L2 证明映射场景经 `POST /api/connectors/customers/link` 受控登记（legalEntityRef 归属证明、
   劫持 409、跨租户 403）后自动恢复。
4. **门户两段能力拼不成办理通** → 方案 R 冻结（IR-04-2C）：页面只提交通道上传，A 档案工件由
   aBridge 以映射凭据登记（材料=上传者、派生/registrar、运行/Gate/findings=service），
   requestId 确定性幂等。页面链验收归 04 路 journey 复跑（IR-02-4B），本轮为组件链通过。
5. **服务令牌信任边界** → upload 邀请↔客户一致性（403 CUSTOMER_MISMATCH）、preview 归属对账
   （IR-04-2A-1/2/2D）；actor 可信来源=token→调用方绑定（callerBindings，网关方可代理人类
   actor，非代理自报 403 ACTOR_NOT_DELEGABLE，未绑定 fail closed；IR-04-2A-3 闭合）；
   manual-entry/correct-fact 资源归属校验（T2）。

## 本轮（收口轮）补验与新增

- Back/C 适配器补强：XLSX key/value 声明表支持行级 unit/caliber 列（声明列优先于上传元数据），
  与 CSV 表头感知解析（extractKvCsvFacts）同一口径。
- 复跑全绿：Back/B 105/105、Back/C 101/101、Back/Connectors 88/88（含 link-chain 6/6、
  blocked-recovery 3/3、actor-trust 2/2）。GLM 接入代码（Back/B/src/transport/glm.mjs、
  scripts/glm-*）未改动、原样保留；真实外发保持关闭。

## 组件链通过 vs 页面链通过（如实区分）

- **组件链：通过**（执行者自验）——真实字节上传→解析/人工路线→四域→A 材料/派生件/运行/Gate
  回执/findings 在 A 侧落库可查（link-chain 直查 A 库）。
- **页面链：未复跑（NOT_RUN）**——旧 JOURNEY_RECORD 基于已废除的 skipped(no_customer_link)
  行为，需 04 路按新语义组织联合复验（见 INTERFACE_REQUESTS.md IR-02-4B/4D）。
- 用户验收未发生。
