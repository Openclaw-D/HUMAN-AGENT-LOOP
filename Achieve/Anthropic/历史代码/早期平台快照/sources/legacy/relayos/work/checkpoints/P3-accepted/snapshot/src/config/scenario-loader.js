import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppError, assert } from '../domain/errors.js';

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'scenarioKey', 'version', 'displayNameZh', 'roles',
  'humanPrincipals', 'routableAgents', 'externalSystems', 'controlObjects',
  'authorityGrants', 'triggerPolicies', 'gatePolicies', 'metricDefinitions',
  'extensionNamespace', 'extensionFields',
]);

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
  for (const key of ['roles', 'humanPrincipals', 'routableAgents', 'externalSystems', 'controlObjects', 'authorityGrants', 'triggerPolicies', 'gatePolicies', 'metricDefinitions', 'extensionFields']) {
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
  for (const item of config.metricDefinitions) exactKeys(item, new Set(['metricKey', 'category', 'unit', 'sourceSystem']), 'metricDefinition');
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
  assert(config.metricDefinitions.every((metric) => ['business', 'risk', 'efficiency'].includes(metric.category)), 'SCENARIO_CONFIG_INVALID', 'metric category 无效。');
  nonEmptyString(config.extensionNamespace, 'extensionNamespace');
  assert(config.extensionNamespace === `scenarioExtensions.${config.scenarioKey}`, 'SCENARIO_CONFIG_INVALID', 'extension namespace 必须与 scenarioKey 对齐。');
  assert(new Set(config.extensionFields).size === config.extensionFields.length && config.extensionFields.every((item) => typeof item === 'string' && item.trim()), 'SCENARIO_CONFIG_INVALID', 'extensionFields 必须是唯一字符串。');
  return structuredClone(config);
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
  return map;
}
