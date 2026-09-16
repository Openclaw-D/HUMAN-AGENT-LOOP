import { createHash } from 'node:crypto';

function normalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`Canonical JSON rejects undefined at ${key}.`);
      result[key] = normalize(value[key]);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}.`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function canonicalHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function clone(value) {
  return structuredClone(value);
}
