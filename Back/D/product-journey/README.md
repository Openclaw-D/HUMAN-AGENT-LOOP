# Back/D/product-journey（任务四·新包本轮产物，本路唯一 writer）

合成验收原件包与旅程验收脚本。历史 g0–g9 黑盒矩阵在 `../suites`（不动）。

## 合成原件包（D1 冻结 v1）

- `generate-originals.mjs` —— 零依赖确定性生成器。产出六类原件 ×（一致/冲突两组）+ 失败样本 + 隐藏期望值。
- 运行：`node generate-originals.mjs --out .originals/demo`（输出目录 Git 排除，见本目录 .gitignore）。
- 输出 `manifest.json`（逐文件 sha256/bytes，确定性：同参数两次运行逐字节一致）与 `expectations.json`（隐藏真值与期望观测；只许被测试断言侧加载，禁止进入被测系统输入）。
- 用法纪律（任务书 §2）：期望值只做断言；改原件参数后期望随之重算；不给被测链路预填答案、固定 CLEAR 或预填事实。

## 旅程驱动器（本轮）

- `journey-first-file.mjs` —— 首件金丝雀（D2/R4）：12 件合成原件真实字节 → 受限邀请/上传 → 持久处理（aBridge 登记 A→unzip→parse→facts→analyze→register_results）→ 只读断言。门禁 41 项 + 缺陷复现项 2（修复后自动转绿，当前 0 复现）。自管 A@17933/Connectors@17935 + jw-g04b-pg@15452 journey 专用库（jw_g04j/cnext_g04j，用后即清）。含 admin「激活规则包版本」前置（J1 前置动作）与 G04N-02 黑盒定向复测段。
- `perf-d3.mjs` —— D3 性能驱动器：对**运行中的冻结交付栈**（默认 Edge@17931/A@48282，不重建栈=同环境）连测 N 轮七项指标（首屏/页面上传/预审链/关键提交/SSE 同步/pg 增量/RSS 峰值），逐轮 JSON 落 `docs/product-delivery/goal-04/evidence/d3/perf/`。FAIL/BLOCKED 不汇总为 PASS。
