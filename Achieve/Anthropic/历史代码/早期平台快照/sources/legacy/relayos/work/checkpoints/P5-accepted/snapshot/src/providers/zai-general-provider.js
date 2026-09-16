import { ProviderError } from './errors.js';

export const PROVIDER_TELEMETRY = Symbol('relayos.provider.telemetry');

function endpointFromBase(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ProviderError('configuration_invalid', 'Z.AI General base URL is invalid.');
  }
  if (url.username || url.password || url.search || url.hash) throw new ProviderError('configuration_invalid', 'Z.AI General base URL must not contain credentials, query, or fragment.');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new ProviderError('configuration_invalid', 'Z.AI General base URL must use HTTPS outside local tests.');
  if (url.hostname === 'api.z.ai' && url.pathname.replace(/\/+$/, '') !== '/api/paas/v4') throw new ProviderError('configuration_invalid', 'Official Z.AI runtime must use the General API base path.');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return url.toString();
}

function responseSchemaDescription() {
  return JSON.stringify({
    authority: 'none', status: 'advisory', providerId: 'zai-general', model: 'configured model', outputSchemaVersion: 1,
    recommendations: [{ kind: 'operation-specific kind', summary: 'advisory summary', evidenceIds: ['only supplied Evidence IDs'], confidence: 'number 0..1', requiresHumanReview: true }],
    traceId: 'exact request traceId',
  });
}

function buildMessages(request, model) {
  return [
    {
      role: 'system',
      content: `Return one JSON object only. You are an advisory-only enterprise continuity assistant with authority=none. Never apply changes or decide goal, owner, permission grants, Human Gates, ActionIntent, ExecutionReceipt, or BusinessEvent. Every recommendation requires human review. Exact output shape: ${responseSchemaDescription()}`,
    },
    {
      role: 'user',
      content: JSON.stringify({ ...request, providerId: 'zai-general', model }),
    },
  ];
}

function classifyHttpError(status) {
  if (status === 429) return new ProviderError('rate_limit', 'Z.AI General API rate limited the request.', { transient: true, retryable: true, status });
  if ([500, 502, 503, 504].includes(status)) return new ProviderError('server_error', 'Z.AI General API returned a recoverable server error.', { transient: true, retryable: true, status });
  if (status >= 500) return new ProviderError('server_error', 'Z.AI General API returned a non-recoverable server error.', { status });
  return new ProviderError('client_error', 'Z.AI General API rejected the request.', { status });
}

export class ZaiGeneralProvider {
  #apiKey;

  constructor({ apiKey, baseUrl = 'https://api.z.ai/api/paas/v4/', model = 'glm-5.3', fetchImpl = globalThis.fetch } = {}) {
    if (typeof apiKey !== 'string' || !apiKey) throw new ProviderError('configuration_invalid', 'Dedicated Z.AI General runtime secret is required.');
    if (typeof fetchImpl !== 'function') throw new ProviderError('configuration_invalid', 'Node fetch transport is required.');
    this.providerId = 'zai-general';
    this.model = model;
    this.#apiKey = apiKey;
    this.endpoint = endpointFromBase(baseUrl);
    this.fetchImpl = fetchImpl;
  }

  async suggest(request, { signal } = {}) {
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
          'accept-language': 'en-US,en',
        },
        body: JSON.stringify({
          model: this.model,
          messages: buildMessages(request, this.model),
          response_format: { type: 'json_object' },
          stream: false,
          thinking: { type: 'enabled' },
          reasoning_effort: 'low',
          temperature: 0,
          max_tokens: 2048,
          request_id: request.providerRequestId,
        }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw new ProviderError('timeout', 'Z.AI General API deadline exceeded.', { transient: true, cause: error });
      throw new ProviderError('network', 'Z.AI General API network failure.', { transient: true, retryable: true, cause: error });
    }
    if (!response.ok) throw classifyHttpError(response.status);
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ProviderError('invalid_json', 'Z.AI General API returned invalid JSON.', { cause: error });
    }
    const choice = payload?.choices?.[0];
    if (!choice || typeof choice.finish_reason !== 'string') throw new ProviderError('schema_mismatch', 'Z.AI General response is missing choices.');
    if (choice.finish_reason === 'network_error') throw new ProviderError('network', 'Z.AI General inference ended with network_error.', { transient: true, retryable: true });
    if (choice.finish_reason === 'sensitive') throw new ProviderError('policy_violation', 'Z.AI General response was blocked by policy.');
    if (choice.finish_reason !== 'stop') throw new ProviderError('ambiguity', 'Z.AI General response did not complete as a single advisory JSON object.');
    if (typeof choice.message?.content !== 'string') throw new ProviderError('schema_mismatch', 'Z.AI General response content must be a JSON string.');
    let result;
    try {
      result = JSON.parse(choice.message.content);
    } catch (error) {
      throw new ProviderError('invalid_json', 'Z.AI General model content is not valid JSON.', { cause: error });
    }
    Object.defineProperty(result, PROVIDER_TELEMETRY, {
      enumerable: false,
      value: {
        promptTokens: Number.isFinite(payload.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null,
        completionTokens: Number.isFinite(payload.usage?.completion_tokens) ? payload.usage.completion_tokens : null,
        totalTokens: Number.isFinite(payload.usage?.total_tokens) ? payload.usage.total_tokens : null,
        cachedTokens: Number.isFinite(payload.usage?.prompt_tokens_details?.cached_tokens) ? payload.usage.prompt_tokens_details.cached_tokens : null,
        cost: null,
      },
    });
    return result;
  }
}
