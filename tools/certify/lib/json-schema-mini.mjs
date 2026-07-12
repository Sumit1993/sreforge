// json-schema-mini.mjs — a tiny, dependency-free JSON Schema validator.
//
// Supports exactly the keyword subset the ADR-0026 manifest schemas use:
//   type (incl. "integer" and type arrays), required, properties,
//   additionalProperties (boolean), enum, const, items (single schema),
//   contains (single schema, ≥1 match), minItems, minLength, minimum, maximum,
//   pattern, $ref (local "#/$defs/...").
// This keeps `certify` and the offline CI check zero-dependency. The schemas
// are written as standard JSON Schema, so a full validator (ajv) can replace
// this later without touching the schema files. Returns a list of error
// strings ([] = valid).
export function validate(schema, data, rootSchema = schema, path = "") {
  const errs = [];
  const at = path || "(root)";

  if (schema.$ref) {
    const target = resolveRef(schema.$ref, rootSchema);
    if (!target) return [`${at}: cannot resolve $ref ${schema.$ref}`];
    return validate(target, data, rootSchema, path);
  }

  if (schema.const !== undefined && !deepEqual(schema.const, data)) {
    errs.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((v) => deepEqual(v, data))) {
    errs.push(`${at}: must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(t, data))) {
      errs.push(`${at}: expected type ${types.join("|")}, got ${jsonType(data)}`);
      return errs; // type mismatch → skip structural checks
    }
  }

  if (typeof data === "string") {
    if (schema.minLength != null && data.length < schema.minLength) {
      errs.push(`${at}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errs.push(`${at}: does not match pattern ${schema.pattern}`);
    }
  }

  if (typeof data === "number") {
    if (schema.minimum != null && data < schema.minimum) {
      errs.push(`${at}: less than minimum ${schema.minimum}`);
    }
    if (schema.maximum != null && data > schema.maximum) {
      errs.push(`${at}: greater than maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems != null && data.length < schema.minItems) {
      errs.push(`${at}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.items) {
      data.forEach((v, i) => errs.push(...validate(schema.items, v, rootSchema, `${at}[${i}]`)));
    }
    if (schema.contains && !data.some((v) => validate(schema.contains, v, rootSchema, at).length === 0)) {
      errs.push(`${at}: no item satisfies "contains"`);
    }
  }

  if (isObject(data) && (schema.properties || schema.required || schema.additionalProperties === false)) {
    for (const key of schema.required || []) {
      if (!(key in data)) errs.push(`${at}: missing required property "${key}"`);
    }
    const props = schema.properties || {};
    for (const [key, val] of Object.entries(data)) {
      if (props[key]) {
        errs.push(...validate(props[key], val, rootSchema, `${at}.${key}`));
      } else if (schema.additionalProperties === false) {
        errs.push(`${at}: unexpected property "${key}"`);
      }
    }
  }

  return errs;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) return null;
  return ref
    .slice(2)
    .split("/")
    .reduce((o, k) => (o ? o[k] : undefined), root);
}

function typeOk(t, v) {
  if (t === "integer") return typeof v === "number" && Number.isInteger(v);
  return typeOk2(t, v);
}
function typeOk2(t, v) {
  switch (t) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number";
    case "boolean": return typeof v === "boolean";
    case "object": return isObject(v);
    case "array": return Array.isArray(v);
    case "null": return v === null;
    default: return false;
  }
}
function jsonType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
