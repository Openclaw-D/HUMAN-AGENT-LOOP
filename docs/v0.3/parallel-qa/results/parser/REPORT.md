# V0.3-Z2 · 解析器独立验收报告（PDF / 银行流水CSV / XLSX）

2026-09-21。任务书 `docs/v0.3/parallel-qa/02_PARSER_REGRESSION.md`。只读输入：`Back/C/src/parse/`、既有 C 测试、`Materials/kashgar-demo-v1/` 原件、`docs/v0.3/zcode/material-qa/`（Z1 既有证据）。全部写入仅在本目录。未改生产解析器、未改预期迁就失败、未改原材料、未调用模型、未用数据库/共享服务、未安装依赖（pdfjs-dist 6.3.289 已在 `Back/C/package.json` 固定，node v22.23.1）。

## 结论

**14/14 用例 PASS，最终退出码 EXIT=0**（`logs/run-3.log` / `logs/run-3.exit`）。任务书三项核验（纺织流水 CSV、代表 XLSX、三客户主体 PDF）与异常样本要求全部达标；未发现新缺陷，无需给出修复位置。

## 版本证据判定（为什么三区域全复验）

Z1（`docs/v0.3/zcode/material-qa/REPORT.md`）冻结的源码哈希与当前**不一致**：`adapters.mjs` `1d99d8ed…` → **`7f20fed2…`**（修复后 20:16），并新增 `adapters-async.mjs`、`pdf-worker.mjs`（PDF 提取已改走 **pdf.js worker**，生产入口 `Back/Connectors/src/processing/coordinator.mjs:844` 调 `parseArtifactBytesAsync`）。`semantic-facts.mjs`、`domains/util.mjs` 未变。故 Z1 的三个缺陷结论不再描述当前行为，三缺陷区域按当前版本全部复验。

## 各项核验结果（实际值）

1. **纺织流水 CSV**（`KS-TEXTILE-200/originals/银行流水.csv`）：`parseArtifactBytes` → `bank_statement_csv`，rowCount=**484**，inflowTotal=**77,343,360**，outflowTotal=**74,065,856**，期间 2023-01-12→2026-08-25，与脚本内独立求和（不经被测解析器，awk 亦复核）逐项一致；产出 `bank_inflow_total/bank_outflow_total`（source_supported，绑定行引用）。
2. **合计行不重复计入**：真件经独立核验**没有合计行**（表头1+数据484，无其他行；Z1 报告"合计行剔除≥1"的预期与实物不符，在此更正）；解析器如实报 `totalsExcluded=0`、`badRowCount=0`。剔除机制以最小合成件验证：2 数据行+1 合计行 → 独立求和 1,500,000/200,000，解析聚合相等（合计行支出 9999999 未混入），`totalsExcluded=1` 并留 `total_rows_excluded` 旗标。
3. **代表 XLSX**（`KS-TEXTILE-200/经营台账.xlsx`，11 表）：`ok=true`、`table_xlsx`，提取文本含**"期间"与 21834032**；独立解包核对 workbook.xml 顺序首表=**年度报表→xl/worksheets/sheet1.xml**（与解析器取文件名序首表一致），提取文本与独立读取的首表**逐行一致**（8 行），第2表（月度财务）独有值未泄漏 → **首表范围达标**。命名空间异常如实处理：`x:` 前缀件与默认命名空间件同数据提取一致；`x:` 绑定非 SpreadsheetML → fail-closed `PARSE_FAILED`+manualEntry（不把别的词汇表当单元格）。公式缺缓存值异常：无缓存行（`formulaRows=[2]`）整行拒绝、不编数值、留痕。
4. **三客户主体 PDF**（各 `D02-主体登记资料.pdf`，经 pdf.js worker 路径）：三客户 `ok=true`，中文与原件（同源 md）一致——legal_name 喀什示例**棉纺/金属加工/塑料制品**有限公司及统一社会信用代码值全部出现在提取文本；`artifactHash`=原件 SHA-256（与 `SHA256SUMS.txt` 冻结一致：`783b07fb…`/`8eb9eafe…`/`57c9d1cd…`）；页号连续、逐页 `locator={kind:'page'}`、页 `textHash` 自洽、逐页拼回=全文、legal_name 定位到第 1 页 → **页码/提取位置/原件 hash 齐全**。
5. **异常样本不得返回伪正文**（仓库无既有损坏/扫描/加密样本，按任务允许在本目录 `fixtures/` 生成最小件，哈希见 `fixtures/fixtures.sha256.txt`）：
   - 扫描（仅图片 XObject 无文本层）→ `FORMAT_UNSUPPORTED`+manualEntry，零正文（未 OCR）；
   - 加密（真实 RC4 标准安全处理器 R2、需用户口令）→ 异步/同步路径均 `PARSE_FAILED`+manualEntry，解密内容未泄漏；
   - 损坏（真件截断 60%、真件中部 2048 字节置零）→ 截断件 fail-closed `PARSE_FAILED`；置零件 pdf.js xref 恢复提取出**原件真实文本**（逐行在原件提取文本内，无原件之外内容）——判定为"部分恢复真实文本"非伪正文，如实记录。

## 交付物与复跑

- `accept.test.mjs`：一条命令复跑（JW 根）：`node docs/v0.3/parallel-qa/results/parser/accept.test.mjs`；退出码 **0**=全部通过，**1**=存在行为不符，**2**=输入/源码哈希完整性破坏（运行前后自校验 5 源码+8 输入哈希，并与 `SHA256SUMS.txt` 核对）。
- `results.json`：14 用例逐条断言与实际值、输入核对、源码/输入哈希（测试前=测试后，无漂移）。
- `logs/run-1|2|3.log` + 对应 `.exit`：完整开发轨迹。run-1/run-2 的失败均为**本目录独立对照工装自身缺陷**（sheet 正则未兼容 `x:` 前缀、rels 属性顺序 Id/Target 颠倒、前缀件与默认件行数不同形比较），与被测解析器无关；修正工装后断言语义未改动。
- `fixtures/`：4 个最小异常样本（衍生件，非原材料改动；原件未动）。

## CTRL 摘要（≤12 行）

1. Z2 验收结论：Z1 三缺陷（流水表头别名、PDF ASCII85+字形编码、XLSX 命名空间前缀）在当前源码（adapters.mjs `7f20fed2…` + pdf.js worker 路径）**均已修复且达标**，14/14 PASS，EXIT=0。
2. PDF 生产入口已是 `parseArtifactBytesAsync`（coordinator.mjs:844，pdfjs-dist 6.3.289）；产物含页码 locator、页 textHash、原件 artifactHash，满足"页码/提取位置/原件 hash"要求。
3. 证据更正：纺织流水真件无合计行，Z1"合计行剔除≥1"预期与实物不符；合计剔除机制以最小合成件验证通过并留旗标。
4. 仓库无既有损坏/扫描/加密异常样本；最小样本已生成于本目录 fixtures/ 并附哈希，损坏/扫描/加密均无伪正文（诚实失败或仅恢复真实文本）。
5. 未覆盖（如实声明）：OCR 类图片、其他 20 份 D 系列 PDF、11 表中第 2 表及以后的内容级核对、LangGraph/Connectors 集成链路——不在本任务书范围。
6. 本报告为本版本证据：运行前后源码与输入哈希一致、与 SHA256SUMS.txt 冻结一致；未动他人文件，未改生产解析器与原材料。
