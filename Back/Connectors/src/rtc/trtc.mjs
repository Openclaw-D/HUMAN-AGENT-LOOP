import { createHmac } from 'node:crypto';
import { ConnError } from '../errors.mjs';

/**
 * TRTC 适配器（S4 官方回调契约，cloud.tencent.com/document/product/647/81113，2024-10-12 读取）。
 * - 回调签名：Sign 头 = base64(hmacsha256(key, 原始body))。
 * - 事件组3=云端录制：301/302/303/304/305/306/307/309/310/311/312（页面录制 801-804）。
 * - REST StartCloudRecording 需腾讯云密钥（SigV4）→ 未授权即 BLOCKED_EXTERNAL。
 * - LocalLoop：同一回调契约的合成媒体面（明确 sourceMode=synthetic），供 E0/E1 与 I24。
 */

export function verifyTrtcSignature({ key, rawBody, signHeader }) {
  const expected = createHmac('sha256', key).update(rawBody).digest('base64');
  if (!signHeader || signHeader !== expected) throw new ConnError('CALLBACK_BAD_SIGNATURE', 'TRTC Sign header mismatch');
  return true;
}

export function parseTrtcEvent(rawBody) {
  let evt;
  try { evt = JSON.parse(rawBody); } catch { throw new ConnError('INVALID_INPUT', 'trtc callback body not json'); }
  if (typeof evt.EventGroupId !== 'number' || typeof evt.EventType !== 'number') throw new ConnError('INVALID_INPUT', 'missing EventGroupId/EventType');
  if (evt.EventGroupId !== 3) throw new ConnError('INVALID_INPUT', `unsupported EventGroupId ${evt.EventGroupId} (only cloud recording = 3 wired)`);
  return evt;
}

/** 真实 REST 适配：请求体构造按官方参数；调用被授权守卫拦住。 */
export class TrtcRestAdapter {
  constructor(config) {
    if (config?.allowRealTrtc !== true) {
      throw new ConnError('BLOCKED_EXTERNAL', 'TRTC 真实调用未授权（allowRealTrtc != true）。付费服务未获批，不静默 mock。');
    }
    this.config = config;
  }

  buildStartCloudRecordingParams({ sdkAppId, roomId, userId, userType = 0, recordType = 0, outputFormat = { filetype: 'mp4', is_audio_only: 0 } }) {
    return {
      SdkAppId: Number(sdkAppId), RoomId: String(roomId), UserId: String(userId), UserSig: 'REQUIRES_TRTC_SIGV4_AND_USERSIG',
      RecordParams: { RecordType: recordType, MaxIdleTime: 60, FileType: outputFormat.filetype, IsAudioOnly: outputFormat.is_audio_only },
      StorageParams: { CloudStorage: { StorageType: 0, Cos: { Region: 'REPLACE', Bucket: 'REPLACE', SecretId: 'REPLACE', SecretKey: 'REPLACE' } } },
      MixSearchParams: null,
    };
  }

  async startCloudRecording() { throw new ConnError('BLOCKED_EXTERNAL', 'TRTC REST StartCloudRecording 需密钥与计费授权（E2）'); }
  async stopCloudRecording() { throw new ConnError('BLOCKED_EXTERNAL', 'TRTC REST StopCloudRecording 需密钥与计费授权（E2）'); }
  async fetchRecordingFile() { throw new ConnError('BLOCKED_EXTERNAL', '录制对象取回（COS/VOD）需存储授权（E2）'); }
}

/** 合成媒体面：产生与官方同构的回调事件（经同一签名校验路径），文件写本地对象存储。 */
export class LocalLoopAdapter {
  constructor({ callbackKey, emit, clock = () => Date.now() }) {
    if (!callbackKey || !emit) throw new ConnError('INVALID_INPUT', 'LocalLoopAdapter: callbackKey/emit required');
    this.callbackKey = callbackKey;
    this.emit = emit; // async (rawBody, signHeader) => void  经回调入口（签名验证）
    this.clock = clock;
    this.files = new Map(); // fileName -> Buffer
  }

  envelope(EventType, EventInfo) {
    return { EventGroupId: 3, EventType, CallbackTs: this.clock(), EventInfo };
  }

  async post(evt) {
    const rawBody = JSON.stringify(evt);
    const sign = createHmac('sha256', this.callbackKey).update(rawBody).digest('base64');
    await this.emit(rawBody, sign);
  }

  async startTask({ roomId, tenantId, sessionId }) {
    const taskId = `loop_${roomId}`;
    this.files.set(taskId, { roomId, tenantId, sessionId, startedAt: this.clock() });
    await this.post(this.envelope(301, { RoomId: roomId, TaskId: taskId, StartTimeTs: this.clock(), Status: 0 }));
    return { taskId };
  }

  /** 模拟录制一段媒体并按官方 310/311 上报；bytes 由调用方注入（保持"内容"可控）。
   *  skipFile：310 不携带文件（完全无文件场景）；failFetch：声明了文件但取回失败（I14：回调称完成而对象缺失）。 */
  async finishTask({ taskId, bytes, status = 0, fileStatus = status, skipFile = false, failFetch = false }) {
    const t = this.files.get(taskId);
    if (!t) throw new ConnError('NOT_FOUND', `loop task ${taskId}`);
    const fileName = `${taskId}_main.mp4`;
    const eventInfo = {
      RoomId: t.roomId, TaskId: taskId, Status: fileStatus, SubStatus: 0,
      CreateTimeTs: t.startedAt, RecBeginTimeTs: t.startedAt, RecEndTimeTs: this.clock(),
      File: { CosPath: `loop-bucket/${t.roomId}/${taskId}/`, Region: 'local-loop', Bucket: 'loop-bucket' },
      FileList: skipFile ? [] : [{ FileName: fileName, UserId: 'wo_demo_external_1', TrackType: 'audio_video', MediaId: 'main', StartTimeStamp: t.startedAt, EndTimeStamp: this.clock() }],
    };
    if (!skipFile && !failFetch) this.pendingFile = { fileName, bytes };
    await this.post(this.envelope(305, { RoomId: t.roomId, TaskId: taskId, Status: status, SubStatus: 0 }));
    await this.post(this.envelope(310, eventInfo));
    await this.post(this.envelope(311, {
      RoomId: t.roomId, TaskId: taskId, Status: status, SubStatus: 0,
      TencentVod: { SubAppId: 0, FileId: `vod_${taskId}`, VideoUrl: `https://loop.invalid/vod/${taskId}.m3u8`, CacheFile: [], StartTimeStamp: t.startedAt, EndTimeStamp: this.clock() },
    }));
    await this.post(this.envelope(312, { RoomId: t.roomId, TaskId: taskId, Status: status, SubStatus: 0 }));
  }

  /** 官方回调到对象获取的桥：310 处理时由 recording 服务调用取回字节。 */
  async fetchRecordingFile({ fileName }) {
    if (this.pendingFile && this.pendingFile.fileName === fileName) return this.pendingFile.bytes;
    throw new ConnError('NOT_FOUND', `loop file ${fileName} missing (simulates callback-complete-but-object-missing)`);
  }
}
