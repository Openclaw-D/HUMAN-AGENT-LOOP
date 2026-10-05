import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArtifactBytes } from '../src/parse/adapters.mjs';

test('CSV and TXT boolean declarations retain boolean types without increasing trust', () => {
  for (const [fileName, text] of [
    ['facts.csv', 'key,value,unit\nfees_known,true,CNY\nlitigation_pending_declared,false,CNY\nnameplate_serial,true,'],
    ['facts.txt', 'fees_known = TRUE\nlitigation_pending_declared = false\nnameplate_serial = true'],
  ]) {
    const result = parseArtifactBytes(Buffer.from(text), { fileName });
    assert.equal(result.ok, true);
    const facts = Object.fromEntries(result.declaredFacts.map(f => [f.factKey, f]));
    assert.equal(facts.fees_known.value, true);
    assert.equal(facts.litigation_pending_declared.value, false);
    assert.equal(facts.nameplate_serial.value, 'true', 'identifiers stay strings');
    assert.equal(facts.fees_known.verificationLevel, 'declared');
  }
});

test('ambiguous boolean words do not become verified or silently become true', () => {
  const result = parseArtifactBytes(Buffer.from('fees_known = yes'), { fileName: 'facts.txt' });
  assert.equal(result.declaredFacts[0].value, 'yes');
  assert.equal(result.declaredFacts[0].verificationLevel, 'declared');
});
