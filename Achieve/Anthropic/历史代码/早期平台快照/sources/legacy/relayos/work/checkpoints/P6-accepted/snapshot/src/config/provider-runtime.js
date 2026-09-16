import { AppError } from '../domain/errors.js';
import { MockProvider } from '../providers/mock-provider.js';
import { CircuitBreaker, ResilientAdvisoryProvider } from '../providers/resilience.js';
import { ZaiGeneralProvider } from '../providers/zai-general-provider.js';

const PROVIDERS = new Set(['mock', 'zai-general']);

function deadline(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new AppError('ADVISORY_CONFIGURATION_INVALID', `${label} 必须在 3000–30000ms。`, 500);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 3_000 || parsed > 30_000) throw new AppError('ADVISORY_CONFIGURATION_INVALID', `${label} 必须在 3000–30000ms。`, 500);
  return parsed;
}

function integer(value, fallback, label, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new AppError('ADVISORY_CONFIGURATION_INVALID', `${label} 必须是 ${min}–${max} 的整数。`, 500);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new AppError('ADVISORY_CONFIGURATION_INVALID', `${label} 必须是 ${min}–${max} 的整数。`, 500);
  return parsed;
}

function generalBaseUrl(value) {
  const baseUrl = value === undefined ? 'https://api.z.ai/api/paas/v4/' : value;
  let url;
  try { url = new URL(baseUrl); } catch { throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'RELAYOS_ZAI_GENERAL_BASE_URL 无效。', 500); }
  if (url.origin !== 'https://api.z.ai' || url.pathname.replace(/\/+$/, '') !== '/api/paas/v4' || url.username || url.password || url.search || url.hash) throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'Z.AI runtime 必须使用官方 General API base endpoint。', 500);
  return baseUrl;
}

export function loadProviderRuntimeConfig(env = process.env) {
  const providerMode = env.ADVISORY_PROVIDER === undefined ? 'mock' : env.ADVISORY_PROVIDER;
  if (!PROVIDERS.has(providerMode)) throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'ADVISORY_PROVIDER 必须显式为 mock 或 zai-general。', 500);
  const config = {
    providerMode,
    fastDeadlineMs: deadline(env.RELAYOS_ADVISORY_FAST_DEADLINE_MS, 8_000, 'RELAYOS_ADVISORY_FAST_DEADLINE_MS'),
    standardDeadlineMs: deadline(env.RELAYOS_ADVISORY_STANDARD_DEADLINE_MS, 15_000, 'RELAYOS_ADVISORY_STANDARD_DEADLINE_MS'),
    telemetryPath: env.RELAYOS_PROVIDER_TELEMETRY_PATH === undefined ? ':memory:' : env.RELAYOS_PROVIDER_TELEMETRY_PATH,
    breakerFailureThreshold: integer(env.RELAYOS_PROVIDER_BREAKER_FAILURE_THRESHOLD, 5, 'RELAYOS_PROVIDER_BREAKER_FAILURE_THRESHOLD', 1, 100),
    breakerWindowMs: integer(env.RELAYOS_PROVIDER_BREAKER_WINDOW_MS, 60_000, 'RELAYOS_PROVIDER_BREAKER_WINDOW_MS', 1_000, 600_000),
    breakerOpenMs: integer(env.RELAYOS_PROVIDER_BREAKER_OPEN_MS, 30_000, 'RELAYOS_PROVIDER_BREAKER_OPEN_MS', 1_000, 600_000),
  };
  if (providerMode === 'zai-general') {
    if (typeof env.RELAYOS_ZAI_GENERAL_API_KEY !== 'string' || !env.RELAYOS_ZAI_GENERAL_API_KEY.trim() || env.RELAYOS_ZAI_GENERAL_API_KEY !== env.RELAYOS_ZAI_GENERAL_API_KEY.trim()) throw new AppError('ADVISORY_CONFIGURATION_INVALID', 'zai-general 缺少独立 RelayOS runtime secret。', 500);
    config.apiKey = env.RELAYOS_ZAI_GENERAL_API_KEY;
    config.baseUrl = generalBaseUrl(env.RELAYOS_ZAI_GENERAL_BASE_URL);
    config.model = env.RELAYOS_ZAI_GENERAL_MODEL === undefined ? 'glm-5.3' : env.RELAYOS_ZAI_GENERAL_MODEL;
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
  const breaker = options.resilience?.breaker ?? new CircuitBreaker({
    clock: options.resilience?.clock,
    failureThreshold: config.breakerFailureThreshold,
    failureWindowMs: config.breakerWindowMs,
    openMs: config.breakerOpenMs,
  });
  return new ResilientAdvisoryProvider(raw, { ...options.resilience, breaker });
}
