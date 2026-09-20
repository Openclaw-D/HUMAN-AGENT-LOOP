import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RECEIPT_VERSION = 2;
export const stable = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, normalize(value[k])]));
  return value;
}
export const digest = value => createHash('sha256').update(stable(value)).digest('hex');
export const contextHash = context => digest(context ?? {});
export function workspaceContext(snapshot, assistant) {
  const s = snapshot?.snapshot ?? snapshot;
  const a = s?.admission;
  const { asOf, ...scope } = a?.scope ?? {};
  return {
    assistant, customerName: s?.customer?.displayName ?? s?.customer?.name ?? s?.displayName ?? s?.name ?? null,
    scope, request: a?.request ?? null, assessmentState: a?.assessmentState ?? null,
    contextVersion: a?.inputVersion ?? a?.scope?.revision ?? null,
    candidate: a?.candidate ?? null, candidateRevision: a?.candidateRevision ?? null,
    stale: a?.stale ?? null, staleReasons: a?.staleReasons ?? [],
    preassessment: a?.preassessment ?? null, frozen: a?.frozen ?? null,
    blockers: a?.blockers ?? [], blockersCount: a?.blockers?.length ?? 0,
    materialsByDomain: Object.fromEntries((a?.cells ?? []).filter(c => c?.row === 'input' && c.domain).map(c => [c.domain, c.satisfiedItemCount ?? null])),
    evidenceRefs: [],
  };
}
export function modelConfigHash(t, maxQuestionChars, maxContextChars) {
  const c = t.mode === 'real' ? t.real ?? {} : t.mock ?? {};
  const url = new URL(c.endpoint ?? c.baseUrl);
  // Credentials never participate in the identity or receipt. Non-sensitive query parameters are routing inputs.
  const endpoint = url.origin + url.pathname;
  const query = [...url.searchParams.entries()]
    .filter(([key]) => !/key|token|secret|password|credential|authorization|signature|^sig$/i.test(key))
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  return digest({ mode: t.mode, endpoint, query,
    model: c.model ?? 'mock-glm-5.2', timeoutMs: c.timeoutMs ?? 20000, thinkingType: c.thinkingType ?? null,
    maxOutputTokens: c.maxOutputTokens ?? null, maxConcurrent: c.maxConcurrent ?? null,
    limits: { maxRequestChars: c.limits?.maxRequestChars ?? null },
    outboundAllow: c.outboundAllow ?? null, temperature: 0.1,
    maxQuestionChars, maxContextChars, adapterVersion: 2 });
}

// No file read cache: another process may have completed the receipt since our last read.
// Immutable intent + terminal files retain history. An exclusive claim is never stolen on timeout.
export function createReceipts(dir) {
  const memory = new Map();
  const filename = id => path.join(dir, 'receipts', encodeURIComponent(id) + '.json');
  return {
    namespace: dir ? path.resolve(dir) : Symbol('memory-receipts'),
    async get(id) {
      if (!dir) return memory.get(id) ?? null;
      try {
        const value = JSON.parse(await fs.readFile(filename(id), 'utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid receipt object');
        return value;
      }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async claim(id) {
      if (!dir) {
        if (memory.has(id + ':claim')) return false;
        memory.set(id + ':claim', true); return true;
      }
      await fs.mkdir(path.join(dir, 'receipts'), { recursive: true });
      try { const handle = await fs.open(filename(id) + '.claim', 'wx'); await handle.close(); return true; }
      catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    },
    async put(id, value) {
      if (!dir) { memory.set(id, structuredClone(value)); return; }
      const target = filename(id);
      const temp = target + '.' + randomUUID() + '.tmp';
      const handle = await fs.open(temp, 'wx');
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
      finally { await handle.close(); }
      // Each logical file is written once by its exclusive owner.
      await fs.rename(temp, target);
    },
  };
}
export const flights = new Map();
