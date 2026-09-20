# V0.3-Z1 材料清单核对 REPORT

- 任务书：`docs/v0.3/parallel-qa/01_MATERIAL_INVENTORY.md`
- 执行方式：离线只读核对。未上传、未写数据库、未改manifest/原件、未调用模型、未启动服务、未安装依赖、未commit/push/worktree。
- 复现命令（工作区根目录，一条命令）：`node docs/v0.3/parallel-qa/results/material-inventory/check-material-inventory.mjs`
- 输入哈希：`input-hashes.json`（读取时刻实测）。输出无时间戳，重跑字节一致。

## 结论

- 三例 manifest 共 174 条，逐件实测 SHA256/bytes 与声明**零漂移**；其中 174/174 条与 `Materials/kashgar-demo-v1/SHA256SUMS.txt` 冻结值逐一比对一致（解析205条）→ 原件自冻结以来未变化。
- 候选接入（仅 uploadByDefault=true）：96 个同源证据组（每客户 32 个）；PDF/MD 双表示及 接口设备↔设备清单、接口财务2025↔年度报表 均按 sourceGroup 合并为**一份**证据，重复表示未计为新增材料。
- 回执比对：9 条回执哈希全部匹配当前原件字节（每客户已记录上传 3 件）；每客户其余 29 个候选组尚未记录。
- 完整性错误：0；观察项：21。退出码：**0**。

## 逐例核对

| 案例 | manifest条目 | 唯一materialId | 哈希漂移 | bytes漂移 | 目录逃逸 | 候选组 | 已记录上传 | 尚未记录 |
|---|---|---|---|---|---|---|---|---|
| KS-TEXTILE-200 | 58 | 37 | 0 | 0 | 0 | 32 | 3 | 29 |
| KS-LASER-500 | 58 | 37 | 0 | 0 | 0 | 32 | 3 | 29 |
| KS-INJECTION-1000 | 58 | 37 | 0 | 0 | 0 | 32 | 3 | 29 |

注：漂移列=实测值与manifest声明不一致的条目数；本轮逐件值亦写入 `summary.json`（每案例 items 内含 declared/actual 双值）。

## 核对方法

- 每条 manifest 条目实测：路径合法性（拒绝绝对路径、`..`段、解析后越界、跨案例归属；防目录逃逸）、文件存在性、SHA256 与 bytes（实测 vs 声明 vs SHA256SUMS.txt 冻结值）、sourceMode、customerKey/目录/case-index 三方客户归属一致性。
- 回执比对以**字节哈希**为主键（不依赖文件名）：同案例同名同哈希=已记录上传；哈希无任何原件匹配=孤儿回执；同名不同哈希或哈希记于他名=类别或来源组不一致；跨案例哈希命中=客户归属冲突。
- 冻结基线解析自 `SHA256SUMS.txt` 全部 205 条（实测值同步写入 summary.json 各案例 frozenBaseline.parsedEntries）。

## 同源去重规则与证据

- 分组主键 =（客户, sourceGroup）；同一组内多格式（PDF/MD、CSV/CSV、CSV/XLSX）只产生 **1 个证据槽**。
- 依据：各案例 manifest `note`：“PDF与MD同源，XLSX为全部CSV的展示汇编”；`INTEGRATION.md`：“不要把月度、年度、接口投影三种格式全部当新证据上传”。
- 每客户 32 条 uploadByDefault=true 条目 → 32 组（D01–D21 的 PDF 与其 MD 同组；接口设备.csv 与 设备清单.csv 同组“设备清单”；接口财务2025.csv 与 年度报表.csv 同组“年度报表”）。其中 21 个 MD 与 2 个 CSV（设备清单.csv、年度报表.csv）为组内非候选表示，未计入新增材料。
- `经营台账.xlsx`、`原始材料阅读册.pdf`、`supplements/S01-补件答复.md` 等未被 manifest 收录的文件见下节观察项，不纳入候选清单。

## 回执比对分类

| 案例 | 已记录上传（哈希=当前字节） | 尚未记录 | 类别/来源组不一致 | 跨客户哈希 |
|---|---|---|---|---|
| KS-TEXTILE-200 | 3 | 29 | 0 | 0 |
| KS-LASER-500 | 3 | 29 | 0 | 0 |
| KS-INJECTION-1000 | 3 | 29 | 0 | 0 |

- 回执文件：`.local/v03-recovery/case-upload-receipts.json`（9 条，孤儿回执 0 条）；回执客户ID与 `case-runtime-map.json` 一致性已在各案例 runtimeCustomerIdConsistent 记录。
- **声明**：回执是恢复期历史记录，不是当前服务授权、邀请有效性或数据库状态的证明；本轮未启动任何服务、未查询数据库。

## 发现（错误与观察）

| 级别 | 代码 | 文件 | 说明 |
|---|---|---|---|
| observation | NOT_IN_MANIFEST | KS-TEXTILE-200/customer-profile.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-TEXTILE-200/DEMO_EXPECTATIONS.md | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-TEXTILE-200/material-manifest.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-TEXTILE-200/supplements/S01-补件答复.md | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-TEXTILE-200/workbook-data.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-TEXTILE-200/原始材料阅读册.pdf | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-TEXTILE-200/经营台账.xlsx | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-LASER-500/customer-profile.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-LASER-500/DEMO_EXPECTATIONS.md | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-LASER-500/material-manifest.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-LASER-500/supplements/S01-补件答复.md | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-LASER-500/workbook-data.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-LASER-500/原始材料阅读册.pdf | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-LASER-500/经营台账.xlsx | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-INJECTION-1000/customer-profile.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-INJECTION-1000/DEMO_EXPECTATIONS.md | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-INJECTION-1000/material-manifest.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-INJECTION-1000/supplements/S01-补件答复.md | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-INJECTION-1000/workbook-data.json | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-INJECTION-1000/原始材料阅读册.pdf | 存在于案例目录但未被manifest收录（不计入候选清单） |
| observation | NOT_IN_MANIFEST | KS-INJECTION-1000/经营台账.xlsx | 存在于案例目录但未被manifest收录（不计入候选清单） |

## 交付物

- `check-material-inventory.mjs`（本脚本，零依赖，Node ≥20）
- `summary.json` / `findings.json` / `input-hashes.json`
- `pending-by-customer/KS-TEXTILE-200.json`、`pending-by-customer/KS-LASER-500.json`、`pending-by-customer/KS-INJECTION-1000.json`（每客户待接入清单：文件名、kind、sourceGroup、caliber原始值、单位/期间缺失说明、哈希、回执状态；不含预判评级）
- `REPORT.md`（本文件）

## 单位/期间字段说明（不猜缺失）

- manifest 无结构化 unit/period 字段；caliber 原文（“模拟资料；金额元，接口投影列_wan为万元；期间以文件内容为准”）已原样保留于 `caliberRaw`。
- 案例级 `unit: "CNY-yuan"`、`asOf: "2026-08-31"` 来自 `case-index.json`，已在各清单 `caseLevel` 注明出处。
- 未解析文件内容推断期间（避免猜测）；清单 `missingFields` 逐条说明缺失。
