import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { loadRuntimeConfig, parseExactOrigin } from '../src/config/runtime-config.js';
import { createConfiguredProvider } from '../src/config/provider-runtime.js';

test('P6 runtime defaults are local, Mock-only, Node 22.16+, and capped at ten-second shutdown', () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4178);
  assert.deepEqual(config.allowedOrigins, ['http://127.0.0.1:4178']);
  assert.equal(config.connectorMode, 'mock');
  assert.equal(config.provider.providerMode, 'mock');
  assert.equal(config.demoMode, true);
  assert.equal(config.shutdownTimeoutMs, 10_000);
  assert.equal(config.databasePath, resolve('data/relayos.db'));
  assert(Number(process.versions.node.split('.')[0]) >= 22);
});

test('runtime configuration rejects ambiguous host, port, CORS, connector, demo, log and shutdown values', () => {
  const invalid = [
    { HOST: '0.0.0.0' },
    { HOST: 'http://127.0.0.1' },
    { HOST: '' },
    { PORT: '' },
    { PORT: '-1' },
    { PORT: '4178.5' },
    { CORS_ALLOWED_ORIGINS: '*' },
    { CORS_ALLOWED_ORIGINS: 'null' },
    { CORS_ALLOWED_ORIGINS: 'http://127.0.0.1' },
    { CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4178/path' },
    { CORS_ALLOWED_ORIGINS: 'http://user:pass@127.0.0.1:4178' },
    { CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4178,http://127.0.0.1:4178' },
    { CORS_ALLOWED_ORIGINS: '' },
    { CORS_ALLOWED_ORIGINS: ',http://127.0.0.1:4178' },
    { CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4178,' },
    { RELAYOS_CONNECTOR: 'real-erp' },
    { RELAYOS_DEMO_MODE: 'false' },
    { RELAYOS_LOG_LEVEL: 'verbose' },
    { RELAYOS_LOG_LEVEL: '' },
    { RELAYOS_SHUTDOWN_TIMEOUT_MS: '10001' },
    { RELAYOS_UNKNOWN_SETTING: 'typo' },
    { RELAYOS_PROVIDER_BREAKER_FAILURE_THRESHOLD: '0' },
    { RELAYOS_PROVIDER_BREAKER_WINDOW_MS: '999' },
    { RELAYOS_PROVIDER_BREAKER_OPEN_MS: '600001' },
  ];
  for (const env of invalid) assert.throws(() => loadRuntimeConfig(env), (error) => ['RUNTIME_CONFIGURATION_INVALID', 'CORS_CONFIGURATION_INVALID', 'ADVISORY_CONFIGURATION_INVALID'].includes(error.code), JSON.stringify(env));
});

test('explicit non-loopback host requires an exact scheme+host+port allowlist', () => {
  const config = loadRuntimeConfig({ HOST: '192.0.2.10', PORT: '8080', CORS_ALLOWED_ORIGINS: 'https://pilot.example:4433' });
  assert.equal(config.host, '192.0.2.10');
  assert.deepEqual(config.allowedOrigins, ['https://pilot.example:4433']);
  assert.equal(parseExactOrigin('http://localhost:4178'), 'http://localhost:4178');
});

test('provider deadline and breaker runtime values are strict and effective', () => {
  const config = loadRuntimeConfig({
    RELAYOS_ADVISORY_FAST_DEADLINE_MS: '7000',
    RELAYOS_ADVISORY_STANDARD_DEADLINE_MS: '12000',
    RELAYOS_PROVIDER_BREAKER_FAILURE_THRESHOLD: '3',
    RELAYOS_PROVIDER_BREAKER_WINDOW_MS: '45000',
    RELAYOS_PROVIDER_BREAKER_OPEN_MS: '20000',
  });
  assert.equal(config.provider.fastDeadlineMs, 7000);
  assert.equal(config.provider.standardDeadlineMs, 12000);
  assert.equal(config.provider.breakerFailureThreshold, 3);
  assert.equal(config.provider.breakerWindowMs, 45000);
  assert.equal(config.provider.breakerOpenMs, 20000);
  const provider = createConfiguredProvider(config.provider);
  assert.equal(provider.breaker.failureThreshold, 3);
  assert.equal(provider.breaker.failureWindowMs, 45000);
  assert.equal(provider.breaker.openMs, 20000);

  for (const value of [' 8000 ', '8e3', '8000.0', '+8000', '-8000', '']) {
    assert.throws(
      () => loadRuntimeConfig({ RELAYOS_ADVISORY_FAST_DEADLINE_MS: value }),
      (error) => error.code === 'ADVISORY_CONFIGURATION_INVALID',
      `deadline must reject ${JSON.stringify(value)}`,
    );
  }
});

test('runtime never reads or copies the development ZAI_API_KEY alias', () => {
  const env = new Proxy({}, {
    get(_target, property) {
      if (property === 'ZAI_API_KEY') throw new Error('development credential alias was accessed');
      return undefined;
    },
  });
  assert.equal(loadRuntimeConfig(env).provider.providerMode, 'mock');
  assert.throws(() => loadRuntimeConfig({ ADVISORY_PROVIDER: 'zai-general' }), (error) => error.code === 'ADVISORY_CONFIGURATION_INVALID');
});
