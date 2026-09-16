// Agent-AUDIT-R4 独立复演公共件(自写,不改交付文件)。
// 隔离 store 目录:runtime/audit-r4/<case>/remote-store.json;只写 runtime/audit-r4/。
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const AUDIT_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = AUDIT_DIR ? join(AUDIT_DIR, '..', '..') : process.cwd();
export const SITE = join(ROOT, '..', '..', '..', 'jianwei-v3', 'site');
export const sha = (seed) => createHash('sha256').update(`audit-r4:${seed}`).digest('hex');

/** 建立独立 store 目录并设置环境变量(每次用例独立目录,互不污染)。 */
export function useStoreDir(caseName) {
  const dir = join(AUDIT_DIR, `store-${caseName}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.V5_PREVIEW_DATA_DIR = dir;
  return { dir, file: join(dir, 'remote-store.json') };
}

const SESSION = 'sess-audit-r4';
const EVIDENCE_ID = 'EV-AUDIT-R4';

export function sessionRecord(overrides = {}) {
  return {
    sessionId: SESSION,
    projectId: '2026PA99999',
    title: '【审计合成】独立复演会话',
    status: 'live',
    generation: 0,
    participants: [],
    video: { provider: 'none', state: 'not_configured', message: '视频服务未接入' },
    createdAt: '2026-09-13T08:00:00+08:00',
    updatedAt: '2026-09-13T08:00:00+08:00',
    ...overrides,
  };
}

export function evidenceRecord(overrides = {}) {
  return {
    evidenceId: EVIDENCE_ID,
    projectId: '2026PA99999',
    sessionId: SESSION,
    fixtureId: 'fixture-audit-r4',
    title: '【审计合成】现场照片',
    sourceType: 'simulation_fixture',
    capturedAt: '2026-09-13T07:00:00+08:00',
    receivedAt: '2026-09-13T07:01:00+08:00',
    mime: 'image/svg+xml',
    width: 640,
    height: 480,
    sha256: sha('audit-ev'),
    version: 1,
    supersededBy: null,
    supersedes: null,
    digestOf: 'fixture_bytes',
    ...overrides,
  };
}

export function annotationRecord(overrides = {}) {
  return {
    annotationId: 'AN-AUDIT-R4',
    sessionId: SESSION,
    evidenceId: EVIDENCE_ID,
    evidenceVersion: 1,
    rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.3 },
    question: '【审计合成】存货盘点的差异说明在哪里?',
    author: 'credit',
    status: 'open',
    version: 1,
    createdAt: '2026-09-13T07:05:00+08:00',
    replies: [],
    ...overrides,
  };
}

/** 直接写 store 文件(形状=产品 persistRemoteStoreState 的 stored 输出,须过产品读侧校验)。 */
export function writeStoreFile(storeFile, { version, sessions, evidence, annotations }) {
  writeFileSync(storeFile, `${JSON.stringify({
    schema: 'v5-preview-remote-store@1',
    version,
    sessions,
    evidence,
    annotations: annotations ?? [],
    reviews: [],
    calculations: [],
    ruleConfig: { version: 0, status: 'unconfigured', layers: { technicalQuality: null, evidenceSufficiency: null, businessRisk: null, economics: null } },
    idempotency: [],
  }, null, 2)}\n`, 'utf8');
}

export function removeStoreFile(storeFile) {
  if (existsSync(storeFile)) rmSync(storeFile, { force: true });
}

export function baseRequest(overrides = {}) {
  return {
    requestId: 'req-audit-r4',
    sessionId: SESSION,
    annotationId: 'AN-AUDIT-R4',
    evidenceRef: { fixtureId: 'fixture-audit-r4', sha256: sha('audit-ev'), version: 1 },
    domainRoles: ['credit', 'policy'],
    purpose: 'follow_up_generation',
    ...overrides,
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export async function loadBridge() {
  const mod = await import(`file:///${SITE.replace(/\\/g, '/')}/lib/v5-preview/remote-model-adapter-bridge.ts`);
  return mod.createBridgedModelAdapter;
}
