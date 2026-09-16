# STATUS｜R4-B 把R3相机成果验到产品上

- 日期:2026-09-13(接手时间以首checkpoint记录);截止:以完成验收或真实阻塞为终点(R4不沿用旧09:00)
- 任务入口:`V6/ZCODE_R4_B_20260913.md`;共同契约:`V6/ZCODE_R4_GOALS_20260913.md`、`V6/ZCODE_R4_MAIN_20260913.md`;前序:R3批次(READY_FOR_REVIEW,105/105,冻结只读)
- 状态:**READY_FOR_REVIEW — 收束冻结**(顺序1-3、5完成;顺序4收到MAIN包并复验:产品副本105/105+语义0,运行时资源序列验证BLOCKED于3321旧build——18 chunk 0含钩子,取证与解除后一条命令复验见CAMERA_INTEGRATION_RECEIPT §3-§4;终报FINAL_REPORT.md)
- 写面:仅 `V6/handoff/R4_CAMERA_20260913/**`(runtime/输出可重复生成);产品与R3批次只读;MAIN唯一写产品与integration-inputs。

## 依赖现状与协作姿态(共同契约:不得仅写"等MAIN"就结束)

- MAIN包 `handoff/R4_MAIN_20260913/integration-inputs/` **尚未生成**(接手时核对:不存在)。按契约先推进全部独立工作:升级delta、资源审计、量测方法、105回归runtime化(修evidence污染)、产品验证harness(以R3壳为自测靶,明确标注非产品证据)。
- 本路提供可执行接入/复验命令;MAIN包生成后以 `tools/verify-product.mjs --entry <URL> --inputs <batchDir>` 复验并回填 CAMERA_INTEGRATION_RECEIPT(引用同一输入编号+hash)。STATUS每30–45分钟checkpoint核对包是否已生成。

## 分工(原生Subagent,默认2)

| Owner | 范围 | 独占文件 |
| --- | --- | --- |
| 主agent | 总控、UPGRADE_DELTA、RESOURCE_AUDIT、MAIN_MEASUREMENT、CAMERA_INTEGRATION_RECEIPT、FINAL_REPORT、MANIFEST、runtime复核、MAIN包轮询与复验 | 上述文档、STATUS、MANIFEST、runtime/integration-check.json |
| SA-A | 105回归runtime化:run-r4-regression.mjs(输出仅runtime/,冻结evidence零污染证明:R3证据hash前后一致;runtime工件归一化去时间戳使hash可复现) | tools/run-r4-regression.mjs、runtime/regression/*、evidence/regression-frozen-proof.json |
| SA-B | 产品验证harness:verify-product.mjs(CDP资源序列:拍照成功/失败/迟到授权/取消/挂断/离页/选图/作废;终结态断言)+三viewport按钮可见量测;以R3壳自测,标注非产品证据 | tools/verify-product.mjs、tools/measure-viewport.mjs、runtime/product-verify/*(自测部分)、evidence/harness-selftest.log |

## 关键口径

- 产品证据与独立壳证据严格分开;壳的11场景通过不替代产品验证(DoD明示)。
- 可验证性最小要求(写入UPGRADE_DELTA,不属schema变更):MAIN产品页暴露 `window.__CAMERA_TEST = { controller, buildReceipt }`(一行),harness据此读真实控制器计数。
- runtime/输出归一化(剥离时间戳/时长),重跑hash不漂移;冻结历史(R2/R3 evidence)不重写。
- 自动化仅合成材料与虚拟设备;不自动启用真实摄像头/音频;audio/upload恒0;真机/Safari/键盘未测单列。
- 并发默认2最多3;限流降1;只结束本轮创建且有PID记录的进程。
