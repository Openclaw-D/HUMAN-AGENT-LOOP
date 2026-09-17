import { makeStore } from './store/pg.mjs';
import { migrate } from './store/pg.mjs';
import { makeFsObjectStore } from './objectstore/fs.mjs';
import { makeConsentService } from './wecom/consent.mjs';
import { makeBindingService } from './wecom/binding.mjs';
import { makeIngestService } from './wecom/ingest.mjs';
import { makeSendService } from './wecom/send.mjs';
import { makeSessionService } from './session/service.mjs';
import { makeRecordingService } from './session/recording.mjs';
import { makeEvidenceService } from './evidence/service.mjs';
import { makeRetentionService } from './evidence/retention.mjs';
import { makeIntakeService } from './intake/service.mjs';
import { makeARegistrar } from './evidence/a_register.mjs';
import { FakeWecomTransport, HttpWecomTransport } from './wecom/transport.mjs';

/** 组合根：全部服务经此装配；测试与 HTTP 共用。 */
export async function compose(config) {
  const store = makeStore(config.pg, { objectRoot: config.objectRoot });
  await migrate(store);
  const objectStore = makeFsObjectStore({ root: config.objectRoot, store, signingSecret: config.signingSecret });
  const consent = makeConsentService(store);
  const bindings = makeBindingService(store);
  const ingest = makeIngestService(store, { bindings, consent });
  const send = makeSendService(store, {
    transport: config.wecomTransport ?? new HttpWecomTransport(config.wecom ?? {}),
    bindings, consent,
  });
  const sessions = makeSessionService(store, { signingSecret: config.signingSecret });
  const evidence = makeEvidenceService(store);
  const intake = makeIntakeService(store, { bindings });
  const retention = makeRetentionService(store, { objectStore });
  const recording = config.recordingAdapter
    ? makeRecordingService(store, { objectStore, adapter: config.recordingAdapter })
    : null;
  const aRegister = config.aBaseUrl ? makeARegistrar({ aBaseUrl: config.aBaseUrl, aCredential: config.aCredential }) : null;
  return {
    config, store, objectStore, consent, bindings, ingest, send, sessions, evidence, intake, retention, recording, aRegister,
    async close() { await store.close(); },
  };
}

export { FakeWecomTransport };
