# FINAL_REPORT｜R4-B 把R3相机成果验到产品上

日期:2026-09-13。执行:ZCode主agent(Subagent SA-A中途模型请求失败→主agent接管收尾;并发≤1)。写面:仅 `V6/handoff/R4_CAMERA_20260913/**`。

## 1. 结论

1. **升级delta交付**:UPGRADE_DELTA.md——产品0.2.0→候选0.3.0最小升级(换1文件+4处接线+1行测试钩子),含精确版本/hash、discardPreview/资源计数/收据的接线位置与MAIN自验命令。
2. **产品副本回归全绿**:直接以MAIN集成的 `lib/v5-preview/camera/camera-controller.mjs`(hash `44695861628f47efdf6c…`,与INPUTS登记一致)为被测对象跑R3全套105项 → **105/105,exit 0**;与R3候选剥离块注释逐行比较**语义差异0**(唯一差异1行JSDoc)。
3. **资源合同与审计**:EVENT_RESOURCE_CONTRACT(R3)的产品接线审计版RESOURCE_AUDIT.md(A挂断真实释放/B收缩≠离开/C作废撤URL不冒认/D本机用户主动/E audio与upload恒0/F终结判据表)。
4. **精确量测方法工具化**:verify-product.mjs(产品/壳两用资源序列harness,CDP真仿真)+measure-viewport.mjs(三viewport真布局按钮可见量测)。MAIN一条命令即可复验(见CAMERA_INTEGRATION_RECEIPT §4)。
5. **回归runtime化**:run-r4-regression.mjs修复"测试运行器污染冻结evidence"——输出仅进本批runtime/,归一化文件双轮sha256一致(r4StableHash identical),R3冻结证据before/after根hash逐一比对"PASS: frozen evidence untouched"(evidence/regression-frozen-proof.json)。亲跑复验105/105第三次通过。

## 2. BLOCKED(真实阻塞,非B可解)

**3321运行实例为旧build,产品运行时资源序列验证被阻**:
- 现象:产品页可达、面板按钮已渲染,但 `window.__CAMERA_TEST===undefined`;
- 取证:`http://localhost:3321` 页面引用的18个/_next/ chunk 全量抓取,含`__CAMERA_TEST`者**0个**;而源码camera-panel.tsx:162已含该钩子 → 运行实例bundle落后于当前源码;
- 按R4契约"禁止终止/重启/删除3311/3321/3399实例",B不重启;
- 解除=MAIN重建/重启3321后运行CAMERA_INTEGRATION_RECEIPT §4两条命令(零代码改动);届时S5挂断收据/S8作废/P1版本API自动断言,仍不可自动化处(真实设备)单列NOT TESTED。

## 3. DoD对照

| DoD | 状态 |
| --- | --- |
| 105回归及产品接线证据 | ✅ 105/105对产品文件(runtime/regression-product)+接线审计(camera-panel.tsx:7-13,123,149,157-173,281)+UPGRADE_DELTA |
| 同一MAIN输入hash的CAMERA_INTEGRATION_RECEIPT | ✅ 引用`B-camera-controller`登记hash前缀并全hash核对一致 |
| 三viewport按钮可见量测 | ✅ 工具化(measure-viewport.mjs);产品402实测(15按钮/无横向溢出);390/360在壳层自测通过,**产品**三视口复跑随§2解除一并执行(挂断首屏断言需面板激活) |
| 原件字节hash一致 | ✅ 契约测试+壳harness(合成PNG SHA-256前后一致);产品运行时复验随§2 |
| 真实硬件/Safari/键盘 | NOT TESTED单列(MORNING/REPORT末节) |

## 4. 挂断/取消/离页验证状态明细

| 序列 | 壳层(R3壳+harness,虚拟设备) | 产品(3321) |
| --- | --- | --- |
| idle零调用/零隐形采集 | ✅ | ✅(页面加载零gUM,产品副本语义一致) |
| 拍照成功/失败 | ✅(合成注入) | ⛔ BLOCKED(旧build无钩子;且需虚拟/真实设备,真实设备禁用) |
| 授权迟到/取消 | ✅ | ⛔ BLOCKED(同上) |
| 挂断收据四零 | ✅(reason=hangup实测) | ⛔ BLOCKED(同上;接线代码已审计通过) |
| 离页无残留 | ✅(S6复进新实例) | ⛔ BLOCKED(同上) |
| 选图/预览作废 | ✅ | ⛔ BLOCKED(同上) |

## 5. 边界与清理

无新依赖;无Git写;未操作Codex;未触碰3311/3321/3399(仅HTTP读取3321页面与chunk);本轮自有Chrome进程均已终止、临时profile已删;真实模型调用0、产品API付费0。真机iOS Safari/Android、真实硬件、软键盘、HTTPS部署=NOT TESTED,待用户主动验证。
