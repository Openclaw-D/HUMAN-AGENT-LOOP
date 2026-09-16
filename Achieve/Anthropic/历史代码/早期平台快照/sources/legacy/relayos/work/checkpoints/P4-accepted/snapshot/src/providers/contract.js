import { ProviderError } from './errors.js';

export const ADVISORY_OPERATIONS = new Set([
  'material.extract',
  'context.summarize',
  'conflict.identify',
  'configuration.suggest',
  'action.suggest',
]);

export const DATA_CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted']);
export const OUTPUT_SCHEMA_VERSION = 1;

const REQUEST_KEYS = new Set([
  'providerRequestId', 'operation', 'workCaseId', 'goalVersion', 'contextVersion',
  'inputRefs', 'outputSchemaVersion', 'promptVersion', 'evaluationVersion',
  'traceId', 'deadlineMs', 'dataClassification',
]);
const RESULT_KEYS = new Set(['authority', 'status', 'providerId', 'model', 'outputSchemaVersion', 'recommendations', 'traceId']);
const RECOMMENDATION_KEYS = new Set(['kind', 'summary', 'evidenceIds', 'confidence', 'requiresHumanReview']);
const OPERATION_KINDS = new Map([
  ['material.extract', new Set(['extraction'])],
  ['context.summarize', new Set(['summary'])],
  ['conflict.identify', new Set(['conflict'])],
  ['configuration.suggest', new Set(['configuration'])],
  ['action.suggest', new Set(['action'])],
]);
const FORBIDDEN_RECOMMENDATION_KEYS = new Set([
  'apply', 'applied', 'command', 'commandType', 'owner', 'ownerActorRef',
  'grant', 'authorityGrant', 'gate', 'humanGate', 'receipt', 'executionReceipt',
  'businessEvent', 'actionIntent',
]);
const FORBIDDEN_SUMMARY_PATTERNS = [
  /\bapply\b/i,
  /\b(assign|change|replace|set|transfer)\s+(the\s+)?owner\b/i,
  /\b(grant|revoke)\s+(authority|permission)\b/i,
  /\b(resolve|approve|reject|close|cancel)\s+(the\s+)?gate\b/i,
  /\b(create|record|forge|mark)\s+(an?\s+)?(execution\s+)?receipt\b/i,
  /\bappend\s+(a\s+)?business\s*event\b/i,
  /(修改|变更|转移|指定).{0,8}(owner|负责人)/i,
  /(授予|撤销).{0,8}(权限|authority)/i,
  /(批准|拒绝|解决|关闭|取消).{0,8}(gate|闸门|审批门)/i,
  /(创建|伪造|记录).{0,8}(receipt|回执)/i,
];

function fail(category, message) {
  throw new ProviderError(category, message);
}

function assertExactKeys(value, allowed, label, category = 'schema_mismatch') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(category, `${label} 必须是对象。`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(category, `${label} 含未知字段。`);
}

function nonEmptyString(value, label, category = 'schema_mismatch') {
  if (typeof value !== 'string' || !value.trim()) fail(category, `${label} 必须是非空字符串。`);
  return value.trim();
}

export function validateAdvisoryRequest(rawRequest) {
  assertExactKeys(rawRequest, REQUEST_KEYS, 'AdvisoryRequest', 'request_invalid');
  const request = structuredClone(rawRequest);
  for (const key of ['providerRequestId', 'workCaseId', 'promptVersion', 'evaluationVersion', 'traceId']) {
    request[key] = nonEmptyString(request[key], key, 'request_invalid');
  }
  if (request.providerRequestId.length < 6 || request.providerRequestId.length > 64) fail('request_invalid', 'providerRequestId 长度必须为 6–64。');
  if (!ADVISORY_OPERATIONS.has(request.operation)) fail('request_invalid', 'operation 不在冻结 allowlist。');
  if (!Number.isInteger(request.goalVersion) || request.goalVersion < 1) fail('request_invalid', 'goalVersion 必须是正整数。');
  if (!Number.isInteger(request.contextVersion) || request.contextVersion < 1) fail('request_invalid', 'contextVersion 必须是正整数。');
  if (!Array.isArray(request.inputRefs) || request.inputRefs.length === 0 || request.inputRefs.some((item) => typeof item !== 'string' || !item.trim())) fail('request_invalid', 'inputRefs 必须是非空 Evidence ID 数组。');
  request.inputRefs = request.inputRefs.map((item) => item.trim());
  if (new Set(request.inputRefs).size !== request.inputRefs.length) fail('request_invalid', 'inputRefs 不得重复。');
  if (request.outputSchemaVersion !== OUTPUT_SCHEMA_VERSION) fail('request_invalid', `outputSchemaVersion 必须是 ${OUTPUT_SCHEMA_VERSION}。`);
  if (!Number.isInteger(request.deadlineMs) || request.deadlineMs < 3_000 || request.deadlineMs > 30_000) fail('request_invalid', 'deadlineMs 必须在 3000–30000ms。');
  if (!DATA_CLASSIFICATIONS.has(request.dataClassification)) fail('request_invalid', 'dataClassification 无效。');
  return request;
}

function containsForbiddenKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value).some(([key, nested]) => FORBIDDEN_RECOMMENDATION_KEYS.has(key) || containsForbiddenKey(nested));
}

export function validateAdvisoryResult(rawResult, request, { providerId, model } = {}) {
  if (containsForbiddenKey(rawResult?.recommendations)) fail('authority_violation', 'provider 建议携带了权威写入字段。');
  assertExactKeys(rawResult, RESULT_KEYS, 'AdvisoryResult');
  const missing = [...RESULT_KEYS].filter((key) => !Object.hasOwn(rawResult, key));
  if (missing.length > 0) fail('schema_mismatch', 'AdvisoryResult 缺少必填字段。');
  const result = structuredClone(rawResult);
  if (result.authority !== 'none' || result.status !== 'advisory') fail('authority_violation', 'AdvisoryResult 必须是 authority=none、status=advisory。');
  nonEmptyString(result.providerId, 'providerId');
  nonEmptyString(result.model, 'model');
  if (providerId !== undefined && result.providerId !== providerId) fail('schema_mismatch', 'providerId 与运行时 provider 不匹配。');
  if (model !== undefined && result.model !== model) fail('schema_mismatch', 'model 与运行时配置不匹配。');
  if (result.outputSchemaVersion !== request.outputSchemaVersion) fail('schema_mismatch', 'outputSchemaVersion 与请求不匹配。');
  if (result.traceId !== request.traceId) fail('schema_mismatch', 'traceId 与请求不匹配。');
  if (!Array.isArray(result.recommendations) || result.recommendations.length === 0) fail('schema_mismatch', 'recommendations 必须是非空数组。');
  const allowedEvidence = new Set(request.inputRefs);
  const allowedKinds = OPERATION_KINDS.get(request.operation);
  for (const recommendation of result.recommendations) {
    assertExactKeys(recommendation, RECOMMENDATION_KEYS, 'recommendation');
    const recommendationMissing = [...RECOMMENDATION_KEYS].filter((key) => !Object.hasOwn(recommendation, key));
    if (recommendationMissing.length > 0) fail('schema_mismatch', 'recommendation 缺少必填字段。');
    if (!allowedKinds.has(recommendation.kind)) fail('schema_mismatch', 'recommendation.kind 与 operation 不匹配。');
    nonEmptyString(recommendation.summary, 'recommendation.summary');
    if (FORBIDDEN_SUMMARY_PATTERNS.some((pattern) => pattern.test(recommendation.summary))) fail('authority_violation', 'provider 建议试图越过确定性 authority 边界。');
    if (!Array.isArray(recommendation.evidenceIds) || recommendation.evidenceIds.length === 0 || recommendation.evidenceIds.some((id) => typeof id !== 'string' || !allowedEvidence.has(id))) fail('evidence_reference_invalid', 'recommendation 引用了请求范围外的 Evidence。');
    if (new Set(recommendation.evidenceIds).size !== recommendation.evidenceIds.length) fail('schema_mismatch', 'recommendation.evidenceIds 不得重复。');
    if (typeof recommendation.confidence !== 'number' || !Number.isFinite(recommendation.confidence) || recommendation.confidence < 0 || recommendation.confidence > 1) fail('schema_mismatch', 'confidence 必须在 0–1。');
    if (recommendation.requiresHumanReview !== true) fail('authority_violation', 'P3 建议必须 requiresHumanReview=true。');
  }
  return result;
}
