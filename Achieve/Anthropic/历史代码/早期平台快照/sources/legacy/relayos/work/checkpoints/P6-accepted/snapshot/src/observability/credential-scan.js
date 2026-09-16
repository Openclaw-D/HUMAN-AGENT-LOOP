const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;
const AUTH_PATTERN = /\b(?:Bearer|Basic)\s+([A-Za-z0-9._~+\/=\-]{20,})/gi;
const TOKEN_PATTERN = /\b(sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}|AIza[A-Za-z0-9_-]{30,})\b/gi;
const QUOTED_ASSIGNMENT_PATTERN = /['"]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)['"]?\s*[:=]\s*(['"])([^'"\r\n]{16,})\1/gi;
const UNQUOTED_ASSIGNMENT_PATTERN = /['"]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)['"]?\s*[:=]\s*([A-Za-z0-9_~+\/=\-]{16,})(?=$|[\s,;])/gi;
const ALLOWED_SYNTHETIC_CREDENTIALS = new Set([
  'test-only', 'runtime-test-only', 'dedicated-runtime-secret-test-only',
  'runtime-secret-canary', 'runtime-secret-canary-p6-never-persist',
  '[redacted]', 'excluded', '<placeholder>', '${placeholder}',
]);

export function isAllowedSyntheticCredential(value) {
  return ALLOWED_SYNTHETIC_CREDENTIALS.has(String(value).toLowerCase());
}

export function containsCredential(bytesOrText, options = {}) {
  const text = Buffer.isBuffer(bytesOrText) ? bytesOrText.toString('utf8') : String(bytesOrText);
  const allowSynthetic = options.allowSynthetic ?? (() => false);
  if (PRIVATE_KEY_PATTERN.test(text)) return true;
  for (const [pattern, group] of [
    [AUTH_PATTERN, 1],
    [TOKEN_PATTERN, 1],
    [QUOTED_ASSIGNMENT_PATTERN, 2],
    [UNQUOTED_ASSIGNMENT_PATTERN, 1],
  ]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (!allowSynthetic(match[group].trim())) return true;
    }
  }
  return false;
}
