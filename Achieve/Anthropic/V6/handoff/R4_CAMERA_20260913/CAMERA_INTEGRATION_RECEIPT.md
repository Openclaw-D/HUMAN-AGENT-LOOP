# CAMERA_INTEGRATION_RECEIPT｜R4-B 相机接入回执

- 批次:R4_CAMERA_20260913;引用输入:**`B-camera-controller`**(MAIN integration-inputs/INPUTS.json)
- 回执时间:2026-09-13(见runtime文件生成时间)

## 1. 同一输入hash核对

| 项 | MAIN登记 | B实测 | 一致 |
| --- | --- | --- | --- |
| 产品控制器文件 | `lib/v5-preview/camera/camera-controller.mjs` | 同路径存在 | ✅ |
| 版本 | `0.3.0-r3-candidate` | 代码内常量一致 | ✅ |
| sha256 | `44695861628f47ef…`(前缀) | `44695861628f47efdf6c480fd41e14dee040a75b3bba3cd3c21ecfcb28cc8b8e` | ✅ |
| 与R3候选语义 | — | 剥离块注释逐行比较 **diff=0**(唯一差异为1行JSDoc) | ✅ |

## 2. 产品副本回归(DoD"105回归及产品接线证据")

- **直接以产品文件为被测对象**重跑R3全套105项:`tools/run-product-regression.mjs` → **105/105,exit 0**(`runtime/regression-product/summary.json`、`tap-output.log`)。

## 3. 运行时资源序列验证(挂断/取消/离页/选图/作废)——**部分BLOCKED**

产品入口 `http://localhost:3321/v5-preview/remote-session`(402×874 DPR3真仿真):

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 页面可达+真实布局 | ✅ clientWidth=402精确、无横向溢出、15按钮 | runtime/product-verify/measure-summary-*.json |
| `window.__CAMERA_TEST` 钩子 | ❌ **undefined** | 运行实例18个bundle chunk **0个**包含`__CAMERA_TEST`(扫描脚本输出见FINAL_REPORT §3);代码已入库(camera-panel.tsx:162)但**3321运行实例为旧build** |
| 由此 | 资源序列运行时验证(S5挂断收据/S8作废/计数器读取) **BLOCKED**:harness无法读取真实控制器计数;按约B不重启3321 | 阻塞解除=MAIN重建/重启3321后执行§4一条命令 |

未阻塞即已验证的产品事实:
- 页面加载**零gUM调用**、无隐形采集(能力检测按钮文案"不申请权限"与代码一致);
- 产品副本控制器行为与R3候选**语义完全一致**(105项含取消/挂断/离页/作废全部行为断言);
- 壳层虚拟设备全序列(挂断/取消/离页/选图/作废)在R3批11场景+R4 harness自测通过(S1零调用/S7持有/S8作废/S5挂断全零/S6离页无残留),**该证据属harness-selftest级,不替代产品**。

## 4. BLOCKED解除后MAIN/B复验命令(零代码改动,一条命令)

```bash
node V6/handoff/R4_CAMERA_20260913/tools/verify-product.mjs --entry "http://localhost:3321/v5-preview/remote-session" --inputs V6/handoff/R4_MAIN_20260913/integration-inputs --out product-post-rebuild
node V6/handoff/R4_CAMERA_20260913/tools/measure-viewport.mjs --entry "http://localhost:3321/v5-preview/remote-session" --viewports 402x874x3,390x844x3,360x800x3
```

预期:钩子出现后,P1(version/api)、P3(挂断收据经`__CAMERA_TEST.buildReceipt`)、S7/S8(若MAIN提供注入钩子)自动运行并断言四零;仍需真机的部分单列NOT TESTED。

## 5. 资源合同要点回执(挂断/取消/离页)

- 挂断=dispose全清(收据四零),非仅退出全屏;收缩视图零资源动作;作废=discardPreview撤URL且不冒认事实;摄像头仅本机用户显式动作;audio恒false;上传恒0(页面探针)。逐项判据见RESOURCE_AUDIT.md,产品运行时生效以§4复验为准。
