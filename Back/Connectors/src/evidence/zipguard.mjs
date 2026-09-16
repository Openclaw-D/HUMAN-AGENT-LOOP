import zlib from 'node:zlib';
import { ConnError } from '../errors.mjs';

/**
 * ZIP 安全提取（任务02 §6 / I23）：路径穿越、压缩炸弹（实际解压字节+比率）、文件数、深度限制。
 * 依赖-free：解析 End of Central Directory + Central Directory，逐条 local header 后 inflateRaw。
 * 任何异常 → 拒绝并隔离记录；原件不做"清洗"覆盖。
 */

export const DEFAULT_ZIP_LIMITS = {
  maxEntries: 500,
  maxTotalUncompressed: 100 * 1024 * 1024, // 100MB
  maxRatio: 200,                            // 压缩比上限（炸弹检测）
  maxDepth: 8,
  maxEntrySize: 50 * 1024 * 1024,
};

function findEOC(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new ConnError('ZIP_UNSAFE', 'End of Central Directory not found');
}

function safeEntryName(name) {
  if (name.startsWith('/') || name.startsWith('\\')) throw new ConnError('ZIP_UNSAFE', `absolute entry path: ${name}`);
  if (/^[a-zA-Z]:/.test(name)) throw new ConnError('ZIP_UNSAFE', `drive letter path: ${name}`);
  const parts = name.split(/[\\/]/);
  if (parts.some((p) => p === '..')) throw new ConnError('ZIP_UNSAFE', `path traversal entry: ${name}`);
  const clean = parts.filter((p) => p.length > 0);
  if (clean.length > DEFAULT_ZIP_LIMITS.maxDepth) throw new ConnError('ZIP_UNSAFE', `depth > ${DEFAULT_ZIP_LIMITS.maxDepth}: ${name}`);
  return clean.join('/');
}

export async function extractZip(buf, { limits = {}, onEntry } = {}) {
  const lim = { ...DEFAULT_ZIP_LIMITS, ...limits };
  const eoc = findEOC(buf);
  const totalEntries = buf.readUInt16LE(eoc + 10);
  const cdOffset = buf.readUInt32LE(eoc + 16);
  if (totalEntries > lim.maxEntries) throw new ConnError('ZIP_UNSAFE', `entries ${totalEntries} > ${lim.maxEntries}`);

  const out = new Map();
  let totalUncompressed = 0;
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ConnError('ZIP_UNSAFE', `bad central directory at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const safeName = safeEntryName(name);
    if (!safeName) { p += 46 + nameLen + extraLen + commentLen; continue; } // 目录项
    if (uncompSize > lim.maxEntrySize) throw new ConnError('ZIP_UNSAFE', `entry ${safeName} uncompressed ${uncompSize} > limit`);
    if (compSize > 0 && uncompSize / Math.max(compSize, 1) > lim.maxRatio) throw new ConnError('ZIP_UNSAFE', `compression ratio ${uncompSize}/${compSize} suspicious (bomb)`);

    // local header
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ConnError('ZIP_UNSAFE', `bad local header for ${safeName}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = await new Promise((resolve, reject) => {
      const chunks = [];
      const infl = zlib.createInflateRaw({ chunkSize: 64 * 1024 });
      let produced = 0;
      infl.on('data', (c) => { produced += c.length; if (produced > lim.maxEntrySize) { infl.destroy(new Error('uncompressed size over limit')); return; } chunks.push(c); });
      infl.on('error', (e) => reject(new ConnError('ZIP_UNSAFE', `inflate failed for ${safeName}: ${e.message}`)));
      infl.on('end', () => resolve(Buffer.concat(chunks)));
      infl.end(comp);
    });
    else throw new ConnError('ZIP_UNSAFE', `unsupported compression method ${method} for ${safeName}`);

    if (data.length !== uncompSize && uncompSize !== 0) throw new ConnError('ZIP_UNSAFE', `size mismatch for ${safeName}: ${data.length} != ${uncompSize}`);
    totalUncompressed += data.length;
    if (totalUncompressed > lim.maxTotalUncompressed) throw new ConnError('ZIP_UNSAFE', `total uncompressed ${totalUncompressed} > ${lim.maxTotalUncompressed} (bomb guard)`);
    out.set(safeName, data);
    if (onEntry) await onEntry({ name: safeName, data, size: data.length });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { files: out, totalUncompressed, entries: totalEntries };
}

/** 提取到落盘前的内容审查入口（隔离区语义）：返回条目列表供 evidence 登记。 */
export async function inspectZip(buf, limits) {
  const r = await extractZip(buf, { limits });
  return { ok: true, entries: [...r.files.entries()].map(([name, data]) => ({ name, size: data.length })), totalUncompressed: r.totalUncompressed };
}
