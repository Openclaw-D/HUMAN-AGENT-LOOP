import { ProviderError, isProviderError } from './errors.js';

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deadlineSignalFactory(ms, parentSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason ?? new Error('Provider request aborted.'));
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Provider deadline exceeded.')), ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abort);
    },
  };
}

export class CircuitBreaker {
  constructor({ clock = () => Date.now(), failureThreshold = 5, failureWindowMs = 60_000, openMs = 30_000 } = {}) {
    this.clock = clock;
    this.failureThreshold = failureThreshold;
    this.failureWindowMs = failureWindowMs;
    this.openMs = openMs;
    this.failures = [];
    this.openUntil = 0;
    this.halfOpenInFlight = false;
  }

  beforeCall() {
    const now = this.clock();
    if (this.openUntil > 0) {
      if (now < this.openUntil || this.halfOpenInFlight) throw new ProviderError('circuit_open', 'Provider circuit breaker is open.', { transient: true });
      this.halfOpenInFlight = true;
      return { halfOpen: true };
    }
    return { halfOpen: false };
  }

  success() {
    this.failures = [];
    this.openUntil = 0;
    this.halfOpenInFlight = false;
  }

  nonTransientFailure() {
    this.success();
  }

  transientFailure(token) {
    const now = this.clock();
    if (token.halfOpen) {
      this.openUntil = now + this.openMs;
      this.halfOpenInFlight = false;
      return;
    }
    this.failures = this.failures.filter((at) => now - at < this.failureWindowMs);
    this.failures.push(now);
    if (this.failures.length >= this.failureThreshold) {
      this.openUntil = now + this.openMs;
      this.halfOpenInFlight = false;
    }
  }

  health() {
    const now = this.clock();
    if (this.openUntil > now) return { state: 'open', retryAfterMs: this.openUntil - now };
    if (this.openUntil > 0) return { state: this.halfOpenInFlight ? 'half_open_probe' : 'half_open' };
    return { state: 'closed', recentTransientFailures: this.failures.filter((at) => now - at < this.failureWindowMs).length };
  }
}

export class ResilientAdvisoryProvider {
  constructor(provider, {
    clock = () => Date.now(), sleep = defaultSleep, random = Math.random,
    timeoutSignalFactory = deadlineSignalFactory, breaker = null,
  } = {}) {
    if (!provider || typeof provider.suggest !== 'function') throw new ProviderError('provider_contract_invalid', 'Provider must implement suggest(request, { signal }).');
    this.provider = provider;
    this.providerId = provider.providerId;
    this.model = provider.model;
    this.clock = clock;
    this.sleep = sleep;
    this.random = random;
    this.timeoutSignalFactory = timeoutSignalFactory;
    this.breaker = breaker ?? new CircuitBreaker({ clock });
  }

  async suggest(request, { signal } = {}) {
    const breakerToken = this.breaker.beforeCall();
    const startedAt = this.clock();
    let finalError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const elapsed = Math.max(0, this.clock() - startedAt);
      const remaining = request.deadlineMs - elapsed;
      if (remaining <= 0) {
        finalError = new ProviderError('timeout', 'Provider deadline exceeded.', { transient: true });
        break;
      }
      const deadline = this.timeoutSignalFactory(remaining, signal);
      try {
        const result = await this.provider.suggest(request, { signal: deadline.signal });
        deadline.cancel();
        this.breaker.success();
        return result;
      } catch (error) {
        deadline.cancel();
        finalError = isProviderError(error)
          ? error
          : new ProviderError(deadline.signal.aborted || signal?.aborted ? 'timeout' : 'network', 'Provider transport failed.', { transient: true, retryable: !(deadline.signal.aborted || signal?.aborted), cause: error });
        if (!(attempt === 0 && finalError.retryable)) break;
        const jitterMs = 25 + Math.floor(this.random() * 75);
        await this.sleep(jitterMs);
      }
    }
    if (finalError?.transient) this.breaker.transientFailure(breakerToken);
    else this.breaker.nonTransientFailure();
    throw finalError;
  }

  health() {
    const circuit = this.breaker.health();
    return {
      status: circuit.state === 'closed' ? 'ready' : 'degraded',
      providerId: this.providerId,
      model: this.model,
      circuit,
    };
  }
}
