'use strict';

const { PlannerError } = require('./planner-error.cjs');

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateInputs(jobs) {
  if (!Array.isArray(jobs)) {
    throw new PlannerError('INVALID_JOBS', 'jobs must be an array');
  }

  for (const job of jobs) {
    if (!isPlainObject(job)) {
      throw new PlannerError('INVALID_JOB', 'each job must be a plain object');
    }
    if (!isNonEmptyString(job.id)) {
      throw new PlannerError('INVALID_JOB_ID', 'job id must be a non-empty string');
    }
    if (!Array.isArray(job.dependsOn)) {
      throw new PlannerError('INVALID_DEPENDENCIES', 'dependsOn must be an array');
    }
    if (job.dependsOn.some((dependency) => !isNonEmptyString(dependency))) {
      throw new PlannerError('INVALID_DEPENDENCIES', 'dependencies must be non-empty strings');
    }
    if (new Set(job.dependsOn).size !== job.dependsOn.length) {
      throw new PlannerError('INVALID_DEPENDENCIES', 'dependencies must not contain duplicates');
    }
    if (!isPlainObject(job.payload)) {
      throw new PlannerError('INVALID_PAYLOAD', 'payload must be a plain object');
    }
    try {
      structuredClone(job.payload);
    } catch {
      throw new PlannerError('INVALID_PAYLOAD', 'payload must be structured-cloneable');
    }
  }
}

function planJobs(jobs) {
  validateInputs(jobs);

  const indexesById = new Map();
  jobs.forEach((job, index) => {
    if (indexesById.has(job.id)) {
      throw new PlannerError('DUPLICATE_JOB_ID', `duplicate job id: ${job.id}`);
    }
    indexesById.set(job.id, index);
  });

  for (const job of jobs) {
    if (job.dependsOn.includes(job.id)) {
      throw new PlannerError('SELF_DEPENDENCY', `self dependency: ${job.id}`);
    }
  }

  for (const job of jobs) {
    for (const dependency of job.dependsOn) {
      if (!indexesById.has(dependency)) {
        throw new PlannerError('UNKNOWN_DEPENDENCY', `unknown dependency: ${dependency}`);
      }
    }
  }

  const indegrees = new Array(jobs.length).fill(0);
  const dependents = jobs.map(() => []);
  for (const [index, job] of jobs.entries()) {
    for (const dependency of job.dependsOn) {
      const dependencyIndex = indexesById.get(dependency);
      dependents[dependencyIndex].push(index);
      indegrees[index] += 1;
    }
  }

  const layers = [];
  const order = [];
  let wave = [];
  for (const [index] of indegrees.entries()) {
    if (indegrees[index] === 0) {
      wave.push(index);
    }
  }

  while (wave.length > 0) {
    const nextWave = [];
    const layer = wave.map((index) => jobs[index].id);
    layers.push(layer);
    order.push(...layer);

    for (const index of wave) {
      for (const dependentIndex of dependents[index]) {
        indegrees[dependentIndex] -= 1;
        if (indegrees[dependentIndex] === 0) {
          nextWave.push(dependentIndex);
        }
      }
    }

    wave = nextWave;
  }

  if (order.length !== jobs.length) {
    const remainingIds = [];
    for (const [index, job] of jobs.entries()) {
      if (indegrees[index] > 0) {
        remainingIds.push(job.id);
      }
    }
    throw new PlannerError('CYCLE', 'dependency cycle detected', {
      remainingIds,
    });
  }

  return {
    order,
    layers,
    jobs: order.map((id) => structuredClone(jobs[indexesById.get(id)])),
  };
}

module.exports = { planJobs };
