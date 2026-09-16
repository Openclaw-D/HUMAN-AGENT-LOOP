import { AppError } from '../domain/errors.js';
import { MockProvider } from '../providers/mock-provider.js';
import { ResilientAdvisoryProvider } from '../providers/resilience.js';
import { ZaiGeneralProvider } from '../providers/zai-general-provider.js';

const PROVIDERS = new Set(['mock', 'zai-general']);

function deadline(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 3_000 || parsed > 30_000) throw new AppError('ADVISORY_CONFIGURATION_INVALID', `${label} 必须在 3000–30000ms。`, 500);
  return parsed;
}

function generalBaseUrl(value) {
  const baseUrl = value || 'https://api.z.ai/api/paas/v4/';
  let url;
  try { url = new URL(baseUrl); } catch { throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'RELAYOS_ZAI_GENERAL_BASE_URL 无效。', 500); }
  if (url.origin !== 'https://api.z.ai' || url.pathname.replace(/\/+$/, '') !== '/api/paas/v4' || url.username || url.password || url.search || url.hash) throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'Z.AI runtime 必须使用官方 General API base endpoint。', 500);
  return baseUrl;
}

export function loadProviderRuntimeConfig(env = process.env) {
  const providerMode = env.ADVISORY_PROVIDER || 'mock';
  if (!PROVIDERS.has(providerMode)) throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'ADVISORY_PROVIDER 必须显式为 mock 或 zai-general。', 500);
  const config = {
    providerMode,
    fastDeadlineMs: deadline(env.RELAYOS_ADVISORY_FAST_DEADLINE_MS, 8_000, 'RELAYOS_ADVISORY_FAST_DEADLINE_MS'),
    standardDeadlineMs: deadline(env.RELAYOS_ADVISORY_STANDARD_DEADLINE_MS, 15_000, 'RELAYOS_ADVISORY_STANDARD_DEADLINE_MS'),
    telemetryPath: env.RELAYOS_PROVIDER_TELEMETRY_PATH || ':memory:',
  };
  if (providerMode === 'zai-general') {
    if (!env.RELAYOS_ZAI_GENERAL_API_KEY) throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'zai-general 缺少独立 RelayOS runtime secret。', 500);
    config.apiKey = env.RELAYOS_ZAI_GENERAL_API_KEY;
    config.baseUrl = generalBaseUrl(env.RELAYOS_ZAI_GENERAL_BASE_URL);
    config.model = env.RELAYOS_ZAI_GENERAL_MODEL || 'glm-5.3';
    if (config.model !== 'glm-5.3') throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'P3 Z.AI General runtime model 必须是 glm-5.3。', 500);
  }
  return config;
}

export function defaultDeadlineForOperation(operation, config) {
  return ['material.extract', 'context.summarize'].includes(operation) ? config.fastDeadlineMs : config.standardDeadlineMs;
}

export function createConfiguredProvider(config, options = {}) {
  const raw = config.providerMode === 'mock'
    ? new MockProvider(options.mock)
    : new ZaiGeneralProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, fetchImpl: options.fetchImpl });
  return new ResilientAdvisoryProvider(raw, options.resilience);
}
