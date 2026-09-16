# STATUS｜R3-B 相机能力进入手机访谈,验证全过程资源边界

- 日期:2026-09-13 06:25+08:00(接手);截止 09:00
- 任务入口:`V6/ZCODE_R3_B_20260913.md`;前序:R2批次(READY_FOR_REVIEW,96/96,冻结只读)
- 状态:**READY_FOR_REVIEW — 已收束冻结**(顺序1–5全部完成;105/105测试全绿;headless矩阵11场景failedChecks=0;本批自本文件本次修改起冻结,续改须开新批次。晨报见MORNING_REPORT.md,接入映射见MAPPING.md,资源契约见EVENT_RESOURCE_CONTRACT.md)
- 写面:仅 `V6/handoff/R3_CAMERA_20260913/**`;R2批次与产品代码只读;产品由MAIN接。

## 接手口径

- 复用R2控制器(v0.2.0-r2-candidate, fd19c44a)为基线,R3副本升级 `0.3.0-r3-candidate`,新增增量保持最小:仅计划新增 `discardPreview()`(仅内容作废的明确契约:撤销预览URL、**流保持不变**、状态回ready(流存活)/idle),其余语义零变更;老测试语义预计无变更(如出现失败即为红旗,按DoD"禁止只改测试迎合错误"处理)。
- 交付:EVENT_RESOURCE_CONTRACT.md(事件→资源状态表)、MAPPING.md(camera-panel最小替换映射+集成测试入口)、控制器与测试(R2 96项回归+新增断言)、精确截图(Chrome headless `--window-size`=真实布局视口 + `--force-device-scale-factor=3`=真DPR3;390/360真实尺寸)、挂断资源收据JSON、manifest。
- 并发:默认2最多3子代理,限流退避。
- 自动化仅合成PNG与虚拟mediaDevices;不自动启用真实摄像头/音频;不上传;不触碰现有服务;真机/软键盘未测即NOT TESTED。

## Subagent分工(每文件唯一writer)

| Owner | 范围 | 独占文件 |
| --- | --- | --- |
| 主agent | 总控/控制器增量/壳钩子/headless矩阵/截图测量JSON/资源收据/整合冻结 | STATUS、src/*、tools/*、screenshots/*、evidence/browser-*、REPORT/MORNING_REPORT/MANIFEST |
| SA-A 测试 | 回归生成器+R2 96项对R3控制器回归+新增契约测试 | test/regression-generated/*(生成)、test/run-r3.mjs、test/r3-contract.test.mjs、evidence/r3-tests-run.log |
| SA-B 契约与映射 | 事件→资源契约表+camera-panel替换映射 | EVENT_RESOURCE_CONTRACT.md、MAPPING.md |
