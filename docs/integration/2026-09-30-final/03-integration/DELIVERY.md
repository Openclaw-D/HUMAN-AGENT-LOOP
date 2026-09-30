# 03-integration DELIVERY（V0.5 收尾轮：可靠启动、十案例真实集成、交付归档候选）

状态：**执行者自测完成 + 集成验证完成**。01/02 已交回冻结（各自 DELIVERY 与指纹），03 在其上完成
最终整链的可用部分；4 项前端对接缺陷（DEF-03-06/07/08/09）已记录交 01，修复后由 03 页面复验。
Codex 独立验收与用户验收另行进行；未 commit/push/tag。

## 1. 结论摘要

- **可靠启动**：根目录 `Start-JW.ps1/.cmd` 一键启动（幂等：健康复用/部分存活恢复/未知占用报告；
  真实就绪=聚合探测+版本封存+登录冒烟，非静态预览）；三态实测（status/复用/冷恢复/停止）。
  REVIEW 指出的"数据库容器退出→登录 503"已有完整恢复路径并实证（停机→页面分类解释→容器恢复→自愈）。
- **统一入口**：同源生产入口 `http://127.0.0.1:48431/`（Edge 托管 01 冻结 dist，逐字节指纹核对）；
  开发 `?edge=` 已由 01 限制为 dev 端口+localhost；未改凭据、未禁用鉴权；Bash-only Runbook 由
  Windows 版替代。
- **十案例真实检查点**：`ten-case-init.mjs` 接 02 `seedTenCases`，checkpoint/fresh **双批次真实执行**
  （v05b2 / v05fresh-t1，均留审计与事件历史；同 run 幂等跳过、换 run 新批次、零清库重置）。
  A 权威 `arrow-cases`（含 /caseId detail）经 Edge 全通：十例 差→中→好、检查点/下一动作/助手投影齐备；
  **Edge fallback404 双来源全部退役**（代码+配置六处清理）。
- **浏览器逐例验收**（1920×1080，01 冻结 dist）：十卡横条+要点+进度渲染（截图）；case-06 人工核验
  登记经 **UI 全链**完成（DEF-03-05 修复实证：表单→二次确认→confirmed 事实 unit=wan 落库→自动重评）；
  case-09 模拟回执经 **UI 登记**（DB external_receipt+recordedBy 留痕）→API 结清/关闭；case-10
  面板显示已关闭+返单点击→**UI alert REORDER_REQUIRES_FRESH_CASE**（服务端拦截诚实呈现）；
  case-04 补件经授权 API 完成（覆盖率 2.105=独立预期）。余例以 A 权威检查点+02 T 套件证据支撑。
- **助手确定性说明**：无模型时 observe 返回 200 `deterministic_briefing`（现行事实/材料/只读指引，
  来源"案例说明"，自由问答如实不可用）；模型已配置路径零改动；零付费出站。
- **负例**：DB 停机→登录 503 分类文案（截图）→容器恢复→连接池自愈→目录回归（截图）；双击/重放、
  旧依据、跨客户/撤权由 02 T8/T11 与 9/29 轮 UI 证据支撑；全部故障注入只在本轮自有 v05 栈。

## 2. 十案例结果（逐例详见 RESULTS.json）

| # | 案例 | 检查点 | 状态 | 03 实证 |
|---|---|---|---|---|
| 1 | 喀什河谷新材料加工厂 | blocked_redline | PASS | A 检查点+红线推导；推进 409 |
| 2 | 天山南麓农机装备公司 | blocked_hard | PASS | 种子核验 false→HARD_BLOCK→adopt 409 留痕 |
| 3 | 准噶尔包装制品厂 | risk_decision | PASS | 覆盖率 0.55 findingsSuspicion |
| 4 | 伊犁河谷食品加工合作社 | awaiting_evidence→补件 | PASS | API 补件→roundNo2→覆盖率 2.105（=独立预期）；UI 主按钮=DEF-03-09 |
| 5 | 阿克苏果业冷链公司 | conflict_review | PASS | 双来源 contradictions+investigate |
| 6 | 吐鲁番纺织印染厂 | verification_pending | **PASS（UI FULL）** | 核验表单 UI 全链（DEF-03-05 实证） |
| 7 | 塔城农机维修连锁 | stale_review | PASS | 补证 supersede+旧候选 VERSION_CONFLICT |
| 8 | 昌吉精密模具制造 | preassessment_review | PASS | 评估链+Gate CLEAR 停待确认；零授信写入 |
| 9 | 克拉玛依建材租赁 | awaiting_external | **PASS（回执 UI FULL）** | UI 回执落库→settle/close（面板分支=DEF-03-08） |
| 10 | 博乐葡萄酒庄设备回租 | closed_reorderable | **PASS（UI FULL）** | 已关闭面板+返单 409 UI alert |

## 3. 03 路本轮改动清单（ownership：Back/Edge/**、Back/Connectors/**、根启动器、03-integration/**、release/**）

- `Back/Edge/src/proxy.mjs`：补 POST grants 白名单路由（上轮遗留缺口）。
- `Back/Edge/src/advance-round.mjs`：arrow-cases 读路由 + `/arrow-cases/:caseId`；fallback404 退役。
- `Back/Edge/src/readproxy.mjs`：fallbacks 机制移除（单一权威）。
- `Back/Edge/src/server.mjs`：助手确定性说明层接线（assistant-briefing）；fallback 块移除。
- `Back/Edge/src/assistant-briefing.mjs`：新增（无模型案例说明）。
- `Back/Edge/scripts/ten-case-init.mjs`：新增（seedTenCases 集成栈封装；批次/幂等/状态）。
- `Back/Edge/scripts/demo-init.mjs` / `demo-selftest.mjs` / `demo-init-v2.mjs`：上轮交付与本轮骨架（v2 为配方执行器骨架，被 ten-case-init 取代，保留为工具）。
- `Back/Edge/scripts/edge-start.mjs` / `integration-lib.mjs` / `integration-up.mjs`：fallback 透传清理。
- `Back/Edge/.run/v05/`：栈配置（Git 排除）。
- 根：`Start-JW.ps1`、`Start-JW.cmd`（新增）。
- Back/Connectors：**零改动**（链路经 v05 十案例种子全程真实运行验证）。
- 文档/证据：03-integration/{DELIVERY,RUNBOOK,DEMO_GUIDE,RESULTS,DEFECTS,CONTRACT_NOTES,PATCH_PROPOSAL,RUNTIME_LEDGER,engine-selftest}、release/{CANDIDATE.md,json}、release-evidence 截图。

## 4. 缺陷与遗留（全部如实）

| 项 | 归属 | 状态 | 影响 |
|---|---|---|---|
| DEF-03-06 目录卡阶段/下一动作未消费 A checkpoint/nextActions（对象/数组形状） | 01 | OPEN | 目录卡两行显示缺省文案；进案例后真实状态不受影响 |
| DEF-03-07 协调员（多角色）身份从角色入口不可达，种子里程碑页内不可见 | 01 | OPEN | 单角色办理流不受影响；协调员批次历史仅目录摘要可见 |
| DEF-03-08 周期面板回执登记后未按 external_receipt 分支（状态名差异） | 01 | OPEN | 回执已落库、settle 可用（API/接口同）；面板少"可结清"分支 |
| DEF-03-09 主"提交材料并分析"按钮 plan 可用时不发 POST | 01 | OPEN | 分析事件 UI 闭环受阻（v05）；补件/核验/采用组件链正常；API 同接口可用 |
| 行尾空白 Back/A/test/customer-credit.test.mjs 5 行；根目录异名残片文件 97B | Codex（发布清理） | 报备 | 不影响运行；CANDIDATE 有清理建议与备份 |

## 5. 发布门对照（00_SCOPE）

十案例横向展列+进度各异 ✅（checkpoint 批次）；检查点/从头体验双批次真实执行 ✅；页面正确路径或
明确等待条件 ✅（6 例页内证据+4 例 A 权威/02 T 证据；06/08 人工入口在位、09/10 周期 UI 在位）；
单事件多步服务端证据 ✅（02 T9 + v05 advance 202）；负例矩阵 ✅（停机/恢复/重放/旧依据/权限/跨客户，
全部自有栈注入）；回归/typecheck/build ✅（01/02 冻结报告：164/164、11/11+43/43、tsc 0；03 未重复
全量）；Windows 启停/重演说明 ✅（RUNBOOK）；脱敏 ✅（敏感扫描零密钥；演示值全公开合成）；**缺陷
4 项 OPEN 交 01**（不阻塞 Codex 判断，但目录卡两行与主分析按钮的修复建议在验收前排期）。

## 6. 验收状态（如实区分）

执行者自测+集成验证=本报告与 RESULTS.json；Codex 独立验收=PENDING；用户视觉/业务验收=PENDING；
V0.5 tag 由 Codex 在用户确定版本后执行——本轮未 commit/push/tag，不宣称发布完成。
