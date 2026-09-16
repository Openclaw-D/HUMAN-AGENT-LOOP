// 任务 03 · C 路四域模块共用小工具：稳定序列化与哈希（零依赖）。

/** 规范化 JSON（键排序、剔除 undefined），保证 inputHash 可重放。 */
export function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

import { createHash } from 'node:crypto';

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function stableHash(value) {
  return sha256(stableStringify(value));
}
