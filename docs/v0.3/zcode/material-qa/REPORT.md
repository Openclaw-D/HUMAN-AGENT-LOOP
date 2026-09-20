# V0.3-Z1-MATERIAL-QA · 合成材料解析缺陷复核报告

2026-09-20。独立复核 kashgar-demo-v1 三类材料（银行流水CSV / 中文PDF / XLSX）的解析缺陷，交付可复现失败用例与精确预期，供 CTRL 后续修复。**未实施任何解析器修复**，未改业务标准，未修改材料原件、Back、Front、公共文档或他人任务目录；全部写入仅在本目录与 `.local/v03-zcode-material/`。无付费模型调用、无网络服务、无常驻进程、未占用端口（纯离线 node 脚本）。

## 结论

三个主要缺陷全部**独立复现**，且与 `docs/v0.3/material/PARSER_PROBE.json` 的观察互证（探针记录的解析器源码哈希与当前一致，探针结果即当前版本行为）。测试前后 `Back/C` 解析相关源码 SHA-256 完全一致（见 `logs/hashes-pre.txt`，pre/post 同文件），故本报告为**本版本证据**，无漂移。

## 复跑方式（一条命令，JW 根目录）

```
node docs/v0.3/zcode/material-qa/material-qa.test.mjs
```

- 实测命令与退出码：`node docs/v0.3/zcode/material-qa/material-qa.test.mjs > docs/v0.3/zcode/material-qa/logs/run-1.log 2>&1; echo "EXIT=$?"` → **EXIT=0**（原始日志 `logs/run-1.log`，退出码 `logs/run-1.exit`）。
- 退出码语义：**0**=三个缺陷仍复现且对照/诚实用例与冻结基线一致；**1**=行为漂移（某缺陷不再复现=可能已被修复，需对照本报告重判）；**2**=输入或源码 SHA-256 与冻结清单不符（结果不作本版本证据）。测试启动时自校验 7 项哈希。
- 16 用例＝3类缺陷×（真件反例＋最小合成复现）＋4 正常对照＋6 缺件/不可读/不支持。

## 三个主要缺陷

### 缺陷1 · 银行流水CSV表头别名缺口 → 整表降级垃圾声明，ok=true 掩盖失败

- 反例：`docs/materials/kashgar-demo-v1/KS-TEXTILE-200/originals/银行流水.csv`（SHA-256 `063d70a8…`，真表头 `流水号,日期,关联单号,对手方,摘要,收入元,支出元,余额元,币种,标识`）。
- 入口：`parseArtifactBytes` → `extractBankStatement` → `findHeaderRow`（`Back/C/src/parse/adapters.mjs:176`）。`HEADER_MAP` 的 inflow/outflow/balance 别名（`adapters.mjs:165-167`）含 `收入/收入金额/贷方` 等，**不含 `收入元/支出元/余额元`** → 表头识别失败（`adapters.mjs:198`）→ 回退 `extractKvCsvFacts`（`adapters.mjs:769`）→ 逐行逗号正则（`adapters.mjs:306`）把 484 条流水+表头变成 **485 条 declared 垃圾"声明"**（如 factKey=`KS-TEXTILE-200-B0001`，value=整行逗号串），`ok=true`、format=`keyvalue_csv`，无任何聚合与 `bank_inflow_total/bank_outflow_total` source_supported 事实。
- 精确预期（来源=原件字节独立求和，不经被测解析器）：`format=bank_statement_csv`，rowCount=**484**，inflowTotal=**77,343,360 元**，outflowTotal=**74,065,856 元**，periodStart=**2023-01-12**，periodEnd=**2026-08-25**，合计行剔除≥1，并产出 `bank_inflow_total=77343360`。
- 复现：用例 `DEFECT-BANK-CSV-REAL`（真件）与 `DEFECT-BANK-CSV-SYN`（2数据行+合计行的最小合成件，预期 1500000/200000/totalsExcluded=1）。对照 `CONTROL-BANK-CSV-ALIAS`：同一流水体仅表头改 `收入/支出/余额` → 今天即正确解析为 bank_statement_csv，锁定差异面=别名表。

### 缺陷2 · PDF 内容流 ASCII85Decode+FlateDecode 过滤链不被支持 → 中文文本静默丢失

- 反例：`…/originals/D02-主体登记资料.pdf`（SHA-256 `783b07fb…`，pypdf 生成；D09 合同 PDF 同构）。页面唯一内容流声明 `/Filter [ /ASCII85Decode /FlateDecode ]`（本任务实测解压确认，流内确有 `legal_name=` 行）。
- 入口：`extractPdfText`（`adapters.mjs:543`）。`/FlateDecode/.test(dict)` 对过滤链**误判为纯 Flate**（`adapters.mjs:558`），对 ASCII85 字节直接 inflate 失败 → `content=null` 被静默跳过 → 整页文本丢失；同时其余纯 Flate 的字体二进制流反被文本算子正则捞出 111 字节乱码冒充 text，`ok=true`、format=`keyvalue_pdf`、rawFactCount 仅 0-2。
- 第二层：即使补上 ASCII85，内容流中文是**字形ID单字节编码**（如 `(legal_name=\026\027\004\030…) Tj`），恢复中文必须应用字体 `/ToUnicode` CMap；现 `decodePdfLiteral`（`adapters.mjs:519`）只做 latin1/UTF-8 还原，无 CMap 支持。
- 精确预期（来源=GOLD_ANSWERS `KS-TEXTILE-200::legal_name`＝`喀什示例棉纺有限公司`，与同源 `D02-主体登记资料.md` 第7行一致）：提取文本应含该客户名。最小合成件（唯一内容流 ASCII85+Flate）则应提取出文本而非误报"无可提取文本层"。
- 复现：`DEFECT-PDF-REAL`（真件 nameInText=false）、`DEFECT-PDF-SYN`（被误判 FORMAT_UNSUPPORTED"扫描件"）。对照 `CONTROL-PDF-PLAINFLATE`：同一内容纯 FlateDecode → 今天即正确提取 `legal_name=测试客户甲公司`。

### 缺陷3 · XLSX 命名空间前缀不兼容 → 合法文件被误判"结构无效"转人工

- 反例：`KS-TEXTILE-200/经营台账.xlsx`（SHA-256 `16583064…`，11 个工作表，zip 结构完好、全部条目可正常解压——本任务逐条目实测）。工作表 XML 由 `@oai/artifact-tool` 以 `x:` 前缀写出：`<x:worksheet …><x:sheetData><x:row …>`。
- 入口：`parseXlsxRows` 护栏 `if (!sheetXml.includes('<row') && !sheetXml.includes('<sheetData'))`（`adapters.mjs:465`）→ 抛 `XLSX_INVALID`"工作表内容不是可读 XML" → `PARSE_FAILED`+`manualEntry=true`。**文件本身是合法可读 XML**，错误消息误导（材料报告亦如实注明"不能据此断言Excel文件损坏"）。
- 修复提示（不实施）：仅放宽护栏不够——`parseSharedStrings`（`<x:si>/<x:t>`）、`parseSheetRows`（`<x:row>/<x:c>/<x:v>/<x:is>/<x:t>`）与公式缓存检测同受前缀影响，需整个读取器命名空间无关。
- 精确预期（来源=`workbook-data.json` tables[1]年度报表 rows[0]=`["2023",21834032,…]`，首工作表=年度报表）：`ok=true` 且提取文本含 `期间` 与 `21834032`。最小合成件（前缀化 2023→55667788）应解析成功。
- 复现：`DEFECT-XLSX-REAL`、`DEFECT-XLSX-SYN`。对照 `CONTROL-XLSX-PLAIN`：无前缀同数据 → 今天即 `table_xlsx` 正常提取。

## 正常对照与交叉验证

`CONTROL-KV-CSV-GOLD`（真件已通路径）：`接口财务2025.csv` → keyvalue_csv，语义投影 `revenue_annual_declared=1848.0308 万元`、`total_assets_declared=1475.4932 万元`，与 GOLD_ANSWERS `revenue_2025=18480308 元`（CNY-yuan）换算一致——证明复核工装本身与语义投影层工作正常，缺陷不在投影层。

## 分类账（失败 / 未覆盖 / 不支持）

- **失败（缺陷）**：缺陷1/2/3 共 6 个复现用例（真件+最小合成）。
- **未覆盖**（能力缺口，随缺陷修复自然补齐，不单列修复项）：流水行级聚合与 `bank_inflow_total/bank_outflow_total` 语义事实（缺陷1后果）；D09 合同订单金额语义字段（缺陷2同根因）；经营台账 XLSX 全部 11 表数据（缺陷3后果，且现实现按设计只读第一个工作表）。
- **不支持（诚实拒绝，非缺陷，勿改）**：PNG/JPG 图片、无可提取文本层 PDF（FORMAT_UNSUPPORTED→人工录入）、加密 PDF、非 UTF-8 字节、空字节、既非流水也非键值的 CSV——6 个 HONEST 用例今天全部行为正确。

## 版本证据与哈希清单

- 解析器源码（测试前=测试后，无漂移）：`Back/C/src/parse/adapters.mjs` `1d99d8edc8917d8da4b6ff9297508d9119f84fac76d7f763a916b10e663893c0`；`Back/C/src/parse/semantic-facts.mjs` `42d758c91cfc…ff6`；`Back/C/domains/util.mjs` `08885f46ec1a…898`。与 `PARSER_PROBE.json` 记录源码哈希一致。
- 输入（全部与 PARSER_PROBE 一致）：银行流水.csv `063d70a8…`、D02-主体登记资料.pdf `783b07fb…`、D02-主体登记资料.md `00d5abf8…`、接口财务2025.csv `261c1950…`、经营台账.xlsx `16583064…`、workbook-data.json `a44dffce…`、case-index.json `10b43004…`、GOLD_ANSWERS.json `58291753…`、PARSER_PROBE.json `143a60ef…`。
- 本任务产物：`material-qa.test.mjs` `8d6c29009b74…307e`。完整清单见 `logs/hashes-pre.txt`（含测试后追记段）。
- 用例数：16（缺陷复现 6，对照 4，诚实拒绝 6）；本轮唯一一次正式运行 `logs/run-1.log`，EXIT=0。开发期首次试运行发现对照用例自身表头列数错误（6列对7列），修正后未再改断言语义。

## 交付物

- `REPORT.md`（本文件）
- `material-qa.test.mjs`（可一条命令复跑；16 用例；自校验输入/源码哈希；最小合成 fixture 全部内存生成，不落盘、不改原件）
- `logs/run-1.log`（原始运行日志）、`logs/run-1.exit`（退出码 0）、`logs/hashes-pre.txt`（测试前源码/输入哈希＋测试后追记）
- 辅助根因分析脚本（scratch，非交付核心）：`../../.local/v03-zcode-material/analyze.mjs`

## CTRL 摘要（≤12行）

1. 缺陷1 流水CSV：`收入元/支出元/余额元` 不在 adapters.mjs:165-167 表头别名 → findHeaderRow 失败，整表降级 keyvalue_csv，485 行逐行变 declared 垃圾声明且 ok=true 掩盖；期望 bank_statement_csv（484行，入77,343,360/出74,065,856 元，独立求和），并产出 bank_inflow_total。
2. 缺陷2 PDF：D02/D09 内容流为 `/Filter [ /ASCII85Decode /FlateDecode ]` 链，extractPdfText 只按纯 Flate 处理（adapters.mjs:558），解压失败静默丢整页文本，真件反从字体流提出 111 字节乱码且 ok=true。
3. 缺陷2 深层：中文为字形ID编码，修好过滤链后仍需按字体 ToUnicode CMap 映射才能恢复「喀什示例棉纺有限公司」（GOLD legal_name，同源 md 第7行）。
4. 缺陷3 XLSX：工作表 XML 用 `<x:row>/<x:sheetData>` 命名空间前缀，adapters.mjs:465 护栏只找裸 `<row`/`<sheetData` → 合法文件误判 XLSX_INVALID 转人工；修复需整个读取器前缀无关（x:c/x:v/x:is/x:t/x:si 同受影响）。
5. 复现命令（JW 根）：`node docs/v0.3/zcode/material-qa/material-qa.test.mjs`；exit 0=缺陷仍复现，1=行为漂移（可能已修复，请对照 REPORT 重判），2=输入/源码哈希漂移。16 用例，本轮 EXIT=0。
6. 对照组证明差异面唯一：仅别名差异（收入/支出）、纯 FlateDecode、无前缀 XLSX 今天均正常解析；接口财务CSV 语义投影与 GOLD_ANSWERS 换算一致，投影层无缺陷。
7. 诚实拒绝路径（空字节/非UTF-8/PNG/扫描PDF/加密PDF/杂CSV）今天全部正确，属"不支持"非缺陷，请勿顺手改动。
8. 本报告为本版本证据：测试前后 Back/C 解析源码哈希一致，输入哈希与 PARSER_PROBE 一致；未实施修复、未改业务标准、未动他人目录。
