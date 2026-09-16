# AGENT_LEDGER｜R4-B Subagent台账

授权链:ZCODE_R4_B_20260913 + ZCODE_R4_GOALS_20260913 + ZCODE_R4_MAIN_20260913(依赖包)。并发:首轮派2即遇用户并发限制(SA-B失败)→降1/串行;实际峰值1。

| 任务 | Owner | 独占写面 | 结果 | 证据 | 资源记录 |
| --- | --- | --- | --- | --- | --- |
| SA-A 105回归runtime化 | subagent→**模型请求失败阵亡→主agent接管收尾**(实现已完成且经主agent三跑复验) | tools/run-r4-regression.mjs、runtime/regression/*、evidence/regression-frozen-proof.json | ✅ 105/105×3次;normalized双轮hash一致(r4StableHash identical);R3冻结证据before/after根hash一致"PASS: frozen evidence untouched" | runtime/regression/*、evidence/regression-frozen-proof.json | tokens≈环境回报(未知精确);主agent额度未知 |
| SA-B 产品验证harness | 首派❌用户并发限制→**主agent接管实现** | tools/verify-product.mjs、tools/measure-viewport.mjs、runtime/product-verify/*、evidence/harness-selftest.log | ✅ 壳自测:S1零调用/S7持有/S8作废/S5挂断全零/S6离页/P3挂断收据;产品实测:402真布局+旧build阻塞取证 | runtime/product-verify/* | subagent无产出;主agent完成 |
| 主agent 文档与收口 | 主agent | UPGRADE_DELTA/RESOURCE_AUDIT/MAIN_MEASUREMENT/CAMERA_INTEGRATION_RECEIPT/FINAL_REPORT/STATUS/MANIFEST、tools/run-product-regression.mjs | ✅ | 各文件 | 主agent额度未知 |

- **输入hash回执**:引用MAIN `B-camera-controller`(INPUTS.json登记sha256前缀44695861628f47ef);B实测全hash一致;产品副本vs R3候选语义差异0(剥离块注释逐行比较,见runtime/regression-product/summary.json)。
- **进程纪律**:本轮自有Chrome进程均已taskkill并记录;未触碰3311/3321/3399(仅HTTP读取3321);无广泛清理。
- **额度声明**:产品API付费0;真实模型调用0;账户剩余额度未知。
