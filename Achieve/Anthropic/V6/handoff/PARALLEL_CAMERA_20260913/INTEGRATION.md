# INTEGRATION｜设备拍照控制器接口冻结

- 批次：PARALLEL_CAMERA_20260913（B1）
- 接口版本：`CAMERA_CONTROLLER_VERSION = '0.1.0-candidate'`
- 状态：READY_FOR_REVIEW，本批文件冻结；接口调整须形成新批次，不边集成边改。
- 位置：`V6/handoff/PARALLEL_CAMERA_20260913/src/camera-controller.mjs`（核心）、`src/thumbnail.mjs`（浏览器默认解码/缩略图）
- 零第三方依赖；ES Module；浏览器与Node皆可加载（Node下默认浏览器能力为null并优雅降级）。

## 1. 快速接入

```js
import { CameraController, detectCapabilities } from '.../src/camera-controller.mjs';

const controller = new CameraController({
  onStateChange: (snapshot) => renderState(snapshot),   // {state, hasLiveStream, capabilities, activePreviewId, lastError}
  onPreview: (preview) => showLocalPreview(preview),    // 本地预览对象（见§5），不上传
  onError: (err) => showNotice(err.message),            // {code, message, fallbackHint?}
  onStream: (streamOrNull) => { videoEl.srcObject = streamOrNull; }, // 取景流交付/清空
});

// 进入页面：只做能力检测（不触设备）
const caps = detectCapabilities(); // {secureContext, getUserMedia, imageCapture, liveCameraSupported, takePhotoSupported}

// 用户点击“开启摄像头”
controller.openFromUserGesture();          // {ok:true,pending:true} | {ok:false,code,fallback?}
// 用户点击“拍照”（可增强路径）
controller.capture();
// 系统拍照/选图（渐进增强入口，capture提示仅记录不作出处证明）
await controller.acceptFile(file, { captureHint: { capture: 'environment' } });
// 关闭/释放
controller.closeStream();
controller.dispose();                      // 停全部轨道、撤全部URL；建议 pagehide 时调用
```

## 2. 构造依赖（全部可注入；显式传 `null` 一律禁用该项）

| 依赖 | 默认 | 说明 |
| --- | --- | --- |
| `mediaDevices` | `navigator.mediaDevices` | 需实现 `getUserMedia(constraints)` |
| `ImageCapture` | `globalThis.ImageCapture` | takePhoto增强构造器；null=禁用增强（回退选图） |
| `createObjectURL` / `revokeObjectURL` | `URL.*` | 预览URL登记表；控制器自创建自撤销 |
| `now` | `Date.now` | 时钟，用于 `receivedAt` 与预览ID |
| `decodeImageMetadata(blob)` | thumbnail.mjs默认实现 | 返回 `{width,height}` 或 `null`（未知） |
| `createThumbnail(blob)` | thumbnail.mjs默认实现 | 返回 `{blob,width,height}` 或 `null`（不可用） |
| `isSecureContext` | `globalThis.isSecureContext` | `false` 判定不支持直开摄像头 |
| `videoConstraints` | `{facingMode:'environment', width:{ideal:4096}, height:{ideal:4096}}` | 期望值非强制；设备可拒绝降级 |
| `onStateChange` / `onPreview` / `onError` / `onStream` | 无 | 回调（§4） |

默认请求约束恒为 `{ audio: false, video: {...} }`；调用方无法通过任何入口申请麦克风。

## 3. 方法与返回值

所有同步方法返回 `{ ok: boolean, code?: ErrorCode, pending?: boolean, fallback?: 'file_picker' }`。`acceptFile` 返回 Promise，resolve `{ ok:true, preview }` 或 `{ ok:false, code }`。

| 方法 | 允许的当前状态 | 成功效果 | 失败码 |
| --- | --- | --- | --- |
| `detectCapabilities()` | 任意 | 返回缓存能力，无副作用 | — |
| `openFromUserGesture(options?)` | idle/denied/error/preview(无流) | 发起getUserMedia→ready | `DISPOSED` `ALREADY_PENDING` `ALREADY_OPEN` `UNSUPPORTED`(fallback) |
| `cancelRequest()` | requesting | 立即回idle；迟到授权到货即停轨 | `DISPOSED` `NOT_PENDING` |
| `switchCamera(video?)` | 非requesting/capturing/disposed | 先停旧轨再请求新facingMode | `DISPOSED` `ALREADY_PENDING` `UNSUPPORTED` |
| `capture()` | ready 或 preview且流存活（含error后重试） | takePhoto→preview | `DISPOSED` `CAPTURE_IN_PROGRESS` `NO_STREAM` `IMAGECAPTURE_UNSUPPORTED`(fallback，不改状态) |
| `acceptFile(file, {captureHint}?)` | 除disposed外任意 | 构建本地预览→preview；作废在途takePhoto与未决摄像头请求 | `DISPOSED` `NOT_AN_IMAGE` `EMPTY_FILE` `PREVIEW_BUILD_FAILED` |
| `closeStream()` | 流存活或requesting | 停轨；无预览回idle、有预览停preview | `DISPOSED` `NOT_PENDING` `CAPTURE_IN_PROGRESS` `NO_STREAM` |
| `getPreview()` | 任意 | 最近预览对象或null | — |
| `getSnapshot()` | 任意 | 冻结快照 | — |
| `dispose()` | 任意（幂等） | 停全部轨道、撤全部URL、状态disposed | — |

文件校验：非Blob/`type`非`image/*`（空`type`放行并可能带`mime`警告）→`NOT_AN_IMAGE`；`size===0`→`EMPTY_FILE`。

## 4. 回调与快照

- `onStateChange(snapshot)`：状态每次迁移触发一次。快照 `{ state, hasLiveStream, capabilities, activePreviewId, lastError }`。
- `onPreview(preview)`：新本地预览就绪。**上一预览的URL已同时被撤销**，页面不得继续使用旧预览的`url`。
- `onError({code, message, fallbackHint?})`：`message`为可直接展示的中文；`fallbackHint==='file_picker'` 表示建议页面引导用户改用选图。
- `onStream(stream|null)`：取景流交付与清空；页面据此挂/卸 `<video>`（muted+playsinline）。

## 5. 本地预览对象（冻结字段）

```ts
{
  id: string,
  blob: Blob,              // 原始File/Blob，字节保持不变
  url: string|null,        // 指向原始字节的object URL，控制器拥有并负责撤销
  thumbnail: { blob, url, width, height } | null,  // 另建的有损缩略图，独立URL
  width: number|null,      // 解码失败=未知(null)
  height: number|null,
  mime: string,            // 取blob.type，可能为空串
  byteLength: number,
  sourceMethod: 'live_camera_takephoto' | 'file_picker',
  captureHint: { capture: string } | null,   // 仅记录<input capture>提示，非出处证明
  origin: 'live_camera_stream' | 'user_file_selection',
  capturedAt: null,        // 本轮不解析EXIF：拍摄时间恒为未知，不用本机时间冒充
  receivedAt: number,      // 注入时钟的接收时刻
  provenance: 'unverified',// 恒定：任何路径都不证明现场/设备真实性/未被上游修改
  warnings: string[],      // 'metadata_unavailable' | 'thumbnail_unavailable' | 'object_url_unavailable'
}
```

## 6. 状态机

状态：`idle → requesting → ready → capturing → preview`；异常终态 `denied / unsupported / error`（均可经显式用户动作离开）；`disposed` 唯一终态（一切操作no-op，迟到结果到货即清理）。

- `preview` 仅表示“最近一次交互产出了照片”；流是否存活看 `hasLiveStream`。
- `requesting` 可能永不返回（用户忽略权限弹框）：页面应以“取消/关闭”按钮调用 `cancelRequest()` 提供出路。
- 拒绝权限后不自动重试；仅显式再点击才允许再次请求。

## 7. 错误码

| code | 含义 | 页面建议 |
| --- | --- | --- |
| `UNSUPPORTED` | 非安全上下文或无getUserMedia | 提示改用选图（fallback=file_picker） |
| `NOT_ALLOWED` | 权限被拒/策略阻止 | 提示到系统/浏览器设置恢复，再显式点击 |
| `NO_DEVICE` / `DEVICE_BUSY` / `DEVICE_ABORTED` / `GETUSERMEDIA_FAILED` / `NO_VIDEO_TRACK` | 设备不可用/占用/中止/其他失败 | 可重试或改选图 |
| `ALREADY_PENDING` / `ALREADY_OPEN` / `CAPTURE_IN_PROGRESS` | 重复动作被合并 | 无需提示或轻提示 |
| `NO_STREAM` / `NOT_PENDING` | 操作前提不满足 | 检查按钮可用性 |
| `IMAGECAPTURE_UNSUPPORTED` | 浏览器无takePhoto | 引导选图（fallback=file_picker） |
| `CAPTURE_FAILED` | 拍照失败/空图 | 可重试；流保留 |
| `NOT_AN_IMAGE` / `EMPTY_FILE` | 文件校验失败 | 提示重新选择 |
| `PREVIEW_BUILD_FAILED` | 预览构建异常 | 提示重试 |
| `DISPOSED` | 已释放 | 禁用相关按钮 |

## 8. 所有权与清理责任（冻结）

控制器拥有并负责：MediaStreamTrack的stop、自己创建的全部object URL的撤销、最近一次预览的生命周期、迟到结果的即时清理。
页面拥有并负责：DOM（`<video>`/`<img>`元素）、`onStream(null)` 时清空 `videoEl.srcObject`、`pagehide`/离开时调用 `dispose()`、不撤销控制器的URL、预览被替换后不再使用旧`url`。
控制器承诺：不上传、不持久保存照片、不发模型、不录音、不联网；退出或释放后无任何残留设备占用。

## 9. 集成注意

- 本模块是独立拍照能力，与RTC会议adapter分离；无视频provider不阻碍选图入口。
- “capture=environment”只是提示：移动端可能直接调起系统相机，桌面/部分浏览器会忽略并显示普通选图；返回的File可能来自相册或截图，页面文案不得写“已现场拍摄”。
- 仅本地预览；刷新后预览丢失；入库/上传/隐私处理属下一独立Gate。
- `takePhoto` 分辨率是期望值，受设备支持约束；不承诺RAW或全分辨率。iOS Safari/Firefox 预期无 ImageCapture，自动走 `IMAGECAPTURE_UNSUPPORTED` 回退（详见 CAMERA_READINESS.md）。
