import { createHash, createDecipheriv, createCipheriv, createSign, createVerify, randomBytes, privateDecrypt } from 'node:crypto';
import { ConnError } from '../errors.mjs';

/**
 * 企业微信回调加解密（官方文档 U-90968《加解密方案说明》，读取 2026-09-16）：
 * - EncodingAESKey(43字符) + '=' Base64 解码 → 32字节 AES-256-CBC 密钥；IV=密钥前16字节。
 * - 明文结构：random(16B) + msg_len(4B, 网络序) + msg + receiveid(corpid)；PKCS#7 补位到 32 字节块。
 * - 签名：msg_signature = sha1(sort(token, timestamp, nonce, encrypt_msg).join(''))。
 * 会话存档消息解密（U1）：encrypt_random_key = RSA(PKCS#1 v1.5, 企业公钥) 加密的会话随机密钥；
 * encrypt_chat_msg 由官方 C SDK DecryptData 解密。本模块提供 local-cbc 实现用于合成链路，
 * E2 时必须对照真实 SDK 输出校验；真实模式 'sdk' 未实现（BLOCKED_EXTERNAL）。
 */

export function aesKeyFromEncodingAESKey(encodingAESKey) {
  if (!/^[A-Za-z0-9]{43}$/.test(encodingAESKey)) throw new ConnError('INVALID_INPUT', 'EncodingAESKey must be 43 base64 chars');
  return Buffer.from(encodingAESKey + '=', 'base64');
}

export function callbackSignature(token, timestamp, nonce, encrypt) {
  return createHash('sha1')
    .update([token, timestamp, nonce, encrypt].sort().join(''))
    .digest('hex');
}

function pkcs7Pad(buf, blockSize = 32) {
  const pad = blockSize - (buf.length % blockSize);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

function pkcs7Unpad(buf, blockSize = 32) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > blockSize) throw new ConnError('CALLBACK_BAD_SIGNATURE', 'bad padding');
  for (let i = buf.length - pad; i < buf.length; i++) if (buf[i] !== pad) throw new ConnError('CALLBACK_BAD_SIGNATURE', 'bad padding');
  return buf.subarray(0, buf.length - pad);
}

export function encryptCallbackMessage({ aesKey, plaintext, receiveId }) {
  const random = randomBytes(16);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(Buffer.byteLength(plaintext), 0);
  const data = pkcs7Pad(Buffer.concat([random, len, Buffer.from(plaintext), Buffer.from(receiveId)]));
  const cipher = createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('base64');
}

export function decryptCallbackMessage({ aesKey, encryptB64, receiveId }) {
  const cipherText = Buffer.from(encryptB64, 'base64');
  if (cipherText.length % 32 !== 0) throw new ConnError('CALLBACK_BAD_SIGNATURE', 'ciphertext not block aligned');
  const decipher = createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
  decipher.setAutoPadding(false);
  const plain = pkcs7Unpad(Buffer.concat([decipher.update(cipherText), decipher.final()]));
  if (plain.length < 20) throw new ConnError('CALLBACK_BAD_SIGNATURE', 'plaintext too short');
  const msgLen = plain.readUInt32BE(16);
  const msg = plain.subarray(20, 20 + msgLen).toString('utf8');
  const rid = plain.subarray(20 + msgLen).toString('utf8');
  if (receiveId && rid !== receiveId) throw new ConnError('CALLBACK_RECEIVEID_MISMATCH', `receiveid ${rid} != ${receiveId}`);
  return msg;
}

/** 校验回调签名；timestamp 超出窗口视为过期（防重放第一道；幂等由收件箱兜底）。 */
export function verifyCallback({ token, aesKey, receiveId, signature, timestamp, nonce, encrypt, nowMs, maxAgeSec = 300 }) {
  const expected = callbackSignature(token, timestamp, nonce, encrypt);
  if (expected !== signature) throw new ConnError('CALLBACK_BAD_SIGNATURE');
  if (nowMs != null) {
    const ts = Number(timestamp) * 1000;
    if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > maxAgeSec * 1000) throw new ConnError('CALLBACK_EXPIRED', `timestamp ${timestamp} outside ±${maxAgeSec}s`);
  }
  return decryptCallbackMessage({ aesKey, encryptB64: encrypt, receiveId });
}

/** URL 验证（GET echostr）：同样签名校验后返回明文。 */
export function verifyUrlEcho({ token, aesKey, receiveId, msgSignature, timestamp, nonce, echostr, nowMs }) {
  return verifyCallback({ token, aesKey, receiveId, signature: msgSignature, timestamp, nonce, encrypt: echostr, nowMs });
}

/** RSA 解 encrypt_random_key（企业私钥，PKCS#1 v1.5）。privateKeyPem 由配置注入；测试用合成密钥对。 */
export function decryptArchiveRandomKey({ privateKeyPem, encryptRandomKeyB64 }) {
  const buf = Buffer.from(encryptRandomKeyB64, 'base64');
  return privateDecrypt({ key: privateKeyPem, padding: 'RSA_PKCS1_PADDING' }, buf).toString('utf8');
}

/**
 * 会话消息 AES 解密（local-cbc 模式：与回调同构的 AES-256-CBC/IV=key[:16]/PKCS7(32B)）。
 * 官方 C SDK DecryptData 的内部实现细节以 E2 实测为准；如不一致只需替换本函数，不动管线。
 */
export function decryptArchiveChatMessage({ mode = 'local-cbc', chatKeyB64, encryptChatMsgB64 }) {
  if (mode === 'sdk') throw new ConnError('BLOCKED_EXTERNAL', 'SDK DecryptData requires WeWorkFinanceSdk; not available in local pipeline');
  if (mode !== 'local-cbc') throw new ConnError('INVALID_INPUT', `unknown archive decrypt mode ${mode}`);
  const key = Buffer.from(chatKeyB64, 'base64');
  if (key.length !== 32) throw new ConnError('CALLBACK_BAD_SIGNATURE', 'chat key must be 32 bytes');
  const ct = Buffer.from(encryptChatMsgB64, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const plain = pkcs7Unpad(Buffer.concat([decipher.update(ct), decipher.final()]));
  return plain.toString('utf8');
}

export function encryptArchiveChatMessage({ chatKeyB64, plaintext }) {
  const key = Buffer.from(chatKeyB64, 'base64');
  const data = pkcs7Pad(Buffer.from(plaintext));
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('base64');
}

export { createSign, createVerify };
