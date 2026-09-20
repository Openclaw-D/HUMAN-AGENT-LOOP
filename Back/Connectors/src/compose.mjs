import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { makeABridge } from './evidence/a_bridge.mjs';
import { makeProcessingCoordinator } from './processing/coordinator.mjs';
import { FakeWecomTransport, HttpWecomTransport } from './wecom/transport.mjs';

/** 组合根：全部服务经此装配；测试与 HTTP 共用。 */

/** IR-03-8⑤：processing 配置装配（含客户映射种子透传）。
 *  优先级：显式 processing.aCustomerLinks > a.customerLinks（样例配置主位/既有部署形态）> 空。
 *  种子仅首次落 a_customer_links（表为权威）；生产语义=授权客户目录归集（01 任务书范围）。 */
export function resolveProcessingConfig(config = {}) {
  const processingConfig = { ...(config.processing ?? {}) };
  if (processingConfig.aCustomerLinks === undefined || processingConfig.aCustomerLinks === null) {
    const seed = config.a?.customerLinks;
    if (seed && typeof seed === 'object' && !Array.isArray(seed)) processingConfig.aCustomerLinks = seed;
  }
  return processingConfig;
}
export async function compose(config) {
  const store = makeStore(config.pg, { objectRoot: config.objectRoot });
  if (config.skipMigration !== true) await migrate(store);
  else await store.query('SELECT 1');
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
  const aRegister = config.aBaseUrl ? makeARegistrar({ aBaseUrl: config.aBaseUrl, aCredential: config.aCredential, fetchImpl: config.aFetchImpl ?? null }) : null;
  // goal-02（产品交付·任务二）· A v2 桥：材料/运行/Gate 回执/findings 正式消费通道。
  // 旧 v1 aRegister 保留（e1 集成路径仍在用）；处理链正式收口走 aBridge。
  const aBridge = config.aBaseUrl && config.a?.bridge !== false
    ? makeABridge({
      aBaseUrl: config.aBaseUrl,
      tenantId: config.a?.tenantId ?? config.defaultTenantId ?? 'tenant_demo',
      credentials: config.a?.credentials ?? { service: config.aCredential ?? 'tok-connector' },
      fetchImpl: config.aFetchImpl ?? null,
      defaultTimeoutMs: config.a?.timeoutMs ?? 5000,
    })
    : null;
  // goal-02 · 资料处理与尽调执行协调器（config.processing===false 显式关闭；默认装配）
  // TAKEOFF（03路 PROTOCOL.md）：config.processing.rulePackPath 指向五域准入规则包
  // （C/rules/takeoff-first-admission-rule-pack-v1.json）即启用五域；缺省旧四域包=回归基线。
  const packPath = config.processing?.rulePackPath;
  const processing = config.processing === false ? null : makeProcessingCoordinator(store, evidence, {
    objectStore,
    rulePack: config.processing?.rulePack ?? (packPath ? JSON.parse(readFileSync(resolve(packPath), 'utf8')) : null),
    aBridge,
    sendService: send,
    config: resolveProcessingConfig(config),
  });
  return {
    config, store, objectStore, consent, bindings, ingest, send, sessions, evidence, intake, retention, recording, aRegister, aBridge, processing,
    async close() { processing?.stopDriver(); await store.close(); },
  };
}

export { FakeWecomTransport };
