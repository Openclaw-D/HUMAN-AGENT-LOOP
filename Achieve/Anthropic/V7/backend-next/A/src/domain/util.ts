import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { AppError } from './errors.ts';

export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** 规范化 JSON（键排序）后哈希：幂等载荷与 inputHash 都用它，保证载荷一致性判定与键序无关。 */
export function canonicalHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** 嵌套禁用键扫描（CONTRACT §3.1：模型/计算不得承载审批/额度/价格语义字段，结构层强制）。 */
const FORBIDDEN_KEY_RE = /approv|decision|quota|price|rate|reject/i;

export function assertNoForbiddenKeys(value: unknown, label: string): void {
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v !== null && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (FORBIDDEN_KEY_RE.test(k)) {
          throw new AppError('FORBIDDEN_KEY', `${path}.${k} 携带禁用键（候选结果不得承载审批语义字段）`);
        }
        walk(child, `${path}.${k}`);
      }
    }
  };
  walk(value, label);
}

export const uuid = (): string => randomUUID();
