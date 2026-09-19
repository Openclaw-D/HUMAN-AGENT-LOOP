# 任务04 · EVIDENCE_INDEX

生成：2026-09-19。全部证据产生于合成/隔离环境（合成验收配置、合成原件、无真实客户数据/真实消息/真实模型调用/资金操作）。

| # | 证据 | 位置 | 说明 |
|---|---|---|---|
| E-01 | Edge 全量套件 67/67 | `evidence/edge-suite-final.txt` | 含新增 t4-* 14 个测试文件断言；串行运行 |
| E-02 | 装配冒烟 14/14（API 级，非页面验收） | `evidence/assembly-smoke.mjs` + `evidence/assembly-smoke-result.json` | 完整链路接线证据 + 真实栈授权反例 3 项 |
| E-03 | 资源台账 | `evidence/delivery-resources.json`（原件 `Back/Edge/.run/delivery/resources.json`，Git 排除） | 实例/端口/PID/marker/日志/归属 + B 不常驻判定 |
| E-04 | Connectors 启动日志 | `evidence/connectors-boot.log` | "处理驱动已启动（interval=2000ms…）；恢复扫描内建于 tick" 行 |
| E-05 | 重启保留验证 | `TEST_RESULTS.md` §3 + E-02 重跑 | delivery-down→up 全循环后任务 status=done / 消息线程 / 回执重放均在 |
| E-06 | 版本封存 | `Back/docs/customer-next/acceptance/evidence/s1-20260919-111922/version-seal.json` | gitSha=8dcef63…、dirty=true(59)、contract v1.3、migrations=11 |
| E-07 | 授权反例单元 | `Back/Edge/test/t4-channel-authz.test.mjs`（6 组） | stub 上游零触达断言（拒绝发生在 Edge） |
| E-08 | 消息语义/持久化单元 | `Back/Edge/test/t4-message-store.test.mjs`（7 组） | 分页缺陷回归 + 文件库重启恢复 |
| E-09 | 装配 E0（真实 edge-start 链路） | `Back/Edge/test/t4-assembly.test.mjs` | 透传生效 + 重启恢复（守护进程级） |
| E-10 | 跨路接口登记 | `../task-02/INTERFACE_REQUESTS.md`（IR-04-2A..D） | Connectors 逐资源授权（高优先）/驱动健康/统一上传编排/preview 归属字段 |
| E-11 | 消费任务03 权威清单 | `Back/Edge/src/kernel-store.mjs`（refsSource）+ 冒烟复验 | 问题8 闭合 |
| E-12 | **页面旅程联合验收** | `evidence/final-journey/JOURNEY_RECORD.md` + `snapshot-fingerprint.txt` + `resources-at-freeze.json` | 冻结快照下 12 步页面驱动旅程（8 PASS/1 PARTIAL/2 NOT_RUN/1 BLOCKED 设计内）+ 次级场景覆盖表 |
| E-13 | 版本封存（终验时点） | `Back/docs/customer-next/acceptance/evidence/s1-20260919-114853/version-seal.json` | 冻结快照对应 seal |
| E-14 | 旅程缺陷修复 | DEFECTS.md D-04-12 + `edge-daemon.log`（.run，Git 排除） | 旅程发现 seam messageId 冲突→修复→页面重试通过 |

## 快照冻结流程（联合验收前置，已就绪待执行）

终验开始时按序固化：① HEAD + `git status --porcelain` 指纹（dirty 文件清单 + sha256）；② Front/dist 构建指纹（version-seal dist 段）；③ 配置模式（`delivery-runtime.acceptance.json` 结构 + `_synthetic` 标注，不含凭据明文）；④ 资源台账（E-03 再生）；⑤ 随后页面旅程全部动作仅经浏览器执行，API/只读查库仅作旁证断言。**其他三路完成写入前不执行冻结**——混合变化中的结果不作固定快照结论。
