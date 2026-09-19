# 任务04（合流集成）· board-round-02 · TEST_RESULTS（执行者自验口径）

**执行者自验声明**：本路执行者参与 Edge 实现，页面旅程由本路驱动——全部结果为执行者自验；Codex 独立复核与用户真人验收未发生。判定纪律：NOT_RUN/BLOCKED 不计 PASS；组件绿 ≠ 页面验收。

## 1. 组件测试（本路执行）

| 套件 | 结果 | 证据 |
|---|---|---|
| Edge 全量套件（串行） | **72/72 PASS**（67 存量 + t4-trusted-actor 5） | `evidence/edge-suite-r2.txt` |
| ├ t4-trusted-actor | 5/5：可信头会话派生/伪造头不透传；actorField 覆写（correct-fact/manual-entry/pause/answer 四例，伪造值零残留）；receipts 本人200/他人404/未命中found:false/缺tid400；customers/link 四态 | 同上 |
| Front 全量套件（01 的交付复核） | **64/64 PASS**（含 01 新增行为测试：门户统一上传链/originals 统一/看板/目录/方案面板/工作本钩子） | `evidence/front-suite-r2.txt` |
| 02 套件（link-chain 6/6、blocked-recovery 3/3、actor-trust 2/2、全量 88/88、C 101/101） | 02 自报全绿；本路未重跑，以真实栈全链跑通为旁证 | 02 路 TEST_RESULTS |

## 2. 装配级 API 冒烟（接线证据，非页面验收）

| 冒烟 | 结果 | 说明 |
|---|---|---|
| 上轮全量冒烟（14 步） | 14/14 PASS（重启后复跑） | 第 9 步曾先后暴露两个真实缺口并修复：①blocked_a_unavailable/A_UPLOAD_PRINCIPAL_MISSING（验收配置缺 a.credentials.upload 映射——本路配置修复）②STALE_BASIS（规则包未激活——经 A 受控端点激活 1.0.0 后消除）。修复后全链 **status=done、aRegistered=true、bridgeState=registered**，4 域 run+Gate 回执全部登记 A |
| round-2 增量冒烟（4 步） | 4/4 PASS | receipts 代理（found:false/缺 tid 400）+ customers/link（客户 403 零触达/缺 customerId 400）真实栈接线 |
| receipts 真实回执查询 | PASS | 以真实 a_links requestId 经 Edge 查询：found:true、customer_id/a_ref 正确 |

## 3. 固定快照页面旅程（核心验收）——已执行

快照：HEAD=8f8d962 + 251 dirty 文件 sha256 + dist 指纹 + 配置模式（`evidence/final-journey-r2/snapshot-fingerprint.txt`）。**主链 11 步实质 PASS + 决定段真实语义 fail-closed；负例 N1/N2/N4 PASS、N3/N5 页面级 NOT_RUN**。逐步页面证据：`evidence/final-journey-r2/JOURNEY_RECORD.md`（截图 4 张）。

关键判定：

- **上轮步骤5旧缺陷（done+skipped(no_customer_link)）复验通过**：A 材料登记/结果登记全部 done，aRegistered=true，清单回写。
- **有权人类决定段**：依据包冻结真实成功（Gate 回执系统关联+规则版本+四域依赖），Gate=NEEDS_EVIDENCE 为**真实规则评估结论**（规则前置事实未达 verified），页面如实"决策未就绪，不提供绕过"。**不以豁免/绕过冒充批准**；获准政策与充分 verified 证据接入后同链路复验即可走出。
- 会话失效（90s 租期）→ 诚实提示 → 重登恢复，数据留存：PASS。

## 4. NOT_RUN / BLOCKED（不计 PASS）

- N3 响应未知同号恢复（页面级）：机制在位（固定对账编号+UPSTREAM_UNKNOWN 带 requestId 回显+确认框保留设计），组件级 L3/P09 覆盖；页面驱动中止于收尾指令。
- N5 服务不可达恢复（页面级）：组件级 R1/L5 覆盖；页面驱动未执行。
- N4 的 HOLD_FOR_REVIEW 升级子路径（页面级）：本轮证据组合未精确命中压力门，页面维持诚实 NEEDS_EVIDENCE；组件 L6 覆盖该路径。
- 用户真人验收 / Codex 独立页面复核：未发生。
- 起租/租后/结清完整租赁管理：后端无该能力（生命周期条如实"未支持"），本轮未验收亦未演示。

## 5. 旅程发现缺陷（详见 JOURNEY_RECORD）

- D-R2-14（OPEN，02+01）：processing/status 缺绑定事实 → 重进面板误显"未绑定"禁用上传；过渡绕行=重发通道邀请（本轮实际执行，不影响单路径语义）。
- D-R2-15（OPEN，01，低）：邀请列表兑换后滞留"有效"，整页刷新才现撤权按钮。
