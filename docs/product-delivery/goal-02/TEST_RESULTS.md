# goal-02（产品交付·任务二）· TEST_RESULTS（2026-09-18）

环境：Node v22.23.1；Windows 10 x64；测试 PG `jw-connectors-pg@15443`（Connectors，逐文件建删库）、
`jw-cc-kernel-pg@15444`（A 内核测试库管理连接，逐用例建删库）。基线分支 `v02-goal1234-delivery` @ e4ed7a5。
零真实模型/渠道调用；全部测试数据为测试内生成的原始文件字节。

## 回归矩阵

| 套件 | 命令 | 结果 | 证据 |
|---|---|---|---|
| Back/Connectors（**默认入口，本轮修复**） | `cd Back/Connectors && npm test` | **71/71 pass** | evidence/test-connectors-npm-test.txt |
| Back/C | `cd Back/C && npm test` | **100/100 pass** | evidence/test-c-run-all.txt |
| Back/B（**默认入口补齐 3 文件**） | `cd Back/B && npm test` | **105/105 pass** | evidence/test-b-npm-test.txt |
| goal02 A 桥集成（真实 A 内核） | `node --test test/goal02-a-bridge.test.mjs` | **2/2 pass** | evidence/test-goal02-a-bridge.txt |
| 性能双臂对照 | `node scripts/perf-goal02.mjs` | 等价性 4 项全过 | evidence/perf-goal02-*.json |

## 默认测试入口修复（任务书 B1 明确要求）

- **Connectors `npm test` 修复前实际执行 0 个用例**：原命令 `node --test test/` 在 Node 22 测试发现规则下
  匹配不到任何文件（test/ 下无 `*.test.mjs` 命名）。修复为显式清单（Windows cmd 无 shell glob），
  修复后 71 用例（含原 13 场景整链 + 本轮新增 12 项）。
- **B `npm test` 漏挂 3 个文件**：fs-lock-recovery / inspection-dispatcher / question-arbiter 已补入清单
  （83 → 105 用例）。

## 新增测试与任务书 §六 必测项映射

| 必测项 | 结果 | 位置 |
|---|---|---|
| 引号金额反例（引号内逗号/千分位/双写引号） | ✅ | C parse-adapters-v2 T1；Connectors F1（真实 HTTP 全链） |
| 非法日期（13 月/2-30/紧凑/闰年） | ✅ | C T2（badRow 不入合计，不静默规范化） |
| 坏行合计（坏行+合计行剔除） | ✅ | C T2；F1（badRowCount=1，合计=有效行和） |
| XLSX 原件（真实 ZIP 字节） | ✅ | C T3；F2 全链（序列日期转换注记） |
| text-PDF 原件（FlateDecode 真实流） | ✅ | C T4；F3 全链（declared 声明进事实候选） |
| 扫描人工路线 | ✅ | F3（转人工+问题可见）；M1（录入→冲突→更正→复核 verified） |
| 同字节不同元数据 | ✅ | F4（不 skip、重新解析、新锚点并存；同元数据才判重） |
| 压缩异常/派生命运分离 | ✅ | P04（zip 内 pdf 转人工、csv 正常）；zipguard 既有回归 |
| 错主体/设备/期间 | ✅ | P03（period_mismatch 只定位）；P05（设备补证只动相关域） |
| 重复上传 | ✅ | P02（duplicate 标注+零重复解析/事实/分析） |
| A 提交后断网 | ✅ | P09（超时→blocked_unknown→回执对账→done；材料 POST 恰一次） |
| 进程被终止后恢复 | ✅ | P10（SIGKILL 场景注入、租约回收、事实零重复） |
| 旧结果晚到/补证选择性重算/暂停 | ✅ | P05/P13/P07（复用水位判定；无关域零重算；暂停零外发） |
| 四域→A 贯通（真实 A 内核） | ✅ | G-A1：A 侧只读直查 artifacts/4×analysis_runs(completed)/gate_receipt/findings |
| A 确定性拒绝如实失败 | ✅ | G-A2：未激活规则版本/客户不存在 → failed + a_links 留痕（不降级） |

## 性能（同机同数据双臂对照； selective vs naive_full 基线）

| 指标 | naive（基线形态） | selective（交付形态） |
|---|---|---|
| 处理时长（20 件材料批） | 2642 ms | **1560 ms** |
| 解析执行次数 | 20 | 15（缓存+判重） |
| 域计算次数 | 80 | **26（3.1×↓）** |
| 外发尝试 | 100（无幂等纪律的基线） | 5（question_key 幂等+suggest_only） |

等价性断言（Gate 语义/问题覆盖/事实 SHA/needs_followup SHA）4/4 一致——性能提升不来自跳过核验或隐藏异常。
A 调用计数：性能脚本未配置 A（预审链本身零 A 依赖）；A 调用次数由 e2e 断言（每任务=材料 1+派生 1+运行 8+Gate 1，P09/G-A1 断言恰一次）。

## 如实遗留

1. **B 全量并发偶发 1 次 crash-recovery 时序失败**（跨进程子进程调度；单独复跑与复跑全量均 105/105）。
   未改断言掩盖；如复现请按文件单独跑定位。
2. **XLSX 边界**：仅首个工作表；多 sheet/复杂合并单元格不承诺；日期列序列值转换带注记（不是静默改写）。
3. **PDF 表格不重构**：可提取文本按 key=value 声明处理，表格版面不还原——银行流水 PDF 走人工核对。
4. **包域结果登记**（`aPackageDomainResults`）默认关闭：要求依据包冻结声明与本路消费面一致，
   属业务侧协同配置；本轮代码就绪、未做真内核全链用例（如实标注，不冒充闭环）。
5. 非 Windows 平台未测；perf 绝对值随机器变（倍率关系为结论）。

---

## 2026-09-19 增量（缺陷判据与 PDF 抽取修复验证轮）

背景：04 路 DEFECTS.md 于 R4 将 DEF-G04N-01/02/03 复测关闭（金丝雀转绿，证据见 `docs/product-delivery/goal-04/`）。
本轮在制工作树上独立复证 02 路修复真实有效，并补齐能抓住原缺陷形态的常绿判据；验证中发现并修复一处 PDF 抽取潜在缺陷。

### 回归矩阵（2026-09-19）

| 套件 | 命令 | 结果 | 证据 |
|---|---|---|---|
| Back/C | `cd Back/C && npm test` | **101/101 pass**（100+新增 P3 判据） | evidence/test-c-2026-09-19.txt |
| Back/B（本轮零代码改动） | `cd Back/B && npm test` | **105/105 pass** | evidence/test-b-2026-09-19.txt |
| Back/Connectors（**默认入口含新判据**） | `cd Back/Connectors && npm test` | **73/73 pass**（71+新增 N1/N2，内含 a-bridge 真内核 2/2） | evidence/test-connectors-2026-09-19.txt |

### 缺陷判据映射（新增 3 项）

| 缺陷/观察 | 判据 | 断言要点 |
|---|---|---|
| DEF-G04N-01（requestId 缺失/超长 → 解析产物永不到达 A） | Connectors `defects-g04n.test.mjs` N1 | 假 A 按 A v2kit 同规则校验 requestId（违规=400 INVALID_INPUT，任务不得掩绿）；全链 done；requestId 确定性 `ptx-<taskId>-<op>` 且 ≤128（含 findings 最长形态）；parse_extraction 派生件+事实摘要+provenance 到达 A；重入零新写 |
| DEF-G04N-03（XLSX 被魔数识别当 ZIP 解出垃圾） | Connectors `defects-g04n.test.mjs` N2 | unzip 段 skipped（xlsx_whole_file）零派生子件；事实谓词非 XML 垃圾且无尾随空白；解析=bank_statement_xlsx 且产物以 parse_extraction 登记 A；对照臂真 ZIP 仍解包（命运分离） |
| P3 补充观察（PDF 谓词尾随空格） | C `parse-adapters-v2.test.mjs` 第 5 项 | journey 同形 PDF（冒号前带空格/行首缩进）谓词与值无前导/尾随空白；`TOTAL PRICE` 可被下游精确匹配 |

### 本轮新修缺陷：extractPdfText 流切片含 `stream` 关键字（Back/C，由 P3 判据暴露）

- **现象**：3 行文本 PDF（journey 购机合同同形）抽取文本全空 → 整件被误判"无可提取文本层（扫描）"转人工；
  2 行短流却"正常"（文本前混入垃圾前缀）。同输入同结果未破坏，但**能否解出全凭 zlib 字节运气**。
- **根因**：`extractPdfText` 数据切片自 `sm.index`（`stream` 关键字起点）开始，7 字节 `stream\n` 混入
  FlateDecode 数据；短流侥幸对齐、长流 `invalid literal/length code`。
- **修复**：数据起点 = 关键字之后（`sm.index + sm[0].length`）；无压缩流同样受益（不再混入 `stream` 字面量）。
- **影响面**：C 套件 101/101、Connectors 全量 73/73（含 F3 text-PDF 全链、G-A1 真内核）复证无回归。

### 如实遗留（增量）

6. `extractPdfText` 对 `stream\r`（孤立 CR 结尾关键字）形态仍不识别（PDF 规范允许；本轮样本与 journey 原件均为
   `\n`/`\r\n` 形态）——如遇真实原件出现该形态再立条，不预先扩面。
7. P3 补充观察的台账关闭属 04 路（DEFECTS.md 单 writer）；本路判据已常绿兜底。

---

# 2026-09-19 续轮（IR-03-8 ①②③⑤ 关闭轮）回归矩阵

环境：Node v22；自属容器 `jw-g02r2-pg@15458`（`CONNECTORS_TEST_PG_PORT=15458` +
`JW_A_ADMIN_DB_URL=postgres://cnext:cnext@127.0.0.1:15458/postgres`；共享容器 15443/15444 零触碰）。

| 套件 | 命令 | 结果 | 证据 |
|---|---|---|---|
| Back/Connectors 全量（13 文件） | `CONNECTORS_TEST_PG_PORT=15458 npm test` | **77/77 pass**（上轮 73 + 新增 4：M3/G-A3/N3/N4） | evidence/test-connectors-npm-test-ir038.txt |
| goal02 A 桥集成（真实 A 内核，含 G-A3） | `node --test test/goal02-a-bridge.test.mjs` | **3/3 pass** | evidence/test-goal02-a-bridge-ir038.txt |
| Back/C | `cd Back/C && npm test` | **101/101 pass**（零回归） | evidence/test-c-run-all-ir038.txt |
| Back/B | `cd Back/B && npm test` | **105/105 pass**（零回归） | evidence/test-b-npm-test-ir038.txt |

## IR-03-8 定向判据（新增）

| 判据 | 结果 | 位置 |
|---|---|---|
| ① G3 状态推进：received→needs_review→analyzed（真 A 只读直查；service 身份；runRef 按尝试；failureReason/nextAction） | ✅ | G-A3（真内核） |
| ① G3 上报 requestId 纪律（`a<attempt>-prc-<stage>`；≤128；严格 A 契约校验） | ✅ | N1 |
| ① 幂等重入零新增 G3 行/runs（同 requestId 确定性；新收口才新 ID） | ✅ | G-A3/N1 |
| ② 人工事实进四域输入：录入→收口 NEEDS_EVIDENCE（不冒充通过） | ✅ | M3/G-A3 |
| ② 复核 verified→事实升级→新收口 **CLEAR**（M3 本地 + G-A3 到达 A；历史回执保留） | ✅ | M3/G-A3 |
| ② runs deps 覆盖人工事实来源件（不伪造缩小依赖面） | ✅ | G-A3 |
| ③ 跨客户同字节各自 done、零 duplicate 标注；同客户仍 skipped_duplicate | ✅ | N3 |
| ③ 既有绑定后新邀请 accepted（幂等回执 invitationAccepted；上传范围检查通过） | ✅ | N3 |
| ⑤ a.customerLinks 种子透传→落 a_customer_links→全链到达 A；优先级裁决（纯函数） | ✅ | N4 |

## 如实边界（本轮）

- G3 上报为**进度披露非业务事实**：上报失败不阻断主链，a_links 留痕 failed/unknown（不回卷任务）。
- 收口作用域 requestId（`-<finId>`）为**加法演进**：同输入重放幂等不变；人工事实变更=新收口=合法新 A 写。
- 金丝雀 journey-first-file.mjs 本轮跳过（17933/17935 与 03 路在跑栈冲突），留给路 D 合流回归统一跑。
