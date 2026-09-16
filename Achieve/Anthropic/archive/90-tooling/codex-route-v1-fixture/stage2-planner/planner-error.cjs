'use strict';

class PlannerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PlannerError';
    this.code = code;

    if (code === 'CYCLE') {
      this.details = structuredClone(details);
    }
  }
}

module.exports = { PlannerError };
