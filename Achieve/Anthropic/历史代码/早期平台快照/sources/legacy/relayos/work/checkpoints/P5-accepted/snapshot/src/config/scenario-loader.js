import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppError, assert } from '../domain/errors.js';

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'scenarioKey', 'version', 'displayNameZh', 'roles',
  'humanPrincipals', 'routableAgents', 'externalSystems', 'controlObjects',
  'authorityGrants', 'triggerPolicies', 'gatePolicies', 'metricDefinitions',
  'evidenceRefs', 'boundaryClaims', 'extensionNamespace', 'extensionFields',
  'testOrder',
]);

const EVIDENCE_REF_KEYS = new Set(['evidenceId', 'recordType', 'evidenceGrade', 'boundary', 'usageLimit']);
const BOUNDARY_CLAIM_KEYS = new Set(['claimId', 'classification', 'statement', 'evidenceIds']);
const METRIC_DEFINITION_KEYS = new Set([
  'metricKey', 'category', 'unit', 'sourceSystem', 'ownerRole', 'threshold', 'failureHandling',
]);
const BOUNDARY_CLASSIFICATIONS = new Set(['F', 'I', 'H']);

function nonEmptyString(value, label) {
  assert(typeof value === 'string' && value.trim(), 'SCENARIO_CONFIG_INVALID', `${label} 必须是非空字符串。`);
}

function exactKeys(value, allowed, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'SCENARIO_CONFIG_INVALID', `${label} 必须是对象。`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  assert(unknown.length === 0, 'SCENARIO_CONFIG_INVALID', `${label} 含未知字段。`, 500, { unknown });
}

function uniqueIds(items, label) {
  const ids = items.map((item) => item.id);
  assert(ids.every((id) => typeof id === 'string' && id.trim()), 'SCENARIO_CONFIG_INVALID', `${label} 每项必须有 id。`);
  assert(new Set(ids).size === ids.length, 'SCENARIO_CONFIG_INVALID', `${label} id 必须唯一。`);
}

export function validateScenarioConfig(config) {
  exactKeys(config, TOP_LEVEL_KEYS, 'scenario config');
  assert(config.schemaVersion === 1, 'SCENARIO_CONFIG_INVALID', 'P2 scenario schemaVersion 必须是 1。');
  assert(Number.isInteger(config.version) && config.version >= 1, 'SCENARIO_CONFIG_INVALID', 'scenario version 必须是正整数。');
  nonEmptyString(config.scenarioKey, 'scenarioKey');
  nonEmptyString(config.displayNameZh, 'displayNameZh');
  assert(Number.isInteger(config.testOrder) && config.testOrder >= 1, 'SCENARIO_CONFIG_INVALID', 'testOrder 必须是正整数。');
  for (const key of ['roles', 'humanPrincipals', 'routableAgents', 'externalSystems', 'controlObjects', 'authorityGrants', 'triggerPolicies', 'gatePolicies', 'metricDefinitions', 'evidenceRefs', 'boundaryClaims', 'extensionFields']) {
    assert(Array.isArray(config[key]), 'SCENARIO_CONFIG_INVALID', `${key} 必须是数组。`);
  }
  assert(config.roles.every((item) => typeof item === 'string' && item.trim()), 'SCENARIO_CONFIG_INVALID', 'roles 必须是字符串数组。');
  uniqueIds(config.humanPrincipals, 'humanPrincipals');
  uniqueIds(config.routableAgents, 'routableAgents');
  uniqueIds(config.externalSystems, 'externalSystems');
  uniqueIds(config.controlObjects, 'controlObjects');
  uniqueIds(config.authorityGrants, 'authorityGrants');
  for (const item of config.humanPrincipals) exactKeys(item, new Set(['id', 'displayName', 'role', 'organizationId', 'status', 'capabilities']), `HumanPrincipal:${item.id}`);
  for (const item of config.routableAgents) exactKeys(item, new Set(['id', 'displayName', 'organizationId', 'accountableHumanId', 'responsibility', 'acceptableOutputs', 'exclusions', 'escalationConditions', 'contextPolicy', 'capabilities', 'status']), `RoutableAgent:${item.id}`);
  for (const item of config.externalSystems) exactKeys(item, new Set(['id', 'displayName', 'kind', 'sourceOfTruthFields', 'adapterId', 'allowedReadOps', 'allowedWriteOps', 'status']), `ExternalSystem:${item.id}`);
  for (const item of config.controlObjects) exactKeys(item, new Set(['id', 'kind', 'displayName']), `ControlObject:${item.id}`);
  for (const item of config.authorityGrants) exactKeys(item, new Set(['id', 'principalRef', 'actions', 'scope', 'validFrom', 'validUntil', 'grantedBy', 'reason', 'status', 'effect']), `AuthorityGrant:${item.id}`);
  for (const item of config.triggerPolicies) exactKeys(item, new Set(['type', 'dedupeWindowMinutes', 'defaultSeverity']), 'triggerPolicy');
  for (const item of config.gatePolicies) exactKeys(item, new Set(['policyKey', 'assignedRole', 'protectedActions']), 'gatePolicy');
  for (const item of config.metricDefinitions) exactKeys(item, METRIC_DEFINITION_KEYS, 'metricDefinition');
  for (const item of config.evidenceRefs) exactKeys(item, EVIDENCE_REF_KEYS, `evidenceRef:${item.evidenceId}`);
  for (const item of config.boundaryClaims) exactKeys(item, BOUNDARY_CLAIM_KEYS, `boundaryClaim:${item.claimId}`);
  const humanIds = new Set(config.humanPrincipals.map((item) => item.id));
  assert(config.routableAgents.every((item) => humanIds.has(item.accountableHumanId)), 'SCENARIO_CONFIG_INVALID', '每个 RoutableAgent 必须关联 config 中的 accountable HumanPrincipal。');
  const actorKeys = new Set([
    ...config.humanPrincipals.map((item) => `human:${item.id}`),
    ...config.routableAgents.map((item) => `agent:${item.id}`),
  ]);
  assert(config.authorityGrants.every((grant) => actorKeys.has(`${grant.principalRef?.kind}:${grant.principalRef?.id}`)
    && Array.isArray(grant.actions)
    && grant.actions.length > 0
    && grant.scope?.workCaseId
    && !Number.isNaN(Date.parse(grant.validFrom))
    && !Number.isNaN(Date.parse(grant.validUntil))), 'SCENARIO_CONFIG_INVALID', 'AuthorityGrant 的 principal/actions/scope/time 无效。');
  const systemIds = new Set(config.externalSystems.map((item) => item.id));
  assert(config.metricDefinitions.length === 3
    && new Set(config.metricDefinitions.map((metric) => metric.category)).size === 3
    && config.metricDefinitions.every((metric) => ['business', 'risk', 'efficiency'].includes(metric.category)
      && typeof metric.metricKey === 'string' && metric.metricKey.trim()
      && typeof metric.unit === 'string' && metric.unit.trim()
      && (metric.sourceSystem === 'relayos' || systemIds.has(metric.sourceSystem))
      && typeof metric.ownerRole === 'string' && metric.ownerRole.trim()
      && typeof metric.threshold === 'string' && metric.threshold.trim()
      && typeof metric.failureHandling === 'string' && metric.failureHandling.trim()), 'SCENARIO_CONFIG_INVALID', '三类 metric definition 必须各一项，并包含 data source、owner、threshold 与 failure handling。');
  const evidenceIds = new Set(config.evidenceRefs.map((item) => item.evidenceId));
  assert(evidenceIds.size === config.evidenceRefs.length && config.evidenceRefs.length >= 4, 'SCENARIO_CONFIG_INVALID', 'evidenceRefs 必须至少四项且 evidenceId 唯一。');
  assert(config.evidenceRefs.every((item) => typeof item.evidenceId === 'string' && item.evidenceId.trim()
    && ['job', 'strategy_topic'].includes(item.recordType)
    && ['A', 'B', 'C'].includes(item.evidenceGrade)
    && item.boundary === 'F'
    && typeof item.usageLimit === 'string' && item.usageLimit.trim()), 'SCENARIO_CONFIG_INVALID', 'evidenceRefs 必须保留 record type、grade、F 边界和使用限制。');
  assert(config.boundaryClaims.length >= 3
    && new Set(config.boundaryClaims.map((item) => item.claimId)).size === config.boundaryClaims.length
    && new Set(config.boundaryClaims.map((item) => item.classification)).size === 3
    && config.boundaryClaims.every((item) => typeof item.claimId === 'string' && item.claimId.trim()
      && BOUNDARY_CLASSIFICATIONS.has(item.classification)
      && typeof item.statement === 'string' && item.statement.trim()
      && Array.isArray(item.evidenceIds)
      && item.evidenceIds.every((id) => evidenceIds.has(id))), 'SCENARIO_CONFIG_INVALID', 'boundaryClaims 必须显式覆盖 F/I/H，且只引用已声明 evidence ID。');
  assert(config.boundaryClaims.filter((item) => item.classification === 'F').every((item) => item.evidenceIds.length > 0)
    && config.boundaryClaims.filter((item) => item.classification === 'I').every((item) => item.evidenceIds.length > 0), 'SCENARIO_CONFIG_INVALID', 'F/I claim 必须有来源 evidence ID；H 可为空。');
  nonEmptyString(config.extensionNamespace, 'extensionNamespace');
  assert(config.extensionNamespace === `scenarioExtensions.${config.scenarioKey}`, 'SCENARIO_CONFIG_INVALID', 'extension namespace 必须与 scenarioKey 对齐。');
  assert(new Set(config.extensionFields).size === config.extensionFields.length && config.extensionFields.every((item) => typeof item === 'string' && item.trim()), 'SCENARIO_CONFIG_INVALID', 'extensionFields 必须是唯一字符串。');
  return structuredClone(config);
}

function countScalarLeaves(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return 1;
  if (Array.isArray(value)) return value.reduce((total, item) => total + countScalarLeaves(item), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((total, item) => total + countScalarLeaves(item), 0);
  return 0;
}

export function scenarioExtensionStats(config) {
  const validated = validateScenarioConfig(config);
  const extensionFieldCount = validated.extensionFields.length;
  const shared = structuredClone(validated);
  shared.extensionFields = [];
  const sharedScalarFieldCount = countScalarLeaves(shared);
  const totalDeclaredFieldCount = sharedScalarFieldCount + extensionFieldCount;
  const ratio = totalDeclaredFieldCount === 0 ? 0 : extensionFieldCount / totalDeclaredFieldCount;
  return { extensionFieldCount, sharedScalarFieldCount, totalDeclaredFieldCount, ratio };
}

export function validateScenarioExtensions(config, extensions) {
  const expectedNamespace = config.extensionNamespace.split('.')[1];
  exactKeys(extensions ?? {}, new Set([expectedNamespace]), 'scenarioExtensions');
  const values = extensions?.[expectedNamespace] ?? {};
  exactKeys(values, new Set(config.extensionFields), config.extensionNamespace);
  assert(Object.values(values).every((value) => value === null || ['string', 'number', 'boolean'].includes(typeof value)), 'SCENARIO_CONFIG_INVALID', 'P2 scenario extension values 只能是 scalar。');
  return structuredClone(extensions ?? {});
}

export function loadScenarioConfigs(directory) {
  const absolute = resolve(directory);
  const map = new Map();
  for (const name of readdirSync(absolute).filter((item) => item.endsWith('.json')).sort()) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(resolve(absolute, name), 'utf8'));
    } catch (error) {
      throw new AppError('SCENARIO_CONFIG_INVALID', `无法解析 ${name}。`, 500, { cause: error.message });
    }
    const config = validateScenarioConfig(parsed);
    assert(!map.has(config.scenarioKey), 'SCENARIO_CONFIG_INVALID', `重复 scenarioKey ${config.scenarioKey}。`, 500);
    map.set(config.scenarioKey, config);
  }
  assert(map.size > 0, 'SCENARIO_CONFIG_INVALID', '至少需要一个 scenario config。', 500);
  const ordered = [...map.values()].sort((left, right) => left.testOrder - right.testOrder);
  assert(new Set(ordered.map((item) => item.testOrder)).size === ordered.length, 'SCENARIO_CONFIG_INVALID', 'testOrder 必须唯一。', 500);
  assert(ordered.every((item, index) => item.testOrder === index + 1), 'SCENARIO_CONFIG_INVALID', 'testOrder 必须从 1 连续排列。', 500);
  return new Map(ordered.map((item) => [item.scenarioKey, item]));
}
