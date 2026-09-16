import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROUTES = [
  '../app/api/v3/shared/context/route.ts',
  '../app/api/v3/shared/messages/route.ts',
  '../app/api/v3/shared/messages/retry/route.ts',
  '../app/api/v3/shared/demo-reset/route.ts',
  '../app/api/v3/collaboration/projection/route.ts',
  '../app/api/v3/value/projection/route.ts',
];

test('shared, collaboration and value APIs stay inside the shared SQLite runtime contract', () => {
  for (const relativePath of ROUTES) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /sharedMethodNotAllowed/);
    assert.doesNotMatch(source, /v3-live-shell|professional_gate|recordHumanGate|AUTHORITY/);
  }
  const messageSource = readFileSync(new URL('../app/api/v3/shared/messages/route.ts', import.meta.url), 'utf8');
  assert.match(messageSource, /getV3SharedRuntime\(\)\.sendMessage/);
  const resetSource = readFileSync(new URL('../app/api/v3/shared/demo-reset/route.ts', import.meta.url), 'utf8');
  assert.match(resetSource, /confirmation/);
});
