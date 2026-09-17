# goal-02 · TEST_RESULTS（2026-09-17 实测）

环境：Node v22.23.1；PG 容器 `jw-connectors-pg@127.0.0.1:15443`（测试库逐文件创建/销毁）；
零真实模型调用、零真实渠道调用（企微/TRTC 按既有 CAPABILITY_MATRIX 保持 BLOCKED，不 mock 冒充）。

## 一、全套回归（含本轮新增，全部 0 失败）

| 套件 | 命令 | 结果 | 说明 |
|---|---|---|---|
| Back/C | `node test/run-all.mjs` | **96/96**（93 旧 + 3 新） | 新增 `test/parse-adapters.test.mjs` |
| Back/B | `npm test` | **83/83** | 0 失败（含真实子进程并发/fs-lock/恢复矩阵） |
| Back/Connectors | `node --test test/*.mjs` | **64/64**（50 旧基线 + 13 新 e2e + 2 个模块级文件通过项） | 新增 `test/processing.e2e.mjs` |

注：`node --test` 把无测试声明的 helpers 文件各计 1 个"文件级通过项"，故 64=50+13+2 中有 2 项为该计数口径，非断言测试。

## 二、服务级整链测试（test/processing.e2e.mjs，13/13）

全部经**真实 HTTP 接收入口**（compose+startServer+服务令牌）送入**原始文件字节**，无预填 declaredFacts：

| # | 场景（任务书 §六） | 关键断言 |
|---|---|---|
| P01 | 完整链 | 银行 CSV→逐段回执（parse bank_statement_csv/facts/analyze/questions）→四域结果落库→Gate 收口→补证问题生成；suggest_only 零外发 |
| P02 | 重复上传 | 同字节×2：第二件 duplicate_of 标注+skipped_duplicate+parse_results 恒 1 行+事实零重复+分析零重复 |
| P03 | 错期间 | 声明期间 vs 内容月份错位→period_mismatch 质量旗标（只定位不改写）；事实锚定取内容实际期间 |
| P04 | 同源派生+部分解析失败 | ZIP(csv+txt+pdf)→3 子件各自任务；pdf=FORMAT_UNSUPPORTED 转人工（needs_human 问题可见）；csv/txt 不被拖垮；子件 derived_from+same_source 不叠独立证明 |
| P05 | 修正原件+局部重算 | supersedes→旧件 superseded_by；supersede 消费面保守重算记原因；**无关新材料→四域全复用零重算**；**补铭牌→只重算 asset，policy/credit/commerce 复用** |
| P06 | 多人同时提交 | 财务/实控人并发上传+并发 tick→全部 done、事实/观测零重复（FOR UPDATE SKIP LOCKED） |
| P07 | 暂停与授权竞态 | 暂停→新问题 outbound_paused 零新外发；恢复→按当前代际推进为建议态 |
| P08 | 授权外发幂等 | auto_whitelist 策略：白名单目的逐问外发（5 条）；再分析同键不重发（clientMsgId=question_key） |
| P09 | 超时未知 | A 登记超时→任务 blocked_unknown（阶段 unknown）；回执对账恢复 done；**POST 恰一次，不换 ID 重发** |
| P10 | 进程终止后恢复 | 故障注入 parse 段后崩溃→有限重试从游标续跑；过期租约回收；解析/事实/观测零重复 |
| P11 | 重复回调/任务重入 | 已完成任务重复 tick×3 → 四表计数逐字节不变 |
| P12 | 预算耗尽 | 客户窗口任务上限=1→1 done+1 queued（不丢弃）；台账 estimate.modelCalls=0、actual.billKnown=false（未知，不记 0） |
| P13 | 会后补证 | 回答→answered（≠材料≠核验）；晚到材料→域更新+问题不被回退；verified 仅人工 verify 端点可产生（缺理由 400） |

## 三、单元测试（C parse-adapters 3 项）

银行 CSV 原始字节→行级提取+聚合+source_supported+口径注记（不冒充经营收入）；声明表/文本=declared 级；
期间错位定位；白名单外（PDF 魔数）FORMAT_UNSUPPORTED→人工；空/坏字节不编数；ZIP 容器交回协调层；
同输入恒同输出（确定性）；解析缓存键含租户/客户/处理版本不跨客户。

## 四、性能对照

见 PERF_BEFORE_AFTER.md（naive_full vs selective 等价性断言全过：Gate 语义/问题覆盖/转人工/待补覆盖四项一致）。

## 五、真实边界（不宣称的部分）

- E2 真实感知/渠道（OCR/ASR/企微存档/微信客服/TRTC 录制）：**BLOCKED**，保留人工入口，未 mock 冒充通过。
- A 内核联测（aRegister 的真实 48080 写入）：本轮以故障注入 fetch 覆盖超时/对账路径（P09）；
  真实 A 常驻实例联通属目标一环境（INTERFACE_REQUESTS.md 已列）。
- 生产身份/真实密钥/费用：未触碰；台账实际费用=未知（billKnown=false）。
- 非 Windows 平台未测。
