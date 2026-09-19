# 任务04（合流集成）· board-round-02 · EVIDENCE_INDEX

终版：2026-09-20 00:58。全部证据产生于合成/隔离环境（合成验收配置、合成原件、合成政策位【非公司制度（演示）】；无真实客户数据/真实消息/真实模型调用/资金操作）。

## 页面旅程证据（执行者自验；Codex 复核/用户验收未发生）

| # | 证据 | 位置 |
|---|---|---|
| R2-E-01 | **固定快照页面旅程记录**（主链 11 步实质 PASS+决定段真实 fail-closed；N1/N2/N4 PASS，N3/N5 页面 NOT_RUN；缺陷 D-R2-14/15） | `evidence/final-journey-r2/JOURNEY_RECORD.md` |
| R2-E-02 | 快照冻结（HEAD=8f8d962+251 dirty sha256+dist 指纹+配置模式+运行时参数） | `evidence/final-journey-r2/snapshot-fingerprint.txt` |
| R2-E-03 | 资源台账快照（原件 Back/Edge/.run/delivery/resources.json） | `evidence/final-journey-r2/resources-at-freeze.json` |
| R2-E-04 | 启动日志（政策位播种行/全链就绪） | `evidence/final-journey-r2/delivery-up.log` |
| R2-E-05 | 看板形态截图（阶段条+事项卡+四域卡，结清如实未支持） | `evidence/final-journey-r2/step2-workbench-board.png` |
| R2-E-06 | 统一链 A 回写截图（任务完成+已回写 A 档案+材料清单回写） | `evidence/final-journey-r2/step6-unified-chain-a-writeback.png` |
| R2-E-07 | 客户门户截图（兑换身份真实处理状态视图） | `evidence/final-journey-r2/step12-customer-portal-view.png` |
| R2-E-08 | 第二客户隔离截图（A 材料留存） | `evidence/final-journey-r2/n1-customer-A-materials.png` |
| R2-E-09 | 撤权级联失效截图（门户踢回入口页） | `evidence/final-journey-r2/n2-revoked-portal-dead.png` |

## 组件/装配证据

| # | 证据 | 位置 |
|---|---|---|
| R2-E-10 | Edge 全量套件 72/72（含 t4-trusted-actor 5 组） | `evidence/edge-suite-r2.txt` |
| R2-E-11 | Front 全量套件 64/64（01 交付复核） | `evidence/front-suite-r2.txt` |
| R2-E-12 | 装配冒烟（14/14，含两缺口修复前后过程） | `docs/v02-remediation/task-04/evidence/assembly-smoke-result.json`（终态） |
| R2-E-13 | round-2 增量冒烟 4/4（receipts/customers-link 真实栈接线） | `evidence/assembly-smoke-r2-result.json`（脚本 `assembly-smoke-r2.mjs`） |
| R2-E-14 | 本轮 Edge 增量源码 | `Back/Edge/src/{channel-authz,proxy,readproxy}.mjs`、`Back/Edge/test/t4-trusted-actor.test.mjs`、`Back/Edge/scripts/delivery-up.mjs`（§5.5 政策入口）、`Back/Edge/contract/consumed-surface-v1.json`（t4-r2-1 修订） |
| R2-E-15 | 上轮成果（保留引用） | `docs/v02-remediation/task-04/`（E-01..E-14、DEFECTS、JOURNEY_RECORD） |
| R2-E-16 | 02 round-02 交付（自报全绿+方案 R 冻结+语义冻结） | `../task-02/{CURRENT_STATE,TEST_RESULTS,INTERFACE_REQUESTS}.md` |

## 冻结与运行时参数（复核入口）

- 栈：Edge@48210（同源 dist build d20302cdda757721）/ A@48190（--required-domains-policy domreq-acceptance-synthetic）/ Connectors@48110（driver 2s，/healthz processing 分项正常）/ PG jw-v01-pg@15442（库 jw + cnext）。
- 规则包 1.0.0 激活：POST /api/v2/rule-pack-versions/activate（admin 人类，requestId=r2-activate-1.0.0-001，A 审计留痕）。
- 旅程客户：cust-mu8knz0q-bf1a68c851be（4 份合成材料、4 任务全 done、依据包 pkg-mu8lvm8o… r1、Gate 回执 gr-mu8la14v…）。
- 栈**仍在运行**（收尾按用户指示未停）；停止命令与归属见 CURRENT_STATE §运行资源。
