# Codex 独立发布复核 · 2026-09-20

用户已明确授权直接修复并提交推送。发布范围为 TAKEOFF-FA-1.0.0 当前工作树，保留 ZCode 成果与已有清理；不改变业务范围和二维布局。

## 修复与复核结论

- PASS：正面/附条件确认必须有最新 CLEAR Gate；无回执返回 GATE_BLOCKED。无激活规则、候选/回执/激活规则不一致、Gate 与评估材料快照不一致或为空均返回 STALE_BASIS。
- 客户锁串行化 Gate/证据登记与确认；激活规则共享锁防止核验至提交间换版。负面结论仍由有权人明确确认，不将技术失败自动解释为拒绝。
- 页面和演示脚本使用实际规则版本及来源材料快照。原先硬编码规则包名称/旧演示版本与实际 1.0.0 不一致；解析派生记录曾混入快照，现与 Gate 来源材料保持一致。
- 账本验收原硬编码旧库 jw，实际服务使用 jw_fa_final；现从运行配置取库名，且基线与验证库不一致即拒绝。旧版本账本 PASS 不作为本次独立证据。

## 独立执行证据

| 检查 | 结果 | 本地证据 |
|---|---|---|
| A 预评估定向测试 | PASS 19/19，含缺失/空/部分/同客户其他快照/无激活规则、换版、权限、幂等、恢复和三表不变量 | .local/takeoff-codex-gate-tests.log |
| A TypeScript | PASS | npm run typecheck |
| Front 单测 | PASS 82/82 | .local/takeoff-codex-front-final.log |
| Front 类型与最新构建 | PASS，JS 384.69 kB / gzip 119.17 kB；CSS gzip 4.00 kB | .local/takeoff-codex-front-build-final.log |
| Edge TAKEOFF surface | PASS 6/6 | 本轮已执行 node --test test/takeoff-surface.test.mjs |
| 修复后真实 Edge/A/Connectors API 链 | PASS 61/61，严格模式 | .local/takeoff-codex-chain.log；Back/Edge/.run/takeoff/acceptance/chain-results.json |
| 实际运行库正式业务三表 | PASS，jw_fa_final；确认前后逐行一致，三表均 0 | 同目录 t09-baseline.json；链路 ZERO_CHANGE_PASS |
| 新页面演示客户装配 | PASS，人工核验 7/7、Gate=CLEAR、awaiting_human_review | .local/takeoff-codex-page-setup.log |

原执行者完整测试和截图继续作为其自报证据保留；未全套独立重跑 B/C/Connectors 历史测试。最新 UI 真人视觉验收 NOT_RUN；真实模型/Jev/收费 API NOT_RUN；内网共享部署 NOT_RUN。不将本机 API 通过称为生产就绪。

## 可运行入口

http://127.0.0.1:48214/ （本机 Edge 同源托管 Front/dist）。启动/停止方式见 README。已按 pidfile、心跳、端口标识与 marker 核对归属，仅重启本轮 Edge/Connectors/A；原数据库、对象存储和审计保留。

新待确认合成客户：cust-mu99azy8-6963669118ce；评估 ass-mu99bl6h-7fe860653119。页面确认留给有权人员操作。历史已确认客户不改写；此前旧规则标记下创建的未确认评估会被正确阻断，须按当前规则重建。

## 发布与清理

- 发布前本地与远端 main 均为 8c6d3b0；提交集为本轮源码、测试、迁移、合成夹具、Front/dist 与文字交付记录。
- 不上传私有运行配置、数据库、凭据、原始运行日志/截图和退休源码备份；本地保留恢复文件，未清空未知数据库，未停止未知进程。
- 门修复前源码备份位于 .local/codex-gate-fix/；此前清理证据见 CLEANUP_LOG.md 及各路 CLEANUP。此处不宣称已清除全部历史材料。
- 需求登记页面仍缺；助手为确定性简报。完整新客户全页面办理、真实模型与内网部署需后续验收。
