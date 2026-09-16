import { statSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';

import { AppError } from '../domain/errors.js';
import { loadProviderRuntimeConfig } from './provider-runtime.js';

const MIN_NODE = [22, 16, 0];
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;
const EXACT_ORIGIN = /^https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+):[1-9]\d{0,4}$/i;
const ALLOWED_RELAYOS_KEYS = new Set([
  'RELAYOS_DB_PATH', 'RELAYOS_SCENARIO_DIR', 'RELAYOS_PUBLIC_DIR',
  'RELAYOS_PROVIDER_TELEMETRY_PATH', 'RELAYOS_LOG_PATH', 'RELAYOS_LOG_LEVEL',
  'RELAYOS_CONNECTOR', 'RELAYOS_DEMO_MODE', 'RELAYOS_SCHEMA_MIGRATION',
  'RELAYOS_SHUTDOWN_TIMEOUT_MS', 'RELAYOS_CONNECTOR_DEADLINE_MS',
  'RELAYOS_HTTP_BODY_LIMIT_BYTES', 'RELAYOS_ADVISORY_FAST_DEADLINE_MS',
  'RELAYOS_ADVISORY_STANDARD_DEADLINE_MS', 'RELAYOS_PROVIDER_BREAKER_FAILURE_THRESHOLD',
  'RELAYOS_PROVIDER_BREAKER_WINDOW_MS', 'RELAYOS_PROVIDER_BREAKER_OPEN_MS',
  'RELAYOS_ZAI_GENERAL_API_KEY', 'RELAYOS_ZAI_GENERAL_BASE_URL', 'RELAYOS_ZAI_GENERAL_MODEL',
]);

function fail(message) {
  throw new AppError('RUNTIME_CONFIGURATION_INVALID', message, 500);
}

function nodeVersion() {
  const parts = process.versions.node.split('.').map(Number);
  const supported = parts[0] === MIN_NODE[0]
    && (parts[1] > MIN_NODE[1] || (parts[1] === MIN_NODE[1] && parts[2] >= MIN_NODE[2]));
  if (!supported) fail(`RelayOS P6 要求 Node.js >=${MIN_NODE.join('.')} 且 <23。`);
  return process.versions.node;
}

function integer(value, fallback, { label, min, max }) {
  const raw = value === undefined ? String(fallback) : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) fail(`${label} 必须是 ${min}–${max} 的整数。`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail(`${label} 必须是 ${min}–${max} 的整数。`);
  return parsed;
}

function exactBoolean(value, fallback, label) {
  const raw = value === undefined ? String(fallback) : value;
  if (!['true', 'false'].includes(raw)) fail(`${label} 必须显式为 true 或 false。`);
  return raw === 'true';
}

function host(value) {
  const raw = value === undefined ? '127.0.0.1' : value;
  if (typeof raw !== 'string' || !raw) fail('HOST 不能为空。');
  if (raw !== raw.trim() || raw.includes('://') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) fail('HOST 必须是单一 host，不得包含 scheme、port 或 path。');
  if (!isIP(raw) && !HOSTNAME.test(raw)) fail('HOST 不是有效 IP 或 hostname。');
  return raw.toLowerCase();
}

function pathValue(value, fallback, label, { directory = false, allowMemory = false } = {}) {
  const raw = value === undefined ? fallback : value;
  if (allowMemory && raw === ':memory:') return raw;
  if (typeof raw !== 'string' || !raw.trim() || raw !== raw.trim() || raw.includes('\0')) fail(`${label} 路径无效。`);
  const absolute = resolve(raw);
  if (directory) {
    try {
      if (!statSync(absolute).isDirectory()) fail(`${label} 必须指向目录。`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail(`${label} 目录不存在或不可访问。`);
    }
  }
  return absolute;
}

export function parseExactOrigin(raw, label = 'Origin') {
  if (typeof raw !== 'string' || raw !== raw.trim() || !EXACT_ORIGIN.test(raw)) {
    throw new AppError('CORS_CONFIGURATION_INVALID', `${label} 必须精确为 scheme://host:port。`, 500);
  }
  let url;
  try { url = new URL(raw); } catch { throw new AppError('CORS_CONFIGURATION_INVALID', `${label} 无效。`, 500); }
  const port = Number(raw.slice(raw.lastIndexOf(':') + 1));
  if (port < 1 || port > 65_535 || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.origin !== raw) {
    throw new AppError('CORS_CONFIGURATION_INVALID', `${label} 必须是无 credentials/path/query/fragment 的 canonical origin。`, 500);
  }
  return raw;
}

function corsOrigins(value, runtimeHost, runtimePort) {
  const configured = value === undefined ? [] : value.split(',').map((item) => item.trim());
  if (configured.some((item) => !item)) throw new AppError('CORS_CONFIGURATION_INVALID', 'CORS allowlist 不得为空或包含空项目。', 500);
  if (configured.some((item) => item === '*' || item === 'null')) throw new AppError('CORS_CONFIGURATION_INVALID', 'CORS allowlist 禁止 * 与 null。', 500);
  const parsed = configured.map((item, index) => parseExactOrigin(item, `CORS_ALLOWED_ORIGINS[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new AppError('CORS_CONFIGURATION_INVALID', 'CORS allowlist 不得包含重复 Origin。', 500);
  if (parsed.length === 0 && runtimePort > 0 && LOOPBACK_HOSTS.has(runtimeHost)) {
    const originHost = runtimeHost.includes(':') ? `[${runtimeHost}]` : runtimeHost;
    return [`http://${originHost}:${runtimePort}`];
  }
  if (parsed.length === 0 && !LOOPBACK_HOSTS.has(runtimeHost)) {
    throw new AppError('CORS_CONFIGURATION_INVALID', '非 loopback HOST 必须显式配置精确 CORS_ALLOWED_ORIGINS。', 500);
  }
  return parsed;
}

export function loadRuntimeConfig(env = process.env) {
  const unknownRelayKeys = Object.keys(env).filter((key) => key.startsWith('RELAYOS_') && !ALLOWED_RELAYOS_KEYS.has(key));
  if (unknownRelayKeys.length) fail(`未知 RelayOS 配置：${unknownRelayKeys.sort().join(', ')}。`);
  const runtimeHost = host(env.HOST);
  const port = integer(env.PORT, 4178, { label: 'PORT', min: 0, max: 65_535 });
  const databasePath = pathValue(env.RELAYOS_DB_PATH, './data/relayos.db', 'RELAYOS_DB_PATH');
  const scenarioDirectory = pathValue(env.RELAYOS_SCENARIO_DIR, './scenarios', 'RELAYOS_SCENARIO_DIR', { directory: true });
  const publicDirectory = pathValue(env.RELAYOS_PUBLIC_DIR, './public', 'RELAYOS_PUBLIC_DIR', { directory: true });
  const telemetryPath = pathValue(env.RELAYOS_PROVIDER_TELEMETRY_PATH, ':memory:', 'RELAYOS_PROVIDER_TELEMETRY_PATH', { allowMemory: true });
  const logPath = env.RELAYOS_LOG_PATH === undefined || env.RELAYOS_LOG_PATH === '-'
    ? '-'
    : pathValue(env.RELAYOS_LOG_PATH, '-', 'RELAYOS_LOG_PATH');
  if (telemetryPath !== ':memory:' && telemetryPath === databasePath) fail('Provider telemetry 必须与权威 SQLite volume 分离。');
  if (logPath !== '-' && [databasePath, telemetryPath].includes(logPath)) fail('JSONL log path 不得与 SQLite path 相同。');
  const logLevel = env.RELAYOS_LOG_LEVEL === undefined ? 'info' : env.RELAYOS_LOG_LEVEL;
  if (!LOG_LEVELS.has(logLevel)) fail('RELAYOS_LOG_LEVEL 必须是 debug/info/warn/error。');
  const connectorMode = env.RELAYOS_CONNECTOR === undefined ? 'mock' : env.RELAYOS_CONNECTOR;
  if (connectorMode !== 'mock') fail('P6 只允许 RELAYOS_CONNECTOR=mock；真实 connector 未实现。');
  const demoMode = exactBoolean(env.RELAYOS_DEMO_MODE, true, 'RELAYOS_DEMO_MODE');
  if (!demoMode) fail('P6 无认证部署只支持 RELAYOS_DEMO_MODE=true。');
  const migrationMode = env.RELAYOS_SCHEMA_MIGRATION === undefined ? 'auto' : env.RELAYOS_SCHEMA_MIGRATION;
  if (!['auto', 'verify-only'].includes(migrationMode)) fail('RELAYOS_SCHEMA_MIGRATION 必须是 auto 或 verify-only。');
  const shutdownTimeoutMs = integer(env.RELAYOS_SHUTDOWN_TIMEOUT_MS, 10_000, { label: 'RELAYOS_SHUTDOWN_TIMEOUT_MS', min: 1_000, max: 10_000 });
  const connectorDeadlineMs = integer(env.RELAYOS_CONNECTOR_DEADLINE_MS, 5_000, { label: 'RELAYOS_CONNECTOR_DEADLINE_MS', min: 250, max: 10_000 });
  const bodyLimit = integer(env.RELAYOS_HTTP_BODY_LIMIT_BYTES, 1024 * 1024, { label: 'RELAYOS_HTTP_BODY_LIMIT_BYTES', min: 1024, max: 10 * 1024 * 1024 });
  const provider = loadProviderRuntimeConfig({
    ADVISORY_PROVIDER: env.ADVISORY_PROVIDER,
    RELAYOS_ADVISORY_FAST_DEADLINE_MS: env.RELAYOS_ADVISORY_FAST_DEADLINE_MS,
    RELAYOS_ADVISORY_STANDARD_DEADLINE_MS: env.RELAYOS_ADVISORY_STANDARD_DEADLINE_MS,
    RELAYOS_PROVIDER_TELEMETRY_PATH: telemetryPath,
    RELAYOS_PROVIDER_BREAKER_FAILURE_THRESHOLD: env.RELAYOS_PROVIDER_BREAKER_FAILURE_THRESHOLD,
    RELAYOS_PROVIDER_BREAKER_WINDOW_MS: env.RELAYOS_PROVIDER_BREAKER_WINDOW_MS,
    RELAYOS_PROVIDER_BREAKER_OPEN_MS: env.RELAYOS_PROVIDER_BREAKER_OPEN_MS,
    RELAYOS_ZAI_GENERAL_API_KEY: env.RELAYOS_ZAI_GENERAL_API_KEY,
    RELAYOS_ZAI_GENERAL_BASE_URL: env.RELAYOS_ZAI_GENERAL_BASE_URL,
    RELAYOS_ZAI_GENERAL_MODEL: env.RELAYOS_ZAI_GENERAL_MODEL,
  });
  return Object.freeze({
    nodeVersion: nodeVersion(), host: runtimeHost, port, databasePath, scenarioDirectory,
    publicDirectory, allowedOrigins: Object.freeze(corsOrigins(env.CORS_ALLOWED_ORIGINS, runtimeHost, port)),
    demoMode, provider, connectorMode, connectorDeadlineMs, bodyLimit, logLevel, logPath,
    shutdownTimeoutMs, migrationMode,
  });
}
