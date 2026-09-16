'use strict';

const TERMINALS = new Set(['completed', 'failed']);

function requireStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new TypeError(`${label} must contain only strings`);
    }
    if (seen.has(item)) {
      throw new TypeError(`duplicate ${label}`);
    }
    seen.add(item);
  }
}

function validateExpected(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('expected must be an array');
  }

  const ids = new Set();
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('each expected item must be an object');
    }
    if (typeof item.id !== 'string' || item.id === '') {
      throw new TypeError('expected id must be a non-empty string');
    }
    if (ids.has(item.id)) {
      throw new TypeError(`duplicate expected id: ${item.id}`);
    }
    ids.add(item.id);
    requireStringArray(item.requiredFiles, `expected id ${item.id} requiredFiles`);
    requireStringArray(item.requiredChecks, `expected id ${item.id} requiredChecks`);
  }
}

function validateObserved(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('observed must be an array');
  }

  const ids = new Set();
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('each observed item must be an object');
    }
    if (typeof item.id !== 'string' || item.id === '') {
      throw new TypeError('observed id must be a non-empty string');
    }
    if (ids.has(item.id)) {
      throw new TypeError(`duplicate observed id: ${item.id}`);
    }
    ids.add(item.id);
    if (!TERMINALS.has(item.terminal)) {
      throw new TypeError(`observed id ${item.id} terminal is invalid`);
    }
    requireStringArray(item.files, `observed id ${item.id} files`);
    requireStringArray(item.checks, `observed id ${item.id} checks`);
  }
}

function reconcileCheckpoints(expected, observed) {
  validateExpected(expected);
  validateObserved(observed);

  const observedById = new Map();
  for (const item of observed) {
    observedById.set(item.id, item);
  }

  const accepted = [];
  const rejected = [];
  const missing = [];

  for (const item of expected) {
    const match = observedById.get(item.id);
    if (match === undefined) {
      missing.push(item.id);
      continue;
    }

    const observedFiles = new Set(match.files);
    const observedChecks = new Set(match.checks);
    const missingFiles = item.requiredFiles.filter((file) => !observedFiles.has(file));
    const missingChecks = item.requiredChecks.filter((check) => !observedChecks.has(check));

    if (match.terminal === 'completed' && missingFiles.length === 0 && missingChecks.length === 0) {
      accepted.push(item.id);
    } else {
      rejected.push({
        id: item.id,
        terminal: match.terminal,
        missingFiles,
        missingChecks,
      });
    }
  }

  const expectedIds = new Set(expected.map((item) => item.id));
  const unexpected = observed.filter((item) => !expectedIds.has(item.id)).map((item) => item.id);

  return { accepted, rejected, missing, unexpected };
}

module.exports = { reconcileCheckpoints };
