import { digest, stable } from './assistant-receipts.mjs';

const sha = /^[a-f0-9]{64}$/;
/** Accept only server-resolved, authorized originals. Offsets refer to extracted text, never invented pages. */
export function prepareEvidence({ tenantId, customerId, revision, materials, allowedHashes = [], maxChars = 12000 }) {
  const allowed = new Set(allowedHashes);
  const snippets = [], facts = [], omitted = [];
  const cap = Math.min(12000, maxChars);
  const base = { tenantId, customerId, revision, snippets, facts, omitted, authority: 'none' };
  for (const m of [...materials].sort((a,b) => String(a.evidenceId).localeCompare(String(b.evidenceId)))) {
    if (m.tenantId !== tenantId || m.customerId !== customerId || !sha.test(m.hash ?? '') ||
        !allowed.has(m.hash) || !m.artifactId || !m.parserVersion || m.current !== true)
      throw new Error('EVIDENCE_NOT_AUTHORIZED');
    const pages = Array.isArray(m.pages) && m.pages.length ? m.pages : [{ text: m.text, page: null }];
    for (const p of pages) {
      if (typeof p.text !== 'string') throw new Error('EVIDENCE_TEXT_INVALID');
      for (let start = 0; start < p.text.length; start += 800) {
        const text = p.text.slice(start, start + 800);
        if (!text.trim()) continue;
        const locator = { kind: Number.isInteger(p.page) && p.page > 0 ? 'page_text' : 'extracted_text',
          ...(Number.isInteger(p.page) && p.page > 0 ? { page: p.page } : {}), start, end: start + text.length };
        const ref = { artifactId: m.artifactId, evidenceId: m.evidenceId, hash: m.hash,
          parserVersion: m.parserVersion, locator, text, limitations: m.limitations ?? [] };
        const item = { id: digest(ref), ...ref };
        if (snippets.length >= 8 || stable({ ...base, snippets: [...snippets, item] }).length > cap - 512) {
          if (!omitted.some(o => o.evidenceId === m.evidenceId)) omitted.push({ evidenceId: m.evidenceId, reason: 'CONTEXT_LIMIT' });
          break;
        }
        snippets.push(item);
      }
    }
    // Declared facts are not verified facts; only retain those with a literal source span.
    let omittedFacts = 0;
    for (const f of m.facts ?? []) {
      const source = snippets.find(s => s.evidenceId === m.evidenceId && typeof f.sourceText === 'string' && f.sourceText.length > 0 && s.text.includes(f.sourceText));
      if (!source || facts.length >= 30) { omittedFacts++; continue; }
      const fact = { key: f.factKey, value: f.value, unit: f.unit ?? null, evidenceRefId: source.id, verification: 'declared' };
      if (stable({ ...base, facts: [...facts, fact] }).length <= cap - 512) facts.push(fact);
      else omittedFacts++;
    }
    if (omittedFacts) omitted.push({ evidenceId: m.evidenceId, reason: 'FACT_SOURCE_OR_LIMIT', count: omittedFacts });
  }
  if (!snippets.length) throw new Error('EVIDENCE_MISSING');
  if (stable(base).length > cap) throw new Error('EVIDENCE_CONTEXT_LIMIT');
  return { ...base, hash: digest(base) };
}

/** Reference validity proves provenance, not whether an inference is substantively correct. */
export function validateCitations(outcome, pack) {
  const refs = new Map(pack.snippets.map(s => [s.id, s]));
  const findings = [], questions = [...(outcome.questions ?? [])], checks = [];
  for (const finding of outcome.findings ?? []) {
    const ids = finding.evidenceRefIds;
    const valid = Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && refs.has(id));
    checks.push({ valid, evidenceRefIds: Array.isArray(ids) ? ids : [], reason: valid ? 'SOURCE_BOUND' : 'UNVERIFIED_REFERENCE' });
    if (valid) findings.push({ ...finding, evidenceRefIds: [...new Set(ids)], citationStatus: 'source_bound' });
    else questions.push({ text: `待核验（缺少有效原文引用）：${finding.text}`, citationStatus: 'unverified' });
  }
  const used = new Set(findings.flatMap(f => f.evidenceRefIds));
  return { ...outcome, findings, questions, evidenceRefs: pack.snippets.filter(s => used.has(s.id)), citationChecks: checks };
}
