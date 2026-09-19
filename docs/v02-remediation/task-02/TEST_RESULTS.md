# 任务02 · TEST_RESULTS（原始材料→权威后台持续处理链）

更新：2026-09-20 复核收口轮。环境：`jw-connectors-pg`@15443（cnext/cnext/cnext，Connectors
测试库）+ `jw-cc-kernel-pg`@15444（jwcc，A 管理库，A 内核以真实进程参与）；均与本路
README/TEST_PLAN 登记一致；`jw-v01-pg`@15442 未触碰。证据日志：`.local/task02-round2/`。

## 结果总表（执行者自验；用户验收未发生）

| 套件 | 命令 | 结果 |
|---|---|---|
| Connectors 全量 | `npm test`（Back/Connectors） | **88/88 PASS，0 fail，0 skip** |
| └ link-chain（真实 A 内核） | goal02-link-chain.test.mjs | 6/6 PASS |
| └ blocked-recovery（等待态/恢复） | goal02-blocked-recovery.test.mjs | 3/3 PASS |
| └ actor-trust（actor/归属） | goal02-actor-trust.test.mjs | 2/2 PASS |
| Back/C 回归（适配器改动） | `node test/run-all.mjs`（Back/C） | **101/101 PASS** |
| Back/B 回归（协调器依赖模块） | `npm test`（Back/B） | **105/105 PASS** |

## 任务书验收清单 → 测试映射（全部 PASS）

| 验收项 | 用例 | 关键断言 |
|---|---|---|
| 不预建映射新客户首传达 A | L1（真实 A 内核） | 零配置上传→A 权威同 ID 核验自动接通→done+aRegistered=true，A 材料恰 1，linked_by=auto_authoritative_same_id |
| 同客户重复上传 | L3+P02 | 同字节同元数据→skipped_duplicate，A 无第二份材料（无双份业务效果） |
| 同字节不同声明元数据 | L3+F4 | 照常处理（新锚点事实并存），A 各自登记 |
| 跨客户同字节 | L3+N3 | 各自全链处理，A 按客户各自登记（判重收敛客户级） |
| 缺映射显示并恢复 | R2+L2 | blocked_link（A_CUSTOMER_NOT_IN_A）→受控登记（归属证明）→即时重入→done+aRegistered |
| A 不可达恢复 | P09+R1 | 登记超时→blocked_unknown→回执对账恢复（材料 POST 恰一次，不换 ID）；A 未配置→blocked_a_unavailable→A 上线 sweep 重入 |
| 写成功响应丢失恢复 | P09 | a_links unknown→对账取回 aRef→续跑全链（游标保留，旧缺陷"恢复即 done"已修） |
| 解析后重启不丢不重 | L5+P10 | parse 段崩溃→重启同库续跑→done；A 材料恰 1、事实零重复 |
| CSV 真实原件 | F1+L1 | 银行流水 CSV/引号 CSV 全链；零配置到达 A |
| XLSX 真实原件 | F2+N2 | Excel 序列日期流水表→source_supported 聚合→解析产物登记 A |
| 文本 PDF 真实原件 | F3+L2 | 可提取文本=declared 声明；到达 A |
| 扫描件人工路线 | M1/M3+G-A3+L6 | 转录（≠核验）→录入冲突并存→更正修订链→获准复核 verified→Gate 到达 A |
| 人工更正→分析真实变化 | L6+M3+P05 | 更正后重入分析、新收口、A Gate 回执递增；旧事实 superseded 保留、历史不覆写 |
| 不利材料→限制真实变化 | L6 | 新增大额月供→压力覆盖率 0.55→STRESSED 规则命中=HOLD_FOR_REVIEW（A 侧回执递增）；更正后回落；不被批次/冷却忽略 |
| 伪造客户/租户拒绝 | L4+T2+R2 | 借他人邀请上传 403 CUSTOMER_MISMATCH 零落库；预览归属 403；跨租户读取零泄露；伪造归属证明 422、映射劫持 409 |
| 伪造操作者拒绝 | T1 | 非代理调用方自报人类 actor→403 ACTOR_NOT_DELEGABLE 零落库；未绑定令牌 fail closed |
| 越权材料种类 | L4 | 邀请未授予 kind→403 CUSTOMER_SCOPE_MISMATCH |
| 无预填/固定 CLEAR/伪造完成/legacy 免检 | 全部 | 全部产物来自原始字节真实执行；Gate 由冻结规则包确定性评估（L6 NEEDS_EVIDENCE→HOLD→回落序列）；A 内核无 --allow-legacy-basis；确定性拒绝如实 failed（G-A2） |

## 修复记录（本轮发现并修复，均有测试钉住）

1. CSV 声明表值列吞并 unit/caliber 列、表头行变垃圾事实 → Back/C `extractKvCsvFacts` 表头感知
   提取（修复后压力覆盖率才可真实计算）。
2. blocked_* 覆写游标为 'done' → 对账/等待恢复直接"完成"跳过全链 → finishTask keepCursor。
3. hookAfterStage 先于游标推进 → 游标先行（"段后崩溃"=段完成，恢复从下一段续跑）。
4. correct-fact A 回写 500（artifact_id 列不存在）→ 取 from_artifacts[0]。
5. 对账/等待重入烧尽 attempts → max_attempts+1（attempts 保持单调作 G3 尝试代数）。
6. 同客户重复上传在 A 重复登记材料（A 判重被 connectorRef.evidenceId 击穿）→ register_material
   对本地重复件跳过 A 登记（无双份业务效果）。
7. 缺 registrar 凭据确定性失败 → A_REGISTRAR_MISSING 可恢复等待态。

## NOT_RUN / BLOCKED（不计 PASS）

- 页面级 journey 联合复验：NOT_RUN（04 路，IR-02-4B）。
- 真实企微/TRTC/GLM/生产部署：BLOCKED（未授权，设计内关闭）。
- Back/A 套件与迁移（03 路所有权）：本轮未跑未改。
