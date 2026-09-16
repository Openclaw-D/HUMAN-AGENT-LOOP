# MAPPING｜MAIN旧camera-panel→v0.3.0相机控制器最小替换映射

- 批次：R3_CAMERA_20260913（SA-B 契约与映射，本文件唯一writer）。
- 目标版本：`CAMERA_CONTROLLER_VERSION === '0.3.0-r3-candidate'`；文件hash**以本批 `MANIFEST.json` 为准**（主agent冻结后填写，此处不预写hash值）；R2冻结基线 v0.2.0（fd19c44a）只读。
- 每个用户事件的资源语义见同批 `EVENT_RESOURCE_CONTRACT.md`（下称"契约"）；v0.1.0→v0.2.0 差异、错误码→界面文案表、iframe权限策略、真机边界直接用 `V6/handoff/R2_CAMERA_20260913/MAPPING.md`（含§6增补），本文不重复。

## 1. 版本断言

接入代码处断言版本，防止误接旧批次模块：`console.assert(CAMERA_CONTROLLER_VERSION === '0.3.0-r3-candidate', '相机控制器版本不符')`。源文件：`V6/handoff/R3_CAMERA_20260913/src/camera-controller.mjs`（hash见MANIFEST.json）。

## 2. 替换对照表（旧camera-panel典型职责→v0.3.0接线）

| 旧camera-panel典型职责 | v0.3.0方法/回调 | 注意 |
| --- | --- | --- |
| 页面加载时探测设备能力 | `detectCapabilities()` | 只读无副作用，绝不触设备；unsupported→只展示选图入口 |
| "开启摄像头"按钮 | `openFromUserGesture()` | 必须在用户点击事件处理器内调用 |
| "拍照"按钮 | `capture()` | single默认一次有效；成功/失败后流即关，再拍须重新开启 |
| 选图 `<input type=file capture=environment>` change | `await acceptFile(file, {captureHint})` | 作废在途拍照与未决开启请求；仅本地预览不上传 |
| "翻转"按钮 | `switchCamera(videoOptions?)` | 仅非requesting/capturing/disposed有效 |
| requesting中"取消" | `cancelRequest()` | 与45s超时自动取消共存（REQUEST_TIMEOUT） |
| "删除/重拍"（旧面板自行清空预览或自行revoke） | `discardPreview()`（v0.3.0新增） | 页面不得自行revoke控制器URL；不触设备、流保持不变（契约§3） |
| "关闭取景" | `closeStream()` | 无流时按钮禁用；single拍完已自动关轨 |
| 状态显示 | `onStateChange`快照 + `getSnapshot().hasLiveStream` + `getResourceUsage()` | hasLiveStream驱动取景指示条（纯视图收缩不影响，契约§2） |
| 挂断/返回总览/离开页面 | `dispose()` + `buildResourceReceipt()`（§3） | pagehide义务；dispose幂等 |

### 构造示例（含默认值与页面义务）

```js
import { CameraController, CAMERA_CONTROLLER_VERSION, buildResourceReceipt }
  from 'V6/handoff/R3_CAMERA_20260913/src/camera-controller.mjs';
console.assert(CAMERA_CONTROLLER_VERSION === '0.3.0-r3-candidate', '相机控制器版本不符');

const controller = new CameraController({
  // captureMode: 'single',     // 默认即single，可省略；continuous须显式opt-in且非常态（§5）
  // requestTimeoutMs: 45000,   // 默认45s，可省略；传null禁用
  onStateChange: (s) => renderState(s),   // {state, hasLiveStream, capabilities, activePreviewId, lastError}
  onPreview: (p) => showPhoto(p),         // 新预览；旧预览URL已被控制器撤销，页面停止使用旧p.url
  onError: (e) => showNotice(e.code, e.message, e.fallbackHint),
  onStream: (stream) => { videoEl.srcObject = stream; }, // stream===null必须清空srcObject（single模式触发频繁，必接）
});
window.addEventListener('pagehide', () => controller.dispose());
```

## 3. 挂断/返回总览接线（事件序列+收据）

事件序列：用户点"挂断"或"返回总览"→页面同步执行：①禁用相机按钮 ②`controller.dispose()`（停全部轨道、撤全部URL、`onStream(null)`清srcObject）③读 `getResourceUsage()` ④读 `getResourceCounters()` ⑤`buildResourceReceipt(...)` ⑥按收据渲染"已释放"或经sendBeacon上报、收起相机区。③④必须在②之后（终态断言依赖dispose补齐的计数，契约§6）。

```js
// 回调四件套内同步收集，如 events.push({ t: Date.now(), kind: 'onStream', hasStream: !!s })
function onHangup() {                        // "挂断"与"返回总览"共用；reason分别取'hangup'/'leave'
  setCameraButtonsEnabled(false);
  controller.dispose();
  const receipt = buildResourceReceipt({
    events,                                  // 页面收集的回调事件序列
    finalUsage: controller.getResourceUsage(),
    counters: controller.getResourceCounters(),
    meta: { reason: 'hangup', startedAt, endedAt: Date.now(),
            uploadsAttempted: uploadProbe.count }, // 页面探针实测；未接探针留null，不得填0冒称已测
  });
  renderReceipt(receipt);                    // 或 navigator.sendBeacon(url, JSON.stringify(receipt))
}
```

逐字段验收断言见契约§6（硬门：micRequests=0、danglingUrls=0、liveTracksAtEnd=0、urlsHeldAtEnd=0、stateAtEnd='disposed'）。

## 4. 集成测试入口

- 一行复跑全部回归+契约测试：`node test/run-r3.mjs`（在本批目录 `V6/handoff/R3_CAMERA_20260913/` 下；含R2 96项回归对R3控制器的复跑+R3新增契约断言；运行证据 `evidence/r3-tests-run.log`）。
- headless浏览器复验：见 `tools/headless-shots.mjs`（主agent交付）；402×874/DPR3精确仿真与390/360真实布局尺寸口径见R2 MAPPING§4与本批STATUS。
- R2原批独立复跑（只读基线核对）：在 `V6/handoff/R2_CAMERA_20260913/` 下 `node --test test/camera-controller.test.mjs test/resource-tracking.test.mjs test/adversarial.test.mjs test/stress-loop.test.mjs test/metadata-integrity.test.mjs`（R2 MAPPING§6.4）。

## 5. 硬边界重申

- **continuous不作为默认**：默认single；连续模式须构造时显式opt-in+用户主动开关+开启期间持续"摄像头开启中"提示（R2 MAPPING§2.4）。
- **禁止自动启用真实摄像头/音频**：构造、能力检测、页面加载零设备调用；任何getUserMedia只能由显式用户点击发起；audio恒false，麦克风请求恒0。
- **不新增上传**：控制器无任何网络路径；MAIN若接上传属独立Gate，收据 uploadsAttempted 由页面探针实测，未接探针留null。
- **provenance恒'unverified'**：不冒称现场拍摄；capture提示仅记录；capturedAt恒null；图片不是可信事实。
- **真机/软键盘NOT TESTED**：iOS/Android真机、真实硬件、软键盘推起未测即保持NOT TESTED，验收单不填通过。
- 继承批次约束：不操作Codex、不动现有服务与共享端口、无新依赖、无Git操作。

## 6. v0.2.0→v0.3.0差异（仅此一节，其余见R2 MAPPING）

| 类型 | 内容 |
| --- | --- |
| 新增方法 `discardPreview()` | 仅内容作废契约（契约§3）：撤预览全部URL、流保持不变、state回ready(流存活)/idle、幂等、失败码 NO_PREVIEW/DISPOSED |
| 新增方法 `getResourceCounters()` | 只增计数器快照 `{gumCalls, micConstraintViolations, streamsAdopted, tracksStoppedByController, urlsCreated, urlsRevoked}` |
| 新增导出 `buildResourceReceipt()` | 纯函数资源收据构造器（契约§6）；Node测试与浏览器壳共用 |
| 计数器埋点 | 既有路径新增计数采集；不改变既有行为与返回值语义 |

- 除上表外行为与v0.2.0零变更：R2 96项回归语义不变，若回归失败即为红旗（R3 DoD"禁止只改测试迎合错误"）。
- v0.1.0→v0.2.0 全部差异（single默认关轨、REQUEST_TIMEOUT、TRACK_ENDED、同步throw映射、getResourceUsage）见R2 MAPPING§1，接线时按v0.2.0口径继承。

——完成即停。本文件为纯映射文档；接入实施由MAIN按本文与契约执行。
