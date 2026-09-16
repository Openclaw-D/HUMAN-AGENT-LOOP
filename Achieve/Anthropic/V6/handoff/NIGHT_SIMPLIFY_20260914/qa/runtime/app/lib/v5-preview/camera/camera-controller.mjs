// 设备拍照控制器（R2任务B续作，接口版本见 CAMERA_CONTROLLER_VERSION）。
// 设计约束（继承 v0.1.0，冻结）：
// - 默认 idle；构造与能力检测绝不触碰设备，只有显式用户动作才发起 getUserMedia；
// - 音频恒为 audio:false，本模块永不申请麦克风；
// - mediaDevices / ImageCapture / objectURL / 时钟 / 解码 / 缩略图全部可注入，便于假设备测试；
// - 拒绝权限不循环弹框、双击不开两组流、迟到结果（含迟到权限）立即清理；
// - 原始 File/Blob 字节保持不变，缩略图另建；“capture 提示”只作记录，不证明文件出处；
// - 不上传、不持久保存、不发模型；只管理本地预览对象与其生命周期。
//
// v0.2.0-r2-candidate 相对 v0.1.0 的全部行为变更（未提及的行为保持 v0.1.0 不变）：
// 1) captureMode（构造依赖，默认 'single' | 显式 'continuous'）：single 模式下 capture()
//    的 takePhoto 无论成功或失败，结果落定后立即停全部轨道并回调 onStream(null)；
//    成功先完成预览 ingest（state 'preview'）随后关轨。single 模式 preview 后流已关，
//    再拍必须重新 openFromUserGesture()；capture() 无流时返回 { ok:false, code:'NO_STREAM' }。
//    continuous 显式传入时保持 v0.1.0 连续语义（成功流保留可再拍；失败 state 'error' 流保留）。
// 2) requestTimeoutMs（构造依赖，数字，默认 45000；传 null 禁用）：_beginRequest 发起的
//    getUserMedia 超时未 settled → 自动取消（bump seq、按 cancelRequest 语义清理、
//    state 'idle'、onError REQUEST_TIMEOUT）；到货/失败/取消/dispose 均 clearTimeout；
//    超时后迟到的授权流立即停轨。
// 3) 外部轨道结束：采纳 track 后挂 ended 监听（addEventListener 可用则用，否则 onended）。
//    非我方主动 stop 的外部 ended → 停流引用、onStream(null)、state=有预览?'preview':'idle'、
//    onError TRACK_ENDED。我方主动 stop 用 _expectTrackEnd 标志（同步派发）+ 当前轨道
//    引用判别（异步派发）双重防护，均不误报。
// 4) getUserMedia 同步 throw：捕获后走与异步失败相同的映射
//    （NotAllowedError/SecurityError→denied；NotFoundError/NotReadableError/AbortError→error；
//    其他→error 'GETUSERMEDIA_FAILED'），openFromUserGesture 返回 { ok:false, code:<映射码> }。
// 5) takePhoto 同步 throw：包 try/catch 后走 _handlePhotoFailure 同路径
//    （single 模式关轨，code 'CAPTURE_FAILED'）。
// 6) getResourceUsage()：只读返回 { state, captureMode, liveTracks, urlsHeld }。

import { createThumbnailDefault, decodeImageMetadataDefault } from './thumbnail.mjs';

export const CAMERA_CONTROLLER_VERSION = '0.3.0-r3-candidate';

export const CAMERA_STATES = Object.freeze([
  'idle',
  'requesting',
  'ready',
  'capturing',
  'preview',
  'denied',
  'unsupported',
  'error',
  'disposed',
]);

export const SOURCE_METHODS = Object.freeze({
  LIVE_TAKEPHOTO: 'live_camera_takephoto',
  FILE_PICKER: 'file_picker',
});

export const FILE_ORIGINS = Object.freeze({
  LIVE_CAMERA_STREAM: 'live_camera_stream',
  USER_FILE_SELECTION: 'user_file_selection',
});

const DEFAULT_VIDEO_CONSTRAINTS = Object.freeze({
  facingMode: 'environment',
  width: { ideal: 4096 },
  height: { ideal: 4096 },
});

const DEFAULT_REQUEST_TIMEOUT_MS = 45000;

function getGlobalMediaDevices() {
  try {
    return globalThis.navigator?.mediaDevices ?? null;
  } catch {
    return null;
  }
}

// 纯功能检测：只看 API 是否存在与是否安全上下文，绝不启动设备。
// secureContext 为 null 表示环境未声明（未知），不据猜测判定可用。
export function detectCapabilities(deps = {}) {
  const mediaDevices = deps.mediaDevices !== undefined ? deps.mediaDevices : getGlobalMediaDevices();
  const imageCapture = deps.ImageCapture !== undefined ? deps.ImageCapture : globalThis.ImageCapture ?? null;
  const secure = deps.isSecureContext !== undefined ? deps.isSecureContext : globalThis.isSecureContext;
  const hasGetUserMedia = Boolean(mediaDevices && typeof mediaDevices.getUserMedia === 'function');
  const hasImageCapture = typeof imageCapture === 'function';
  const secureContext = typeof secure === 'boolean' ? secure : null;
  // liveCameraSupported 仅指 API/安全上下文层面可用；不代表设备存在或权限会被授予。
  const liveCameraSupported = hasGetUserMedia && secureContext !== false;
  return Object.freeze({
    secureContext,
    getUserMedia: hasGetUserMedia ? 'available' : 'missing',
    imageCapture: hasImageCapture ? 'available' : 'missing',
    liveCameraSupported,
    takePhotoSupported: liveCameraSupported && hasImageCapture,
  });
}

function looksLikeBlob(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.size === 'number' &&
      typeof value.arrayBuffer === 'function',
  );
}

// getUserMedia 失败 → 状态/错误码/文案 的唯一映射。
// 异步拒绝与同步 throw 共用此映射，保证两条路径行为一致。
function mapStreamError(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      state: 'denied',
      code: 'NOT_ALLOWED',
      message: '摄像头权限被拒绝或被策略阻止。可在系统或浏览器设置中恢复后，再次点击“开启摄像头”。',
    };
  }
  if (name === 'NotFoundError') {
    return { state: 'error', code: 'NO_DEVICE', message: '未找到可用的摄像头设备。' };
  }
  if (name === 'NotReadableError') {
    return { state: 'error', code: 'DEVICE_BUSY', message: '摄像头被其他应用占用，无法读取。' };
  }
  if (name === 'AbortError') {
    return { state: 'error', code: 'DEVICE_ABORTED', message: '摄像头请求被中止，可重试。' };
  }
  return { state: 'error', code: 'GETUSERMEDIA_FAILED', message: `开启摄像头失败：${name || '未知错误'}` };
}

export class CameraController {
  constructor(deps = {}) {
    this._deps = {
      // 显式传 null 一律禁用对应能力（用于测试与受限嵌入环境）。
      mediaDevices: deps.mediaDevices !== undefined ? deps.mediaDevices : getGlobalMediaDevices(),
      ImageCapture: deps.ImageCapture !== undefined ? deps.ImageCapture : globalThis.ImageCapture ?? null,
      createObjectURL:
        deps.createObjectURL !== undefined
          ? deps.createObjectURL
          : globalThis.URL?.createObjectURL
            ? globalThis.URL.createObjectURL.bind(globalThis.URL)
            : null,
      revokeObjectURL:
        deps.revokeObjectURL !== undefined
          ? deps.revokeObjectURL
          : globalThis.URL?.revokeObjectURL
            ? globalThis.URL.revokeObjectURL.bind(globalThis.URL)
            : null,
      now: deps.now ?? (() => Date.now()),
      decodeImageMetadata: deps.decodeImageMetadata ?? decodeImageMetadataDefault,
      createThumbnail: deps.createThumbnail ?? createThumbnailDefault,
      isSecureContext: deps.isSecureContext ?? globalThis.isSecureContext,
      video: { ...DEFAULT_VIDEO_CONSTRAINTS, ...(deps.videoConstraints ?? {}) },
    };
    this._callbacks = {
      onStateChange: deps.onStateChange ?? null,
      onPreview: deps.onPreview ?? null,
      onError: deps.onError ?? null,
      onStream: deps.onStream ?? null,
    };
    this._state = 'idle';
    this._disposed = false;
    this._stream = null;
    this._track = null;
    this._seq = 0; // 每个在途操作持有发起时序号；被更新操作超越或释放后即视为迟到结果
    this._cancelRequested = false;
    this._liveUrls = new Set(); // 本控制器创建且尚未撤销的 object URL
    this._preview = null; // 仅保留最近一次预览；换图时旧URL立即释放
    this._lastError = null;
    // v0.2.0：单次拍照默认拍完即关轨；连续拍摄必须显式 opt-in。
    this._captureMode = deps.captureMode === 'continuous' ? 'continuous' : 'single';
    // v0.2.0：getUserMedia 请求超时；显式 null 禁用；非法值回落默认。
    this._requestTimeoutMs =
      deps.requestTimeoutMs === null
        ? null
        : typeof deps.requestTimeoutMs === 'number' &&
            Number.isFinite(deps.requestTimeoutMs) &&
            deps.requestTimeoutMs > 0
          ? deps.requestTimeoutMs
          : DEFAULT_REQUEST_TIMEOUT_MS;
    this._requestTimer = null;
    this._requestTimerSeq = null;
    this._expectTrackEnd = false; // 我方主动stop期间为true：同步派发的ended不视为外部结束
    this._trackEndHandler = null;
    this._capabilities = detectCapabilities(this._deps);
    // v0.3.0资源收据计数器：只增不改，供buildResourceReceipt与验收核对。
    this._counters = {
      gumCalls: 0,
      micConstraintViolations: 0, // 恒应为0：任何路径audio!==false即+1
      streamsAdopted: 0,
      tracksStoppedByController: 0,
      urlsCreated: 0,
      urlsRevoked: 0,
    };
  }

  get state() {
    return this._state;
  }

  get capabilities() {
    return this._capabilities;
  }

  // 已缓存的本实例能力检测结果（构造时计算，不触设备）。
  detectCapabilities() {
    return this._capabilities;
  }

  getSnapshot() {
    return Object.freeze({
      state: this._state,
      hasLiveStream: this._hasLiveStream(),
      capabilities: this._capabilities,
      activePreviewId: this._preview?.id ?? null,
      lastError: this._lastError,
    });
  }

  getPreview() {
    return this._preview;
  }

  // v0.3.0新增（仅内容作废契约）：丢弃当前待保存预览并撤销其URL；
  // 不触设备——流是否保留由当前事实决定（存活则保持，hasLiveStream可见），页面据此渲染可见状态。
  // 返回 {ok:true, hadPreview, hasLiveStream} 或失败码（NO_PREVIEW/DISPOSED）。幂等。
  discardPreview() {
    if (this._disposed) return this._fail('DISPOSED');
    const had = this._preview;
    if (!had) return this._fail('NO_PREVIEW');
    this._seq += 1; // 使仍在途的照片ingest作废：作废内容优先
    this._revokePreview(had);
    this._preview = null;
    this._lastError = null;
    this._setState(this._hasLiveStream() ? 'ready' : 'idle');
    return { ok: true, hadPreview: true, hasLiveStream: this._hasLiveStream() };
  }

  // v0.2.0：只读资源用量快照（不触设备、不改状态、不发通知）。
  getResourceUsage() {
    return Object.freeze({
      state: this._state,
      captureMode: this._captureMode,
      liveTracks: this._hasLiveStream() ? 1 : 0,
      urlsHeld: this._liveUrls.size,
    });
  }

  // v0.3.0新增：资源收据原始计数器（只增计数；配合buildResourceReceipt生成可复验收据）。
  getResourceCounters() {
    return Object.freeze({ ...this._counters });
  }

  _setState(next) {
    if (this._disposed) return;
    const prev = this._state;
    this._state = next;
    if (prev !== next) this._callbacks.onStateChange?.(this.getSnapshot());
  }

  _fail(code, extra = {}) {
    return { ok: false, code, ...extra };
  }

  _error(code, message, extra = {}) {
    const payload = Object.freeze({ code, message, ...extra });
    this._lastError = payload;
    this._callbacks.onError?.(payload);
    return payload;
  }

  _hasLiveStream() {
    return Boolean(this._stream && this._track && this._track.readyState !== 'ended');
  }

  _stopStream(stream) {
    if (!stream) return;
    // 我方主动停轨：窗口期内同步派发的 ended 不视为外部结束
    //（异步派发的 ended 由 _handleTrackEnded 的当前轨道引用判别兜底）。
    this._expectTrackEnd = true;
    try {
      for (const track of stream.getTracks?.() ?? []) {
        try {
          track.stop?.();
          this._counters.tracksStoppedByController += 1;
        } catch {
          // 停轨失败不阻断清理流程。
        }
      }
    } finally {
      this._expectTrackEnd = false;
    }
  }

  _detachStream(notify = true) {
    const had = this._hasLiveStream();
    this._stopStream(this._stream);
    this._stream = null;
    this._track = null;
    if (notify && had) this._callbacks.onStream?.(null);
  }

  // 采纳轨道后挂 ended 监听：addEventListener 可用则用，否则回退 onended。
  _attachTrackEndListener(track) {
    this._trackEndHandler = () => this._handleTrackEnded(track);
    if (typeof track.addEventListener === 'function') {
      track.addEventListener('ended', this._trackEndHandler);
    } else {
      track.onended = this._trackEndHandler;
    }
  }

  // 外部轨道结束（设备断开/系统回收）：清理流引用并明确报错；我方主动 stop 不进入此路径。
  _handleTrackEnded(track) {
    if (this._disposed || this._expectTrackEnd) return;
    if (track !== this._track) return; // 迟到流/已换轨/我方停轨后的异步派发：不作外部结束处理
    this._detachStream(); // 引用清空；对已 ended 的轨道再 stop 为无害 no-op
    this._callbacks.onStream?.(null);
    this._setState(this._preview ? 'preview' : 'idle');
    this._error('TRACK_ENDED', '摄像头流已在外部结束（设备断开或被系统回收），资源已释放。');
  }

  // 清理 getUserMedia 超时定时器；传入 seq 时只清理属于该请求的定时器（不动更新请求的）。
  _clearRequestTimer(seq) {
    if (this._requestTimer === null) return;
    if (seq !== undefined && this._requestTimerSeq !== seq) return;
    clearTimeout(this._requestTimer);
    this._requestTimer = null;
    this._requestTimerSeq = null;
  }

  _createUrl(blob) {
    try {
      const url = typeof this._deps.createObjectURL === 'function' ? this._deps.createObjectURL(blob) : null;
      if (url) {
        this._liveUrls.add(url);
        this._counters.urlsCreated += 1;
      }
      return url;
    } catch {
      return null;
    }
  }

  _revokeUrl(url) {
    if (!url) return;
    this._liveUrls.delete(url);
    this._counters.urlsRevoked += 1;
    try {
      this._deps.revokeObjectURL?.(url);
    } catch {
      // 撤销失败不阻断清理流程。
    }
  }

  _revokePreview(preview) {
    if (!preview) return;
    this._revokeUrl(preview.url);
    this._revokeUrl(preview.thumbnail?.url ?? null);
  }

  // ---------- 直开摄像头路径（用户点击触发） ----------

  openFromUserGesture(options = {}) {
    if (this._disposed) return this._fail('DISPOSED');
    if (this._state === 'requesting' || this._state === 'capturing') return this._fail('ALREADY_PENDING');
    if (this._hasLiveStream()) return this._fail('ALREADY_OPEN');
    if (!this._capabilities.liveCameraSupported) {
      this._setState('unsupported');
      this._error(
        'UNSUPPORTED',
        '当前环境不支持直接调用摄像头（需要HTTPS或localhost安全上下文，且浏览器提供getUserMedia）。可改用“选择文件（系统拍照/相册）”。',
        { fallbackHint: 'file_picker' },
      );
      return this._fail('UNSUPPORTED', { fallback: 'file_picker' });
    }
    return this._beginRequest({ ...this._deps.video, ...(options.video ?? {}) });
  }

  _beginRequest(videoConstraints) {
    this._clearRequestTimer();
    const seq = ++this._seq;
    this._cancelRequested = false;
    this._setState('requesting');
    // 音频恒为false：本模块任何路径都不申请麦克风。
    this._counters.gumCalls += 1;
    let streamPromise;
    try {
      const constraints = { audio: false, video: videoConstraints };
      if (constraints.audio !== false) this._counters.micConstraintViolations += 1;
      streamPromise = this._deps.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // v0.2.0：同步 throw 与异步失败同路径映射，不崩溃。
      const mapped = mapStreamError(err);
      this._setState(mapped.state);
      this._error(mapped.code, mapped.message);
      return { ok: false, code: mapped.code };
    }
    if (this._requestTimeoutMs !== null) {
      this._requestTimerSeq = seq;
      this._requestTimer = setTimeout(() => {
        this._requestTimer = null;
        this._requestTimerSeq = null;
        this._handleRequestTimeout(seq);
      }, this._requestTimeoutMs);
    }
    streamPromise.then(
      (stream) => this._handleStreamArrival(seq, stream),
      (err) => this._handleStreamFailure(seq, err),
    );
    return { ok: true, pending: true, seq };
  }

  // v0.2.0：getUserMedia 超时未 settled → 按 cancelRequest 语义自动取消。
  // 迟到的授权流/失败由 _handleStreamArrival/_handleStreamFailure 的守卫停轨静默丢弃。
  _handleRequestTimeout(seq) {
    if (this._disposed || seq !== this._seq || this._cancelRequested || this._state !== 'requesting') return;
    this._seq += 1;
    this._cancelRequested = true;
    this._setState('idle');
    this._error('REQUEST_TIMEOUT', '请求超时，已自动取消并释放资源，可重试。');
  }

  _handleStreamArrival(seq, stream) {
    this._clearRequestTimer(seq);
    // 迟到或已取消：立即停轨，不改变当前状态、不通知页面。
    if (this._disposed || seq !== this._seq || this._cancelRequested) {
      this._stopStream(stream);
      return;
    }
    const track = stream?.getVideoTracks?.()[0] ?? null;
    if (!track) {
      this._stopStream(stream);
      this._setState('error');
      this._error('NO_VIDEO_TRACK', '摄像头流中没有视频轨道。');
      return;
    }
    this._stream = stream;
    this._track = track;
    this._lastError = null;
    this._counters.streamsAdopted += 1;
    this._attachTrackEndListener(track);
    this._setState('ready');
    this._callbacks.onStream?.(stream);
  }

  _handleStreamFailure(seq, err) {
    this._clearRequestTimer(seq);
    // 迟到的失败（如用户已取消、已换设备、已释放）：静默清理，不弹框、不重试。
    if (this._disposed || seq !== this._seq || this._cancelRequested) return;
    const mapped = mapStreamError(err);
    this._setState(mapped.state);
    this._error(mapped.code, mapped.message);
  }

  // 用户主动放弃等待：立即退出requesting；迟到的授权结果到达时会被停轨丢弃。
  cancelRequest() {
    if (this._disposed) return this._fail('DISPOSED');
    if (this._state !== 'requesting') return this._fail('NOT_PENDING');
    this._clearRequestTimer();
    this._seq += 1;
    this._cancelRequested = true;
    this._setState('idle');
    return { ok: true };
  }

  // 换设备（如前/后摄）：按MDN建议先停旧轨再以新facingMode发起请求。
  switchCamera(videoOptions = {}) {
    if (this._disposed) return this._fail('DISPOSED');
    if (this._state === 'requesting' || this._state === 'capturing') return this._fail('ALREADY_PENDING');
    if (!this._capabilities.liveCameraSupported) return this._fail('UNSUPPORTED', { fallback: 'file_picker' });
    this._detachStream();
    this._setState('idle');
    return this._beginRequest({ ...this._deps.video, ...videoOptions });
  }

  closeStream() {
    if (this._disposed) return this._fail('DISPOSED');
    if (this._state === 'requesting') return this.cancelRequest();
    if (this._state === 'capturing') return this._fail('CAPTURE_IN_PROGRESS');
    if (this._hasLiveStream()) {
      this._detachStream();
      this._setState(this._preview ? 'preview' : 'idle');
      return { ok: true };
    }
    return this._fail('NO_STREAM');
  }

  // ---------- 拍照增强（可选） ----------

  capture() {
    if (this._disposed) return this._fail('DISPOSED');
    if (this._state === 'capturing') return this._fail('CAPTURE_IN_PROGRESS');
    if (!this._hasLiveStream()) return this._fail('NO_STREAM');
    const ImageCaptureImpl = this._deps.ImageCapture;
    if (typeof ImageCaptureImpl !== 'function') return this._imageCaptureUnsupported();
    let imageCapture;
    try {
      imageCapture = new ImageCaptureImpl(this._track);
    } catch {
      return this._imageCaptureUnsupported();
    }
    if (typeof imageCapture.takePhoto !== 'function') return this._imageCaptureUnsupported();
    const seq = ++this._seq;
    this._setState('capturing');
    let photoPromise;
    try {
      photoPromise = imageCapture.takePhoto();
    } catch (err) {
      // v0.2.0：同步 throw 走与异步失败同路径（single 模式关轨）。
      return this._handlePhotoFailure(seq, err);
    }
    photoPromise.then(
      (blob) => this._handlePhotoArrival(seq, blob),
      (err) => this._handlePhotoFailure(seq, err),
    );
    return { ok: true, pending: true, seq };
  }

  _imageCaptureUnsupported() {
    // 明确回退到系统选图；绝不暗中截帧（grabFrame）冒充 takePhoto 或传感器原图。
    this._error(
      'IMAGECAPTURE_UNSUPPORTED',
      '当前浏览器不支持ImageCapture.takePhoto拍照增强。可改用“选择文件（系统拍照/相册）”。',
      { fallbackHint: 'file_picker' },
    );
    return this._fail('IMAGECAPTURE_UNSUPPORTED', { fallback: 'file_picker' });
  }

  _handlePhotoArrival(seq, blob) {
    // 迟到的照片（用户已取消/换设备/选了文件/释放）：直接丢弃；blob未创建URL，无需释放。
    if (this._disposed || seq !== this._seq) return;
    if (!looksLikeBlob(blob) || blob.size === 0) {
      this._setState('error');
      this._error('CAPTURE_FAILED', '拍照返回了空图像。');
      // v0.2.0：single 模式失败（含空 Blob）也立即关轨。
      if (this._captureMode === 'single') this._detachStream();
      return;
    }
    this._ingestPreview(blob, { sourceMethod: SOURCE_METHODS.LIVE_TAKEPHOTO, captureHint: null, seq })
      .then(() => {
        // v0.2.0：single 模式成功先完成预览 ingest（state 'preview'），随后立即关轨。
        // ingest 被 acceptFile 作废（seq 已被超越）时不在此处关轨：
        // 保持 v0.1.0“acceptFile 使在途 takePhoto 作废”的语义，残留流可经 closeStream/dispose 释放。
        if (this._disposed || this._captureMode !== 'single') return;
        if (seq === this._seq) this._detachStream();
      })
      .catch(() => {
        // 兜底：ingest 意外异常时 single 模式同样关轨，避免流滞留。
        if (this._disposed || this._captureMode !== 'single') return;
        if (seq === this._seq) this._detachStream();
      });
  }

  _handlePhotoFailure(seq, err) {
    if (this._disposed || seq !== this._seq) return this._fail('CAPTURE_FAILED');
    this._setState('error');
    this._error('CAPTURE_FAILED', `拍照失败：${err?.name || err?.message || '未知错误'}`);
    // v0.2.0：single 模式失败也立即关轨；continuous 保持 v0.1.0 行为（流保留可重试）。
    if (this._captureMode === 'single') this._detachStream();
    return this._fail('CAPTURE_FAILED');
  }

  // ---------- 系统拍照/选图路径（渐进增强入口） ----------

  // captureHint 仅登记 <input capture> 的提示值，不作为文件出处证明。
  // 选择文件会使仍在途的takePhoto与未决的摄像头请求作废（后选文件优先，迟到流到货即停轨）。
  acceptFile(file, options = {}) {
    if (this._disposed) return Promise.resolve(this._fail('DISPOSED'));
    if (!looksLikeBlob(file)) {
      this._error('NOT_AN_IMAGE', '请选择图片文件。');
      return Promise.resolve(this._fail('NOT_AN_IMAGE'));
    }
    const mime = typeof file.type === 'string' ? file.type : '';
    if (mime && !mime.startsWith('image/')) {
      this._error('NOT_AN_IMAGE', `不支持的文件类型：${mime}。请选择图片文件。`);
      return Promise.resolve(this._fail('NOT_AN_IMAGE'));
    }
    if (file.size === 0) {
      this._error('EMPTY_FILE', '文件内容为空。');
      return Promise.resolve(this._fail('EMPTY_FILE'));
    }
    const captureHint = options.captureHint ?? null;
    const seq = ++this._seq;
    // v0.2.0：换文件使未决摄像头请求作废时，其超时定时器一并终止。
    this._clearRequestTimer();
    return this._ingestPreview(file, { sourceMethod: SOURCE_METHODS.FILE_PICKER, captureHint, seq }).catch(
      (err) => {
        if (this._disposed) return this._fail('DISPOSED');
        this._setState('error');
        this._error('PREVIEW_BUILD_FAILED', `本地预览构建失败：${err?.message || '未知错误'}`);
        return this._fail('PREVIEW_BUILD_FAILED');
      },
    );
  }

  async _ingestPreview(blob, { sourceMethod, captureHint, seq }) {
    const warnings = [];
    let width = null;
    let height = null;
    try {
      const meta = await this._deps.decodeImageMetadata(blob);
      if (meta && Number.isFinite(meta.width) && Number.isFinite(meta.height)) {
        width = meta.width;
        height = meta.height;
      } else {
        warnings.push('metadata_unavailable');
      }
    } catch {
      warnings.push('metadata_unavailable');
    }
    let thumbnail = null;
    try {
      const thumb = await this._deps.createThumbnail(blob);
      if (thumb?.blob) {
        thumbnail = { blob: thumb.blob, width: thumb.width ?? null, height: thumb.height ?? null, url: null };
      } else {
        warnings.push('thumbnail_unavailable');
      }
    } catch {
      warnings.push('thumbnail_unavailable');
    }
    // 构建期间可能已被更新操作超越或释放：此时不得创建任何URL。
    if (this._disposed || seq !== this._seq) return this._fail('SUPERSEDED');
    const url = this._createUrl(blob); // 指向原始字节的本地预览URL；字节本身不被改动
    if (!url) warnings.push('object_url_unavailable');
    if (thumbnail) thumbnail.url = this._createUrl(thumbnail.blob);
    const preview = Object.freeze({
      id: `pv-${seq}-${this._deps.now()}`,
      blob, // 原始File/Blob，字节保持不变
      url, // 原件的object URL（由控制器创建、拥有并负责撤销）
      thumbnail: thumbnail ? Object.freeze({ ...thumbnail }) : null,
      width, // 解码失败时为 null：保持未知
      height,
      mime: blob.type || '',
      byteLength: blob.size,
      sourceMethod,
      captureHint: captureHint ? Object.freeze({ ...captureHint }) : null,
      origin:
        sourceMethod === SOURCE_METHODS.LIVE_TAKEPHOTO
          ? FILE_ORIGINS.LIVE_CAMERA_STREAM
          : FILE_ORIGINS.USER_FILE_SELECTION,
      // 本轮不解析EXIF：读不到的拍摄时间保持未知，不用本机时间冒充相机拍摄时间。
      capturedAt: null,
      receivedAt: this._deps.now(),
      // capture提示与任何文件来源都不能证明现场拍摄；出处恒为未验证。
      provenance: 'unverified',
      warnings: Object.freeze(warnings),
    });
    const previous = this._preview;
    this._preview = preview;
    this._revokePreview(previous); // 换图释放：旧预览的URL立即撤销
    this._lastError = null;
    this._setState('preview');
    this._callbacks.onPreview?.(preview);
    return { ok: true, preview };
  }

  // ---------- 释放 ----------

  // 停全部轨道、撤销全部URL；幂等。dispose后一切操作no-op，迟到结果到货即清理。
  dispose() {
    if (this._disposed) return { ok: true, code: 'DISPOSED' };
    this._disposed = true;
    this._clearRequestTimer();
    this._seq += 1;
    this._cancelRequested = true;
    this._detachStream(true); // 通知页面清空video
    for (const url of [...this._liveUrls]) this._revokeUrl(url);
    this._preview = null;
    this._state = 'disposed';
    this._callbacks.onStateChange?.(this.getSnapshot());
    return { ok: true, code: 'DISPOSED' };
  }
}

// v0.3.0新增：资源收据构造器（纯函数；Node测试与浏览器壳共用同一实现）。
// events: 页面/测试收集的回调事件序列 [{t, kind, ...}]；finalUsage: 收束时getResourceUsage()；
// counters: 收束时getResourceCounters()；meta: {reason:'hangup'|'leave'|'dispose'|'close', startedAt, endedAt, version}
// uploadsAttempted 由页面级fetch/XHR探针填写——控制器不感知上传，缺省null（不得缺省填0冒称已测）。
/** @param {{ events?: { t: number; kind: string }[]; finalUsage?: unknown; counters?: Record<string, number | null>; meta?: Record<string, unknown> }} opts */
export function buildResourceReceipt({ events = [], finalUsage, counters, meta } = {}) {
  const urlsCreated = counters?.urlsCreated ?? 0;
  const urlsRevoked = counters?.urlsRevoked ?? 0;
  const receipt = {
    kind: 'camera-resource-receipt',
    version: meta?.version ?? CAMERA_CONTROLLER_VERSION,
    reason: meta?.reason ?? 'dispose',
    startedAt: meta?.startedAt ?? null,
    endedAt: meta?.endedAt ?? null,
    micRequests: counters?.micConstraintViolations ?? 0, // 必须0
    uploadsAttempted: meta?.uploadsAttempted ?? null,
    gumCallsTotal: counters?.gumCalls ?? 0,
    streamsAdopted: counters?.streamsAdopted ?? 0,
    tracksStoppedByController: counters?.tracksStoppedByController ?? 0,
    urlsCreated,
    urlsRevoked,
    danglingUrls: Math.max(0, urlsCreated - urlsRevoked),
    liveTracksAtEnd: finalUsage?.liveTracks ?? null, // 终态必须0
    urlsHeldAtEnd: finalUsage?.urlsHeld ?? null, // 终态必须0
    stateAtEnd: finalUsage?.state ?? null,
    eventLog: Object.freeze(events.map((e) => Object.freeze({ ...e }))),
  };
  return Object.freeze(receipt);
}
