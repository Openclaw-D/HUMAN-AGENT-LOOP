# R3-B-INT-NOTES｜相机面板接入 CameraController（R2_CAMERA v0.2.0-r2-candidate）

- 子代理：R3-B-INT（夜间实现），工作目录 `jianwei-v3/site/`。
- 冻结件来源：`V6/handoff/R2_CAMERA_20260913/src/`（camera-controller.mjs + thumbnail.mjs）。
- 拷贝校验：SHA-256 与候选逐字节一致
  - camera-controller.mjs `fd19c44a532239ed029e47264f123e8d28e4406c11ebf24a9de523c4b6e7a272`
  - thumbnail.mjs `8722747b7a560f73dcf72120accd658310419590df6ea0ad07fdad786c6f042e`

## 1. 接入方式（一句话）

手写 getUserMedia/takePhoto 全部淘汰，`camera-panel.tsx` 只经 `lib/v5-preview/camera/camera-controller.mjs` 的 `CameraController`（静态 import `.mjs`，allowJs 推断类型，零 @types 包、零 `@ts-expect-error`）；控制器拥有全部 track/URL，页面只做 `onStream(null)`→清空 video、`pagehide`→`dispose()`、重建（dispose+new）三件事。

## 2. 语义映射表（P2：lifecycle 标注 + 资源责任）

| 用户事件 / 页面事件 | lifecycle 标注 | 面板行为与资源责任 |
| --- | --- | --- |
| 预览就绪后点"保留这张（确认保留）" | `capture_confirmed` | 显示保留；URL 仍由控制器持有；仅本地内存，尚未入库、不上传 |
| requesting 中点"取消开启（不等待授权）"；未确认预览被新拍摄/选图取代 | `user_cancelled` | 迟到授权流由控制器立即停轨；被取代预览的 URL 由控制器在替换时撤销 |
| 点"清除本地预览（释放内存）"；已确认照片被新拍摄替换；切换连续/单次模式释放旧预览 | `discarded`（证据作废/清除） | dispose 旧实例+重建：停全部轨道、撤销全部 URL，资源清零 |
| 点"挂断并释放全部（停轨+撤 URL）"；pagehide；组件卸载 | `session_hangup`（挂断/离页自动释放） | `dispose()` 幂等全清（轨道+URL+预览） |
| 面板"收起/展开" | （无生命周期变化） | `hidden` 属性仅隐藏界面：不停轨、不释放预览、DOM 不卸载（MAPPING §6.2） |

当前预览在终端态前显示"待用户确认（尚未入库、不上传）"中间态；生命周期记录（含四标注中文+英文键）只存面板内存，刷新即失。UI 常驻"摄像头开启中（视频轨道存活）"持续提示（收起时也可见），状态行显示 控制器状态/轨道存活/预览决策。

## 3. 行为契约落实（Codex P2 / MAPPING 口径）

- **拍完默认关轨**：控制器按 `captureMode:'single'` 构造（默认），拍照成功/失败均自动 `onStream(null)`+停轨；`NO_STREAM` 用按钮置灰承接（`disabled={st !== 'ready'}`），不弹错。
- **连续模式显式开启**：checkbox"连续拍摄（显式开启；默认拍完关轨）"，切换= `dispose()`+按新模式重建（captureMode 是构造依赖）；开启期间有持续开启提示。
- **能力检测（不申请权限）**：保留"检测本机拍照能力（不申请权限）"按钮，读控制器构造时缓存的能力（`detectCapabilities`），新增安全上下文一行（未知/是/否）。
- **选图 capture 提示 / 来源未知标注**：`acceptFile(file,{captureHint:{capture:'environment'}})` 仅登记提示；来源标注三态保留（takePhoto / capture 提示 / 图库来源未知）；`provenance=unverified`、`capturedAt=null` 如实展示，无"已现场拍摄"文案。
- **本地预览不上传**：边界段落原文保留（不上传、不入库、不提交模型；『原件』仅指本应用收到的文件）。
- **清除释放**："清除本地预览（释放内存）"= discarded 路径（dispose 重建，资源清零）；"关闭相机"= `closeStream()`；requesting 时出"取消开启"出路（防权限弹框困住）。
- **无双路径**：面板源码无 `mediaDevices.getUserMedia`/`new ImageCapture`/`createObjectURL`/`revokeObjectURL`/track 引用（测试源码断言锁死）。
- props 接口不变：`export default function CameraPanel()`（无 props），page.tsx 未改。

## 4. 完成门（真实执行结果）

| Gate | 命令 | 结果 |
| --- | --- | --- |
| typecheck | `npm.cmd run typecheck` | **0 错误** |
| 新测试 | `node --experimental-strip-types --test test/v5-preview-camera-panel.test.mjs` | **13/13 pass**（0 fail） |
| 回归 | `node --experimental-strip-types --test test/v5-preview.test.mjs` | **22/22 pass**（0 fail；文件清单测试未受影响，remote-session 子目录与 lib/v5-preview/camera 新目录均不触其断言） |
| lint（附加） | `npx eslint camera-panel.tsx 新测试` | 0 error 0 warning |

测试计数明细（新文件 13 个 test()）：
1. 版本校验（0.2.0-r2-candidate + 九态）
2. Node 优雅降级（能力 null→UNSUPPORTED fallback=file_picker）
3. single 成功路径（requesting→ready→capturing→preview、拍完停轨+onStream(null)、NO_STREAM、重开）
4. single 失败路径（CAPTURE_FAILED 且立即关轨）
5. 无 ImageCapture（IMAGECAPTURE_UNSUPPORTED 回退、不改状态）
6. requestTimeoutMs（REQUEST_TIMEOUT→idle、迟到授权停轨）
7. cancelRequest（NOT_PENDING、迟到流停轨）
8. acceptFile 作废在途拍照（后选文件优先、迟到照片丢弃）
9. 外部轨道结束（TRACK_ENDED；无预览→idle / 有预览→preview）
10. dispose 幂等全清 + dispose 后全 no-op
11. acceptFile 校验（NOT_AN_IMAGE/EMPTY_FILE、capture 提示仅记录、provenance/capturedAt 不变量）
12. 面板接线契约（唯一路径、页面不自管 URL/轨道、四标注、single 默认+continuous 显式、持续提示、收起语义）
13. 面板边界文案契约（不上传/不申请权限/来源未知/清除释放/无 fetch/props 不变）

## 5. 调试发现（供后续参考）

- 冻结件 `capture()` 对 `takePhoto()` 的 resolve 值按 **Blob 直传**处理（`_handlePhotoArrival(seq, blob)`，不做 `{blob}` 解包）——mock ImageCapture 必须与候选批自带测试一致直接 resolve Blob，否则按"空图像"处理（与 R2_CAMERA_20260913/test/camera-controller.test.mjs 的 FakeImageCapture 行为一致）。
- `.mjs` 静态 import 在 `allowJs:true` + `moduleResolution:bundler` 下类型自动推断，但构造参数是松散 `{}`：回调参数需面板侧结构化视图类型显式标注，否则 TS7006/TS2339。

## 6. NOT TESTED / 边界

- 浏览器真实设备全路径（权限弹框/真机取景/takePhoto 实拍）、iframe 嵌入 `allow="camera"`、HTTPS 部署：本轮未跑浏览器 Gate（Node 语义测试+typecheck+lint 为本轮完成门），真机项沿用候选批 NOT TESTED 声明。
- 未新增语音/ASR、上传入库、RTC 复用等任何 MAPPING §3 声明不存在的接口。

——完成即停。
