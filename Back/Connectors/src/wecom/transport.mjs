import { ConnError } from '../errors.mjs';

/**
 * 提供方传输端口。真实出站只允许 HTTPS + 显式 allowlist（SSRF 基线）。
 * 真实调用需要 config.allowRealWecom === true 且凭据存在；缺一即 BLOCKED_EXTERNAL——
 * 禁止在未授权时以任何方式触网，也禁止用 fake 的 PASS 冒充真实链路。
 */

export const WECOM_ALLOWED_HOSTS = ['qyapi.weixin.qq.com'];

export function assertOutboundUrl(urlStr, allowedHosts = WECOM_ALLOWED_HOSTS) {
  let u;
  try { u = new URL(urlStr); } catch { throw new ConnError('OUTBOUND_BLOCKED', `unparseable url`); }
  if (u.protocol !== 'https:') throw new ConnError('OUTBOUND_BLOCKED', `protocol ${u.protocol} not allowed`);
  if (!allowedHosts.includes(u.hostname)) throw new ConnError('OUTBOUND_BLOCKED', `host ${u.hostname} not in allowlist`);
  return u;
}

export class FakeWecomTransport {
  constructor() {
    this.chatDataPages = [];        // [{ items: [{seq, msgid, encrypt_random_key, encrypt_chat_msg}] }]
    this.mediaBlobs = new Map();    // sdkfileid -> Buffer
    this.mediaFailures = new Map(); // sdkfileid -> 'error'|'timeout'
    this.kfInbox = [];              // sync_msg items
    this.kfCursor = 0;
    this.sendResults = [];          // queue: {mode:'ok',msgid}|{mode:'fail',failType}|{mode:'unsupported'}
    this.sent = [];
    this.agreeResults = new Map();  // `${userid}|${openid}` -> 'Agree'|'Disagree'
    this.calls = { getChatData: 0, getMediaData: 0, kfSendMsg: 0, kfSyncMsg: 0, checkSingleAgree: 0 };
  }

  async getChatData({ seq, limit = 1000 }) {
    this.calls.getChatData += 1;
    const items = this.chatDataPages.flat().filter((x) => x.seq > seq).sort((a, b) => a.seq - b.seq).slice(0, limit);
    return { errcode: 0, items, provider: { note: 'U1: 拉取窗口5天，超窗历史不可取（由 caller 注入 archive_gap 场景）' } };
  }

  setMedia(sdkfileid, buf) { this.mediaBlobs.set(sdkfileid, buf); }
  failMedia(sdkfileid, mode = 'error') { this.mediaFailures.set(sdkfileid, mode); }

  async getMediaData({ sdkfileid, indexbuf }) {
    this.calls.getMediaData += 1;
    if (this.mediaFailures.has(sdkfileid)) {
      const mode = this.mediaFailures.get(sdkfileid);
      if (mode === 'timeout') throw new ConnError('INTERNAL', 'media gateway timeout');
      throw new ConnError('INTERNAL', 'media download error');
    }
    const blob = this.mediaBlobs.get(sdkfileid);
    if (!blob) throw new ConnError('INTERNAL', `unknown sdkfileid ${sdkfileid}`);
    const CHUNK = 512 * 1024;
    const offset = indexbuf ? Number(indexbuf) : 0;
    const slice = blob.subarray(offset, offset + CHUNK);
    const nextOffset = offset + slice.length;
    return { data: slice, indexbuf: nextOffset < blob.length ? String(nextOffset) : '', is_finish: nextOffset >= blob.length };
  }

  async checkSingleAgree(pairs) {
    this.calls.checkSingleAgree += 1;
    return {
      errcode: 0,
      agreeinfo: pairs.map(({ userid, exteranalopenid }) => ({
        userid, exteranalopenid,
        agree_status: this.agreeResults.get(`${userid}|${exteranalopenid}`) ?? 'Agree',
        status_change_time: Math.floor(Date.now() / 1000),
      })),
    };
  }

  queueKfMessages(items) { this.kfInbox.push(...items); }
  queueSendResult(r) { this.sendResults.push(r); }

  async kfSyncMsg({ cursor }) {
    this.calls.kfSyncMsg += 1;
    const from = cursor ? Number(cursor) : 0;
    const items = this.kfInbox.slice(from, from + 1000);
    return { errcode: 0, next_cursor: String(from + items.length), msg_list: items };
  }

  async kfSendMsg(payload) {
    this.calls.kfSendMsg += 1;
    const r = this.sendResults.shift() ?? { mode: 'ok', msgid: `kf_sent_${this.calls.kfSendMsg}` };
    this.sent.push(payload);
    if (r.mode === 'fail') return { errcode: 40096, errmsg: 'fail', fail_type: r.failType ?? 3 };
    if (r.mode === 'unsupported') return { errcode: 0, msgid: null, status_supported: false };
    return { errcode: 0, msgid: r.msgid, status_supported: true };
  }
}

export class HttpWecomTransport {
  constructor(config) {
    if (!config || config.allowRealWecom !== true) {
      throw new ConnError('BLOCKED_EXTERNAL', '真实企业微信调用未授权（allowRealWecom != true）。保持 BLOCKED，不做静默 mock。');
    }
    for (const k of ['corpid', 'archiveSecret', 'token', 'encodingAESKey']) {
      if (!config[k]) throw new ConnError('BLOCKED_EXTERNAL', `missing wecom config: ${k}`);
    }
    this.config = config;
  }

  base(path, params) {
    const u = assertOutboundUrl(`https://qyapi.weixin.qq.com${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  async getChatData({ seq, limit }) {
    // U1: 真实拉取经 WeWorkFinanceSdk(C)；HTTP 直拉不存在——明确失败而非伪装成功。
    throw new ConnError('BLOCKED_EXTERNAL', 'GetChatData 需官方 C SDK（WeWorkFinanceSdk），HTTP 不可直拉；E2 用 SDK 适配器接入');
  }

  async getMediaData() { throw new ConnError('BLOCKED_EXTERNAL', 'GetMediaData 需官方 SDK；E2 接入'); }
  async checkSingleAgree(pairs) {
    const res = await fetch(this.base('/cgi-bin/msgaudit/check_single_agree', { access_token: await this.accessToken() }), {
      method: 'POST', body: JSON.stringify({ info: pairs }),
    });
    return res.json();
  }
  async kfSyncMsg({ cursor, token }) {
    const res = await fetch(this.base('/cgi-bin/kf/sync_msg', { access_token: await this.accessToken() }), {
      method: 'POST', body: JSON.stringify({ cursor, token, limit: 1000 }),
    });
    return res.json();
  }
  async kfSendMsg(payload) {
    const res = await fetch(this.base('/cgi-bin/kf/send_msg', { access_token: await this.accessToken() }), {
      method: 'POST', body: JSON.stringify(payload),
    });
    return res.json();
  }
  async accessToken() {
    // token 获取未接：E2 前不实现缓存，直接 BLOCKED，避免半可用的真实路径。
    throw new ConnError('BLOCKED_EXTERNAL', 'access_token 获取待 E2 配置与授权');
  }
}
