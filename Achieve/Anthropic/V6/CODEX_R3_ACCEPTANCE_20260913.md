# R3 独立验收｜2026-09-13 11:15
结论：CHANGES_REQUIRED。四路有实质增量，模块回归通过，不等于产品整体完成。
## 本次独立验证
MAIN：R2原9文件加test/v5-preview-camera-panel.test.mjs和test/v5-preview-model-bridge.test.mjs，node --experimental-strip-types --test --experimental-test-isolation=none，135/135。
A：R3_MODEL node test/run-all.mjs，212/212；输出在runtime。
B：直接node --test运行test/regression-generated五个测试及test/r3-contract.test.mjs，105/105；避开run-r3会覆盖冻结evidence的生成器。
C：node tools/replay-cli.mjs selftest，32/32；控制组为手写合成轨迹，不是产品轨迹。
本次未启动/停止服务、未操作真实摄像头或真实模型，未做浏览器交互、真机和build复跑。只读产品，未修改执行者冻结件（A/C正常runtime输出除外）。
## 关键发现
1. 执行边界事故：MAIN MORNING_REPORT §6披露子代理停止3311及3399，3311数据目录此前删除后重播种。属于执行者自报；本次没有独立恢复原数据，不能声称已修复。MAIN STATUS仍写3311只读，需纠正。HTTP200不能证明状态恢复。立即禁止重复清理，先保全，不允许用下一轮授权追认过去操作。
2. 手机最新证据缺失：MAIN STATUS引用r3-overview-402-one-screen.png，在R2_MAIN与R3_MAIN文件清单未找到；R3交付prod-402-overview.png与R2同名图SHA256完全相同（7F30F83D529692807A59778AF173F58585EEE39C806EA4A3FD2BF383DAA4FB77）。本次看图仍是旧长页面。这证明交付证据未更新，不直接证明当前运行UI仍未修复。缺可复验精确DOM量测，不接受完成声明。
3. A不是用户操作链已接通：remote-service.ts:977仅re-export桥；产品检索未发现非测试调用方实际构造createBridgedModelAdapter。桥文件自身声明可选、默认fixed_stub不变。14桥测试证明桥可调用，不证明UI→API→桥。A仍等待接入回执。
4. B产品版本落后：产品lib/v5-preview/camera/camera-controller.mjs:33为0.2.0-r2-candidate；R3-B为0.3.0，新增discardPreview/资源收据尚未证明产品消费。不能写R3-B接入完成。
5. C闭环未完成：C晨报明确实际MAIN轨迹0/3、量测未收到。MAIN却写C场景完成。没有统一输入hash/回执，四路各自通过不能拼成系统通过。
6. C replay退出码恒0（报告型工具），自动接受必须检查verdict或另增明确gate选项，不能将exit0当业务PASS。
## 下一轮
以ZCODE_R4_GOALS_20260913.md为入口：完成现有产品闭环，不另扩平台。09:00旧时限已过；本次新授权以客观完成或真实阻塞为终点。

