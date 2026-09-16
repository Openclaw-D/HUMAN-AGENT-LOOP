import { canonicalHash } from '../domain/canonical.js';
import { AppError } from '../domain/errors.js';
import { validateAdvisoryRequest, validateAdvisoryResult } from '../providers/contract.js';
import { isProviderError } from '../providers/errors.js';
import { PROVIDER_TELEMETRY } from '../providers/zai-general-provider.js';

const CLASSIFICATION_RANK = new Map([['public', 0], ['internal', 1], ['confidential', 2], ['restricted', 3]]);

function mapProviderError(error) {
  if (error instanceof AppError) return error;
  if (isProviderError(error) && error.category === 'request_invalid') return new AppError('ADVISORY_REQUEST_INVALID', error.message, 400, { category: error.category });
  if (isProviderError(error)) return new AppError('ADVISORY_UNAVAILABLE', 'Advisory Provider 暂不可用；权威状态未改变。', 503, { category: error.category });
  return new AppError('ADVISORY_UNAVAILABLE', 'Advisory Provider 暂不可用；权威状态未改变。', 503, { category: 'internal' });
}

function authoritativeFingerprint(projection) {
  return {
    projectionVersion: projection.projectionVersion,
    canonicalStateHash: projection.canonicalStateHash,
    acceptedGoalVersion: projection.state.acceptedGoalVersion,
    currentContextVersion: projection.state.currentContextVersion,
  };
}

function validateScope(request, projection) {
  const state = projection?.state;
  if (!state || state.id !== request.workCaseId) throw new AppError('WORK_CASE_NOT_FOUND', `WorkCase ${request.workCaseId} 不存在。`, 404);
  if (state.acceptedGoalVersion !== request.goalVersion) throw new AppError('ADVISORY_GOAL_VERSION_STALE', 'AdvisoryRequest goalVersion 已过期。', 409, { requested: request.goalVersion, current: state.acceptedGoalVersion });
  if (state.currentContextVersion !== request.contextVersion) throw new AppError('ADVISORY_CONTEXT_VERSION_STALE', 'AdvisoryRequest contextVersion 已过期。', 409, { requested: request.contextVersion, current: state.currentContextVersion });
  const context = state.contextVersions.find((item) => item.version === request.contextVersion);
  if (!context || !context.allowedDecisionUses.includes(request.operation)) throw new AppError('ADVISORY_SCOPE_DENIED', '当前 ContextVersion 未授权该 advisory operation。', 403);
  const evidenceById = new Map(state.evidence.map((item) => [item.id, item]));
  const contextEvidence = new Set(context.evidenceIds);
  for (const evidenceId of request.inputRefs) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence || !contextEvidence.has(evidenceId)) throw new AppError('ADVISORY_EVIDENCE_SCOPE_DENIED', 'inputRefs 含 ContextVersion 范围外的 Evidence。', 403, { evidenceId });
    if (!CLASSIFICATION_RANK.has(evidence.classification) || CLASSIFICATION_RANK.get(evidence.classification) > CLASSIFICATION_RANK.get(request.dataClassification)) throw new AppError('ADVISORY_DATA_CLASSIFICATION_DENIED', 'dataClassification 不足以覆盖请求 Evidence。', 403, { evidenceId });
  }
  return projection;
}

export class AdvisoryService {
  constructor({
    getWorkCase, provider, telemetry = null, clock = () => Date.now(),
    deadlinePolicy = (operation) => (['material.extract', 'context.summarize'].includes(operation) ? 8_000 : 15_000),
  }) {
    if (typeof getWorkCase !== 'function') throw new TypeError('AdvisoryService requires a read-only getWorkCase callback.');
    if (!provider || typeof provider.suggest !== 'function') throw new TypeError('AdvisoryService requires a provider executor.');
    this.getWorkCase = getWorkCase;
    this.provider = provider;
    this.telemetry = telemetry;
    this.clock = clock;
    this.deadlinePolicy = deadlinePolicy;
    this.sequence = 0;
    this.lastTelemetryError = null;
  }

  async #record(record) {
    if (!this.telemetry) return;
    try {
      await this.telemetry.record(record);
      this.lastTelemetryError = null;
    } catch (error) {
      this.lastTelemetryError = error;
    }
  }

  async suggest(rawRequest, { signal } = {}) {
    let request;
    try {
      request = validateAdvisoryRequest(rawRequest);
    } catch (error) {
      throw mapProviderError(error);
    }
    const effectiveDeadlineMs = this.deadlinePolicy(request.operation);
    if (!Number.isInteger(effectiveDeadlineMs) || effectiveDeadlineMs < 3_000 || effectiveDeadlineMs > 30_000) throw new AppError('ADVISORY_CONFIGURATION_INVALID', '运行时 provider deadline 必须在 3000–30000ms。', 500);
    request.deadlineMs = effectiveDeadlineMs;
    const before = validateScope(request, this.getWorkCase(request.workCaseId));
    const beforeFingerprint = authoritativeFingerprint(before);
    const startedMs = this.clock();
    const startedAt = new Date(startedMs).toISOString();
    const invocationId = `${request.providerRequestId}:${startedMs}:${++this.sequence}`;
    const inputHash = canonicalHash(request);
    let outputHash = null;
    let usage = {};
    try {
      const rawResult = await this.provider.suggest(request, { signal });
      usage = rawResult?.[PROVIDER_TELEMETRY] ?? {};
      const after = validateScope(request, this.getWorkCase(request.workCaseId));
      if (canonicalHash(authoritativeFingerprint(after)) !== canonicalHash(beforeFingerprint)) throw new AppError('ADVISORY_SCOPE_STALE', 'Provider 调用期间权威 WorkCase 已变化；建议已丢弃。', 409);
      const result = validateAdvisoryResult(rawResult, request, { providerId: this.provider.providerId, model: this.provider.model });
      outputHash = canonicalHash(result);
      const completedMs = this.clock();
      await this.#record({
        invocationId, providerRequestId: request.providerRequestId, providerId: this.provider.providerId,
        model: this.provider.model, operation: request.operation, promptVersion: request.promptVersion,
        evaluationVersion: request.evaluationVersion, outputSchemaVersion: request.outputSchemaVersion,
        traceId: request.traceId, startedAt, completedAt: new Date(completedMs).toISOString(),
        latencyMs: Math.max(0, completedMs - startedMs), status: 'succeeded', errorCategory: null,
        promptTokens: usage.promptTokens ?? null, completionTokens: usage.completionTokens ?? null,
        totalTokens: usage.totalTokens ?? null, cachedTokens: usage.cachedTokens ?? null, cost: usage.cost ?? null,
        inputHash, outputHash,
      });
      return result;
    } catch (error) {
      const completedMs = this.clock();
      const mapped = mapProviderError(error);
      await this.#record({
        invocationId, providerRequestId: request.providerRequestId, providerId: this.provider.providerId,
        model: this.provider.model, operation: request.operation, promptVersion: request.promptVersion,
        evaluationVersion: request.evaluationVersion, outputSchemaVersion: request.outputSchemaVersion,
        traceId: request.traceId, startedAt, completedAt: new Date(completedMs).toISOString(),
        latencyMs: Math.max(0, completedMs - startedMs), status: 'failed', errorCategory: mapped.details?.category ?? mapped.code,
        promptTokens: usage.promptTokens ?? null, completionTokens: usage.completionTokens ?? null,
        totalTokens: usage.totalTokens ?? null, cachedTokens: usage.cachedTokens ?? null, cost: usage.cost ?? null,
        inputHash, outputHash,
      });
      throw mapped;
    }
  }

  health() {
    let provider;
    try {
      provider = typeof this.provider.health === 'function'
        ? this.provider.health()
        : { status: 'ready', providerId: this.provider.providerId, model: this.provider.model };
    } catch {
      provider = { status: 'degraded', providerId: this.provider.providerId, model: this.provider.model, errorCategory: 'provider_health_failed' };
    }
    let telemetry;
    try {
      telemetry = this.lastTelemetryError ? { status: 'degraded', errorCategory: 'telemetry_write_failed' } : (this.telemetry?.health?.() ?? { status: 'disabled' });
    } catch {
      telemetry = { status: 'degraded', errorCategory: 'telemetry_health_failed' };
    }
    return {
      ...provider,
      telemetry,
    };
  }
}
