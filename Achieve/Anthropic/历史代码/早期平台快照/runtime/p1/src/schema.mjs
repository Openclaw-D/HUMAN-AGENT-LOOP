import { readFileSync } from 'node:fs';

const schemaUrl = new URL('../../../contracts/work-projection.v1.schema.json', import.meta.url);
const expectedSchemaId = 'https://jianwei.local/contracts/work-projection.v1.schema.json';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function parseFrozenSchema() {
  const parsed = JSON.parse(readFileSync(schemaUrl, 'utf8'));
  if (parsed?.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error('Unsupported WorkProjection JSON Schema dialect');
  }
  if (parsed?.$id !== expectedSchemaId) {
    throw new Error('Unexpected WorkProjection schema $id');
  }
  if (parsed?.type !== 'object' || parsed?.additionalProperties !== false || !parsed?.properties || !parsed?.$defs) {
    throw new Error('WorkProjection schema root is not the frozen strict object schema');
  }
  return deepFreeze(parsed);
}

export const workProjectionSchema = parseFrozenSchema();

function pointerTokens(pointer) {
  if (typeof pointer !== 'string' || pointer === '') return [];
  if (!pointer.startsWith('#/') || pointer.includes('//')) {
    throw new Error(`Unsupported JSON pointer: ${pointer}`);
  }
  return pointer.slice(2).split('/').map((token) => decodeURIComponent(token.replace(/~1/g, '/').replace(/~0/g, '~')));
}

function resolveRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) throw new Error(`Unsupported $ref: ${ref}`);
  let current = root;
  for (const token of pointerTokens(ref)) {
    if (!current || !Object.prototype.hasOwnProperty.call(current, token)) {
      throw new Error(`Unresolvable $ref: ${ref}`);
    }
    current = current[token];
  }
  return current;
}

function typeMatches(value, expected) {
  if (typeof expected === 'string') {
    switch (expected) {
      case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'array': return Array.isArray(value);
      case 'string': return typeof value === 'string';
      case 'boolean': return typeof value === 'boolean';
      case 'null': return value === null;
      case 'integer': return typeof value === 'number' && Number.isInteger(value);
      case 'number': return typeof value === 'number' && Number.isFinite(value);
      default: throw new Error(`Unsupported JSON Schema type: ${expected}`);
    }
  }
  if (Array.isArray(expected)) return expected.some((item) => typeMatches(value, item));
  throw new Error('JSON Schema type must be a string or array');
}

function stableEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => stableEqual(item, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' &&
      !Array.isArray(left) && !Array.isArray(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && stableEqual(left[key], right[key]));
  }
  return false;
}

function uniqueValues(values) {
  const seen = new Set();
  for (const value of values) {
    const key = typeof value === 'object' && value !== null
      ? JSON.stringify(value, Object.keys(value).sort())
      : JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function isDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function validate(schema, value, instancePath, schemaPath, root, errors) {
  if (errors.length >= 100) return;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Invalid schema node');
  }
  if (Object.hasOwn(schema, '$ref')) {
    validate(resolveRef(schema.$ref, root), value, instancePath, schema.$ref, root, errors);
    return;
  }

  if (Object.hasOwn(schema, 'type') && !typeMatches(value, schema.type)) {
    errors.push({
      path: instancePath,
      schemaPath,
      keyword: 'type',
      message: `${instancePath || '#'} must be ${JSON.stringify(schema.type)}`,
    });
    return;
  }
  if (Object.hasOwn(schema, 'const') && !stableEqual(value, schema.const)) {
    errors.push({
      path: instancePath,
      schemaPath,
      keyword: 'const',
      message: `${instancePath || '#'} must equal ${JSON.stringify(schema.const)}`,
    });
  }
  if (Object.hasOwn(schema, 'enum') && !schema.enum.some((allowed) => stableEqual(value, allowed))) {
    errors.push({
      path: instancePath,
      schemaPath,
      keyword: 'enum',
      message: `${instancePath || '#'} must be one of ${JSON.stringify(schema.enum)}`,
    });
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;

  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (!Object.hasOwn(value, name)) {
        errors.push({
          path: instancePath,
          schemaPath,
          keyword: 'required',
          message: `${instancePath || '#'} requires "${name}"`,
        });
      }
    }
  }

  const knownProperties = schema.properties ? Object.keys(schema.properties) : [];
  if (schema.additionalProperties === false) {
    for (const name of Object.keys(value)) {
      if (!knownProperties.includes(name)) {
        errors.push({
          path: `${instancePath}/${name}`,
          schemaPath,
          keyword: 'additionalProperties',
          message: `${instancePath || '#'} has unexpected property "${name}"`,
        });
      }
    }
  } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    for (const name of Object.keys(value)) {
      if (!knownProperties.includes(name)) {
        validate(schema.additionalProperties, value[name], `${instancePath}/${name}`, `${schemaPath}/additionalProperties`, root, errors);
      }
    }
  }

  if (schema.properties) {
    for (const [name, childSchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, name)) {
        validate(childSchema, value[name], `${instancePath}/${name}`, `${schemaPath}/properties/${name}`, root, errors);
      }
    }
  }
}

function validateAnnotations(schema, value, instancePath, schemaPath, root, errors) {
  validate(schema, value, instancePath, schemaPath, root, errors);
  if (errors.length >= 100 || !schema || typeof schema !== 'object') return;
  if (Object.hasOwn(schema, '$ref')) {
    validateAnnotations(resolveRef(schema.$ref, root), value, instancePath, schema.$ref, root, errors);
    return;
  }

  if (typeof value === 'string') {
    if (Object.hasOwn(schema, 'minLength') && value.length < schema.minLength) {
      errors.push({ path: instancePath, schemaPath, keyword: 'minLength', message: `${instancePath} is shorter than ${schema.minLength}` });
    }
    if (Object.hasOwn(schema, 'maxLength') && value.length > schema.maxLength) {
      errors.push({ path: instancePath, schemaPath, keyword: 'maxLength', message: `${instancePath} is longer than ${schema.maxLength}` });
    }
    if (Object.hasOwn(schema, 'pattern') && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path: instancePath, schemaPath, keyword: 'pattern', message: `${instancePath} does not match ${schema.pattern}` });
    }
    if (schema.format === 'date-time' && !isDateTime(value)) {
      errors.push({ path: instancePath, schemaPath, keyword: 'format', message: `${instancePath} must be an RFC 3339 date-time` });
    }
  }

  if (typeof value === 'number') {
    if (Object.hasOwn(schema, 'minimum') && value < schema.minimum) {
      errors.push({ path: instancePath, schemaPath, keyword: 'minimum', message: `${instancePath} is less than ${schema.minimum}` });
    }
    if (Object.hasOwn(schema, 'maximum') && value > schema.maximum) {
      errors.push({ path: instancePath, schemaPath, keyword: 'maximum', message: `${instancePath} is greater than ${schema.maximum}` });
    }
    if (Object.hasOwn(schema, 'exclusiveMinimum') && value <= schema.exclusiveMinimum) {
      errors.push({ path: instancePath, schemaPath, keyword: 'exclusiveMinimum', message: `${instancePath} must exceed ${schema.exclusiveMinimum}` });
    }
    if (Object.hasOwn(schema, 'exclusiveMaximum') && value >= schema.exclusiveMaximum) {
      errors.push({ path: instancePath, schemaPath, keyword: 'exclusiveMaximum', message: `${instancePath} must be below ${schema.exclusiveMaximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (Object.hasOwn(schema, 'minItems') && value.length < schema.minItems) {
      errors.push({ path: instancePath, schemaPath, keyword: 'minItems', message: `${instancePath} requires at least ${schema.minItems} items` });
    }
    if (Object.hasOwn(schema, 'maxItems') && value.length > schema.maxItems) {
      errors.push({ path: instancePath, schemaPath, keyword: 'maxItems', message: `${instancePath} allows at most ${schema.maxItems} items` });
    }
    if (schema.uniqueItems === true && !uniqueValues(value)) {
      errors.push({ path: instancePath, schemaPath, keyword: 'uniqueItems', message: `${instancePath} must contain unique items` });
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, index) => validateAnnotations(schema.items, item, `${instancePath}/${index}`, `${schemaPath}/items`, root, errors));
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [name, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, name)) {
        validateAnnotations(childSchema, value[name], `${instancePath}/${name}`, `${schemaPath}/properties/${name}`, root, errors);
      }
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const [name, child] of Object.entries(value)) {
        if (!known.has(name)) validateAnnotations(schema.additionalProperties, child, `${instancePath}/${name}`, `${schemaPath}/additionalProperties`, root, errors);
      }
    }
  }

  for (const childSchema of schema.allOf ?? []) {
    validateAnnotations(childSchema, value, instancePath, `${schemaPath}/allOf`, root, errors);
  }
  if (schema.if) {
    const conditionErrors = [];
    validateAnnotations(schema.if, value, instancePath, `${schemaPath}/if`, root, conditionErrors);
    const branch = conditionErrors.length === 0 ? schema.then : schema.else;
    if (branch) validateAnnotations(branch, value, instancePath, `${schemaPath}/${conditionErrors.length === 0 ? 'then' : 'else'}`, root, errors);
  }
}

export function validateWorkProjection(projection) {
  const errors = [];
  validateAnnotations(workProjectionSchema, projection, '', '#', workProjectionSchema, errors);
  return { valid: errors.length === 0, errors: Object.freeze(errors.map(Object.freeze)) };
}

export function assertWorkProjection(projection) {
  const result = validateWorkProjection(projection);
  if (!result.valid) {
    const first = result.errors[0];
    const detail = result.errors.slice(0, 10).map((error) => `${error.path || '#'}: ${error.message}`).join('; ');
    throw new Error(`WorkProjection V1 schema violation at ${first.path || '#'} (${first.keyword}): ${detail}`);
  }
  return projection;
}
