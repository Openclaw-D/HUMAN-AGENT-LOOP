// 生成确定性合成PNG（800×1200, RGB）：用于浏览器模块验证的“原件”素材。
// 内容由整数运算逐像素决定，不依赖随机数与外部资源；同脚本重跑字节完全一致。
// 用法：node tools/make-synthetic-png.mjs  → 写 evidence/assets/synthetic-800x1200.png 并打印SHA-256。
// 本文件由主agent拥有；仅本地生成测试素材，不上传。
import { deflateSync, crc32 as zCrc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 800;
const H = 1200;

function crc32(buf) {
  if (typeof zCrc32 === 'function') return zCrc32(buf);
  // Node < 22.2 回退：标准CRC-32表实现
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 原始扫描线：每行前置filter字节0；像素值由确定性整数函数给出（不易压缩，接近照片体量）。
const raw = Buffer.alloc(H * (1 + W * 3));
let off = 0;
for (let y = 0; y < H; y++) {
  raw[off++] = 0;
  for (let x = 0; x < W; x++) {
    const r = (x * 7 + y * 13 + ((x * y) % 251)) % 256;
    const g = (x * 3 + y * 29 + ((x + y) % 199)) % 256;
    const b = (x * 41 + y * 5 + ((x * x + y) % 241)) % 256;
    raw[off++] = r;
    raw[off++] = g;
    raw[off++] = b;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 6 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'assets', 'synthetic-800x1200.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`file=${out}`);
console.log(`bytes=${png.length}`);
console.log(`sha256=${createHash('sha256').update(png).digest('hex')}`);
console.log(`dimensions=${W}x${H}`);
