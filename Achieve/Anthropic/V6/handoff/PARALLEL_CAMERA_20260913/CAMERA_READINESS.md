# CAMERA_READINESS｜设备拍照能力就绪度（并行B，批次B1）

日期：2026-09-13。结论先行：**控制器逻辑层已就绪并经32项自动化测试（假设备/合成文件）；真机与真实浏览器行为全部未实测（NOT TESTED）**，待测矩阵见§4，真机验收步骤见§6。本文件不冒称手机原相机已通过。

## 1. 已核对的官方文档要点（2026-09-13）

- [MDN capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture)：`<input type="file">` 的 `capture` 属性**只是提示**（"optionally, a new file should be captured"），取值 `user`/`environment`；移动端更有意义，桌面通常退化为普通文件选择器；MDN标注"非Baseline、有限可用"。⇒ 控制器把capture仅作记录（`captureHint`），不用它证明文件出处。
- [MDN takePhoto](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto)：单次曝光，返回`Promise<Blob>`；`imageWidth/imageHeight` 只是期望值，设备只取最接近的离散档位；轨道非live时抛`InvalidStateError`。⇒ 控制器不承诺RAW/全分辨率，失败映射`CAPTURE_FAILED`，不支持时显式回退选图，绝不`grabFrame`截帧冒充。
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)：仅安全上下文可用（HTTPS/localhost）；非安全上下文`navigator.mediaDevices`为`undefined`；权限必须用户授予，**promise可能永不返回**（用户忽略弹框）；常见错误`NotAllowedError/NotFoundError/NotReadableError/AbortError`；切换facingMode前建议先`stop()`旧轨。⇒ 控制器实现`cancelRequest()`出路、`switchCamera()`先停旧轨、`denied`不循环弹框。

## 2. 安全上下文与局域网HTTP（重要）

- 手机通过 `http://192.168.x.x` 访问本机样例**不是安全上下文**，`navigator.mediaDevices` 将不存在，直开摄像头入口会进入 `unsupported` 并提示改用选图——这是浏览器安全边界，按约定**不开公网隧道、不关安全校验**绕过。
- 可用的合规途径（均属后续Gate，本轮未做）：真机用 `https` + 可信证书部署，或操作系统级"受信任的本地回环/开发域"方案；由用户决定后再实施。

## 3. 已实现并自动化验证的能力（假设备/合成文件）

见 `REPORT.md` 与 `evidence/node-test-run-2.log`：默认idle零调用、显式开启、拒绝/取消/不支持、双击合并、拍摄失败重试、dispose后迟到结果清理、换图释放、原字节与缩略图分离、URL/track全量释放、capture提示不作出处证明。

## 4. 待测矩阵（全部NOT TESTED——未经真实设备验证，不得填“通过”）

| 能力 | iOS Safari 15+ | Android Chrome | 桌面 Chrome/Edge | 桌面 Firefox | 桌面 Safari |
| --- | --- | --- | --- | --- | --- |
| 文件选择（accept=image/*） | 待实测 | 待实测 | 待实测 | 待实测 | 待实测 |
| `capture=environment` 调起系统相机 | 待实测（预期：可调起或出现“拍照/相册”选择） | 待实测（预期：调起后摄意图） | 待实测（预期：忽略提示，普通选图） | 待实测（预期：忽略提示） | 待实测（预期：忽略提示） |
| 安全上下文判定（HTTP局域网→unsupported提示） | 待实测 | 待实测 | 待实测 | 待实测 | 待实测 |
| getUserMedia 直开摄像头 | 待实测（预期：可用，需HTTPS） | 待实测（预期：可用，需HTTPS） | 待实测（预期：可用） | 待实测（预期：可用） | 待实测（预期：可用） |
| `ImageCapture.takePhoto` 增强 | 待实测（**预期：不可用**→自动回退选图） | 待实测（预期：可用；Chromium系） | 待实测（预期：可用） | 待实测（**预期：不可用**→回退选图） | 待实测（**预期：不可用**→回退选图） |
| 拒绝权限→denied不循环 | 待实测 | 待实测 | 待实测 | 待实测 | 待实测 |
| 切换前后摄（switchCamera停旧轨） | 待实测 | 待实测 | 待实测 | 待实测 | 待实测 |
| 缩略图生成（OffscreenCanvas/DOM canvas回退） | 待实测（预期：iOS 16.4+走OffscreenCanvas，更早走DOM canvas） | 待实测 | 待实测 | 待实测 | 待实测 |
| 大照片（>10MB）字节不变与预览性能 | 待实测 | 待实测 | 待实测 | 待实测 | 待实测 |

注：§4“预期”列来自§1官方文档与公开实现的通识，仅作测试关注点，不构成已验证结论；以MDN live兼容表与实测为准。

## 5. 已知限制（如实声明）

- 本轮不解析EXIF：拍摄时间恒为未知（`capturedAt: null`），不用本机时间冒充。
- 缩略图输出JPEG：有损、丢alpha通道；仅作列表缩略展示。
- “原件”仅指应用收到的文件字节；不证明设备真实性、现场真实性或未被上游修改（`provenance: 'unverified'`）。
- `requesting` 可能因用户忽略权限弹框而长期停留：页面必须提供取消按钮（样例“关闭摄像头”即此出路）。
- 未配置/不支持的提示已明确（`UNSUPPORTED`+中文文案+回退建议），但真实设备上的具体呈现未实测。

## 6. 用户真机手动验收清单（建议脚本，需HTTPS环境）

1. 打开样例页（HTTPS）：确认状态“待机”、能力检测JSON正确、**未出现任何权限弹框**。
2. 点“选择文件”：Android预期调起相机/相册意图；iOS预期相机/相册选项；桌面预期普通选图。选一张照片：确认尺寸/字节/来源方式显示、出处为“未验证”。
3. 点“开启摄像头”（HTTPS下）：接受权限→取景画面出现、状态“ready”；拒绝权限→状态“denied”、提示一次、**不再反复弹框**。
4. “拍照”（支持的浏览器）：照片出现且字节/尺寸合理；“拍照”在iOS Safari/Firefox预期提示“不支持takePhoto，请改用选择文件”。
5. “关闭摄像头”：指示灯/状态条消失；“释放全部”：状态“disposed”。刷新页面：预览丢失（符合声明）。
6. 对照§4矩阵逐格记录实测结果；任何一格未测即保持“待实测”。
