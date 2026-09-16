# EVENT_RESOURCE_CONTRACT｜用户事件→相机资源状态契约（v0.3.0-r3-candidate）

- 批次：R3_CAMERA_20260913（SA-B 契约与映射，本文件唯一writer）。
- 控制器：`V6/handoff/R3_CAMERA_20260913/src/camera-controller.mjs`，`CAMERA_CONTROLLER_VERSION='0.3.0-r3-candidate'`；R2 冻结基线 v0.2.0（fd19c44a）的最小增量，行为语义以实现与测试为准。
- 版本演进：v0.1.0 接口冻结见 `V6/handoff/PARALLEL_CAMERA_20260913/INTEGRATION.md`；v0.1.0→v0.2.0 差异见 `V6/handoff/R2_CAMERA_20260913/MAPPING.md`（含§6增补）；v0.3.0 仅新增 `discardPreview()`/`getResourceCounters()`/`buildResourceReceipt()` 与计数器埋点，其余行为零变更。
- 总不变量：默认 idle；构造与能力检测绝不触设备；任何 getUserMedia 只能由显式用户动作发起；audio 恒 false（麦克风请求恒0）；不上传、不持久化；provenance 恒 `'unverified'`；原始文件字节不变。

## 1. 事件→资源状态总表

约定：**track** 列=本控制器持有的存活视频轨道数变化（before→after 净值）；**objectURL** 列=创建/撤销计数（预览原图与缩略图各1个URL，缩略图不可用时少1）；"页面义务"为宿主页面（MAIN）接线责任。标注"须显式用户操作"的行，控制器不得自动发起、自动重试、自动重开。

| # | 触发动作（须显式用户操作） | 状态迁移(before→after) | track | objectURL(建/撤) | 页面义务 | 可见状态（hasLiveStream指示/notice建议） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 本机开启：点"开启摄像头"→`openFromUserGesture()` | idle/denied/error/preview(无流)→`requesting`→`ready`；失败→`denied`/`error`（错误码映射见R2 MAPPING§2.5） | 成功+1；失败0 | 0/0 | `onStream(stream)`挂video（muted+playsinline）；requesting中禁"开启/拍照" | requesting："正在请求摄像头…"并提供"取消"；ready 后 hasLiveStream=true，显示取景指示条 |
| 2 | 翻转：点"翻转"→`switchCamera(videoOptions?)`（仅非requesting/capturing/disposed） | `ready`→idle瞬时→`requesting`→`ready`；失败→`denied`/`error`（旧流已停不恢复） | −1停旧轨再+1采纳新轨；净0 | 0/0（预览不动） | `onStream(null)`立即清空`video.srcObject`，新流到达再挂；失败按错误码提示 | 切换中 hasLiveStream=false、指示条消失，显示"切换摄像头中…"；失败提示可改用选图 |
| 3 | 单次拍照成功：点"拍照"→`capture()`（captureMode默认single） | `ready`→`capturing`→`preview`（ingest完成后立即关轨） | 成功落定后−1（single拍完即关轨，`onStream(null)`） | 建+2（原图+缩略图）；有旧预览则撤其1–2个 | `onPreview(p)`展示成片；`onStream(null)`清srcObject并收起取景；主按钮变"重新开启再拍"，不得自动重开 | hasLiveStream=false；预览区标"预览待保存"（仅内存，未入库，刷新即失） |
| 4 | 拍照失败：`capture()`失败/空Blob（single模式） | `ready`→`capturing`→`error` | −1（single失败同样立即关轨） | 0/0（失败路径从不创建URL） | `onError({code:'CAPTURE_FAILED'})`展示；清srcObject；给"重新开启"入口 | hasLiveStream=false；notice："拍照失败，摄像头已关闭。点击重新开启后可再拍。" |
| 5 | 证据作废：点"作废/丢弃"→`discardPreview()`（v0.3.0新增，流契约见§3） | `preview`→`ready`（流存活）/`idle`（流已关） | 0（不触设备，流保持不变） | 撤该预览全部URL（1–2个）/建0；在途照片ingest同步作废（不建URL，无泄漏） | 按返回值与`getSnapshot().hasLiveStream`移除预览展示并停止使用被撤销url；无预览时"作废"按钮禁用 | 流存活→hasLiveStream指示条**持续可见**（=摄像头仍开启的明确可见状态）；流已关→回到可重开状态 |
| 6 | 取消：requesting中点"取消"→`cancelRequest()` | `requesting`→`idle` | 0（流从未建立；迟到授权到货即停） | 0/0 | 关闭"请求中"提示，恢复"开启"按钮 | 无指示条；"已取消，未开启摄像头" |
| 7 | 超时：`REQUEST_TIMEOUT`（默认45s未落定自动收束，非用户直接动作） | `requesting`→`idle` | 0；迟到授权流到货即停轨丢弃 | 0/0 | `onError({code:'REQUEST_TIMEOUT'})`展示；恢复按钮 | notice："请求超时，已自动取消并释放资源，可重试。" |
| 8 | 挂断（=dispose，访谈语义别名）：点"挂断"或"返回总览"→`dispose()` | 任意→`disposed`（唯一终态，幂等） | 停全部轨道（计入`tracksStoppedByController`），归零 | 撤全部持有URL，归零 | `onStream(null)`清srcObject；移除预览img；禁用相机按钮；按§6收集资源收据并展示/上报 | 相机区收起："已挂断，摄像头与本地预览已全部释放" |
| 9 | 页面隐藏/离开：`pagehide`→`dispose()` | 同行8 | 同行8 | 同行8 | `window.addEventListener('pagehide',()=>controller.dispose())`；收据须在pagehide回调内同步构建，上报方式页面自定（如sendBeacon） | 页面即将隐藏无可见义务；资源必须归零 |

补充：外部轨道结束（设备断开/系统回收）非用户事件但影响可见状态——`onError({code:'TRACK_ENDED'})`+`onStream(null)`+state回`preview`(有预览)/`idle`（v0.2.0语义，R2 MAPPING§1.1#5）；页面须同时监听 TRACK_ENDED 与 onStream(null) 刷新UI。

## 2. 收缩视图 ≠ 离开会话

- 展开/收起预览、面板折叠、抽屉、切换面板均属**纯视图操作**：控制器是纯逻辑+回调、不持有DOM，零资源影响——track变化0、objectURL变化0、状态迁移0。R2真实浏览器证据：`V6/handoff/R2_CAMERA_20260913/evidence/browser-step03-collapse-state.json`、`screenshots/03-preview-collapsed.png`（收起/展开后 img.src 不变、图像仍可解码；接线做法见R2 MAPPING§6.2：用CSS隐藏而非卸载节点）。
- **只有明确的"挂断/返回总览/离开会话"用户意图才调用 `dispose()`**（行8/9路径）；视图收缩、面板切换绝不得触发 dispose/closeStream。
- 判别口径：收缩=宿主CSS操作，控制器无感知；离开会话=用户动作→dispose全释放。状态收缩/恢复不得丢失有效预览与原件（R3 DoD）。

## 3. 仅内容作废：`discardPreview()` 流契约（v0.3.0新增）

- **不触设备**：流保持不变——流存活则仍live，hasLiveStream指示条持续可见，这就是"摄像头仍开启"的**明确可见状态**；控制器不借作废暗中关流。关流永远是独立的显式用户动作（`closeStream()`/`dispose()`）。
- 撤销该预览的**全部**URL（原图+缩略图），计入 urlsRevoked。
- **在途照片ingest作废**：内部 seq+1，使未落定的照片ingest返回 SUPERSEDED——不创建URL、不改预览、无泄漏（作废内容优先）。
- 状态迁移：`preview`→`ready`（流存活）/`idle`（流已关），触发 `onStateChange`；**单次模式下拍照后流已关，作废即回到可重开状态**（idle，主按钮"重新开启"）。
- 幂等：重复调用安全，第二次返回 `{ok:false,code:'NO_PREVIEW'}`，无二次撤销、无状态抖动、计数器不重复累计。
- 返回值：成功 `{ok:true,hadPreview:true,hasLiveStream:<bool>}`；失败 `{ok:false,code:'NO_PREVIEW'|'DISPOSED'}`。
- 页面义务：移除预览DOM并停止使用被撤销url；无预览时禁用"作废"按钮（避免 NO_PREVIEW 弹错）。

## 4. 取消/挂断/离开不留隐形采集：资源归零证据点

| 路径 | 归零断言点 |
| --- | --- |
| `cancelRequest()`（行6） | 终态 `getResourceUsage().liveTracks===0`；迟到授权到货即停轨后 `getResourceCounters().tracksStoppedByController` 含该次停轨；eventLog 记录取消 |
| `REQUEST_TIMEOUT`（行7） | 同上；eventLog/onError 记录 REQUEST_TIMEOUT |
| `dispose()`（行8/9，挂断/返回总览/离开） | 收据断言（§6）：`liveTracksAtEnd===0`、`urlsHeldAtEnd===0`、`danglingUrls===0`、`micRequests===0`、`stateAtEnd==='disposed'` |
| 单次拍照成功（行3） | 无需等dispose：single关轨后即时 `getResourceUsage().liveTracks===0` |
| 通用 | `micRequests===0`（计数器 micConstraintViolations 恒0，任何路径 audio!==false 即+1）；重复点击峰值存活流≤1（§7） |

## 5. URL 释放边界

- 控制器创建并拥有其全部 objectURL（`_liveUrls` 登记），**页面不得自行 revoke 控制器的URL**。
- 撤销只发生在三个时机：**替换**（新预览ingest就绪时撤旧预览全部URL，含缩略图）、**作废**（`discardPreview()`）、**释放**（`dispose()`）。
- **仍展示的当前预览URL绝不提前撤销**：R2"换图释放"测试（旧URL在新预览就绪时才撤，见R2回归 `test/resource-tracking.test.mjs`、`evidence/full-regression.log`）与 R3 `test/r3-contract.test.mjs` 断言口径（展示中URL在discard/dispose前保持可解码）。
- 页面义务：`onPreview` 交付新预览后旧url立即失效，停止引用；预览被替换后继续使用旧url属页面缺陷。
- URL创建可能失败（`preview.url===null`，warnings 含 `object_url_unavailable`），页面须容忍。URL仅是本地引用，原件字节永不改动（R2证据 `evidence/browser-step02-hash-check.json`）。

## 6. 资源收据 schema（`buildResourceReceipt`）

纯函数，控制器文件导出，Node测试与浏览器壳共用。入参 `{events, finalUsage, counters, meta}`；`finalUsage`=收束时 `getResourceUsage()`，`counters`=收束时 `getResourceCounters()`，`meta={reason,startedAt,endedAt,version?,uploadsAttempted?}`。

| 字段 | 来源 | 验收断言 |
| --- | --- | --- |
| `kind` | 恒定 | `==='camera-resource-receipt'` |
| `version` | meta.version，缺省=控制器版本 | `==='0.3.0-r3-candidate'` |
| `reason` | meta.reason | ∈ `'hangup'｜'leave'｜'dispose'｜'close'`；挂断→hangup，返回总览/离开会话→leave，pagehide/通用→dispose，仅关流收束→close；缺省'dispose' |
| `startedAt`/`endedAt` | meta（MAIN自记会话起止） | 均非null且 endedAt≥startedAt |
| `micRequests` | counters.micConstraintViolations | **必须0**（硬门） |
| `uploadsAttempted` | meta.uploadsAttempted（页面fetch/XHR探针实测填写） | 已接探针并实测→`0`；未接探针→`null`（含义"未测"），**缺省null不得填0冒称已测** |
| `gumCallsTotal` | counters.gumCalls | 与eventLog一致；每次开启尝试都计入（含失败/超时/迟到） |
| `streamsAdopted` | counters.streamsAdopted | ≤gumCallsTotal |
| `tracksStoppedByController` | counters.tracksStoppedByController | dispose收束时 ≥streamsAdopted（被外部ended的不需我方停） |
| `urlsCreated`/`urlsRevoked` | counters | 终局 `urlsRevoked===urlsCreated` |
| `danglingUrls` | max(0, created−revoked) | **必须0**（硬门） |
| `liveTracksAtEnd` | finalUsage.liveTracks | **必须0**（硬门） |
| `urlsHeldAtEnd` | finalUsage.urlsHeld | **必须0**（硬门） |
| `stateAtEnd` | finalUsage.state | `==='disposed'` |
| `eventLog` | 页面收集的回调事件 `[{t,kind,...}]` | 冻结数组；含关键序列（onStream(stream)/(null)、onPreview、onError）供复核 |

**挂断/返回总览的MAIN调用序列**（顺序不可换）：会话开始记 startedAt，回调四件套内同步 push eventLog → 用户点挂断 → `controller.dispose()` → `getResourceUsage()` → `getResourceCounters()` → `buildResourceReceipt({events, finalUsage, counters, meta})` → 展示/上报并收起相机区。**usage与counters必须在dispose()之后读取**：dispose会补齐最后的停轨与撤URL计数，终态断言依赖该顺序。代码示例见同批 `MAPPING.md`§3。

## 7. 对抗与竞态行为行（证据指针）

| 场景 | 行为契约 | 证据指针 |
| --- | --- | --- |
| 迟到授权 | 取消/超时/切文件/dispose 之后授权流才到货→立即停轨，不改状态、不通知、不弹框 | R2 `test/adversarial.test.mjs`；R3 `test/r3-contract.test.mjs` |
| 迟到照片 | takePhoto结果到达时seq已被超越（作废/换文件/dispose）→整张丢弃；blob从未创建URL，无需释放 | R2 `test/adversarial.test.mjs`；R3 `test/r3-contract.test.mjs` |
| 取消中切文件 | requesting中 `acceptFile`→未决请求作废且其超时定时器一并终止（v0.2.0语义）；迟到流到货即停 | R2 `test/camera-controller.test.mjs`；R3回归 |
| 连续点击 | 双击开启→第二次 `ALREADY_PENDING`；双击拍照→第二次 `CAPTURE_IN_PROGRESS`；峰值存活流≤1，gumCalls按真实尝试计 | R2 `test/stress-loop.test.mjs`；R3回归断言 |
| 作废时在途ingest | `discardPreview()` 的 seq+1 使在途照片ingest返回 SUPERSEDED：不创建URL、不改预览、无泄漏 | R3 `test/r3-contract.test.mjs`（v0.3.0新增） |

——纯契约文档；行为以控制器实现与测试为准。产品接入由MAIN按同批 `MAPPING.md` 执行。
