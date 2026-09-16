import { createHmac } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256Hex } from '../ids.mjs';
import { ConnError } from '../errors.mjs';

/**
 * 本地 FS 对象存储（E1）：受控目录 + 短时签名 URL；没有无鉴权的公开读路径。
 * 对象元数据（sha256/size）与 DB objects 表同事务语义（先文件后元数据，put 幂等）。
 * COS/S3 适配（真实对象存储）属 E2：接口见 port 注释，本文件不冒充已验证的 S3 实现。
 */
export function makeFsObjectStore({ root, store, signingSecret }) {
  if (!root || !signingSecret) throw new ConnError('INVALID_INPUT', 'objectstore: root/signingSecret required');

  function pathFor(objectRef) {
    if (objectRef.includes('..')) throw new ConnError('INVALID_INPUT', 'objectRef path traversal');
    return join(root, objectRef);
  }

  async function put(objectRef, buf, { tenantId, contentType = 'application/octet-stream' } = {}) {
    const p = pathFor(objectRef);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, buf);
    await store.query(
      `INSERT INTO objects (object_ref, tenant_id, sha256, size_bytes, content_type, storage_path) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (object_ref) DO UPDATE SET sha256=$3, size_bytes=$4, content_type=$5`,
      [objectRef, tenantId, sha256Hex(buf), buf.length, contentType, p],
    );
    return { objectRef, sha256: sha256Hex(buf), size: buf.length };
  }

  async function get(objectRef) {
    const meta = await statRow(objectRef);
    const buf = await readFile(meta.storage_path);
    if (sha256Hex(buf) !== meta.sha256) throw new ConnError('INTERNAL', `object ${objectRef} checksum mismatch`);
    return buf;
  }

  async function statRow(objectRef) {
    const r = await store.query(`SELECT * FROM objects WHERE object_ref=$1`, [objectRef]);
    if (r.rows.length === 0) throw new ConnError('NOT_FOUND', `object ${objectRef}`);
    return r.rows[0];
  }

  function sign({ objectRef, op, customerId, tenantId, ttlSec, nowMs = Date.now() }) {
    const exp = nowMs + ttlSec * 1000;
    const payload = `${op}|${objectRef}|${tenantId}|${customerId}|${exp}`;
    const sig = createHmac('sha256', signingSecret).update(payload).digest('base64url');
    return `/objects/${objectRef}?op=${op}&tid=${encodeURIComponent(tenantId)}&cid=${encodeURIComponent(customerId)}&exp=${exp}&sig=${sig}`;
  }

  function verify({ objectRef, op, tid, cid, exp, sig, nowMs = Date.now() }) {
    if (!sig || !exp) throw new ConnError('MEDIA_URL_BAD_SIGNATURE');
    if (Number(exp) < nowMs) throw new ConnError('MEDIA_URL_EXPIRED', `expired at ${exp}`);
    const payload = `${op}|${objectRef}|${tid}|${cid}|${exp}`;
    const expected = createHmac('sha256', signingSecret).update(payload).digest('base64url');
    if (expected !== sig) throw new ConnError('MEDIA_URL_BAD_SIGNATURE');
    return { tenantId: tid, customerId: cid, op };
  }

  return { put, get, stat: statRow, sign, verify, root };
}
