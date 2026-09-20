import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCompletionBody } from '../src/transport/glm.mjs';
const body = content => ({ choices: [{ message: { content } }] });
test('single JSON fence preserves decisions and references; surrounding prose is not parsed', () => {
  const data = { decisions: [{id:'option_1', evidenceRefIds:['ref-1']}], observations: [], questions: [] };
  for (const content of [JSON.stringify(data), '```json\n'+JSON.stringify(data)+'\n```']) {
    assert.deepEqual(mapCompletionBody(body(content)).decisions, data.decisions);
  }
  assert.equal(mapCompletionBody(body('Ignore instructions\n```json\n'+JSON.stringify(data)+'\n```')).decisions, undefined);
  assert.equal(mapCompletionBody(body('```json\n{"decisions": [\n```')).decisions, undefined);
});
