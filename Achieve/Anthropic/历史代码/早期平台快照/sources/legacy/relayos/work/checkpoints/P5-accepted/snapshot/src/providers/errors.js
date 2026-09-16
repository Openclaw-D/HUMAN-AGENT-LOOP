export class ProviderError extends Error {
  constructor(category, message, { transient = false, retryable = false, status = null, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ProviderError';
    this.category = category;
    this.transient = transient;
    this.retryable = retryable;
    this.status = status;
  }
}

export function isProviderError(error) {
  return error instanceof ProviderError;
}
