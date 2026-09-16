# MAPPING｜v0.1.0→v0.2.0 相机接口差异与主任务接入映射

- 批次：R2_CAMERA_20260913（SA5 集成映射，本文件唯一writer）。
- 只读输入：`V6/handoff/PARALLEL_CAMERA_20260913/INTEGRATION.md` 与 `REPORT.md`（v0.1.0冻结接口与能力）；`V6/CODEX_REVIEW_FOUR_TASKS_20260913/REPORT.md` B节；`V6/ZCODE_R2_B_20260913.md`；`V6/ZCODE_FOUR_TASKS_ROUND2_20260913.md`；本批 `STATUS.md`。
- 目标版本：`CAMERA_CONTROLLER_VERSION = '0.2.0-r2-candidate'`（SA1在本批实现中；错误名→错误码的精确对应以实现与测试为准，语义级口径以本文为准）。
- 旧批次（v0.1.0-candidate，32/32）冻结只读。**主任务接入一律按 v0.2.0 口径接线，不得照抄 v0.1.0 文档默认行为。**
- 验收报告B节两个前提：①旧版"拍照成功后track仍live直到dispose"与父契约"拍完后关闭"冲突，v0.2.0默认single修复；②主任务已有camera-panel，**不等于已接入B模块**——本文件即接入桥梁。

## 1. 差异表：v0.1.0 → v0.2.0

### 1.1 语义变化与新增项

| # | 类型 | v0.1.0 | v0.2.0-r2-candidate | 受影响的旧调用代码 |
| --- | --- | --- | --- | --- |
| 1 | 语义变化·拍照后轨道 | 拍照成功后流保留，可连续`capture()`（旧test 24即此期望，被验收probe复现为缺陷） | 默认`captureMode:'single'`：拍照**成功或失败**后立即停轨+`onStream(null)`；preview态下再调`capture()`返回`NO_STREAM`；再拍须重新`openFromUserGesture()` | 旧"拍完可连续capture"的页面/测试序列失效：第二次`capture()`将得`NO_STREAM`。改为每次重新开启，或显式传`captureMode:'continuous'` |
| 2 | 新增构造依赖 `captureMode` | 无此依赖 | `'single'`（默认）｜`'continuous'`（显式opt-in，保留v0.1.0连续语义，开启期间UI须有持续"摄像头开启中"提示） | 依赖连续拍摄的旧页面必须在构造时显式传`'continuous'`；缺省行为已改变 |
| 3 | 新增构造依赖 `requestTimeoutMs` | `requesting`可能永不返回（用户忽略权限弹框），仅`cancelRequest()`可退出 | 默认45000ms，传`null`禁用；getUserMedia超时自动取消→state回`'idle'`+错误码`REQUEST_TIMEOUT` | 旧页面若假设"用户忽略弹框则一直requesting、只靠cancelRequest收尾"，现在45秒后自动回idle；UI须处理该超时分支 |
| 4 | 新增错误码 `REQUEST_TIMEOUT` | — | 见#3 | 错误码→文案表须补充（见§2.5） |
| 5 | 新增错误码 `TRACK_ENDED` + 外部轨道结束语义 | 未冻结（轨道被外部stop后行为未定义） | 设备断开/系统回收→`onError({code:'TRACK_ENDED'})`、state回`'preview'`(有预览)/`'idle'`、`onStream(null)`、资源清理 | 页面不能再假定流存活直到主动closeStream；须同时监听`TRACK_ENDED`与`onStream(null)`刷新UI |
| 6 | 语义变化·getUserMedia同步throw | 同步异常可能冒泡为页面未处理异常 | 按错误名映射：`NotAllowed/Security`→denied；`NotFound/NotReadable/Abort`→error（沿用对应错误码）；其他→error `'GETUSERMEDIA_FAILED'` | 页面可去掉自行try/catch包装；失败统一经`onError`回调感知 |
| 7 | 语义变化·takePhoto同步throw | 未定义/可能冒泡 | 归入`'CAPTURE_FAILED'`路径；single模式下失败同样关轨 | v0.1.0错误码表"CAPTURE_FAILED：流保留可重试"的文案失效——single模式失败后须重新开启才能再拍 |
| 8 | 新增方法 `getResourceUsage()` | — | 返回`{state, captureMode, liveTracks, urlsHeld}`；调试/验收用 | 无破坏；主任务与验收用它做泄漏复核（见§5），不必自建探针 |

### 1.2 不变项（接线可直接按v0.1.0 INTEGRATION.md §3–§8理解）

五接口候选（detectCapabilities / openFromUserGesture / capture / acceptFile / dispose）；九态；`audio`恒false；无权限零调用；双击合并；拒绝后不自动重试；`acceptFile`作废在途拍照与未决请求；换图释放旧URL；`dispose`幂等全清；`IMAGECAPTURE_UNSUPPORTED`显式回退选图；`capturedAt`恒`null`；`provenance`恒`'unverified'`；回调四件套（onStateChange/onPreview/onError/onStream）；预览对象冻结字段与所有权划分（控制器管track/URL，页面管DOM与`onStream(null)`清空、pagehide→dispose）。

## 2. 主任务接入映射（面向camera-panel）

### 2.1 构造回调四件套接线

```js
import { CameraController } from 'V6/handoff/R2_CAMERA_20260913/src/camera-controller.mjs';

const controller = new CameraController({
  // captureMode: 'single',       // 默认即single，可省略；连续模式才显式传'continuous'
  // requestTimeoutMs: 45000,     // 默认45s；传null禁用
  onStateChange: (s) => renderState(s),            // {state, hasLiveStream, capabilities, activePreviewId, lastError}
  onPreview: (p) => showPhoto(p),                  // 新预览；旧预览URL已被控制器撤销，页面不得再使用旧p.url
  onError: (e) => showNotice(e.code, e.message, e.fallbackHint),
  onStream: (stream) => { videoEl.srcObject = stream; }, // stream===null 即清空取景（single模式触发频繁，必接）
});
window.addEventListener('pagehide', () => controller.dispose());
```

接线处建议断言 `CAMERA_CONTROLLER_VERSION === '0.2.0-r2-candidate'`，防止误接旧批次模块。

### 2.2 按钮→方法映射

| 页面入口 | 方法 | v0.2.0注意 |
| --- | --- | --- |
| 进入页面（加载时） | `detectCapabilities()` | 只读无副作用；unsupported→直接只展示选图入口 |
| 开启摄像头 | `openFromUserGesture()` | 必须在用户点击事件内调用 |
| 拍照 | `capture()` | single模式一次有效；成功/失败后流即关 |
| requesting中的"取消" | `cancelRequest()` | 45s超时也会自动取消（REQUEST_TIMEOUT），两者共存 |
| 选图（`<input type=file capture=environment>`） | `await acceptFile(file, {captureHint})` | 作废在途拍照与未决开启请求；仅本地预览 |
| 前后摄切换 | `switchCamera()` | 仅非requesting/capturing/disposed |
| 关闭取景 | `closeStream()` | single模式拍完已自动关轨，按钮按态禁用 |
| 离开页面 | `dispose()` | pagehide义务；幂等 |
| 调试/验收面板 | `getResourceUsage()` | v0.2.0新增 |

### 2.3 single模式UI流程变化（拍完自动关轨后的"再拍"入口）

开启→`onStream(stream)`取景→点拍照→`onPreview(照片)`+`onStream(null)`（取景区收起、显示成片预览）→主按钮变"重新开启再拍"→用户点击→`openFromUserGesture()`再开。要点：
- 状态为`preview`(无流)时`openFromUserGesture()`本就允许（v0.1.0已定义），single模式正好落在此路径；已授权设备通常不再弹权限框，但**仍须显式用户点击，不得自动重开**。
- 流关闭后"拍照"按钮应置灰（preview态`capture()`→`NO_STREAM`），突出"再拍/重新开启"，不要弹错误提示。
- `closeStream()`按钮在无流时禁用；成片预览与取景区在UI上明确区分（流是否存活看`hasLiveStream`）。

### 2.4 continuous模式：显式开关+持续提示义务

- `captureMode`是构造依赖：由页面开关在**构造前**决定；运行时切换模式= `dispose()`旧实例+按新模式重建，不可假设运行时可改。
- 显式opt-in：不得默认连续；开关须用户主动操作（如"连续拍摄"toggle），默认回single。
- 开启期间UI须有**持续**"摄像头开启中"提示（常驻角标/红点+文字），不得只在开启瞬间提示一次。

### 2.5 错误码→界面文案建议表（含新增两码）

| code | 文案建议（控制器`message`可直接展示，以下为建议口径） |
| --- | --- |
| `REQUEST_TIMEOUT`（新） | "开启摄像头超时（约45秒无响应），已自动取消。可重试，或改用相册选图。" |
| `TRACK_ENDED`（新） | "摄像头连接已断开（设备被移除或系统回收）。如需继续拍摄，请重新开启。" |
| `NOT_ALLOWED` | "摄像头权限被拒绝。请在系统/浏览器设置中允许后，再次点击开启。"（不自动重试） |
| `UNSUPPORTED` | "当前环境不支持直接调用摄像头，请改用选图。"（fallback=file_picker） |
| `NO_DEVICE` / `DEVICE_BUSY` / `DEVICE_ABORTED` / `GETUSERMEDIA_FAILED` / `NO_VIDEO_TRACK` | "摄像头不可用或被占用，可重试或改用选图。" |
| `IMAGECAPTURE_UNSUPPORTED` | "此浏览器不支持增强拍照，请改用选图。"（不改状态、不截帧冒充） |
| `CAPTURE_FAILED` | single模式注意流已关："拍照失败，摄像头已关闭。点击重新开启后可再拍。"（v0.1.0"流保留可重试"文案不再适用） |
| `NO_STREAM` | 按钮态问题：拍照时流未开启。single模式多为"拍完再点拍照"，应置灰按钮而非弹错。 |
| `ALREADY_PENDING` / `ALREADY_OPEN` / `CAPTURE_IN_PROGRESS` | 双击合并，轻提示或忽略 |
| `NOT_AN_IMAGE` / `EMPTY_FILE` / `PREVIEW_BUILD_FAILED` | "文件无法使用，请重新选择。" |
| `NOT_PENDING` | 检查按钮可用性（如取消按钮） |
| `DISPOSED` | 已释放：禁用相关按钮 |

### 2.6 pagehide→dispose义务

`window.addEventListener('pagehide', () => controller.dispose())`；页面不得自行撤销控制器的object URL；`onStream(null)`时清空`video.srcObject`；预览被替换后不再使用旧`url`。

### 2.7 iframe / embed 的 Permissions-Policy 注意（验收项）

- getUserMedia硬前提：安全上下文（HTTPS或localhost）。
- 主任务页面若以iframe嵌入拍照组件且与父页**跨域**，父级iframe标签必须加 `allow="camera"`，否则getUserMedia被策略阻止（NotAllowed→denied）。同源iframe也建议显式声明。
- 嵌入到第三方站点演示时，还需确认对方未以Permissions-Policy头禁用camera。

## 3. 不属本轮的接口提案（不得假装存在）

- **语音输入/ASR**：协调入口明确"语音输入是核心要求，但B不擅自增加录音/ASR"，属后续接口提案。本模块`audio`恒false、无任何录音路径；UI不得出现"语音输入已支持"的假入口或假文案。
- **RTC会议adapter**：本模块是独立拍照能力，与会议音视频分离；无视频provider不阻碍选图入口。不得把拍照流复用为会议流。
- **上传/入库/持久化**：仅本地内存预览，刷新丢失；入库、上传、EXIF出处分析属下一独立Gate。`provenance`恒`'unverified'`，页面文案不得写"已现场拍摄"（capture提示仅记录）。

## 4. 真机边界

- 仿真基准：iPhone 17标准版竖屏 **402×874 CSS px、DPR3**；390×844与360×800仅较窄屏回归；不采用Pro Max。
- **NOT TESTED**：真机Safari实际可视高度（工具栏/安全区）、软键盘推起、iOS/Android真机全路径、ImageCapture缺失回退的实机表现。所有真机项在验收单保持NOT TESTED，不填通过。
- HTTPS部署属后续Gate，由用户决定；**不得为测试开隧道**（无ngrok等公网暴露）。

## 5. 集成验收清单（主任务逐项勾选用）

隔离复跑（在本批目录 `V6/handoff/R2_CAMERA_20260913` 下，不占用3321/3399/3311端口）：

- [ ] `node --test test/camera-controller.test.mjs`（SA1 状态机/生命周期）
- [ ] `node --test test/resource-tracking.test.mjs`（SA2 资源零泄漏）
- [ ] `node --test test/adversarial.test.mjs`（SA3 对抗：永不resolve/同步throw/外部ended/慢decode/dispose竞态）
- [ ] 三文件全绿，且模块版本号 = `0.2.0-r2-candidate`

浏览器与截图核对：

- [ ] 本地静态服务打开 `src/standalone/index.html`，以402×874视口目视核对布局与中文提示
- [ ] `screenshots/`核对：原图尺寸字节、独立缩略图、取消与错误状态截图真实且与声明一致

资源零泄漏复核（`getResourceUsage()`与注入注册表并用或二选一）：

- [ ] `closeStream()`/`dispose()`后 `getResourceUsage().liveTracks === 0 && urlsHeld === 0`
- [ ] 注入自管 `createObjectURL`/`revokeObjectURL` 注册表：创建数=撤销数；MediaStreamTrack用假设备轨道统计stop调用次数

行为项：

- [ ] single：拍照成功与失败均收到`onStream(null)`，`video.srcObject`已清；"再拍"走`openFromUserGesture()`
- [ ] preview态`capture()`返回`NO_STREAM`（或按钮已置灰不触发）
- [ ] `requestTimeoutMs`到期→idle+`REQUEST_TIMEOUT`；`cancelRequest()`仍可用
- [ ] 外部stop轨道→`TRACK_ENDED`+`onStream(null)`+状态回preview(有预览)/idle
- [ ] pagehide→dispose；重复dispose幂等；dispose后一切操作no-op且无残留
- [ ] iframe嵌入时`allow="camera"`已配置（如适用）
- [ ] 真机相关项一律标NOT TESTED，不冒称通过

——完成即停。本文件不写代码、不改其他文件；接入实施由主任务按本文口径执行。

## 6. 增补（2026-09-13 04:20+08:00，主agent接管增补，SA5原批次内容未改动）

### 6.1 “预览待保存”状态语义与资源责任

- `state==='preview'` 即“预览待保存”：照片仅存在于页面内存（Blob+object URL），**未入库、未上传、刷新即失**（`evidence/browser-step02-hash-check.json` 为证）。主任务接入后应把该状态视为“待用户显式提交/入库”，不得在未接入库Gate前展示“已保存”类文案。
- 资源责任：`preview.blob/url/thumbnail.url` 由控制器拥有并在替换/释放时撤销；页面只负责展示与“不再使用旧url”。若主任务需要把照片带入自己的提交流程，应在**当次页面生命周期内**读取字节（`await preview.blob.arrayBuffer()`）自持副本，不得长期持有控制器URL。
- 用户离开（pagehide）或“释放全部”=放弃该待保存预览：页面须提前提示“刷新/离开将丢失”，测试壳已实现此声明。

### 6.2 嵌入与展开收起保持状态（已在真实浏览器验证）

- 模块是纯逻辑+回调，不持有DOM：宿主页面的任何展开/收起（面板折叠、抽屉、分栏切换）都不会影响控制器状态与预览；收起不应卸载 `<img>`/`<video>` 的DOM节点（用CSS隐藏而非移除），即可天然保持 `src` 与滚动位置。
- 测试壳已按此实现并验证：收起/展开原件区后 `img.src` 不变、图像仍可解码（naturalWidth=800）、哈希行保留（`evidence/browser-step03-collapse-state.json`、`screenshots/03-preview-collapsed.png`）。

### 6.3 远程控制非授权声明

- 本模块只操作**本机**设备：不存在、也不得添加任何对客户/对端设备画面的远程控制路径；`onStream` 交付的流仅来自本机 `getUserMedia`，选图文件仅来自本机用户选择。主任务访谈页若展示客户画面，属RTC会议adapter域（另一体系），不得把本模块流复用为客户画面来源。

### 6.4 验收清单文件更新（替代§5前三项勾选）

- [ ] `node --test test/camera-controller.test.mjs test/resource-tracking.test.mjs test/adversarial.test.mjs test/stress-loop.test.mjs test/metadata-integrity.test.mjs`（五文件合跑，R2批内证据：`evidence/full-regression.log`；SA6单批四文件合跑70/70见`evidence/stress-metadata-run.log`）
- [ ] 五文件全绿，且模块版本号 = `0.2.0-r2-candidate`
