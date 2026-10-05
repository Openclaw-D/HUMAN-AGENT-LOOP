// Explicit real-provider regression against approved original files; no credentials in output.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createAssistantModel } from '../src/assistant-model.mjs';
import { prepareEvidence } from '../src/assistant-evidence.mjs';
import { PARSE_ADAPTERS_VERSION } from '../../C/src/parse/adapters.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required');
const phase = arg('phase');
if (!['before', 'after'].includes(phase)) throw new Error('--phase=before|after required');
const planPath = arg('plan'), manifestPath = arg('manifest'), inputsRoot = arg('inputs'), configPath = arg('model-config'), out = arg('output');
if ([planPath, manifestPath, inputsRoot, configPath, out].some(v => !v)) throw new Error('Plan, manifest, inputs, model-config and output paths required');
const sha = buf => createHash('sha256').update(buf).digest('hex');
const planBytes = await readFile(planPath), configBytes = await readFile(configPath);
const plan = JSON.parse(planBytes), cfg = JSON.parse(configBytes);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (cfg.transport.mode !== 'real' || new URL(cfg.transport.real.endpoint).origin !== plan.provider || cfg.transport.real.model !== plan.model)
  throw new Error('Approved real provider/model mismatch');
await mkdir(out, { recursive: true });
const model = await createAssistantModel({ configPath, receiptsDir: path.join(out, 'assistant-receipts'), costLedgerPath: path.join(out, 'assistant-cost.jsonl') });
let frozen;
if (phase === 'before') {
  frozen = { planSha256: sha(planBytes), configSha256: sha(configBytes), createdAt: new Date().toISOString(), inputs: [] };
  for (const check of plan.cases) {
    const c = manifest.cases.find(c => c.caseId === check.caseId);
    if (!c) throw new Error('Case missing from approved manifest');
    const customerId = `api-regression-${c.caseId}`, tenantId = 'codex-api-regression';
    const materials = [];
    for (const [i, f] of c.files.entries()) {
      const bytes = await readFile(path.join(inputsRoot, c.caseId, f.name));
      if (sha(bytes) !== f.sha256 || bytes.length !== f.bytes || !cfg.evidencePolicy.allowedHashes.includes(f.sha256))
        throw new Error('Original bytes/hash/authorization mismatch');
      if (!/\.(csv|txt)$/i.test(f.name)) throw new Error('This regression requires original UTF8 text sources');
      const text = bytes.toString('utf8');
      if (text.includes('\ufffd')) throw new Error('Invalid original UTF8');
      materials.push({ tenantId, customerId, artifactId: `${c.caseId}-original-${i}`, evidenceId: `${c.caseId}-original-${i}`,
        hash: f.sha256, parserVersion: PARSE_ADAPTERS_VERSION, current: true, text, limitations: ['synthetic', 'declarations_not_verified'] });
    }
    const evidencePack = prepareEvidence({ tenantId, customerId, revision: 1, materials, allowedHashes: cfg.evidencePolicy.allowedHashes, maxChars: model.evidencePolicy().maxChars });
    frozen.inputs.push({ caseId: c.caseId, customerId, tenantId, assistant: 'credit', question: plan.question,
      context: { customerName: c.businessName, assessmentState: 'assessing', contextVersion: 'api-regression-frozen-v1', evidencePack } });
  }
  await writeFile(path.join(out, 'FROZEN_ASSISTANT_INPUTS.json'), JSON.stringify(frozen, null, 2));
} else {
  frozen = JSON.parse(await readFile(path.join(out, 'FROZEN_ASSISTANT_INPUTS.json'), 'utf8'));
  if (frozen.planSha256 !== sha(planBytes) || frozen.configSha256 !== sha(configBytes)) throw new Error('Comparison plan/config changed');
  // Check the actual original bytes again immediately before each after run.
  for (const input of frozen.inputs) for (const file of manifest.cases.find(c => c.caseId === input.caseId).files) {
    const bytes = await readFile(path.join(inputsRoot, input.caseId, file.name));
    if (sha(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error('Frozen original changed');
  }
}
const results = [];
for (const input of frozen.inputs) {
  const started = performance.now();
  const result = await model.observe({ ...input, checkCurrent: async () => true }); // Local immutable frozen snapshot only.
  const row = { caseId: input.caseId, latencyMs: Math.round(performance.now() - started), result };
  results.push(row);
  await writeFile(path.join(out, `${phase.toUpperCase()}_ASSISTANT.json`), JSON.stringify({ phase, at: new Date().toISOString(), planSha256: frozen.planSha256, results }, null, 2));
  console.log(JSON.stringify({ caseId: row.caseId, latencyMs: row.latencyMs, status: result.status, sent: result.sent, replayed: result.replayed,
    observations: result.observations, questions: result.questions, model: result.source?.model, errorCode: result.error?.code }));
  if (result.status === 'unknown' || result.status === 'failed') break;
}
