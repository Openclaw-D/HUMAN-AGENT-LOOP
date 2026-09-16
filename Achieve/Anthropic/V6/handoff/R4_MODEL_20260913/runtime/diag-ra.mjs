import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const SITE = path.resolve(root, '..', '..', '..', 'jianwei-v3', 'site');
const DATA_DIR = path.join(root, 'runtime', 'diag-store5');
mkdirSync(DATA_DIR, { recursive: true });
process.env.V5_PREVIEW_DATA_DIR = DATA_DIR;
const sha = (s) => createHash('sha256').update('synthetic-r4:' + s).digest('hex');
const STORE = path.join(DATA_DIR, 'remote-store.json');
function baseStore() {
  writeFileSync(STORE, JSON.stringify({ schema: 'v5-preview-remote-store@1', version: 7,
    sessions: [{ sessionId: 'sess-r4-001', projectId: '2026PA21001', title: 't', status: 'live', generation: 0, participants: [], video: { provider: 'none', state: 'not_configured', message: 'v' }, createdAt: '2026-09-13T10:00:00+08:00', updatedAt: '2026-09-13T10:00:00+08:00' }],
    evidence: [{ evidenceId: 'EV-R4-001', projectId: '2026PA21001', sessionId: 'sess-r4-001', fixtureId: 'fixture-r4-001', title: 'e', sourceType: 'simulation_fixture', capturedAt: '2026-09-13T09:00:00+08:00', receivedAt: '2026-09-13T09:01:00+08:00', mime: 'image/svg+xml', width: 800, height: 600, sha256: sha('ev1'), version: 1, supersededBy: null, supersedes: null, digestOf: 'fixture_bytes' }],
    annotations: [{ annotationId: 'AN-R4-001', sessionId: 'sess-r4-001', evidenceId: 'EV-R4-001', evidenceVersion: 1, rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, question: 'q', author: 'credit', status: 'open', version: 1, createdAt: '2026-09-13T09:05:00+08:00', replies: [] }],
    reviews: [], calculations: [], ruleConfig: { version: 0, status: 'unconfigured', layers: { technicalQuality: null, evidenceSufficiency: null, businessRisk: null, economics: null } }, idempotency: [] }, null, 2));
}
const storeMod = await import(pathToFileURL(path.join(SITE, 'lib', 'v5-preview', 'remote-store.ts')).href);
const { createBridgedModelAdapter } = await import(pathToFileURL(path.join(SITE, 'lib', 'v5-preview', 'remote-model-adapter-bridge.ts')).href);
baseStore();
let refs = [];
const slow = { resolve: null, promise: null };
slow.promise = new Promise((r) => { slow.resolve = r; });
const bridge = createBridgedModelAdapter({ transport: async (call) => { refs = call.payload.evidenceRefs.map((r) => ({ ...r })); return slow.promise; }, timeoutMs: 5000 });
const p = bridge.generateFollowUps({ requestId: 'req-r4-001', sessionId: 'sess-r4-001', annotationId: 'AN-R4-001', evidenceRef: { fixtureId: 'fixture-r4-001', sha256: sha('ev1'), version: 1 }, domainRoles: ['credit'], purpose: 'follow_up_generation' });
const st = JSON.parse(readFileSync(STORE, 'utf8'));
st.version = 8;
st.sessions = [];
writeFileSync(STORE, JSON.stringify(st, null, 2));
slow.resolve({ ok: true, simulated: true, output: { findings: [{ id: 'F1', text: 'x', evidenceRefs: refs }], questions: [], evidenceRefs: refs }, usage: { totalTokens: 3 } });
const result = await p;
console.log(JSON.stringify({ status: result.status, failureReason: result.failureReason, candidate: result.candidate ? { status: result.candidate.status, errorCode: result.candidate.errorCode, errorMessage: result.candidate.errorMessage, generation: result.candidate.generation, contextVersion: result.candidate.contextVersion } : null }, null, 2));
