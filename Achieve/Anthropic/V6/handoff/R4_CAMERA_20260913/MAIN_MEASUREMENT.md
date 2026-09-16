# MAIN_MEASUREMENT｜MAIN可复用的精确viewport量测方法(不装依赖、不抢端口)

受众:MAIN。R4要求产品证据与独立壳证据分开——**独立壳11场景通过不能替代产品**;本文给MAIN在自己产品页上复现"真实布局402×874/DPR3(390/360真实尺寸)"的量测方法与现成工具。

## 1. 为什么不能用窗口缩放或图片缩放

- Windows下Chrome/Edge窗口有最小宽度钳制(实测约486px):`--window-size=402,874`在**非headless**或某些环境下实际布局视口被抬到486,`document.documentElement.clientWidth===486≠402`——R3曾据此否决窗口法。
- 截图缩放只改像素尺寸,不改CSS布局;`clientWidth`/`matchMedia`仍暴露真实值。R4验收以**页面实测**为准:`clientWidth===402`、`devicePixelRatio===3`、截图物理尺寸=402×3。
- 结论:用CDP `Emulation.setDeviceMetricsOverride`(Playwright同源机制),Node 22内置WebSocket即可驱动,**零新依赖**。

## 2. 现成工具(B交付,MAIN直接用)

```bash
# 三viewport按钮可见量测(402x874x3默认,可--viewports 390x844x3,360x800x3)
node V6/handoff/R4_CAMERA_20260913/tools/measure-viewport.mjs --entry <产品URL> --viewports 402x874x3,390x844x3,360x800x3
# 产品资源序列验证(挂断/取消/离页/选图/作废...)
node V6/handoff/R4_CAMERA_20260913/tools/verify-product.mjs --entry <产品URL> --inputs <R4_MAIN integration-inputs批次目录>
```

- 工具输出到本批 `runtime/product-verify/`(带evidenceClass字段区分harness-selftest/product),MAIN可直接读取,也可把工具拷入R4_MAIN自跑(不回写B冻结件)。
- 端口纪律:Chrome用`--remote-debugging-port=0`自动分配;不触碰3311/3321/3399;只结束自己启动且记录PID的进程。

## 3. MAIN自跑最小脚本(若无B工具在手边)

要点(约20行,Node 22+本机Chrome):
1. `chrome --headless=new --user-data-dir=<临时> --remote-debugging-port=0 about:blank`;
2. 读 `<profile>/DevToolsActivePort` 首行端口,`fetch('/json/version')` 取 `webSocketDebuggerUrl`;
3. `new WebSocket(wsUrl)` → `Target.createTarget` → `Target.attachToTarget{flatten:true}` → `Emulation.setDeviceMetricsOverride{width:402,height:874,deviceScaleFactor:3,mobile:true}` → `Page.navigate` → `Page.captureScreenshot`;
4. 页面内量测用 `Runtime.evaluate` 读:`innerWidth/clientWidth/devicePixelRatio/visualViewport.height`、每个关键按钮的 `getBoundingClientRect()`(挂断按钮须 `y+height ≤ visualViewport.height` 即首屏常可见);
5. 断言:`clientWidth===402 && devicePixelRatio===3 && 截图IHDR宽===1206`。

完整参考实现:`tools/measure-viewport.mjs`(B独占写面,MAIN只读)。

## 4. 证据分级规则(产品 vs 独立壳)

| evidenceClass | 靶 | 效力 |
| --- | --- | --- |
| `product`(须带MAIN inputs批次号+hash) | 产品入口URL | 正式验收证据 |
| `harness-selftest` | R3独立壳 | 仅证明harness自身可用,**不得**写入产品验收材料 |

MAIN在FINAL_REPORT引用产品量测时必须附:输入包编号、hash、命令行、`evidenceClass:"product"`的summary.json。

## 5. 真机边界(单列,不冒称)

本方法全部为桌面Chromium仿真:真机iOS Safari可视高度(工具栏/安全区)、软键盘推起、触摸实击未测;真机由用户主动验证。仿真结论不得写"真机通过"。
