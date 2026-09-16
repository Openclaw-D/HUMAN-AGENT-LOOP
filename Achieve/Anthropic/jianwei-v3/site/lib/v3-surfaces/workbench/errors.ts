function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'INTERNAL_ERROR';
}

export function classifyWorkbenchError(error: unknown) {
  const code = errorCode(error);
  if (
    code === 'WORKBENCH_DEPENDENCY_BUSY' ||
    code === 'WORKBENCH_DEPENDENCY_UNAVAILABLE' ||
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_BUSY_RETRYABLE' ||
    code === 'CHAT_BUSY'
  ) {
    return { status: 503, retryable: true } as const;
  }
  return { status: null, retryable: false } as const;
}

export function getWorkbenchErrorCode(error: unknown): string {
  return errorCode(error);
}
