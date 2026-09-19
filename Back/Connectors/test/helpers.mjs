import pg from 'pg';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, dropTestDatabase, makeStore, migrate } from '../src/store/pg.mjs';
import { makeFsObjectStore } from '../src/objectstore/fs.mjs';
import { makeConsentService } from '../src/wecom/consent.mjs';
import { makeBindingService } from '../src/wecom/binding.mjs';
import { makeIngestService } from '../src/wecom/ingest.mjs';
import { makeSendService } from '../src/wecom/send.mjs';
import { makeSessionService } from '../src/session/service.mjs';
import { makeRecordingService } from '../src/session/recording.mjs';
import { makeEvidenceService } from '../src/evidence/service.mjs';
import { makeRetentionService } from '../src/evidence/retention.mjs';
import { makeIntakeService } from '../src/intake/service.mjs';
import { FakeWecomTransport } from '../src/wecom/transport.mjs';
import { LocalLoopAdapter } from '../src/rtc/trtc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// 测试 PG 可用 CONNECTORS_TEST_PG_PORT/USER/PASSWORD/DATABASE 覆盖（并行轮次各自专用容器，避免共享容器干扰假失败）
export const BASE_PG = {
  host: '127.0.0.1',
  port: Number(process.env.CONNECTORS_TEST_PG_PORT ?? 15443),
  user: process.env.CONNECTORS_TEST_PG_USER ?? 'cnext',
  password: process.env.CONNECTORS_TEST_PG_PASSWORD ?? 'cnext',
  database: process.env.CONNECTORS_TEST_PG_DATABASE ?? 'cnext',
};
export const TENANT = 'tenant_test';
export const SIGNING_SECRET = 'test_signing_secret_do_not_use_in_prod';

/** 真实 PG 不可达时显式跳过（blocked_env），绝不计 PASS。 */
export async function pgAvailable() {
  try {
    const p = new pg.Pool({ ...BASE_PG, max: 1, connectionTimeoutMillis: 3000 });
    await p.query('SELECT 1');
    await p.end();
    return true;
  } catch {
    return false;
  }
}

/** 每个测试文件独立库：create → migrate → services → dispose。 */
export async function makeHarness({ fakeTransport } = {}) {
  const created = await createTestDatabase(BASE_PG);
  const dbName = created.dbName;
  const cfg = created; // 含 database: dbName
  const objectRoot = join(ROOT, '.run', `test-objects-${dbName}`);
  mkdirSync(objectRoot, { recursive: true });
  const store = makeStore(cfg, { objectRoot });
  await migrate(store);
  const objectStore = makeFsObjectStore({ root: objectRoot, store, signingSecret: SIGNING_SECRET });
  const consent = makeConsentService(store);
  const bindings = makeBindingService(store);
  const ingest = makeIngestService(store, { bindings, consent });
  const transport = fakeTransport ?? new FakeWecomTransport();
  const send = makeSendService(store, { transport, bindings, consent });
  const sessions = makeSessionService(store, { signingSecret: SIGNING_SECRET });
  const evidence = makeEvidenceService(store);
  const intake = makeIntakeService(store, { bindings });
  const retention = makeRetentionService(store, { objectStore });

  // 回调入口（与 HTTP 层相同的校验路径）：LocalLoop 事件经签名后进入 recording.handleCallback。
  let recording = null;
  let loop = null;
  function wireRecording() {
    recording = makeRecordingService(store, { objectStore, adapter: loop });
    return recording;
  }
  function wireLoop() {
    loop = new LocalLoopAdapter({
      callbackKey: SIGNING_SECRET,
      emit: async (rawBody, sign) => { await recording.handleCallback({ tenantId: TENANT, rawBody, signHeader: sign, callbackKey: SIGNING_SECRET }); },
    });
    recording = makeRecordingService(store, { objectStore, adapter: loop });
    return loop;
  }

  return {
    dbName, store, objectStore, consent, bindings, ingest, send, sessions, evidence, intake, retention, transport,
    wireLoop, wireRecording,
    get loop() { return loop; },
    get recording() { return recording; },
    async dispose() {
      await store.close();
      await dropTestDatabase(BASE_PG, dbName);
      rmSync(objectRoot, { recursive: true, force: true });
    },
  };
}
