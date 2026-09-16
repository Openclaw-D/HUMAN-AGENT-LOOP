import { ProviderError } from './errors.js';

const FIXTURES = new Map([
  ['material.extract', { kind: 'extraction', summary: '材料中存在一项可供人工复核的结构化事实。', confidence: 0.98 }],
  ['context.summarize', { kind: 'summary', summary: '当前上下文围绕已接受目标汇总，结论仅供人工复核。', confidence: 0.96 }],
  ['conflict.identify', { kind: 'conflict', summary: '两个证据引用之间存在版本差异，需要人工复核。', confidence: 0.92 }],
  ['configuration.suggest', { kind: 'configuration', summary: '建议形成候选配置差异，由具名人员通过确定性流程复核。', confidence: 0.88 }],
  ['action.suggest', { kind: 'action', summary: '建议准备候选行动方案并交由具名人员复核。', confidence: 0.9 }],
]);

export class MockProvider {
  constructor({ mode = 'success', script = [] } = {}) {
    this.providerId = 'mock';
    this.model = 'deterministic-fixture-v1';
    this.mode = mode;
    this.script = [...script];
    this.callCount = 0;
  }

  setMode(mode) {
    this.mode = mode;
  }

  async suggest(request, { signal } = {}) {
    this.callCount += 1;
    if (signal?.aborted) throw new ProviderError('timeout', 'Mock provider deadline exceeded.', { transient: true });
    const mode = this.script.length > 0 ? this.script.shift() : this.mode;
    switch (mode) {
      case 'timeout': throw new ProviderError('timeout', 'Mock provider deadline exceeded.', { transient: true });
      case 'network': throw new ProviderError('network', 'Mock provider network failure.', { transient: true, retryable: true });
      case '429': throw new ProviderError('rate_limit', 'Mock provider rate limited.', { transient: true, retryable: true, status: 429 });
      case '5xx': throw new ProviderError('server_error', 'Mock provider recoverable server failure.', { transient: true, retryable: true, status: 503 });
      case '4xx': throw new ProviderError('client_error', 'Mock provider non-retryable client failure.', { status: 400 });
      case 'invalid-json': throw new ProviderError('invalid_json', 'Mock provider returned invalid JSON.');
      case 'ambiguity': throw new ProviderError('ambiguity', 'Mock provider output is ambiguous.');
      case 'schema-mismatch':
        return { authority: 'none', providerId: this.providerId, model: this.model, outputSchemaVersion: request.outputSchemaVersion, recommendations: [], traceId: request.traceId };
      case 'unsafe':
        return {
          authority: 'none', status: 'advisory', providerId: this.providerId, model: this.model,
          outputSchemaVersion: request.outputSchemaVersion,
          recommendations: [{ kind: 'action', summary: '候选动作', evidenceIds: [request.inputRefs[0]], confidence: 1, requiresHumanReview: true, apply: true }],
          traceId: request.traceId,
        };
      case 'success': break;
      default: throw new ProviderError('mock_mode_invalid', 'Unknown deterministic MockProvider mode.');
    }
    const fixture = FIXTURES.get(request.operation);
    if (!fixture) throw new ProviderError('request_invalid', 'MockProvider received an unsupported operation.');
    return {
      authority: 'none',
      status: 'advisory',
      providerId: this.providerId,
      model: this.model,
      outputSchemaVersion: request.outputSchemaVersion,
      recommendations: [{ ...fixture, evidenceIds: [...request.inputRefs], requiresHumanReview: true }],
      traceId: request.traceId,
    };
  }
}
