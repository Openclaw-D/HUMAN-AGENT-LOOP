# AUDIT_REPORT_R4｜任务A反例测试(test/unit/18)独立审计(Agent-AUDIT-R4,2026-09-13)

**审计结论:PASS-WITH-NOTES**

四个点名风险的判定实质准确、措辞无"风险/缺陷"互串;独立复演全部兑现交付判定,另找到两个**产品写语义之外**的打穿参数组合与一处测试注释的机制归因失准(不影响判定实质)。判定均为审计者本人实测,不接受自报。

---

## 1. 实际运行数字(审计者本人执行)

| 命令(cwd=R4_MODEL_20260913) | 结果 | 退出码 |
| --- | --- | --- |
| `node --test test/unit/18-product-bridge-risks.test.mjs`(Node v22.23.1) | tests 6 / pass 6 / fail 0 / skipped 0 | **0** |
| `node test/run-all.mjs` | tests 218 / pass 218 / fail 0 / skipped 0 | **0** |
| `node runtime/audit-r4/audit-hash.mjs`(对 `evidence/r3-baseline-input-hashes.txt` 40 文件独立重算 SHA256) | match 40 / mismatch 0 / missing 0 | 0 |

冻结件完整性:审计期间(含两轮全量测试与本审计全部复演后)基线 40/40 哈希一致;产品树 `site/.v5-preview-data/remote-store.json` mtime=02:39(早于本轮 16:22 起),未被触碰。零新增依赖(仅 node 内建),零网络,真实模型调用 0(全部 transport 为合成闭包)。

## 2. 独立复演结果(自写脚本,均在 runtime/audit-r4/,未改任何交付/产品文件)

### 2.1 R-c 独立复演(audit-rc.mjs,退出码 0)——**缺陷独立确认,形态与交付判定一致**

自构造双角色(credit=succeeded 真实通道形状、policy=`{ok:'indeterminate'}`→unknown)直接调产品树 .ts 桥:

- `status='partial'`;perRole = credit:succeeded / policy:unknown(TRANSPORT_INDETERMINATE)
- `productAction = {"uiAction":"show_result_pending_review", …, "mustHumanVerify":true,"allowRetry":false}`
- `productAction.uiAction !== 'human_verify_before_retry'` → unknown 专属动作丢失,确认
- unknown 仅存于 failureReason 文字("部分角色结果未采纳(policy=unknown):…请人工核实…")与 candidate.perRole 元数据;remote-service.ts:546-557 ok/partial 分支只回写 replies、不消费 failureReason/candidate → 接线后的产品持久层确实完全丢失 unknown 语义
- 顺带确认 R-b:`candidate.scope=null`

### 2.2 R-a 独立验证与打穿(audit-ra.mjs,退出码 0)

| 案例 | 构造 | 结果 |
| --- | --- | --- |
| A1 会话消失+version 7→8(等价一次 store 写) | 慢 transport 在途期间删会话并推进 version | **rejected,replies=0**,failureReason="上下文版本已变化,该在途结果已过期(stale)…" → 失败关闭确认;**误归类确认**(原因码为上下文版本变化,无一字提及会话消失) |
| A2 打穿①:会话消失但 **version 不变**(直接改文件) | 同 A1 但只删 sessions 数组、version 保持 7 | **逃逸复现:status='ok',replies=1** —— 兜底完全依赖 version 推进,与会话存在性无关 |
| A3 打穿②:**整个 store 文件删除**(请求时 version=1) | 在途期间 unlink;`readRemoteStoreState`(remote-store.ts:315-321)对缺失文件以 **version=1 重播种空 store** → 快照 {generation:1, contextVersion:1, paused:false} 与请求 {1,1} 完全重合 | **逃逸复现:status='ok',replies=1** |
| A4 打穿③:在途期间 store 文件损坏 | 写入非法 JSON | 桥**抛错**(REMOTE_STORE_CORRUPT 透传,失败有声,非静默 ok);服务层(remote-service.ts:568-570)捕获后回退确定性表并如实标注,不冒充成功 |

**打穿可达性评估(关键)**:产品 API **不存在会话删除路径**(remote-service.ts 无 deleteSession/splice/filter 删除),且所有写路径先 `state.version += 1` 再落盘(204/351/401/460/503/585/666/696 行);createSession 使会话存在的最低版本为 2,version=1 时必无会话。故 **A2/A3 均不可经产品写语义到达**,只能通过直接改 store 文件/备份恢复等带外手段构造。结论:交付"无实际逃逸"在产品可达路径上**成立**;逃逸空间是"version 非单调"这一机制级条件,比交付注释所举的"未来 contextVersion 改为会话局部版本"更宽(整删重播种 v1、备份恢复同样命中),且都落在交付已建议的修法(快照对缺失会话返回 paused:true,R3 桥 product-bridge.mjs:136-146 同款)覆盖范围内。

### 2.3 R-d 独立对照(audit-rd.mjs / audit-rd3.mjs,退出码均 0)

- D1 不传 probe、仅翻 paused(version 7→8,generation 不变)→ **rejected**(contextVersion 兜底),与交付 R-d(1) 一致
- D2 静态 probe(恒 paused):**rejected + 'session paused'**,但降级留痕文字为 **"pre-call state gate(桥接层状态门,未调用候选)"** → 交付 18 R-d(2) 注释"probe 在 post-await 抓 paused"**机制归因失准**(静态 probe 在调用前门即被拒,候选从未执行,"transport 立即成功"未发生);断言本身(rejected/原因/downgrade 存在)不受影响
- D3 有状态 probe(首次 live/v1 → 第二次 paused/v1):probeCalls=2,**rejected**,downgrade="post-await state recheck:候选成功结果按此刻探测改判 rejected…" → bridge.ts:440-455 的 **post-await 复核分支真实有效**(该分支在交付测试中实际未被触达,由本审计 D3 补证)

## 3. 措辞审计(逐项)

| 判定 | 审计意见 |
| --- | --- |
| R-a "脆弱模式确认,无实际逃逸,失败关闭 rejected" | **属实**。代码模式确认(bridge.ts:299-301 快照回退旧 generation+paused:false);A1 证失败关闭;误归类如实记录。"无实际逃逸"限产品写语义内成立(N1 给出边界与两个带外逃逸组合)。无夸大:未把模式说成可利用缺陷,也未把失败关闭说成安全无忧。 |
| R-b "接口缺口确认;产品层 reviews/verification 等价门" | **属实且分寸正确**。桥源码确无 gate 入口、scope 恒 null(行为级独立复现);标"接口缺口"而非"缺陷"与事实相称(R2 INTEGRATION.md §1.3 将 gate 列为 analyze context 契约一部分,产品桥未接;产品层 createReview/F2 门真实存在)。 |
| R-c "**缺陷确认(形态修正)**" | **属实,且形态修正有据**。缺陷本体独立复现;修正依据见 §4。"人控语义降级"措辞与本体相符:mustHumanVerify/allowRetry 未失守,失守的是 unknown 专属"先核实外部是否实际发生"的 uiAction/zh 指令,且接线后端到端丢失(2.1)。**没有**把已保留的 mustHumanVerify 说成丢失(避免了 STATUS.md 预判中的错误断言),也无把缺陷弱化为风险。 |
| R-d "接线缺口确认;不传 probe 时内部快照兜住,未复现实际逃逸" | **实质属实**。接线缺口(539-545 行无第二参)与"未传时兜底"(D1/A1)独立确认。"未复现实际逃逸"如实(残余窗口趋零的表述诚实)。唯一失准在测试**注释**:R-d(2) 称 post-await 抓 paused,实测命中的是 pre-call 门(N3);判定文字"传 probe 时 post 复核有效降级"由本审计 D3 补证成立。 |

无一处"把风险说成缺陷"或"把缺陷说成风险"的措辞失实;交付测试头部原则("不能复现的如实标注'未复现/风险'而非伪称缺陷")在 R-a/R-d 上得到执行。

## 4. R-c"形态修正"依据核对(R2 冻结事实)

- R2 批次 `R2_MODEL_20260913/FIELD_MAPPING.md` §3(42-50 行):状态语义行明示 unknown 以 `allowRetry:false + mustHumanVerify:true` 编码;succeeded 行 = `show_result_pending_review / allowRetry:false / mustHumanVerify:true`(48 行),unknown 行 = `human_verify_before_retry / false / true`(50 行)。
- R3 权威版(本交付 `FIELD_MAPPING.md` §3,61-73 行)逐字继承同表。
- 规范实现即产品树 `model-adapter/integration/product-mapping.mjs` STATUS_ACTIONS(203-208 / 215-220 行),与上表一致;`R2_MODEL_20260913/INTEGRATION.md` §1.4(46 行)明示"statusToProductAction 提供同表实现"。
- 对照 STATUS.md 预判行(22 行)曾写"productAction 取成功角色状态(**mustHumanVerify=false**)"——该预判与 R2 冻结表不符;交付 18 未沿用错误预判,而是按实测改写为"形态修正:沿用 succeeded 动作,mustHumanVerify 不丢、丢 unknown 专属语义"。**修正合理,登记核实无误。**

## 5. 问题清单(均不阻断 PASS)

- **N1(机制边界,R-a)**:"无实际逃逸"依赖 store.version 单调这一隐含前提。审计找到两个带外逃逸参数组合:A2 会话消失+version 不变 → ok 放行;A3 整文件删除+请求时 version=1 → 重播种重合 → ok 放行。均不可经产品 API 到达(无会话删除路径;写恒 bump;version=1 时必无会话)。建议把这两个组合写入 CHANGE_REQUEST 的论据,强化"快照对缺失会话返回 paused:true"的必要性(与 R3 桥 product-bridge.mjs:136-146 对齐)。
- **N2(注释失准,R-d(2))**:静态 probe 命中的是 pre-call 状态门而非 post-await 复核(降级留痕文字自证"未调用候选");post-await 分支由本审计 D3(双态 probe)另行证有效。建议修正该测试注释,或改用双态 probe 使测试真正覆盖 bridge.ts:440-455。
- **N3(过程)**:交付未生成 `MANIFEST.json`,`tools/verify-frozen-hash.mjs` 按现状不可运行;本审计以 `evidence/r3-baseline-input-hashes.txt` 独立重算替代(40/40 一致)。
- **N4(过程)**:STATUS.md 仍为 IN_PROGRESS,未按其头部声明更新 READY_FOR_REVIEW 并冻结。
- **N5(琐碎)**:任务书/STATUS 引"remote-service.ts:540 调桥",实际 `bridge.generateFollowUps({` 在 539 行(跨至 545);18 号测试自身未引用该行号,不受影响。18 内其他行号引用(bridge.ts:299-301、440-455)核对无误。

## 6. 审计产物清单(全部为本审计新建,未改交付/产品文件)

- 本报告(唯一交付根写入)
- `runtime/audit-r4/helpers.mjs`、`audit-rc.mjs`、`audit-ra.mjs`、`audit-rd.mjs`、`audit-rd3.mjs`、`audit-hash.mjs`
- `runtime/audit-r4/t18-stdout.txt`、`run-all-stdout.txt`、`store-*/`(隔离 store)
