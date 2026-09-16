# CAMERA_READINESS｜设备原相机能力就绪度

## 已实现（本轮，全部本地、用户主动触发）

1. **能力检测（不申请权限）**：点击"检测本机拍照能力"后纯特性探测——文件输入（可用）/ getUserMedia / ImageCapture.takePhoto，逐项显示可用性。
2. **最小入口（渐进增强）**：`<input type="file" accept="image/*" capture="environment">` 系统拍照/选图；另有"从图库选择（来源未知）"入口。浏览器返回图库时如实标注"来源未知，未验证现场"，不写"已现场拍摄"。
3. **可选增强**：用户点击后 `getUserMedia({video:{facingMode:'environment'}, audio:false})` 仅申请视频轨道；`ImageCapture.takePhoto` 单次曝光得 Blob；**takePhoto 不可用时回退选图，不以 canvas 截帧冒充照片**。
4. **元数据展示**：实际文件名/字节数/类型/最后修改时间 + 来源方式三分（capture 提示 / 图库未知 / takePhoto）。
5. **资源释放**：取消/关闭/拍照完成/离开页面 → 停止全部轨道 + revoke 全部 object URL；"清除本地预览"按钮实测释放。
6. **边界标注**：面板显著注明"尚未入库，刷新或离开将清除；不上传、不入库、不提交模型；『原件』仅指本应用收到的文件，不证明设备/现场真实性"。

## 实测（桌面 Chrome 仿真 + 合成 File）

- 能力检测三项显示正确（evidence/screenshots）。
- 合成 File（DataTransfer 注入 533 字节 PNG）→ 本地预览 + 元数据正确 → 清除后预览消失（组件级实测）。
- 权限拒绝/取消/失败路径：代码路径实现（NotAllowedError/NotFoundError/通用错误各自提示）；**真实权限弹窗交互 NOT TESTED（无真机/真实相机授权环境）**。

## NOT TESTED / 未做

- 真机（手机）实拍：未测（无真机条件）。
- 手机局域网 HTTP 下 getUserMedia 的安全上下文限制：**未绕过、未测**（MDN：非安全上下文不可用；localhost 可用）。文档已注明。
- ImageCapture 在不同浏览器的实际支持差异：以运行时检测+回退处理，未逐浏览器实测。
- 照片入库（上传/持久化/提交模型）：**本轮明确不做**，需下一独立 Gate（存储、隐私、真实性标注）。

## 与视频会议的关系

相机面板与 RTC 会议 adapter **完全分离**：无视频 provider 不阻碍本地拍照入口；拍照不申请麦克风、不建立会议连接。
