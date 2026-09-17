# goal-02 · HANDOFF（2026-09-17）

交付：客户从商机入口提交资料后，系统**持续**完成接收→登记/校验→解压→解析→观测→事实候选→
四域预审（选择性）→问题准备→授权提问→补证→会后续办；重复材料不重复处理，局部变化只触发必要
重算，中断后从正确状态恢复。范围：`Back/B/**`、`Back/C/**`、`Back/Connectors/**`；
A/契约/Edge/Front/D 零改动；无 Git 提交；零真实模型/渠道调用。

## 1｜主入口与运行

- **服务主入口**：`cd Back/Connectors && node scripts/start-connectors.mjs`
  （`.run/config.json` 必填 signingSecret/serviceToken/企微回调 token；真实企微/TRTC 无凭据保持
  BLOCKED）。启动后：HTTP 面 `127.0.0.1:<port>` + 处理常驻驱动（`fileCfg.processing.driverIntervalMs`，
  默认 2000ms；恢复扫描内建于 tick）。
- **上传即入队**：`POST /api/connectors/evidence/upload` 回执带 `processing.taskId`；处理由驱动推进，
  也可手动 `POST /api/connectors/processing/tick {maxTasks}`。
- **进度查询**：`GET /api/connectors/processing/status?tid=<tenant>&cid=<customer>`（任务/阶段/
  问题/暂停态）；`GET /api/connectors/processing/tasks/:taskId`（逐段回执与失败原因）。
  传输(HTTP 200)≠解析完成：解压/解析/事实/分析/提问/A登记逐段留痕。
- **默认策略**：`outboundPolicy='suggest_only'`（只建议零外发）；`auto_whitelist` 才对白名单目的
  （fact_verification/evidence_request/clarification/site_recheck）经 send 外发，敏感类恒 human_gate；
  语音问题无活动通话一律排队。暂停：`POST /processing/pause`→零新外发，恢复按代际推进。
- 配置项（`.run/config.json` 的 `processing` 节）：`concurrency`、`maxAttempts`、`leaseSec`、
  `maxZipDepth`、`maxTasksPerCustomerPerHour`（客户级窗口预算）、`outboundPolicy`、
  `transaction`（交易适用面声明——生产须来自商机/产品登记，不由材料推断）、`aProjectByCustomer`、
  `driverIntervalMs`、`strategy`（恒用默认 selective；naive_full 仅供 perf 对照）。

## 2｜关键机制与不变量（验收人可按此抽查）

- **重复材料**：`parse_results` 键=租户+客户+sha256+解析器版本（不跨客户）；`duplicate_of` 工件
  任务 skip_duplicate；事实 contentKey 确定性幂等（evidence/service.mjs assertFact 增量）。
- **局部重算**：域结果缓存键=域消费面签名（该域实际消费的事实键状态+规则版本）+参与材料一致性；
  复用/重算理由逐域落 `recomputed_because`（例：补铭牌只重算 asset；与域消费面无关的新材料零重算）。
- **恢复**：任务表+阶段游标+租约（`FOR UPDATE SKIP LOCKED`）；崩溃/重启后 reclaim 过期租约、
  从游标续跑；facts 段确定性 contentKey 防重复；A 登记 deterministic requestId+回执对账
  （`blocked_unknown` 永不换 ID 重发，对账超界转人工）。
- **三层证据语义**：机器从原件确定性提取=source_supported；自由文本申报=declared；
  verified 仅人工 `POST /questions/verify`。流水聚合不映射经营收入（口径注记强制）。

## 3｜验证方法（复现）

```
cd Back/C          && node test/run-all.mjs          # 96/96
cd Back/B          && npm test                        # 83/83
cd Back/Connectors && node --test test/*.mjs          # 64/64（含 13 项服务级整链）
cd Back/Connectors && node scripts/perf-goal02.mjs    # 双臂对照+等价性断言，JSON 落 evidence/
```

## 4｜遗留与边界（如实）

- **真实感知/渠道 BLOCKED**：解析白名单=csv/tsv/txt/zip；pdf/图片/office/加密一律转人工
  （needs_followup+needs_human 问题可见）。OCR/ASR/企微/TRTC 真实链路未获授权，未 mock 冒充。
- **A 正式收口未接线**：四域预审结果留存 Connectors（候选，authority=none）；进 A 需 IR-1
  服务身份/客户授权（INTERFACE_REQUESTS.md），对应路径显式 skipped 并回执注明。
- **域消费面签名不含材料身份**：supersede 值同源异时保守重算并记原因（不冒充复用）——语义正确
  但该场景无缓存收益；如需收益须收窄 C 的 DOMAIN_READ_SCOPE（影响 42 场景冻结集，留待后续裁决）。
- 事实核验等级不落 fact_assertions 列（等级随解析结果/感知条目走）；补证问题满足判定按
  "不再出现在当前问题计划"驱动——若未来新增计划外停止条件需同步 markSatisfiedQuestions。
- 非 Windows 平台未测；perf 数字随机器而变（倍率关系是结论）。
- 测试进程/目录/端口登记：测试库逐文件创建销毁于 15443；对象存储目录 `Back/Connectors/.run/
  test-objects-*` 随测试清理；e2e 固定端口 48281、perf 48391/48392（用后即闭）。

## 5｜交付物清单（本目录）

`DESIGN.md`（现状测量+数据流+固定测试数据）、`CHANGELOG.md`（逐文件变更）、`TEST_RESULTS.md`
（回归矩阵+13 场景断言）、`PERF_BEFORE_AFTER.md`（双臂对照+等价性）、`INTERFACE_REQUESTS.md`
（IR-1..4 交目标一）、`evidence/perf-goal02-*.json`（原始对照数据）。
根 DECISIONS/CHANGELOG 未由本轮写入（单 writer 纪律）；如需登记请集成方摘录本 CHANGELOG。
