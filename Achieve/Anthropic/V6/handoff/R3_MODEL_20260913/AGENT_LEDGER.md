# AGENT_LEDGER｜R3 A(2026-09-13,北京时间)

授权:`V6/ZCODE_R3_A_20260913.md`(默认 2 最多 3 子代理,分接入验证/反例审查;限流退避)。输入基线:`evidence/r2-baseline-input-hashes.txt`(R2 冻结批次拷贝,35 文件)。额度计量平台未暴露——未知;仅记录可见事实。

| # | 时刻 | Agent | 目标 | owner 文件 | 并发 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 06:30 | Agent-BRIDGE-TEST | 接入一致性 16 | test/unit/16-bridge-integration.test.mjs | 2 | **1302 限流,无产出**;主线程接手(见主线程行) |
| 2 | 06:30 | Agent-BRIDGE-FAULT | 故障压测+定向 mutation 17 | test/unit/17-bridge-fault.test.mjs | 2 | **成功**:11/11;全量 203/203;mutation 2/2(E1 偏移/E2 默认常数);账本逐笔溯源守恒;固定 seed=20260913,3 次复跑逐位一致 |

**并发峰值 2**(符合"默认 2 最多 3");限流 1 次,退避处理(主线程接手,未重试风暴、未嵌套绕过)。

## 主线程(串行)

- 接手:R2 基线拷贝+hash、STATUS 接收、产品形状源码核对(remote-types.ts / remote-store.ts)。
- 实现:src/bridge/product-bridge.mjs(+1 偏移/原子 reader/superseded 显式过滤/保守停摆快照)、src/bridge/receipt-protocol.mjs(R3_BRIDGE_RECEIPT@1 + isIntegratedReady;修复 generatedAt 冻结后不可填的接口缺陷→改为可选入参)、fixtures/product-snapshots.mjs(6 组冻结产品形状)。
- 接手 16:9 项接入一致性测试(含两次 transport 输出引用错误的自纠——正确行为是守门拒绝,测试改为引用请求实际清单)。
- 文档:INTERFACE/INTEGRATION_CHECKLIST/sample/REPORT/MORNING_REPORT/STATUS;冻结与复跑核验。

## 最终数字

- 测试:**212/212**(退出码 0;192 R2 回归 + 9 接入一致性 + 11 故障压测)。
- mutation:R3 定向 **2/2(分母 2)**;R2 套件 7/7(分母 7)回归通过(09)。
- 压测分母:25 调用(19/2/1/2/1),账本终态逐笔溯源(见 REPORT §3)。
- 资源计量:未知(平台未暴露);subagent token 消耗可见值不采信为额度口径。
