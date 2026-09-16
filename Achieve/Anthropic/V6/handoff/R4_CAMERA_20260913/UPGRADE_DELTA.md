# UPGRADE_DELTA｜产品相机 0.2.0 → 0.3.0 最小升级与接线位置

受众:MAIN(唯一产品writer)。本文件只写R4_CAMERA,MAIN可整份读取;升级动作本身由MAIN执行。
结论:**替换1个文件+4处接线+1行测试钩子**,即可从产品现行 v0.2.0 升到候选 v0.3.0;现有方法行为零变更(96项回归语义差异0已独立复核)。

## 1. 版本与hash(接入处必须断言)

| 文件 | 版本 | sha256 | 字节 |
| --- | --- | --- | --- |
| 产品现行(0.2.0) | `0.2.0-r2-candidate` | `fd19c44a532239ed029e47264f123e8d28e4406c11ebf24a9de523c4b6e7a272` | 18284 |
| 候选(0.3.0,本delta目标) | `0.3.0-r3-candidate` | `5a2a0e9c6ab07d2cfc2a53aac20d70119258ab5cf41a1bab888cb5993bafb689` | 29277 |
| thumbnail.mjs(不变) | — | `8722747b7a560f73dcf72120accd658310419590df6ea0ad07fdad786c6f042e` | 3572 |

来源:`V6/handoff/R3_CAMERA_20260913/src/camera-controller.mjs`(R3冻结批,只读拷贝)。升级后代码内断言 `CAMERA_CONTROLLER_VERSION === '0.3.0-r3-candidate'`,防止回退。

## 2. 0.3.0 相对 0.2.0 的全部差异(仅新增,无修改删除)

| 新增 | 签名 | 语义要点 |
| --- | --- | --- |
| `discardPreview()` | `→ {ok:true, hadPreview, hasLiveStream} \| {ok:false, code:'NO_PREVIEW'\|'DISPOSED'}` | 仅内容作废:撤销当前预览全部URL、在途照片ingest作废(seq+1);**不触设备**——流保持不变,状态回ready(流存活)/idle;幂等。不冒认事实:作废≠删除已上传(本就没有上传),provenance仍unverified |
| `getResourceCounters()` | `→ 冻结{gumCalls, micConstraintViolations, streamsAdopted, tracksStoppedByController, urlsCreated, urlsRevoked}` | 只增计数埋点;配合收据 |
| `buildResourceReceipt({...})`(模块级导出) | `({events[], finalUsage, counters, meta:{reason:'hangup'\|'leave'\|'dispose'\|'close', startedAt, endedAt, version, uploadsAttempted}}) → 冻结收据` | 纯函数;`uploadsAttempted`由页面fetch/XHR探针填写,缺省`null`不得冒0 |
| (内部)`_counters` 埋点 | — | gUM调用/采纳流/我方停轨/URL建撤 计数;行为无变化 |

回归证据:R3批 105/105(96项R2回归对0.3.0语义差异0 + 9项新契约),`V6/handoff/R3_CAMERA_20260913/evidence/r3-tests-run.log`;R4批runtime化复跑见本目录runtime/regression。

## 3. 接线位置(MAIN产品侧,4+1处)

1. **资源收据→挂断/返回总览按钮**(最重要):
   - 页面级维护 `eventLog`(在四回调 onStateChange/onPreview/onError/onStream 里 `eventLog.push({t, kind, ...})`);
   - 挂断按钮 handler:`controller.dispose()` → `buildResourceReceipt({ events:eventLog, finalUsage:controller.getResourceUsage(), counters:controller.getResourceCounters(), meta:{reason:'hangup', startedAt, endedAt:performance.now(), uploadsAttempted:window.__uploadProbeHits??null} })`;
   - **顺序冻结**:dispose → 读usage → 读counters → buildResourceReceipt(终态断言依赖dispose补齐计数);
   - 收据落到会话记录/调试面板;`liveTracksAtEnd/danglingUrls/micRequests` 必须为0,非0即缺陷。
2. **discardPreview→“作废/重拍”按钮**:预览存在的作废动作统一走 `controller.discardPreview()`,不得自行撤销controller的URL;作废后按返回的`hasLiveStream`渲染可见状态(摄像头仍开→状态条保留)。
3. **资源计数→验收/调试面板**:直接展示 `getResourceUsage()`(state/captureMode/liveTracks/urlsHeld)与 `getResourceCounters()`;无UI需求也建议console可读,便于复验。
4. **上传探针→页面级**:包裹 `window.fetch`/`XMLHttpRequest.open`(非GET/HEAD计数),值喂给收据`uploadsAttempted`;相机路径任何图片字节上传都应使该值>0=缺陷。
5. **测试钩子(一行,可验证性要求)**:`window.__CAMERA_TEST = { controller, buildReceipt }`。B的harness(`tools/verify-product.mjs`)经它读真实控制器计数做产品验证;不暴露则产品验证多数序列只能记SKIPPED_PAGE_NO_HOOK。

已有义务不变(0.2.0已要求):四回调接线、`onStream(null)`清`video.srcObject`、`pagehide→dispose()`、single默认拍完关轨、continuous须显式opt-in+常驻提示、`accept=image/* capture=environment`选图入口。

## 4. MAIN自验命令(接入后)

```bash
# 行为回归(对0.3.0,105项)
node V6/handoff/R4_CAMERA_20260913/tools/run-r4-regression.mjs
# 产品资源序列验证+三viewport量测(MAIN包生成后,--inputs指向integration-inputs批次)
node V6/handoff/R4_CAMERA_20260913/tools/verify-product.mjs --entry <产品URL> --inputs <batchDir>
node V6/handoff/R4_CAMERA_20260913/tools/measure-viewport.mjs --entry <产品URL>
```

B收到MAIN输入包后以同一命令复验并写 `CAMERA_INTEGRATION_RECEIPT`(引用同一批次编号+hash)。
