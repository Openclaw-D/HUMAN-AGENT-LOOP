const DEFAULT_MAX_BYTES = 16 * 1024;
const DEFAULT_BODY_TIMEOUT_MS = 10_000;

function bodyTooLarge(): Error & { code: 'REQUEST_BODY_TOO_LARGE' } {
  return Object.assign(new Error('请求体超过允许大小'), { code: 'REQUEST_BODY_TOO_LARGE' as const });
}

function requestBodyTimeout(): Error & { code: 'REQUEST_BODY_TIMEOUT' } {
  return Object.assign(new Error('请求体读取超时'), { code: 'REQUEST_BODY_TIMEOUT' as const });
}

function cancelBestEffort(cancel: () => Promise<unknown>): void {
  try {
    void cancel().catch(() => {});
  } catch {
    // Cleanup must never delay or replace the authoritative size error.
  }
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_BODY_TIMEOUT_MS,
): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength >= 0 && parsedLength > maxBytes) {
      if (request.body) cancelBestEffort(() => request.body!.cancel());
      throw bodyTooLarge();
    }
  }

  if (!request.body) return JSON.parse('');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let activeRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let timedOut = false;
  let timeoutError: ReturnType<typeof requestBodyTimeout> | undefined;
  let timeoutId: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutError = requestBodyTimeout();
      cancelBestEffort(() => reader.cancel());
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    while (true) {
      activeRead = reader.read();
      const { done, value } = await Promise.race([activeRead, deadline]);
      activeRead = undefined;
      // reader.cancel() can resolve the pending read with { done: true }
      // before the deadline rejection wins Promise.race. Timeout remains the
      // authoritative outcome in either ordering.
      if (timedOut) throw timeoutError!;
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        cancelBestEffort(() => reader.cancel());
        throw bodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timeoutId!);
    // A timeout can win the race before reader.cancel() settles the pending
    // read. Wait for that read only (not the possibly hanging underlying
    // cancel hook) so releaseLock cannot replace the authoritative timeout.
    if (activeRead) {
      try {
        await activeRead;
      } catch {
        // The original read/timeout error remains authoritative.
      }
    }
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
