export function validateJsonSchema(value, schema, options = {}) {
  const errors = [];
  visit(value, schema && typeof schema === "object" ? schema : {}, options.path || "args", errors, options);
  return errors;
}

function visit(value, schema, path, errors, options) {
  if (!schema || typeof schema !== "object" || Object.keys(schema).length === 0) return;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((type) => typeMatches(value, type))) {
    errors.push(`${path} expected ${types.join(" or ")}, got ${valueType(value)}`);
    return;
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === "string") validateString(value, schema, path, errors);
  if (typeof value === "number" && Number.isFinite(value)) validateNumber(value, schema, path, errors);
  if (Array.isArray(value)) validateArray(value, schema, path, errors, options);
  if (value && typeof value === "object" && !Array.isArray(value)) validateObject(value, schema, path, errors, options);
}

function validateString(value, schema, path, errors) {
  if (Number.isFinite(schema.minLength) && value.length < schema.minLength) errors.push(`${path} must contain at least ${schema.minLength} characters`);
  if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) errors.push(`${path} must contain at most ${schema.maxLength} characters`);
  if (schema.pattern) {
    try {
      if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} must match ${schema.pattern}`);
    } catch {
      errors.push(`${path} uses an invalid schema pattern`);
    }
  }
}

function validateNumber(value, schema, path, errors) {
  if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
  if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
}

function validateArray(value, schema, path, errors, options) {
  if (Number.isFinite(schema.minItems) && value.length < schema.minItems) errors.push(`${path} must contain at least ${schema.minItems} items`);
  if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) errors.push(`${path} must contain at most ${schema.maxItems} items`);
  if (schema.items && typeof schema.items === "object") {
    value.forEach((item, index) => visit(item, schema.items, `${path}[${index}]`, errors, options));
  }
}

function validateObject(value, schema, path, errors, options) {
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  for (const name of Array.isArray(schema.required) ? schema.required : []) {
    const missing = !Object.hasOwn(value, name) || value[name] === undefined || value[name] === null || (options.requiredNonEmpty !== false && value[name] === "");
    if (missing) errors.push(`${path}.${name} is required`);
  }
  for (const [name, item] of Object.entries(value)) {
    if (Object.hasOwn(properties, name)) visit(item, properties[name], `${path}.${name}`, errors, options);
    else if (schema.additionalProperties === false) errors.push(`${path}.${name} is not allowed`);
    else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      visit(item, schema.additionalProperties, `${path}.${name}`, errors, options);
    }
  }
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  return true;
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
