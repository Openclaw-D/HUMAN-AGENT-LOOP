# REPORT｜并行任务B：设备拍照控制器与本地预览

日期：2026-09-13。执行者：ZCode（并行B独立任务）。写面：仅 `V6/handoff/PARALLEL_CAMERA_20260913/**`。

## 1. 概要

按 `V6/ZCODE_PARALLEL_B_CAMERA_20260913.md` 交付了可被现有响应式页面复用的独立拍照模块：可注入依赖的控制器、浏览器默认解码/缩略图实现、极小standalone样例（模块测试壳）、32项自动化测试（全绿）、本地样例服务工具与完整交接文档。全程未开启物理摄像头/麦克风、未上传任何照片、未调用任何模型（本轮真实模型调用数=0）。

## 2. 交付物

| 文件 | 说明 |
| --- | --- |
| `src/camera-controller.mjs` | 控制器：九态生命周期、五接口候选（detectCapabilities/openFromUserGesture/capture/acceptFile/dispose）+cancelRequest/switchCamera/closeStream/getPreview/getSnapshot；mediaDevices/ImageCapture/objectURL/时钟/解码/缩略图全部可注入 |
| `src/thumbnail.mjs` | 浏览器默认实现：createImageBitmap→OffscreenCanvas→DOM canvas 逐级回退；Node环境优雅返回null |
| `src/standalone/index.html` + `standalone-main.mjs` | 极小测试壳：中文界面、默认不请求设备、本地预览与元数据展示、“尚未入库/刷新丢失”声明、pagehide自动dispose；不复制项目主页面 |
| `test/camera-controller.test.mjs` | 28项控制器测试（假设备轨道+合成Blob） |
| `test/thumbnail.test.mjs` | 4项Node降级行为测试 |
| `tools/serve-standalone.mjs` | 仅127.0.0.1动态端口静态服务（只读、自清理），非产品代码 |
| `INTEGRATION.md` | 冻结接口：输入/输出/错误码/状态机/所有权与清理责任 |
| `CAMERA_READINESS.md` | 安全上下文、系统选图与ImageCapture限制；五平台待测矩阵（全部NOT TESTED）；真机验收清单 |
| `evidence/` | 测试原始日志×2、语法检查、服务冒烟日志、服务进程输出 |

## 3. 验证结果（实测）

- 自动化测试：**32/32 通过**（node v22.23.1, node:test, 零依赖）。原始日志：`evidence/node-test-run-2.log`（第一轮 `node-test-run-1.log` 记录了3处失败及修复前的真实状态）。
- 语法检查：6个mjs全部通过（`evidence/syntax-check.log`）。
- 样例服务冒烟（`evidence/serve-smoke.log`）：动态端口55005、PID 104660，页面与全部模块200且MIME正确（`text/javascript`保证ESM可用）、目录穿越被拒；进程已kill并确认无残留监听（NO_LISTENER_ON_55005）。第一轮冒烟（PID 103849）暴露路径守卫缺陷，修复后重测。
- 必测清单对照：无权限零调用✓ 明确开启✓ 拒绝/取消✓ unsupported✓ 重复点击（开/拍）✓ 拍摄失败✓ dispose后迟到结果（流/拒绝/照片三路）✓ 换图释放✓ 原字节与缩略图分离✓ URL/track全量释放✓ capture提示不作出处证明✓ 换设备停旧轨✓ 迟到权限静默✓。
- 浏览器内人工观测：未做（遵守“共享窗口留验收步骤、不抢控制”）；步骤见 `CAMERA_READINESS.md` §6。

## 4. 关键设计决定

1. **acceptFile使在途操作作废**：选图会让未决的getUserMedia与在途takePhoto立即作废（迟到流到货即停），语义为“后选文件优先”——与“迟到结果立即清理”一致，并杜绝双预览竞态。
2. **capture提示与出处分离**：`sourceMethod` 只记 `file_picker`/`live_camera_takephoto`；`captureHint` 单独记录且 `provenance` 恒为 `unverified`——任何路径都不声称“现场拍摄”。
3. **capturedAt恒null**：不解析EXIF（零依赖约束），读不到的拍摄时间保持未知，不用本机时间冒充。
4. **ImageCapture缺失→显式回退**：`capture()` 返回 `IMAGECAPTURE_UNSUPPORTED + fallback:'file_picker'` 且不改状态、不截帧冒充；`requesting` 永不返回（用户忽略弹框）由 `cancelRequest` 提供出路（MDN明确此可能）。
5. **显式null注入即禁用**：依赖解析用 `!== undefined` 判定，允许测试与受限环境强制关闭任一浏览器能力（首轮测试发现 `??` 会把null当缺失、且Node 22自带 `URL.createObjectURL`，已修正）。

## 5. NOT TESTED / 已知限制

- 真机/真实浏览器全路径未测：iOS Safari、Android Chrome、桌面浏览器矩阵见 `CAMERA_READINESS.md` §4（全部“待实测”，不填通过）。预期ImageCapture在iOS Safari与Firefox缺失→自动回退，此预期本身也未实测。
- 浏览器内真实画布缩略图路径（OffscreenCanvas/DOM canvas）未在真实浏览器验证；Node层已验证优雅降级。
- 不上传、不持久保存、不入库、不发模型、无RTC/3D；刷新丢失预览（已在界面声明）。
- 端口/进程清理：无残留（见§3冒烟记录）。

## 6. 给主任务的接手步骤

1. 读 `INTEGRATION.md`（接口已冻结）→ 在隔离目录跑 `node --test test/camera-controller.test.mjs test/thumbnail.test.mjs` 复验。
2. 接入页面：构造回调四件套（§4）→ 点击事件里调 `openFromUserGesture/capture/acceptFile` → `pagehide` 调 `dispose`。
3. 真机测试按 `CAMERA_READINESS.md` §6 清单执行并回填§4矩阵；HTTPS部署属后续Gate，由用户决定。
4. 本批次自STATUS置READY_FOR_REVIEW起冻结；映射或调整需求请走新批次，不直接改本目录交付。
