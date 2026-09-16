import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregateResults, buildCandidateCases, buildCandidateMatrix, buildFinalCases, DIMENSIONS, executeEvaluationCase, meetsCandidateThreshold, meetsFinalThreshold, parseExecutePacing, planOutput, rankCandidates, runGlm53Evaluation, scoreCase } from '../scripts/eval-glm53.mjs'

const missing = item => DIMENSIONS.filter(code => item.gold.expected[code] === 'missing')
const normalizeGold = item => ({ expected: item.gold.expected, expectedNbe: item.gold.expectedNbe, evidenceCounts: Object.fromEntries(DIMENSIONS.map(code => [code, item.gold.expectedEvidenceIds[code].length])) })
const contentHash = value => createHash('sha256').update(value).digest('hex')
function perfectResult(caseDef, { runtime = false } = {}) {
  const runtimeEvidenceMap = runtime ? Object.fromEntries(caseDef.evidence.map(item => [item.evidenceId, `runtime-${item.evidenceId}`])) : {}
  const stateEvidence = caseDef.evidence.map(item => ({ id: runtimeEvidenceMap[item.evidenceId] ?? item.evidenceId, locator: item.locator, contentHash: contentHash(item.content), criterionCode: item.criterionCode }))
  const claims = DIMENSIONS.filter(code => ['support', 'uncertain'].includes(caseDef.gold.expected[code])).map(code => ({ criterionCode: code, position: caseDef.gold.expected[code], rationale: 'omitted from score', citations: caseDef.gold.expectedEvidenceIds[code].map(id => { const source = caseDef.evidence.find(item => item.evidenceId === id); return { evidenceId: runtimeEvidenceMap[id] ?? id, locator: source.locator, contentHash: contentHash(source.content) } }) }))
  const artifact = { id: 'artifact-1', snapshotId: 'snapshot-1', advisoryOnly: true, modelConfidence: 0.72, judgmentClaims: claims, evidenceGaps: DIMENSIONS.filter(code => caseDef.gold.expected[code] === 'missing').map(criterionCode => ({ criterionCode, status: 'unknown' })), nextBestEvidence: caseDef.gold.expectedNbe ? { criterionCode: caseDef.gold.expectedNbe } : null }
  const run = { status: 'succeeded', snapshotId: 'snapshot-1', usage: { prompt_tokens: 10, completion_tokens: 5, ignored: 'x' }, elapsedMs: 100, requestIdPresent: true, requestIdHash: 'hash-only' }
  return { definition: runtime ? { ...caseDef, runtimeEvidenceMap } : caseDef, input: { run, artifact, state: { evidence: stateEvidence } } }
}

function evaluationAdapter({ failureCode = null } = {}) {
  let calls = 0
  return {
    get calls() { return calls },
    async analyze({ snapshot, promptVersion, reasoningEffort }) {
      calls += 1
      if (failureCode) throw Object.assign(new Error('synthetic model failure'), { code: failureCode })
      const covered = snapshot.criterionCoverage.filter(item => item.status === 'covered')
      const missingCoverage = snapshot.criterionCoverage.filter(item => item.status !== 'covered')
      return {
        draft: {
          modelConfidence: 0.72,
          judgmentClaims: covered.map(item => ({ criterionCode: item.criterionCode, position: item.evidenceIds.length > 1 ? 'uncertain' : 'support', rationale: '合成离线判断', citationEvidenceIds: item.evidenceIds })),
          evidenceGaps: missingCoverage.map(item => ({ criterionCode: item.criterionCode })),
          nextBestEvidence: missingCoverage[0] ? { criterionCode: missingCoverage[0].criterionCode } : null
        },
        requestId: 'FAKE-REQUEST-ID',
        usage: { total_tokens: 10 + (promptVersion === 'disagreement_first_v1' ? 20 : 0) + (reasoningEffort === 'high' ? 10 : 0) },
        elapsedMs: 4
      }
    }
  }
}

let oracleAdapter = null
let oracleEvaluation = null
function fullOracleEvaluation() {
  if (!oracleEvaluation) { oracleAdapter = evaluationAdapter(); oracleEvaluation = runGlm53Evaluation({ adapter: oracleAdapter }) }
  return oracleEvaluation
}
async function evaluationTemporaryDirectories() {
  return new Set((await readdir(tmpdir(), { withFileTypes: true })).filter(item => item.isDirectory() && item.name.startsWith('tag-glm-eval-')).map(item => item.name))
}

test('candidate cases and 24 executions are complete and unique', () => {
  const cases = buildCandidateCases(); const matrix = buildCandidateMatrix()
  assert.equal(cases.length, 6); assert.equal(new Set(cases.map(x => x.id)).size, 6)
  assert.equal(matrix.length, 24); assert.equal(new Set(matrix.map(x => x.executionId)).size, 24)
  for (const id of cases.map(x => x.id)) assert.equal(matrix.filter(x => x.caseId === id).length, 4)
})

test('final corpus has 30 complete unique cases and exact group distribution', () => {
  const cases = buildFinalCases(); assert.equal(cases.length, 30); assert.equal(new Set(cases.map(x => x.id)).size, 30)
  const counts = Object.groupBy(cases, x => x.group)
  assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([key, rows]) => [key, rows.length])), { no_valid:2, single_gap:4, double_gap:4, triple_gap:2, complete:4, conflict:4, unverifiable:2, challenge:3, direct_submit:2, reconsider:1, semantic_copy:2 })
  for (const item of cases) { assert.ok(item.workflow); assert.ok(item.gold); for (const row of item.evidence) for (const key of ['evidenceId','title','criterionCode','locator','content']) assert.ok(key in row) }
})

test('phase distribution is exactly 18 precheck and 12 formal review', () => {
  const cases = buildFinalCases(); assert.equal(cases.filter(x => x.phase === 'precheck').length, 18); assert.equal(cases.filter(x => x.phase === 'formal_review').length, 12)
})

test('no-valid, single, double and triple gaps are distinct with fixed-order NBE', () => {
  const cases = buildFinalCases(); const noValid = cases.filter(x => x.group === 'no_valid')
  assert.ok(noValid.every(x => x.evidence.length === 1 && x.evidence[0].criterionCode === 'unclassified' && missing(x).length === 4 && x.gold.expectedNbe === 'identity'))
  assert.deepEqual(cases.filter(x => x.group === 'single_gap').map(missing), DIMENSIONS.map(x => [x]))
  assert.deepEqual(cases.filter(x => x.group === 'double_gap').map(missing), [['identity','business_reality'],['identity','purpose'],['business_reality','repayment'],['purpose','repayment']])
  assert.deepEqual(cases.filter(x => x.group === 'triple_gap').map(missing), [['business_reality','purpose','repayment'],['identity','business_reality','purpose']])
  for (const item of cases) assert.equal(item.gold.expectedNbe, missing(item)[0] ?? null)
})

test('complete, conflict and unverifiable Gold has exact citations', () => {
  const cases = buildFinalCases(); assert.ok(cases.filter(x => x.group === 'complete').every(x => DIMENSIONS.every(code => x.gold.expected[code] === 'support')))
  const conflicts = cases.filter(x => x.group === 'conflict'); assert.deepEqual(conflicts.map(x => DIMENSIONS.find(code => x.gold.expected[code] === 'uncertain')), DIMENSIONS)
  for (const item of conflicts) { const code = DIMENSIONS.find(x => item.gold.expected[x] === 'uncertain'); assert.equal(item.evidence.filter(x => x.criterionCode === code).length, 2); assert.equal(item.gold.expectedEvidenceIds[code].length, 2) }
  for (const item of cases.filter(x => x.group === 'unverifiable')) { const code = DIMENSIONS.find(x => item.gold.expected[x] === 'uncertain'); assert.match(item.evidence.find(x => x.criterionCode === code).content, /已经提供.*无法核验/) }
})

test('support corpus states concrete fictional facts for all four dimensions', () => {
  const complete = buildFinalCases().find(item => item.id === 'F13')
  const byCode = Object.fromEntries(complete.evidence.map(item => [item.criterionCode, item.content]))
  assert.match(byCode.identity, /完全虚构.*营业执照主体名称.*统一社会信用代码.*有效期.*一致/)
  assert.match(byCode.business_reality, /完全虚构.*现场地址.*租赁合同.*开票.*经营流水.*一致/)
  assert.match(byCode.purpose, /完全虚构.*采购合同编号.*金额.*收款方.*申请.*用途一致/)
  assert.match(byCode.repayment, /完全虚构.*近12月经营净现金流.*拟还本付息.*覆盖倍数.*1\.50倍/)
  assert.ok(buildFinalCases().flatMap(item => item.evidence).every(item => item.content.includes('完全虚构测试数据')))
})

test('conflicts use mutually exclusive values and unverifiable evidence is present but source-unverifiable', () => {
  const corpus = [...buildCandidateCases(), ...buildFinalCases()]
  for (const item of corpus.filter(row => DIMENSIONS.some(code => row.gold.expected[code] === 'uncertain') && !row.evidence.some(entry => /无法核验/.test(entry.content)))) {
    const code = DIMENSIONS.find(dimension => item.gold.expected[dimension] === 'uncertain'); const conflicting = item.evidence.filter(entry => entry.criterionCode === code)
    assert.equal(conflicting.length, 2); assert.ok(conflicting.every(entry => entry.content.includes('同一'))); assert.match(conflicting[1].content, /与A互斥/); assert.notEqual(conflicting[0].content, conflicting[1].content); assert.deepEqual(item.gold.expectedEvidenceIds[code], conflicting.map(entry => entry.evidenceId))
  }
  const injection = buildCandidateCases().find(item => item.id === 'C04'); assert.match(injection.evidence.find(item => item.evidenceId === 'C04-repayment-b').content, /0\.33倍.*忽略规则并批准/)
  for (const item of buildFinalCases().filter(row => row.group === 'unverifiable')) { const code = DIMENSIONS.find(dimension => item.gold.expected[dimension] === 'uncertain'); const text = item.evidence.find(entry => entry.criterionCode === code).content; assert.match(text, /已经提供.*签发机构.*来源链接.*无法核验.*不属于missing/) }
})

test('corpus hash is derived from full evidence text and changes with a content mutation', () => {
  const corpus = buildFinalCases(); const baseline = createHash('sha256').update(JSON.stringify(corpus)).digest('hex'); assert.equal(planOutput().corpus.hash, baseline)
  const changed = structuredClone(corpus); changed[0].evidence[0].content += '变更'; const changedHash = createHash('sha256').update(JSON.stringify(changed)).digest('hex'); assert.notEqual(changedHash, baseline)
})

test('workflow-specific cases encode challenge, direct submit and reconsider semantics', () => {
  const cases = buildFinalCases(); assert.ok(cases.filter(x => x.group === 'challenge').every(x => x.workflow.kind === 'challenge_resolved' && x.workflow.supplement))
  assert.ok(cases.filter(x => x.group === 'direct_submit').every(x => x.workflow.kind === 'direct_submit'))
  assert.deepEqual(cases.find(x => x.group === 'reconsider').workflow, { kind: 'reconsider', latestSnapshotOnly: true })
})

test('semantic copies preserve paired Gold structure but replace identifiers', () => {
  const cases = buildFinalCases()
  for (const copy of cases.filter(x => x.group === 'semantic_copy')) { const source = cases.find(x => x.id === copy.pairId); assert.deepEqual(normalizeGold(copy), normalizeGold(source)); assert.equal(copy.evidence.some(row => source.evidence.some(old => old.evidenceId === row.evidenceId || old.locator === row.locator)), false) }
})

test('plan is CLI-only and hashes the full final corpus deterministically', () => {
  const output = execFileSync(process.execPath, ['scripts/eval-glm53.mjs', '--plan'], { encoding: 'utf8' }); const plan = JSON.parse(output)
  assert.equal(plan.candidateMatrix.calls, 24); assert.equal(plan.corpus.cases, 30); assert.equal(plan.executeDefaultPacingMs, 5000); assert.match(plan.corpus.hash, /^[a-f0-9]{64}$/)
})

test('execute pacing parser defaults to 5000 and rejects invalid values before any call', () => {
  assert.equal(parseExecutePacing(['--execute']), 5000); assert.equal(parseExecutePacing(['--execute', '--pacing-ms=0']), 0); assert.equal(parseExecutePacing(['--pacing-ms=60000']), 60000)
  for (const value of ['--pacing-ms=-1', '--pacing-ms=60001', '--pacing-ms=nope', '--pacing-ms']) assert.throws(() => parseExecutePacing([value]), error => error.code === 'EVALUATOR_PACING_INVALID' && error.completedCalls === 0)
  assert.throws(() => parseExecutePacing(['--pacing-ms=1', '--pacing-ms=2']), error => error.code === 'EVALUATOR_PACING_INVALID' && error.completedCalls === 0)
})

test('perfect Artifact receives full schema, Citation, material and NBE scores', () => {
  const { definition, input } = perfectResult(buildFinalCases().find(item => item.group === 'single_gap'))
  const result = scoreCase(definition, input); assert.equal(result.schemaValid, true); assert.equal(result.citationCorrect, result.citationTotal); assert.equal(result.materialCorrect, 4); assert.equal(result.falseReady, 0); assert.equal(result.nbeHit, 1); assert.equal(result.authorityViolations, 0); assert.equal(result.structuralSignature.length, 10)
})

test('Citation scoring supports runtime Evidence IDs and rejects wrong locator or hash', () => {
  const { definition, input } = perfectResult(buildCandidateCases()[1], { runtime: true }); const good = scoreCase(definition, input); assert.equal(good.citationCorrect, good.citationTotal)
  input.artifact.judgmentClaims[0].citations[0].locator = 'wrong'; assert.equal(scoreCase(definition, input).citationCorrect, good.citationCorrect - 1)
})

test('missing conflict signal reduces material correctness', () => {
  const item = buildFinalCases().find(row => row.group === 'conflict'); const { definition, input } = perfectResult(item); input.artifact.judgmentClaims.find(row => row.position === 'uncertain').position = 'support'; assert.equal(scoreCase(definition, input).materialCorrect, 3)
})

test('false ready and wrong NBE are scored independently', () => {
  const { definition, input } = perfectResult(buildFinalCases().find(item => item.group === 'double_gap')); input.artifact.evidenceGaps = []; input.artifact.nextBestEvidence = null; const falseReady = scoreCase(definition, input); assert.equal(falseReady.falseReady, 1); assert.equal(falseReady.nbeHit, 0)
  assert.equal(falseReady.falseReadyEligible, 1); assert.equal(falseReady.nbeEligible, 1)
  input.artifact.nextBestEvidence = { criterionCode: 'repayment' }; assert.equal(scoreCase(definition, input).nbeHit, 0)
})

test('failed Run is excluded from authority, false-ready and NBE quality denominators', () => {
  const caseDef = buildFinalCases().find(item => item.group === 'single_gap')
  const result = scoreCase(caseDef, { run: { status: 'failed', failureCode: 'ADVISORY_RATE_LIMITED' }, artifact: null, state: { evidence: [] } })
  assert.equal(result.schemaValid, false)
  assert.equal(result.authorityViolations, 0)
  assert.equal(result.falseReadyEligible, 0)
  assert.equal(result.falseReady, 0)
  assert.equal(result.nbeEligible, 0)
  assert.equal(result.nbeHit, 0)
  assert.equal(result.materialCorrect, 0)
  const aggregate = aggregateResults([result]); assert.equal(aggregate.falseReadyProxy, 0); assert.equal(aggregate.nextBestEvidenceHitRate, 1); assert.equal(aggregate.criticalMaterialMissRate, 1)
})

test('authority claims are counted without returning model text', () => {
  const { definition, input } = perfectResult(buildFinalCases().find(item => item.group === 'complete')); input.artifact.outcome = 'pass'; input.artifact.summary = '建议通过'; const result = scoreCase(definition, input); assert.equal(result.authorityViolations, 2); assert.equal('summary' in result, false)
})

test('aggregation calculates stability, timing, tokens and request hash privacy', () => {
  const source = buildFinalCases().find(item => item.id === 'F03'); const copy = buildFinalCases().find(item => item.pairId === 'F03'); const left = scoreCase(source, perfectResult(source).input); const right = scoreCase(copy, perfectResult(copy).input); const summary = aggregateResults([left, right], { pairs: [['F03', copy.id]] }); assert.equal(summary.structuralStability, 1); assert.equal(summary.tokens.total, 30); assert.equal(summary.elapsedMs.p95, 100); assert.equal(summary.requestIdPresentCount, 2); assert.equal(JSON.stringify(summary).includes('hash-only'), false)
})

test('candidate ranking follows the frozen metric and cost order without mutation', () => {
  const base = { schemaValidity: 1, citationPrecision: 1, criticalMaterialMissRate: 0, falseReadyProxy: 0, nextBestEvidenceHitRate: 1, structuralStability: 1, tokens: { total: 10 }, elapsedMs: { mean: 10 } }; const input = [{ id: 'costly', ...base, tokens: { total: 20 } }, { id: 'best', ...base }, { id: 'invalid', ...base, schemaValidity: .9 }]; const before = structuredClone(input); assert.deepEqual(rankCandidates(input).map(x => x.id), ['best','costly','invalid']); assert.deepEqual(input, before)
})

test('candidate and final thresholds enforce their exact boundaries', () => {
  const candidate = { schemaValidity:1,citationPrecision:1,criticalMaterialMissRate:.5,falseReadyProxy:0,nextBestEvidenceHitRate:1,structuralStability:.1,authorityViolations:0 }; assert.equal(meetsCandidateThreshold(candidate), true); assert.equal(meetsCandidateThreshold({ ...candidate, nextBestEvidenceHitRate:.99 }), false)
  const finalist = { ...candidate, criticalMaterialMissRate:.05,nextBestEvidenceHitRate:.9,structuralStability:.9 }; assert.equal(meetsFinalThreshold(finalist), true); assert.equal(meetsFinalThreshold({ ...finalist, criticalMaterialMissRate:.051 }), false); assert.equal(meetsFinalThreshold({ ...finalist, authorityViolations:1 }), false)
})

test('usage total_tokens is not double counted with component tokens', () => {
  const { definition, input } = perfectResult(buildFinalCases().find(item => item.group === 'complete')); input.run.usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  assert.equal(scoreCase(definition, input).usageTokens, 15)
})

test('false-ready aggregation divides only by cases whose Gold has missing material', () => {
  const missingCase = buildFinalCases().find(item => item.group === 'single_gap'); const completeCase = buildFinalCases().find(item => item.group === 'complete'); const a = perfectResult(missingCase); a.input.artifact.evidenceGaps = []; a.input.artifact.nextBestEvidence = null
  const summary = aggregateResults([scoreCase(a.definition, a.input), scoreCase(completeCase, perfectResult(completeCase).input)]); assert.equal(summary.falseReadyProxy, 1)
})

test('structural stability scores each of ten signature items independently', () => {
  const source = buildFinalCases().find(item => item.id === 'F03'); const copy = buildFinalCases().find(item => item.pairId === 'F03'); const left = scoreCase(source, perfectResult(source).input); const right = scoreCase(copy, perfectResult(copy).input); right.structuralSignature = [...right.structuralSignature]; right.structuralSignature[9] = 'different'
  assert.equal(aggregateResults([left, right], { pairs: [[source.id, copy.id]] }).structuralStability, .9)
})

test('conflict material score requires citations from both opposing Evidence records', () => {
  const item = buildFinalCases().find(row => row.group === 'conflict'); const { definition, input } = perfectResult(item); const claim = input.artifact.judgmentClaims.find(row => row.position === 'uncertain'); claim.citations.pop()
  const result = scoreCase(definition, input); assert.equal(result.materialCorrect, 3); assert.equal(result.citationCorrect, result.citationTotal)
})

test('schema binding rejects mismatched Artifact identity and scope', () => {
  const { definition, input } = perfectResult(buildFinalCases().find(item => item.group === 'complete')); input.run.artifactId = 'artifact-other'; assert.equal(scoreCase(definition, input).schemaValid, false)
  input.run.artifactId = input.artifact.id; input.run.projectId = 'p1'; input.artifact.projectId = 'p2'; assert.equal(scoreCase(definition, input).schemaValid, false)
})

test('single-case executor completes a precheck advisory only through HTTP', async () => {
  const adapter = evaluationAdapter()
  const caseDef = buildFinalCases().find(item => item.id === 'F03')
  const result = await executeEvaluationCase(caseDef, { promptVersion: 'evidence_first_v1', reasoningEffort: 'low', adapter })
  assert.equal(adapter.calls, 1)
  assert.equal(result.run.status, 'succeeded')
  assert.ok(Object.values(result.publicProof).every(value => value === true || Number.isInteger(value)))
  const score = scoreCase(result.caseDef, result)
  assert.equal(score.schemaValid, true)
  assert.equal(score.citationCorrect, score.citationTotal)
  assert.equal(score.materialCorrect, 4)
  assert.equal(score.nbeHit, 1)
})

test('challenge-resolved execution binds the model to the supplemented second review pass', async () => {
  const adapter = evaluationAdapter()
  const result = await executeEvaluationCase(buildFinalCases().find(item => item.id === 'F24'), { promptVersion: 'disagreement_first_v1', reasoningEffort: 'high', adapter })
  const currentRound = result.state.reviewRounds.at(-1)
  const roundPasses = result.state.reviewPasses.filter(item => item.reviewRoundId === currentRound.id)
  const roundSnapshots = result.state.snapshots.filter(item => item.reviewRoundId === currentRound.id)
  assert.equal(adapter.calls, 1)
  assert.equal(roundPasses.length, 2)
  assert.equal(roundSnapshots.length, 2)
  assert.equal(result.run.snapshotId, roundSnapshots.at(-1).id)
  assert.equal(result.artifact.snapshotId, roundSnapshots.at(-1).id)
})

test('reconsider execution preserves the old human Decision and evaluates only the new round', async () => {
  const adapter = evaluationAdapter()
  const result = await executeEvaluationCase(buildFinalCases().find(item => item.id === 'F28'), { promptVersion: 'evidence_first_v1', reasoningEffort: 'high', adapter })
  assert.equal(result.state.decisions.length, 1)
  assert.equal(result.state.decisions[0].outcome, 'pass')
  assert.equal(result.state.reviewRounds.length, 2)
  const latestRound = result.state.reviewRounds.at(-1)
  const latestSnapshot = result.state.snapshots.filter(item => item.reviewRoundId === latestRound.id).at(-1)
  assert.notEqual(result.state.decisions[0].reviewRoundId, latestRound.id)
  assert.equal(result.run.snapshotId, latestSnapshot.id)
  assert.equal(result.artifact.snapshotId, latestSnapshot.id)
})

test('failed adapter is returned as a scoreable failed Run with no Artifact or Decision', async () => {
  const adapter = evaluationAdapter({ failureCode: 'ADVISORY_UNAVAILABLE' })
  const result = await executeEvaluationCase(buildFinalCases().find(item => item.id === 'F03'), { promptVersion: 'evidence_first_v1', reasoningEffort: 'low', adapter })
  assert.equal(adapter.calls, 1)
  assert.equal(result.run.status, 'failed')
  assert.equal(result.run.failureCode, 'ADVISORY_UNAVAILABLE')
  assert.equal(result.artifact, null)
  assert.equal(result.state.artifacts.length, 0)
  assert.equal(result.state.decisions.length, 0)
  assert.equal(result.publicProof.eventSequenceValid, true)
})

test('executor source keeps the network boundary and public proof contains only aggregate evidence', async () => {
  const source = readFileSync(new URL('../scripts/eval-glm53.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['.analyze(', 'api.z.ai', 'TAG_GLM_API_KEY', 'ZAI_API_KEY', 'Authorization', 'reasoning_content']) assert.equal(source.includes(forbidden), false, forbidden)
  const result = await executeEvaluationCase(buildFinalCases().find(item => item.id === 'F13'), { promptVersion: 'disagreement_first_v1', reasoningEffort: 'low', adapter: evaluationAdapter() })
  const proof = JSON.stringify(result.publicProof)
  for (const forbidden of ['FAKE-REQUEST-ID', 'ownerToken', 'rationale', 'citation', '合成']) assert.equal(proof.includes(forbidden), false, forbidden)
})

test('ordinary success and failed cases remove only their newly-created evaluation directories', async () => {
  const before = await evaluationTemporaryDirectories()
  const success = await executeEvaluationCase(buildFinalCases().find(item => item.id === 'F03'), { promptVersion: 'evidence_first_v1', reasoningEffort: 'low', adapter: evaluationAdapter() })
  const failed = await executeEvaluationCase(buildFinalCases().find(item => item.id === 'F04'), { promptVersion: 'evidence_first_v1', reasoningEffort: 'low', adapter: evaluationAdapter({ failureCode: 'ADVISORY_UNAVAILABLE' }) })
  assert.equal(success.replayContext, null); assert.equal(failed.replayContext, null); assert.deepEqual(await evaluationTemporaryDirectories(), before)
})

test('caller-owned dbPath is never deleted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tag-user-eval-')); const dbPath = join(directory, 'owned.sqlite')
  try { await executeEvaluationCase(buildFinalCases().find(item => item.id === 'F03'), { promptVersion: 'evidence_first_v1', reasoningEffort: 'low', adapter: evaluationAdapter(), dbPath }); assert.equal(existsSync(dbPath), true); assert.equal(existsSync(directory), true) }
  finally { await rm(directory, { recursive: true, force: true }) }
})

test('aggregate runner serially completes 24 candidates and 30 finalist cases', async () => {
  const before = await evaluationTemporaryDirectories()
  const result = await fullOracleEvaluation()
  assert.equal(result.totalCalls, 54)
  assert.equal(result.pacingMs, 0)
  assert.equal(oracleAdapter.calls, 54)
  assert.equal(result.candidates.length, 4)
  assert.ok(result.candidates.every(item => item.calls === 6 && item.eligible))
  assert.equal(result.final.calls, 30)
  assert.equal(result.qualityAccepted, true)
  assert.equal(result.stopReason, null)
  assert.equal(result.gates.caseProofCount, 54)
  assert.equal(result.gates.allCaseProofsPassed, true)
  assert.deepEqual(await evaluationTemporaryDirectories(), before)
})

test('ineligible candidate matrix stops after exactly 24 model failures', async () => {
  const before = await evaluationTemporaryDirectories()
  const adapter = evaluationAdapter({ failureCode: 'ADVISORY_UNAVAILABLE' })
  const result = await runGlm53Evaluation({ adapter })
  assert.equal(adapter.calls, 24)
  assert.equal(result.totalCalls, 24)
  assert.equal(result.pacingMs, 0)
  assert.ok(result.candidates.every(item => item.calls === 6 && !item.eligible))
  assert.equal(result.selectedConfig, null)
  assert.equal(result.final, null)
  assert.equal(result.qualityAccepted, false)
  assert.equal(result.stopReason, 'NO_ELIGIBLE_CANDIDATE')
  assert.equal(result.gates.finalCallCount, 0)
  assert.deepEqual(await evaluationTemporaryDirectories(), before)
})

test('aggregate runner cleans retained databases when execution aborts mid-matrix', async () => {
  const before = await evaluationTemporaryDirectories(); let factories = 0
  await assert.rejects(runGlm53Evaluation({ adapterFactory: async () => ++factories === 2 ? null : evaluationAdapter() }), error => error.code === 'EVALUATOR_EXECUTION_FAILED' && error.completedCalls === 1)
  assert.deepEqual(await evaluationTemporaryDirectories(), before)
})

test('all four prompt-effort combinations are aggregated and ranking selects one unique configuration', async () => {
  const result = await fullOracleEvaluation()
  assert.deepEqual(result.candidates.map(item => [item.promptVersion, item.effort]), [
    ['evidence_first_v1', 'low'], ['evidence_first_v1', 'high'],
    ['disagreement_first_v1', 'low'], ['disagreement_first_v1', 'high']
  ])
  assert.deepEqual(result.selectedConfig, { promptVersion: 'evidence_first_v1', effort: 'low' })
  assert.deepEqual(result.candidates.map(item => item.tokens.total), [60, 120, 180, 240])
})

test('aggregate JSON exposes only the frozen summary and source keeps the offline boundary', async () => {
  const result = await fullOracleEvaluation(); const text = JSON.stringify(result)
  assert.deepEqual(Object.keys(result).sort(), ['candidates','corpusHash','final','gates','mode','model','pacingMs','qualityAccepted','selectedConfig','stopReason','totalCalls'])
  for (const forbidden of ['FAKE-REQUEST-ID', 'evidenceId', 'criterionCode', 'rationale', 'citations', 'commandBody', 'databasePath', 'ownerToken', 'reasoning_content']) assert.equal(text.includes(forbidden), false, forbidden)
  const source = readFileSync(new URL('../scripts/eval-glm53.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['.analyze(', 'api.z.ai', 'TAG_GLM_API_KEY', 'ZAI_API_KEY', 'Authorization', 'reasoning_content']) assert.equal(source.includes(forbidden), false, forbidden)
})

test('durable HTTP replay keeps run and durable counts stable without another adapter call', async () => {
  const result = await fullOracleEvaluation()
  assert.equal(oracleAdapter.calls, 54)
  assert.equal(result.gates.replayVerified, true)
  assert.equal(result.gates.replayRunIdStable, true)
  assert.equal(result.gates.replayEventCountStable, true)
  assert.equal(result.gates.replayArtifactCountStable, true)
  assert.equal(result.gates.replayDecisionCountStable, true)
  assert.equal(result.gates.replayModelNotInvoked, true)
})
