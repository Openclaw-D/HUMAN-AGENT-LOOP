# goal-02 · 支持格式与边界（2026-09-18）

解析器：`Back/C/src/parse/adapters.mjs`（`parse-adapters@2`）。全部支持格式以**原始文件字节**测试
（`Back/C/test/parse-adapters*.test.mjs` + `Back/Connectors/test/goal02-parsing.test.mjs`）。

## 自动解析（白名单内）

| 格式 | 边界与语义 |
|---|---|
| CSV/TSV | 引号感知（RFC4180 风格：引号内分隔符/换行/`""` 转义）；分隔符嗅探（制表>分号>逗号，取引号外首行）；银行流水表头识别（前 5 行内，日期+收入/支出列别名）；行级确定性求和=source_supported（绑定行引用+parserVersion），强制附"入账≠经营收入"口径注记 |
| XLSX | 内容识别（ZIP 内含 spreadsheetml Content_Types + xl/workbook.xml，扩展名仅辅助）；**固定合理表结构=第一个工作表**；共享字符串/inlineStr/布尔；银行流水表→同 CSV 语义；两列 key/value 表→declared 声明；其余表格→结构化留存+观测，不产事实候选（诚实） |
| TXT | `key=value`/`key: value`/`key，value` 声明提取=declared；自由文本只留观测不编事实 |
| 可提取文本 PDF | FlateDecode 内容流+文本算子（Tj/TJ/'/"/十六进制串；Td/TD/T*/ET/BT→换行）；提取文本按 key=value 声明=declared；表格结构不重构（全文留存观测）——如实，不冒充表格解析 |
| ZIP（容器） | 交协调层 zipguard 安全解包（穿越/展开大小/深度/数量限制）；逐 entry 重入各自命运（部分失败不拖垮同批）；派生件 provenance 指向容器 |

## 安全接收 + 人工路线（白名单外，不 mock）

| 类型 | 行为 |
|---|---|
| JPG/PNG/GIF | 魔数嗅探、不解码、不 OCR；`FORMAT_UNSUPPORTED + manualEntry + previewSafe`；预览经短时签名 URL（无公开媒体目录） |
| 扫描/图片型 PDF（无文本层） | 同上；走"原件可见→人工录入→获准复核"产品入口 |
| 加密 PDF | `PARSE_FAILED`（PDF_ENCRYPTED），不猜内容 |
| 非法日期（2026-13-45、2 月 30、非闰年） | 该行 badRow 拒绝，不入合计（不再静默规范化） |
| 非千分位逗号金额（1,2345） | 该单元格拒绝→该行 badRow（不错列金额后仍成功） |
| 合计/总计/小计行 | 剔除不重复计入聚合，留 `total_rows_excluded` 旗标 |
| XLSX 公式缺缓存值 | **整行拒绝**（数值未知不入合计），留明细；XLSX 内容非 XML（损坏/压缩标记不符）→ `XLSX_INVALID` 诚实拒绝 |

## 缓存与幂等键（任务书 §五）

- 解析缓存键 = `(tenant, customer, sha256, parserVersion, 声明元数据签名)`——元数据签名含期间起止/币种/单位/口径。同字节同元数据→缓存命中跳过；同字节不同元数据→**不 skip**：重新解析（质量旗标依赖声明期间），事实按内容键在新锚点下并存。
- 事实内容键 = 租户+客户+对象锚+键+值+单位+期间+来源件（+人工录入 mode）——重放/恢复/重录零重复候选；同锚同键不同值→冲突显式并存。
- A 操作幂等 = 确定性 requestId（`ptx-<taskId>-<op>`）+ a_links 状态机；unknown 先回执对账，绝不换 ID。

## 明确不支持（如实，未授权能力）

OCR/ASR（无获准提供方）、DOCX 正文解析、加密压缩包内容、真实模型理解、真实企微/TRTC 外发。以上均不走"开发者预填 JSON"替代，转人工产品入口或显式 BLOCKED。
