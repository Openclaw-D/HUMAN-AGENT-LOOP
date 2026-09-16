import { randomUUID, createHash } from 'node:crypto';

export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}
