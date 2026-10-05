import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildZoneSemantic } from '../src/domain/zone-semantic.ts';

test('semantic duplicate requests share one provider call, bind inputs and survive replay', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jw-semantic-'));
  let hits = 0, hang = false;
  const server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      hits++;
      if(hang)return;
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ model: 'offline-test', choices: [{ message: { content: JSON.stringify({ decisions: [
          { id: 'f1', label: '核对费用原件', impact: '补证后复核', evidenceRefIds: ['a1'], confidence: null },
        ] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })); }, 60);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify({ transport: { mode: 'mock', mock: {
    baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 800, model: 'offline-test',
  } }, budget: { maxTotalCost: 1, perCallEstimate: 0.01, currency: 'CNY' } }));
  const options = { configPath, receiptsDir: dir };
  const model = buildZoneSemantic(options);
  const ctx = { tenantId: 't', customerId: 'c', jobId: 'j', domain: 'commerce', requestId: 'r1', feedback: [],
    candidate: { assessment: { summary: '待复核', evidenceRefs: [{ materialId: 'a1' }] } } };
  const results = await Promise.all(Array.from({ length: 8 }, () => model.run(ctx)));
  assert.ok(results.every(r => r.status === 'simulated'), JSON.stringify(results));
  assert.equal(hits, 1);
  const ledger = (await readFile(path.join(dir, 'zone-semantic-cost.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(ledger.filter(x => x.type === 'actual').length, 1);
  const restarted = buildZoneSemantic(options);
  assert.equal((await restarted.run(ctx)).replayed, true);
  assert.equal(hits, 1);
  await assert.rejects(() => restarted.run({ ...ctx, customerId: 'other' }), /请求/);
  assert.equal(hits, 1);

  // Two module instances compete for the same durable claim; only one may send.
  const next = { ...ctx, requestId: 'r2' };
  const cross = await Promise.all([model.run(next), restarted.run(next)]);
  assert.equal(hits, 2);
  assert.ok(cross.some(r => r.status === 'simulated'));
  assert.ok(cross.every(r => ['unknown', 'simulated'].includes(r.status)));
  assert.equal((await restarted.run(next)).status, 'simulated');

  // A prior intent without a terminal is a reconciliation boundary, never a retry.
  const persisted = (await readFile(path.join(dir, 'zone-semantic-receipts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  await writeFile(path.join(dir, 'zone-semantic-receipts.jsonl'), persisted.filter(x => x.requestId !== 'r2' || x.phase === 'intent').map(JSON.stringify).join('\n') + '\n');
  assert.equal((await restarted.run(next)).status, 'unknown');
  assert.equal(hits, 2);
  hang=true;
  const timed={...ctx,requestId:'r3'};
  const timeout=await model.run(timed);
  assert.equal(timeout.status,'unknown');
  assert.equal(timeout.sent,null,'timeout cannot be described as definitely unsent');
  assert.equal((await restarted.run(timed)).status,'unknown');
  assert.equal(hits,3,'uncertain timeout is never automatically resent');
});
