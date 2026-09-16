# 并行任务B｜设备拍照控制器与本地预览

先完整读根AGENTS、V6/ZCODE_PARALLEL_20260913.md及返修文件C节。你是ZCode独立执行者；你不是唯一writer，不改其他任务成果。

## Objective / Ownership

产出可由现有响应式页面复用的独立拍照模块，不是第二套产品前端。**只写V6/handoff/PARALLEL_CAMERA_20260913/**。不得改产品页面/CSS/API/存储、不得使用现有用户浏览器标签或全局viewport。

## 实现边界

1. 默认idle，进入页面不请求摄像头/麦克风。功能检测只检测API/安全上下文，不能借检测启动设备。
2. 系统拍照/选图路径作为渐进增强：capture=environment提示不等于一定使用后摄；收到File来源不能证明现场拍摄。可选ImageCapture.takePhoto增强，不支持时明确回退，拒绝权限不循环弹框。
3. 提供可注入mediaDevices/ImageCapture/objectURL/时钟的控制器，生命周期至少含idle/requesting/ready/capturing/preview/denied/unsupported/error/disposed。显式用户动作才触发请求，默认audio=false；关页/取消/重试/设备切换正确停track、撤销URL，迟到权限结果也立即清理，双击不能开两组流。
4. 接收的原始File/Blob保持字节不变，缩略图另建；给出width/height、mime、byteLength、sourceMethod、receivedAt。读取不到的拍摄时间保持未知，不将本机时间当相机拍摄时间；不能用capture提示证明文件出处。
5. 接口候选 `detectCapabilities()`、`openFromUserGesture()`、`capture()`、`acceptFile(file)`、`dispose()`，通过回调向主页面返回本地预览对象。命名可微调，但须在INTEGRATION.md冻结明确输入/输出/错误/所有权与清理责任。
6. 不上传、不持久保存真实照片、不发模型、不录音，不集成RTC/3D。默认只本地预览，明确刷新可能丢失。不得将视频grabFrame结果冒充takePhoto或传感器RAW。

## 交付与验证

- src/控制器及极小standalone样例（仅模块测试壳，不复制项目主页面）。无需第三方依赖。
- 自动化使用假设备轨道、合成图像/File；实际物理相机不自行开启，真机交由用户主动测试。
- 必测无权限时零调用、明确开启、拒绝/取消、unsupported、重复点击、拍摄失败、dispose后迟到结果、换图释放、原字节与缩略图分离、URL/track全部释放。
- 对照官方文档记录安全上下文、系统选图和ImageCapture兼容限制；输出iOS Safari/Android Chrome/桌面浏览器待测矩阵，未实际测试不可填通过，不为测试开公网隧道/关安全限制。
- 若要运行样例仅本地动态端口，自有进程，不能重启3321/3399/3311。浏览器观测若需要共享窗口就留下主任务验收步骤，不抢控制。
- 提交测试原始日志、CAMERA_READINESS.md、INTEGRATION.md、STATUS/REPORT/MANIFEST。可交接标准为控制器与mock测试可运行，不冒称手机原相机真机通过。

完成READY_FOR_REVIEW后冻结，主任务负责接到真实页面。无需等待模型/案例任务，也不代替主任务修改圈选交互。
