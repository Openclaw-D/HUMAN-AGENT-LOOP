import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppError, assert } from '../domain/errors.js';
import { validateScenarioExtensions } from './scenario-loader.js';

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'fixtureVersion', 'scenarioKey', 'synthetic', 'deidentified',
  'title', 'nextAction', 'trigger', 'goal', 'evidence', 'handoff', 'gate',
  'action', 'exception', 'metrics', 'scenarioExtensions',
]);
const TRIGGER_KEYS = new Set(['type', 'summary', 'boundary']);
const GOAL_KEYS = new Set(['statement', 'constraints', 'boundary']);
const EVIDENCE_KEYS = new Set(['id', 'boundary', 'summary', 'marketEvidenceIds', 'dataClassification']);
const HANDOFF_KEYS = new Set(['packageSummary', 'clarificationReason', 'acceptReason', 'nextAction']);
const GATE_KEYS = new Set(['policyId', 'question', 'protectedActions', 'resolutionRationale']);
const ACTION_KEYS = new Set(['systemId', 'operation']);
const EXCEPTION_KEYS = new Set(['type', 'severity', 'reason']);
const METRIC_KEYS = new Set(['metricKey', 'category', 'value', 'unit', 'sourceSystem']);
const BOUNDARIES = new Set(['F', 'I', 'H']);
const DATA_CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted']);

function exactKeys(value, allowed, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'SCENARIO_FIXTURE_INVALID', `${label} 必须是对象。`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  assert(unknown.length === 0, 'SCENARIO_FIXTURE_INVALID', `${label} 含未知字段。`, 500, { unknown });
  const missing = [...allowed].filter((key) => !Object.hasOwn(value, key));
  assert(missing.length === 0, 'SCENARIO_FIXTURE_INVALID', `${label} 缺少字段。`, 500, { missing });
}

function nonEmptyString(value, label) {
  assert(typeof value === 'string' && value.trim(), 'SCENARIO_FIXTURE_INVALID', `${label} 必须是非空字符串。`);
}

function assertDeidentified(value, path = 'fixture') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDeidentified(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assert(!/^(api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|session[-_]?token)$/i.test(key), 'SCENARIO_FIXTURE_SENSITIVE', `${path}.${key} 禁止包含敏感字段。`);
      assertDeidentified(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value !== 'string') return;
  assert(!/-----BEGIN [A-Z ]+PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(value), 'SCENARIO_FIXTURE_SENSITIVE', `${path} 疑似包含 secret。`);
  assert(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value), 'SCENARIO_FIXTURE_SENSITIVE', `${path} 禁止包含真实邮箱。`);
  assert(!/(?<!\d)1[3-9]\d{9}(?!\d)/.test(value), 'SCENARIO_FIXTURE_SENSITIVE', `${path} 禁止包含真实手机号。`);
}

export function validateScenarioFixture(rawFixture, config) {
  exactKeys(rawFixture, TOP_LEVEL_KEYS, 'scenario fixture');
  assert(rawFixture.schemaVersion === 1 && rawFixture.fixtureVersion === 1, 'SCENARIO_FIXTURE_INVALID', 'fixture schemaVersion/fixtureVersion 必须是 1。');
  assert(rawFixture.scenarioKey === config.scenarioKey, 'SCENARIO_FIXTURE_INVALID', 'fixture scenarioKey 与 config 不匹配。');
  assert(rawFixture.synthetic === true && rawFixture.deidentified === true, 'SCENARIO_FIXTURE_INVALID', 'fixture 必须显式标记 synthetic/deidentified。');
  nonEmptyString(rawFixture.title, 'title');
  nonEmptyString(rawFixture.nextAction, 'nextAction');

  exactKeys(rawFixture.trigger, TRIGGER_KEYS, 'trigger');
  nonEmptyString(rawFixture.trigger.type, 'trigger.type');
  nonEmptyString(rawFixture.trigger.summary, 'trigger.summary');
  assert(rawFixture.trigger.boundary === 'I', 'SCENARIO_FIXTURE_INVALID', 'Trigger 只能标记为 I（有证据推断）。');
  assert(config.triggerPolicies.some((policy) => policy.type === rawFixture.trigger.type), 'SCENARIO_FIXTURE_INVALID', 'Trigger type 未在 config 声明。');

  exactKeys(rawFixture.goal, GOAL_KEYS, 'goal');
  nonEmptyString(rawFixture.goal.statement, 'goal.statement');
  assert(Array.isArray(rawFixture.goal.constraints) && rawFixture.goal.constraints.every((item) => typeof item === 'string' && item.trim()), 'SCENARIO_FIXTURE_INVALID', 'goal.constraints 必须是字符串数组。');
  assert(rawFixture.goal.boundary === 'I', 'SCENARIO_FIXTURE_INVALID', 'Goal 只能标记为 I（有证据推断）。');

  assert(Array.isArray(rawFixture.evidence) && rawFixture.evidence.length === 3, 'SCENARIO_FIXTURE_INVALID', 'fixture evidence 必须恰好三项并覆盖 F/I/H。');
  const configuredEvidenceIds = new Set(config.evidenceRefs.map((item) => item.evidenceId));
  const evidenceIds = new Set();
  for (const item of rawFixture.evidence) {
    exactKeys(item, EVIDENCE_KEYS, `evidence:${item?.id}`);
    nonEmptyString(item.id, 'evidence.id');
    assert(!evidenceIds.has(item.id), 'SCENARIO_FIXTURE_INVALID', 'fixture evidence id 必须唯一。');
    evidenceIds.add(item.id);
    assert(BOUNDARIES.has(item.boundary), 'SCENARIO_FIXTURE_INVALID', 'Evidence boundary 必须是 F/I/H。');
    nonEmptyString(item.summary, `evidence:${item.id}.summary`);
    assert(Array.isArray(item.marketEvidenceIds) && item.marketEvidenceIds.every((id) => configuredEvidenceIds.has(id)), 'SCENARIO_FIXTURE_INVALID', 'Evidence 只能引用 config 中声明的市场证据 ID。');
    if (item.boundary !== 'H') assert(item.marketEvidenceIds.length > 0, 'SCENARIO_FIXTURE_INVALID', 'F/I evidence 必须有市场证据引用。');
    assert(DATA_CLASSIFICATIONS.has(item.dataClassification), 'SCENARIO_FIXTURE_INVALID', 'Evidence dataClassification 无效。');
  }
  assert(new Set(rawFixture.evidence.map((item) => item.boundary)).size === 3, 'SCENARIO_FIXTURE_INVALID', 'fixture evidence 必须各有一项 F/I/H。');

  exactKeys(rawFixture.handoff, HANDOFF_KEYS, 'handoff');
  for (const key of HANDOFF_KEYS) nonEmptyString(rawFixture.handoff[key], `handoff.${key}`);

  exactKeys(rawFixture.gate, GATE_KEYS, 'gate');
  nonEmptyString(rawFixture.gate.policyId, 'gate.policyId');
  nonEmptyString(rawFixture.gate.question, 'gate.question');
  nonEmptyString(rawFixture.gate.resolutionRationale, 'gate.resolutionRationale');
  assert(Array.isArray(rawFixture.gate.protectedActions) && rawFixture.gate.protectedActions.length > 0, 'SCENARIO_FIXTURE_INVALID', 'gate.protectedActions 不能为空。');
  const gatePolicy = config.gatePolicies.find((policy) => policy.policyKey === rawFixture.gate.policyId);
  assert(gatePolicy && rawFixture.gate.protectedActions.every((action) => gatePolicy.protectedActions.includes(action)), 'SCENARIO_FIXTURE_INVALID', 'Gate fixture 与 config policy 不匹配。');

  exactKeys(rawFixture.action, ACTION_KEYS, 'action');
  const system = config.externalSystems.find((item) => item.id === rawFixture.action.systemId);
  assert(system && system.allowedWriteOps.includes(rawFixture.action.operation), 'SCENARIO_FIXTURE_INVALID', 'Action fixture 未获 config adapter 声明允许。');

  exactKeys(rawFixture.exception, EXCEPTION_KEYS, 'exception');
  for (const key of EXCEPTION_KEYS) nonEmptyString(rawFixture.exception[key], `exception.${key}`);

  assert(Array.isArray(rawFixture.metrics) && rawFixture.metrics.length === 3, 'SCENARIO_FIXTURE_INVALID', 'fixture metrics 必须恰好三项。');
  const metricDefinitions = new Map(config.metricDefinitions.map((item) => [item.metricKey, item]));
  for (const item of rawFixture.metrics) {
    exactKeys(item, METRIC_KEYS, `metric:${item?.metricKey}`);
    const definition = metricDefinitions.get(item.metricKey);
    assert(definition
      && definition.category === item.category
      && definition.unit === item.unit
      && definition.sourceSystem === item.sourceSystem
      && typeof item.value === 'number' && Number.isFinite(item.value), 'SCENARIO_FIXTURE_INVALID', 'Metric fixture 必须与 config 定义一致且 value 为有限数值。');
  }
  assert(new Set(rawFixture.metrics.map((item) => item.category)).size === 3, 'SCENARIO_FIXTURE_INVALID', 'fixture metrics 必须各有 business/risk/efficiency 一项。');

  validateScenarioExtensions(config, rawFixture.scenarioExtensions);
  assertDeidentified(rawFixture);
  return structuredClone(rawFixture);
}

export function loadScenarioFixtures(directory, scenarioConfigs) {
  const absolute = resolve(directory);
  const fixtures = new Map();
  for (const name of readdirSync(absolute).filter((item) => item.endsWith('.json')).sort()) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(resolve(absolute, name), 'utf8'));
    } catch (error) {
      throw new AppError('SCENARIO_FIXTURE_INVALID', `无法解析 ${name}。`, 500, { cause: error.message });
    }
    const config = scenarioConfigs.get(parsed.scenarioKey);
    assert(config, 'SCENARIO_FIXTURE_INVALID', `${name} 引用了未知 scenarioKey。`, 500);
    const fixture = validateScenarioFixture(parsed, config);
    assert(!fixtures.has(fixture.scenarioKey), 'SCENARIO_FIXTURE_INVALID', `重复 fixture ${fixture.scenarioKey}。`, 500);
    fixtures.set(fixture.scenarioKey, fixture);
  }
  const missing = [...scenarioConfigs.keys()].filter((key) => !fixtures.has(key));
  const extra = [...fixtures.keys()].filter((key) => !scenarioConfigs.has(key));
  assert(fixtures.size === scenarioConfigs.size && missing.length === 0 && extra.length === 0, 'SCENARIO_FIXTURE_INVALID', '每个 scenario 必须恰好有一个 fixture。', 500, { missing, extra });
  return new Map([...scenarioConfigs.keys()].map((key) => [key, fixtures.get(key)]));
}
