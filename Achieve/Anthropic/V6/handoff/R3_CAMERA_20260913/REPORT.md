# REPORT｜R3 相机能力进入手机访谈,全过程资源边界验证

日期:2026-09-13(07:20+08:00收束,09:00截止前)。执行:ZCode主agent + 原生Subagent SA-A/SA-B(并发默认2,限流退避记录见AGENT_LEDGER)。写面:仅 `V6/handoff/R3_CAMERA_20260913/**`;R2批次(96/96,READY_FOR_REVIEW)与产品代码只读;产品由MAIN接。

## 1. 结论(TL;DR)

按 `ZCODE_R3_B_20260913.md` 交付:可嵌入访谈的控制器 `0.3.0-r3-candidate`(新增"仅内容作废"契约 `discardPreview()`、资源计数器、可复验资源收据 `buildResourceReceipt()`)、事件→资源契约表、MAIN camera-panel最小替换映射、**105/105 测试全绿**(R2 96项回归对R3控制器+9项新契约)、**11场景真实Chrome CDP仿真全绿(failedChecks=0)**——402×874/DPR3与390×844、360×800均为**真实布局视口**(clientWidth实测精确相等,非缩放充数)。麦克风0/上传0/挂断终态live tracks与悬空URL全0/并发流峰值≤1。

## 2. 任务书顺序对照

| 顺序 | 要求 | 结果与证据 |
| --- | --- | --- |
| 1 事件→资源状态表 | EVENT_RESOURCE_CONTRACT.md §1九行全覆盖(开启/翻转/单拍/失败/作废/取消/超时/挂断/离页)+外部ended;收缩视图≠离开会话(§2);**仅内容作废的流契约**(§3:不触设备、流保持、hasLiveStream指示=可见状态);取消/挂断/离开不留隐形采集(§4三级归零证据点) | SA-B交付,主agent复核 |
| 2 补回归+URL边界 | 迟到授权/迟到照片/取消中切文件/连续点击:r3-contract契约3/4/5/6;URL释放不破坏展示中预览+原件字节不变+来源unverified:契约4(逐字节对比) | evidence/r3-tests-run.log |
| 3 MAIN替换映射 | MAPPING.md:十项职责对照、构造示例、挂断收据接线、集成测试入口`node test/run-r3.mjs`、continuous非默认、禁自动启用真实摄像头/音频、无上传 | SA-B交付 |
| 4 精确小屏 | **真Chrome+CDP Emulation**(真402×874/DPR3,390/360真实布局):11场景failedChecks=0;PNG物理尺寸=W×3校验;几何断言(超长提示不遮挡按钮=true) | evidence/headless-measure.json + screenshots/ |
| 5 挂断/返回总览收据 | buildResourceReceipt 15字段schema;挂断场景收据reason=hangup:micRequests 0/uploadsAttempted 0探针实测/danglingUrls 0/liveTracksAtEnd 0/urlsHeldAtEnd 0/stateAtEnd disposed/eventLog完整 | evidence/collected/r3-05-*.json |

## 3. 测试与验证(实测)

- **105/105,exit 0**(`node test/run-r3.mjs`,evidence/r3-tests-run.log):R2五文件96项经生成副本对R3控制器回归(语义差异0,唯一非行为差量=4处版本字面量,经协调者裁决以显式映射通过,regeneration-proof.json逐条计数并含裁决记录)+R3新契约9项(discardPreview契约/URL边界/取消中切文件/峰值流≤1/收据断言)。
- **压力覆盖完整执行**:stress-loop 42×2轮对R3全量运行(此前因版本断言中止的缺口已消除):peakLiveStreams=1、peakUrls=4(≤2组)、uploads=0、同seed重跑deepEqual一致。
- **headless矩阵**:11场景,断言含 realLayoutViewport/realDpr3/physicalSize/bodyFits/收据四零/长提示不遮挡,全过(evidence/headless-measure.json)。
- 中途发现并修复(壳层,控制器零缺陷):SA-A发现的4处fail=版本字面量(裁决处理);我自查3处:标题残留"R2"字样、长提示被动作报错覆盖(时序)、root重定向丢查询串(承R2修复继续完善)。控制器经SA-A独立复核**未发现行为缺陷**。

## 4. NOT TESTED(不冒称)

真机iOS Safari/Android Chrome;真实摄像头/麦克风硬件;软键盘推起与安全区实际可视高度;触摸实击(headless以DOM click驱动同一监听器,触控指针事件未仿真);HTTPS真机部署;语音/ASR(明确不属B,无假入口);上传/入库(下一Gate,uploadsAttempted由页面探针实测0,非控制器自证)。

## 5. 资源与清理

自有Chrome/服务进程全部关闭、临时profile已删;无残留监听;无新依赖;无Git写;未操作Codex;真实模型调用0、产品API付费0。

## 6. 移交MAIN

按MAPPING.md:版本断言0.3.0-r3-candidate→接线四回调+pagehide→挂断/返回总览用buildResourceReceipt收据→集成测试`node test/run-r3.mjs`一行复验。候选待Codex复验与用户视觉接受(visual_accepted=false不自评)。
